import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  treeFingerprint,
  validateQualification,
  requiredChecks,
  verifyRelease,
  sha256,
} from "../../scripts/release-integrity.mjs";
it("rejects incomplete, failed and source/runtime-mismatched qualification", () => {
  const hash = "a".repeat(64);
  const report = {
    qualificationVersion: "1.0",
    qualified: true,
    sourceSha256: hash,
    nodeSha256: hash,
    pythonSha256: hash,
    nodeVersion: process.version,
    results: requiredChecks.map((label) => ({
      label,
      code: 0,
      executable: "fixture",
      args: [],
      elapsedMs: 1,
    })),
  };
  expect(() =>
    validateQualification(report, hash, process.version),
  ).not.toThrow();
  expect(() =>
    validateQualification(
      { ...report, qualified: false },
      hash,
      process.version,
    ),
  ).toThrow();
  expect(() =>
    validateQualification(
      { ...report, results: report.results.slice(1) },
      hash,
      process.version,
    ),
  ).toThrow();
  expect(() =>
    validateQualification(report, "changed", process.version),
  ).toThrow();
  expect(() => validateQualification(report, hash, "v24.0.0")).toThrow();
  expect(() =>
    validateQualification(
      { ...report, results: report.results.map((r) => ({ ...r, code: 1 })) },
      hash,
      process.version,
    ),
  ).toThrow();
});
it("fingerprints changed, added and missing assets and rejects outside links", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "release-test-"));
  try {
    writeFileSync(path.join(root, "asset.json"), "original");
    const original = await treeFingerprint(root);
    writeFileSync(path.join(root, "asset.json"), "changed");
    expect(await treeFingerprint(root)).not.toEqual(original);
    writeFileSync(path.join(root, "extra.json"), "extra");
    expect(Object.keys(await treeFingerprint(root))).toHaveLength(2);
    rmSync(path.join(root, "asset.json"));
    expect(Object.keys(await treeFingerprint(root))).toHaveLength(1);
    symlinkSync(path.resolve("package.json"), path.join(root, "outside"));
    await expect(treeFingerprint(root)).rejects.toThrow(
      "RELEASE_EXTERNAL_LINK",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses an unconfigured supervisor and an incomplete release", () => {
  const profile = spawnSync(
    process.execPath,
    ["-e", "require('./ecosystem.release.config.cjs')"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SCALPER_RELEASE_DIR: "",
        SCALPER_NODE_BINARY: "",
        SCALPER_ENV_FILE: "",
      },
    },
  );
  expect(profile.status).not.toBe(0);
  expect(profile.stderr).toContain("RELEASE_SUPERVISOR_CONFIGURATION_REQUIRED");
  const root = mkdtempSync(path.join(tmpdir(), "incomplete-release-"));
  try {
    const check = spawnSync(
      process.execPath,
      ["scripts/prepare-release.mjs", "verify", root],
      { encoding: "utf8" },
    );
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("RELEASE_OPERATION_FAILED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("verifies a bound manifest and rejects later asset or state-link changes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "bound-release-"));
  const state = mkdtempSync(path.join(tmpdir(), "bound-state-"));
  try {
    mkdirSync(path.join(root, ".venv/bin"), { recursive: true });
    writeFileSync(
      path.join(root, ".venv/bin/python"),
      "synthetic interpreter bytes",
    );
    mkdirSync(path.join(state, ".runtime"));
    mkdirSync(path.join(state, "logs"));
    const links = {
      ".runtime": path.join(state, ".runtime"),
      logs: path.join(state, "logs"),
    };
    for (const [name, target] of Object.entries(links))
      symlinkSync(target, path.join(root, name));
    writeFileSync(path.join(root, "asset.json"), "frozen asset");
    const hash = "a".repeat(64),
      nodeHash = sha256(readFileSync(process.execPath));
    const qualification = {
      qualificationVersion: "1.0",
      qualified: true,
      sourceSha256: hash,
      nodeSha256: nodeHash,
      pythonSha256: sha256("synthetic interpreter bytes"),
      nodeVersion: process.version,
      results: requiredChecks.map((label) => ({
        label,
        code: 0,
        executable: "fixture",
        args: [],
        elapsedMs: 1,
      })),
    };
    const manifest = {
      manifestVersion: "1.0",
      runtimeLinks: links,
      commit: "b".repeat(40),
      sourceSha256: hash,
      nodeVersion: process.version,
      nodeSha256: nodeHash,
      qualification,
      files: await treeFingerprint(root, links),
    };
    writeFileSync(
      path.join(root, "release-manifest.json"),
      JSON.stringify(manifest),
    );
    await expect(verifyRelease(root)).resolves.toBeDefined();
    writeFileSync(path.join(root, "asset.json"), "changed asset");
    await expect(verifyRelease(root)).rejects.toThrow("RELEASE_ASSET_MISMATCH");
    writeFileSync(path.join(root, "asset.json"), "frozen asset");
    rmSync(path.join(root, "logs"));
    symlinkSync(path.join(state, ".runtime"), path.join(root, "logs"));
    await expect(verifyRelease(root)).rejects.toThrow(
      "RELEASE_STATE_LINK_MISMATCH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
