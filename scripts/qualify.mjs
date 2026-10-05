import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, chmod, chown, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.versions.node.split(".")[0] !== "22")
  throw new Error("QUALIFICATION_NODE_22_REQUIRED");
const directory = await mkdtemp(path.join(tmpdir(), "scalper-qualification-"));
await chmod(directory, 0o755);
const logs = path.join(directory, "checks");
await mkdir(logs, { mode: 0o700 });
const results = [];
let activeChild = null;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    activeChild?.kill("SIGTERM");
  });
async function run(label, executable, args, options = {}) {
  if (stopping && label !== "database-stop")
    throw new Error("QUALIFICATION_INTERRUPTED");
  const started = Date.now();
  const output = [];
  const code = await new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    const timeout = setTimeout(() => child.kill("SIGTERM"), 600_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      if (activeChild === child) activeChild = null;
    });
    child.once("error", () => {
      clearTimeout(timeout);
      if (activeChild === child) activeChild = null;
    });
    child.stdout.on("data", (data) => output.push(data));
    child.stderr.on("data", (data) => output.push(data));
    child.once("error", () => resolve(127));
    child.once("exit", (value) => resolve(value ?? 1));
  });
  await writeFile(path.join(logs, label + ".log"), Buffer.concat(output), {
    mode: 0o600,
  });
  results.push({
    label,
    executable,
    args,
    code,
    elapsedMs: Date.now() - started,
  });
  process.stdout.write(`${label}: ${code === 0 ? "PASS" : "FAIL"}\n`);
  if (code !== 0) throw new Error("QUALIFICATION_FAILED:" + label);
  return Buffer.concat(output).toString("utf8").trim();
}
const postgresBin = await run("postgres-bindir", "pg_config", ["--bindir"]);
const asRoot = process.getuid?.() === 0;
const dbRun = (label, name, args) =>
  asRoot
    ? run(
        label,
        "runuser",
        ["-u", "postgres", "--", path.join(postgresBin, name), ...args],
        { cwd: directory },
      )
    : run(label, path.join(postgresBin, name), args, { cwd: directory });
let started = false;
try {
  const data = path.join(directory, "database");
  const cert = path.join(directory, "server.crt"),
    key = path.join(directory, "server.key");
  await run("test-certificate", "openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  await chmod(key, 0o600);
  if (asRoot) {
    const uid = Number(await run("postgres-uid", "id", ["-u", "postgres"]));
    const gid = Number(await run("postgres-gid", "id", ["-g", "postgres"]));
    await chown(directory, uid, gid);
    await chown(key, uid, gid);
  }
  await dbRun("database-init", "initdb", [
    "-D",
    data,
    "-U",
    "scalper_qualification",
    "--auth-local=trust",
    "--auth-host=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const value = address.port;
      server.close(() => resolve(value));
    });
  });
  started = true;
  await dbRun("database-start", "pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(directory, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${directory} -c ssl=on -c ssl_cert_file=${cert} -c ssl_key_file=${key}`,
    "-w",
    "start",
  ]);
  started = true;
  const url = new URL(
    `postgresql://scalper_qualification@127.0.0.1:${port}/postgres`,
  );
  url.searchParams.set("sslrootcert", cert);
  url.searchParams.set("sslmode", "verify-full");
  const environment = { ...process.env, TEST_DATABASE_URL: url.toString() };
  delete environment.DATABASE_URL;
  const node = process.execPath;
  const python = path.join(root, ".venv/bin/python");
  if (!process.argv.includes("--database-only")) {
    for (const [label, executable, args] of [
      [
        "format",
        node,
        [
          "node_modules/prettier/bin/prettier.cjs",
          "--check",
          "**/*.{ts,mjs,json,md,yml,yaml}",
        ],
      ],
      ["lint", node, ["node_modules/eslint/bin/eslint.js", "."]],
      [
        "types",
        node,
        ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"],
      ],
      [
        "build",
        node,
        [
          "node_modules/typescript/bin/tsc",
          "-p",
          "tsconfig.build.json",
          "--outDir",
          path.join(directory, "build"),
        ],
      ],
      [
        "node-tests",
        node,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--exclude",
          "**/*.integration.test.ts",
          "--maxWorkers=1",
        ],
      ],
      [
        "python-format",
        python,
        [
          "-m",
          "ruff",
          "format",
          "--check",
          "python",
          "apps/dashboard",
          "tests/python",
        ],
      ],
      [
        "python-lint",
        python,
        ["-m", "ruff", "check", "python", "apps/dashboard", "tests/python"],
      ],
      ["python-types", python, ["-m", "mypy", "python", "apps/dashboard"]],
      ["secrets", "bash", ["scripts/secret-scan.sh"]],
      ["npm-audit", "npm", ["audit", "--audit-level=high"]],
      ["python-audit", python, ["-m", "pip_audit", "-r", "requirements.lock"]],
    ])
      await run(label, executable, args, { env: environment });
  }
  await run(
    "database-lifecycle",
    node,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration",
      "--maxWorkers=1",
      "--testTimeout=60000",
    ],
    { env: environment },
  );
  await run("python-tests", python, ["-m", "pytest", "tests/python", "-q"], {
    env: environment,
  });
} catch (error) {
  process.stderr.write(
    error instanceof Error && /^QUALIFICATION_/.test(error.message)
      ? error.message + "\n"
      : "QUALIFICATION_FAILED\n",
  );
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      await dbRun("database-stop", "pg_ctl", [
        "-D",
        path.join(directory, "database"),
        "-m",
        "immediate",
        "-w",
        "stop",
      ]);
    } catch {
      process.exitCode = 1;
    }
  }
  await writeFile(
    path.join(logs, "results.json"),
    JSON.stringify({ results }, null, 2),
    { mode: 0o600 },
  );
  // Retain private validation logs, remove only this runner's disposable DB and test key.
  await rm(path.join(directory, "database"), { recursive: true, force: true });
  await rm(path.join(directory, "server.key"), { force: true });
  process.stdout.write(`Qualification evidence: ${logs}\n`);
}
