import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  lstat,
  realpath,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyReleaseTree,
  sha256,
  sourceFiles,
  sourceFingerprint,
  treeFingerprint,
  validateQualification,
  verifyRelease,
} from "./release-integrity.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function prepare(directory, evidenceFile, stateDirectory) {
  if (process.versions.node.split(".")[0] !== "22")
    throw new Error("RELEASE_NODE_22_REQUIRED");
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  if (status.status !== 0 || status.stdout.trim())
    throw new Error("RELEASE_DIRTY_SOURCE");
  const destination = path.resolve(directory);
  const parent = await realpath(path.dirname(destination));
  if (parent === root || parent.startsWith(root + path.sep))
    throw new Error("RELEASE_DESTINATION_INSIDE_SOURCE");
  if (!stateDirectory || !path.isAbsolute(stateDirectory))
    throw new Error("RELEASE_STATE_ROOT_REQUIRED");
  const state = await realpath(stateDirectory);
  const runtimeLinks = {};
  for (const name of [".runtime", "logs"]) {
    const target = await realpath(path.join(state, name));
    if (!(await lstat(target)).isDirectory())
      throw new Error("RELEASE_STATE_ROOT_INVALID");
    runtimeLinks[name] = target;
  }
  const sourceSha256 = await sourceFingerprint(root);
  const qualification = JSON.parse(await readFile(evidenceFile, "utf8"));
  validateQualification(qualification, sourceSha256, process.version);
  if (
    qualification.nodeSha256 !== sha256(await readFile(process.execPath)) ||
    qualification.pythonSha256 !==
      sha256(await readFile(path.join(root, ".venv/bin/python")))
  )
    throw new Error("RELEASE_RUNTIME_MISMATCH");
  await mkdir(destination, { mode: 0o750 }); // Exclusive; never replace another release.
  for (const file of sourceFiles(root)) {
    if (!(await lstat(path.join(root, file))).isFile())
      throw new Error("RELEASE_SOURCE_LINK_UNSUPPORTED");
    const output = path.join(destination, file);
    await mkdir(path.dirname(output), { recursive: true });
    await cp(path.join(root, file), output, {
      errorOnExist: true,
      force: false,
    });
  }
  await copyReleaseTree(
    path.join(root, "node_modules"),
    path.join(destination, "node_modules"),
  );
  await copyReleaseTree(
    path.join(root, ".venv"),
    path.join(destination, ".venv"),
  );
  const build = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      path.join(root, "tsconfig.build.json"),
      "--outDir",
      path.join(destination, "dist"),
    ],
    { cwd: root, stdio: "ignore" },
  );
  if (build.status !== 0) throw new Error("RELEASE_BUILD_FAILED");
  if (sourceSha256 !== (await sourceFingerprint(root)))
    throw new Error("RELEASE_SOURCE_CHANGED");
  const commit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim();
  for (const [name, target] of Object.entries(runtimeLinks))
    await symlink(target, path.join(destination, name));
  const manifest = {
    manifestVersion: "1.0",
    runtimeLinks,
    commit,
    sourceSha256,
    nodeVersion: process.version,
    nodeSha256: sha256(await readFile(process.execPath)),
    qualification,
    files: await treeFingerprint(destination, runtimeLinks),
  };
  await writeFile(
    path.join(destination, "release-manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx", mode: 0o640 },
  );
  await verifyRelease(destination);
}
try {
  const [command, directory, evidence, state] = process.argv.slice(2);
  if (!directory || !path.isAbsolute(directory))
    throw new Error("RELEASE_ABSOLUTE_DESTINATION_REQUIRED");
  if (command === "prepare" && evidence)
    await prepare(directory, evidence, state);
  else if (command === "verify" && !evidence) await verifyRelease(directory);
  else throw new Error("RELEASE_ARGUMENTS_INVALID");
  process.stdout.write("RELEASE_VERIFIED\n");
} catch (error) {
  process.stderr.write(
    error instanceof Error && /^RELEASE_[A-Z_:]+$/.test(error.message)
      ? error.message + "\n"
      : "RELEASE_OPERATION_FAILED\n",
  );
  process.exitCode = 1;
}
