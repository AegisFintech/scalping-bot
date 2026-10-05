import { spawnSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root =
  process.argv[2] === "--root" && process.argv.length === 4
    ? path.resolve(process.argv[3])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
);
if (files.status !== 0) {
  process.stderr.write("SECRET_SCAN_FILE_LIST_FAILED\n");
  process.exit(1);
}
let failed = false;
const patterns = [
  [
    "populated-assignment",
    /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|database_url|authorization)\s*=\s*[^\s#]{8,}/gim,
  ],
  // A token must start at its own boundary: the 'sk-' inside 'risk-budget' is not a key.
  [
    "api-credential",
    /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}|\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/g,
  ],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
for (const name of new Set(files.stdout.split("\0").filter(Boolean))) {
  const file = path.join(root, name);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || stat.size > 16_000_000) {
    process.stderr.write(`${name}: SECRET_SCAN_UNSUPPORTED_FILE\n`);
    failed = true;
    continue;
  }
  const text = readFileSync(file, "utf8");
  for (const [label, pattern] of patterns) {
    if (
      label === "populated-assignment" &&
      (name === ".env.sample" || /^systemd\/.*\.template$/.test(name))
    )
      continue;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      // Never echo the matched credential or raw source line.
      process.stderr.write(`${name}:${line}: potential ${label}\n`);
      failed = true;
    }
  }
}
process.exitCode = failed ? 1 : 0;
