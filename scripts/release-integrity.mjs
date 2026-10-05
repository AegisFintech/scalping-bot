import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, readlink, lstat, realpath } from "node:fs/promises";
import path from "node:path";
const schemas = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../schemas",
);
const ajv = new Ajv2020({ strict: true });
const validateReport = ajv.compile(
  JSON.parse(
    readFileSync(path.join(schemas, "qualification-report-1.0.json"), "utf8"),
  ),
);
const validateManifest = ajv.compile(
  JSON.parse(
    readFileSync(path.join(schemas, "release-manifest-1.0.json"), "utf8"),
  ),
);
export const requiredChecks = [
  "format",
  "lint",
  "types",
  "build",
  "node-tests",
  "python-format",
  "python-lint",
  "python-types",
  "secrets",
  "npm-audit",
  "python-audit",
  "database-lifecycle",
  "python-tests",
  "database-stop",
];
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export function sourceFiles(root, untracked = false) {
  const args = [
    "ls-files",
    "-z",
    ...(untracked ? ["--cached", "--others", "--exclude-standard"] : []),
  ];
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("RELEASE_SOURCE_UNAVAILABLE");
  return [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
}
export async function sourceFingerprint(root) {
  const entries = [];
  for (const file of sourceFiles(root, true)) {
    if (file.startsWith("docs/") || file === "AGENTS.md" || file === "plan.md")
      continue;
    if (
      !/\.(?:ts|mts|cts|js|mjs|cjs|json|ya?ml|py|sql|lock|in|sh|toml)$/.test(
        file,
      ) &&
      !file.startsWith("prompts/") &&
      file !== ".env.sample"
    )
      continue;
    if (!(await lstat(path.join(root, file))).isFile())
      throw new Error("RELEASE_SOURCE_LINK_UNSUPPORTED");
    entries.push([file, sha256(await readFile(path.join(root, file)))]);
  }
  return sha256(JSON.stringify(entries));
}
export function validateQualification(value, sourceHash, nodeVersion) {
  if (!validateReport(value)) throw new Error("RELEASE_QUALIFICATION_INVALID");
  if (
    value.qualificationVersion !== "1.0" ||
    value.qualified !== true ||
    value.sourceSha256 !== sourceHash ||
    value.nodeVersion !== nodeVersion ||
    !Array.isArray(value.results)
  )
    throw new Error("RELEASE_QUALIFICATION_INVALID");
  for (const label of requiredChecks) {
    const rows = value.results.filter((row) => row.label === label);
    if (rows.length !== 1 || rows[0].code !== 0)
      throw new Error("RELEASE_CHECK_MISSING_OR_FAILED:" + label);
  }
}
export async function treeFingerprint(root, runtimeLinks = {}) {
  const entries = {};
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name),
        relative = path.relative(root, file);
      if (relative === "release-manifest.json") continue;
      const stat = await lstat(file);
      if (stat.isDirectory()) await walk(file);
      else if (stat.isSymbolicLink()) {
        const target = await readlink(file);
        const resolved = await realpath(file);
        // Venv interpreters alone may link to a pinned system Python binary.
        if (Object.hasOwn(runtimeLinks, relative)) {
          if (
            ![".runtime", "logs"].includes(relative) ||
            resolved !== runtimeLinks[relative]
          )
            throw new Error("RELEASE_STATE_LINK_MISMATCH");
          entries[relative] = { link: target, sha256: sha256(target) };
          continue;
        }
        if (
          !resolved.startsWith(root + path.sep) &&
          !/^\.venv\/bin\/python(?:3(?:\.13)?)?$/.test(relative)
        )
          throw new Error("RELEASE_EXTERNAL_LINK");
        entries[relative] = {
          link: target,
          sha256: sha256(
            await readFile(resolved).catch(() => Buffer.from(target)),
          ),
        };
      } else if (stat.isFile())
        entries[relative] = { sha256: sha256(await readFile(file)) };
      else throw new Error("RELEASE_FILE_UNSUPPORTED");
    }
  }
  await walk(root);
  return entries;
}
export async function verifyRelease(directory) {
  const root = await realpath(directory);
  const manifestFile = path.join(root, "release-manifest.json");
  const stat = await lstat(manifestFile);
  if (!stat.isFile() || stat.size > 16_000_000)
    throw new Error("RELEASE_MANIFEST_INVALID");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (!validateManifest(manifest)) throw new Error("RELEASE_MANIFEST_INVALID");
  if (
    manifest.manifestVersion !== "1.0" ||
    manifest.nodeVersion !== process.version ||
    process.versions.node.split(".")[0] !== "22"
  )
    throw new Error("RELEASE_RUNTIME_MISMATCH");
  validateQualification(
    manifest.qualification,
    manifest.sourceSha256,
    process.version,
  );
  if (sha256(await readFile(process.execPath)) !== manifest.nodeSha256)
    throw new Error("RELEASE_RUNTIME_MISMATCH");
  if (
    manifest.qualification.nodeSha256 !== manifest.nodeSha256 ||
    manifest.qualification.pythonSha256 !==
      sha256(await readFile(path.join(root, ".venv/bin/python")))
  )
    throw new Error("RELEASE_RUNTIME_MISMATCH");
  const actual = await treeFingerprint(root, manifest.runtimeLinks ?? {});
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
    throw new Error("RELEASE_ASSET_MISMATCH");
  return manifest;
}
