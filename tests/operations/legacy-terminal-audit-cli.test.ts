import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);
it.each([undefined, "live", "demo"])(
  "rejects missing audit scope in %s without leaking configuration or writing evidence",
  async (mode) => {
    const directory = await mkdtemp(path.join(tmpdir(), "legacy-audit-test-"));
    const output = path.join(directory, "evidence.json");
    const dotenv = path.join(directory, "empty.env");
    await writeFile(dotenv, "");
    await writeFile(output, "existing evidence", { mode: 0o600 });
    try {
      await expect(
        run(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/audit-legacy-terminal.ts",
            "--output",
            output,
          ],
          {
            env: {
              PATH: process.env.PATH,
              DOTENV_CONFIG_PATH: dotenv,
              ...(mode ? { TRADING_MODE: mode } : {}),
              ACCOUNT_KEY: "private-test-sentinel",
            },
          },
        ),
      ).rejects.toMatchObject({
        stdout: "",
        stderr:
          JSON.stringify({
            status: "LEGACY_AUDIT_FAILED",
            phase: "preflight",
            reason: "AUDIT_EXPLICIT_DEMO_SCOPE_REQUIRED",
          }) + "\n",
      });
      expect(await readFile(output, "utf8")).toBe("existing evidence");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
