import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
it("distinguishes document names from credentials and never echoes secret matches", () => {
  const root = mkdtempSync(path.join(tmpdir(), "secret-scan-test-"));
  try {
    spawnSync("git", ["init", root], { stdio: "ignore" });
    const scan = () =>
      spawnSync(
        process.execPath,
        [path.resolve("scripts/secret-scan.mjs"), "--root", root],
        { encoding: "utf8" },
      );
    writeFileSync(
      path.join(root, "review.md"),
      "Read risk-budget-recovery-report.md.",
    );
    expect(scan().status).toBe(0);
    const token = "sk-" + "A".repeat(26);
    writeFileSync(path.join(root, "key.txt"), token);
    const result = scan();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("key.txt:1");
    expect(result.stderr).not.toContain(token);
    writeFileSync(path.join(root, "key.txt"), "Bearer " + "B".repeat(26));
    expect(scan().status).toBe(1);
    writeFileSync(path.join(root, "key.txt"), "API_KEY=" + "C".repeat(26));
    expect(scan().status).toBe(1);
    writeFileSync(
      path.join(root, "key.txt"),
      "-----BEGIN " + "PRIVATE KEY-----",
    );
    expect(scan().status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
