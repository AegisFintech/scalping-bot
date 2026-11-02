import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";

it("forces bytecode writes off at the real Python child boundary", () => {
  const root = mkdtempSync(path.join(tmpdir(), "python-launcher-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, ".venv/bin"), { recursive: true });
    copyFileSync(
      "scripts/run-python-service.mjs",
      path.join(root, "scripts/run-python-service.mjs"),
    );
    symlinkSync(
      path.resolve("node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    writeFileSync(
      path.join(root, ".venv/bin/python"),
      '#!/bin/sh\nprintf "%s" "$PYTHONDONTWRITEBYTECODE"\n',
      { mode: 0o755 },
    );
    const result = execFileSync(
      process.execPath,
      [path.join(root, "scripts/run-python-service.mjs"), "analytics"],
      {
        cwd: root,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "0" },
        encoding: "utf8",
      },
    );
    expect(result).toBe("1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
