import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OperationalFault } from "../../apps/execution-service/src/operational-fault.js";

describe("durable operational failure/backoff", () => {
  it("retains a redacted storage block across restart until a successful durable cycle", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fault-"));
    try {
      let now = Date.parse("2026-09-08T01:00:00Z");
      const file = path.join(dir, "fault.json");
      const state = new OperationalFault(file, () => now);
      expect(state.snapshot).toBeNull();
      state.fail(new Error("private host: project size limit exceeded"));
      expect(readFileSync(file, "utf8")).not.toContain("private");
      const resumed = new OperationalFault(file, () => now);
      expect(resumed.snapshot?.reasonCode).toBe(
        "DATABASE_STORAGE_LIMIT_EXCEEDED",
      );
      expect(resumed.canRetry).toBe(false);
      now += 60000;
      expect(resumed.canRetry).toBe(true);
      expect(resumed.snapshot).not.toBeNull();
      resumed.recovered();
      expect(new OperationalFault(file).snapshot).toBeNull();
      writeFileSync(file, "bad");
      expect(new OperationalFault(file).snapshot?.reasonCode).toBe(
        "OPERATIONAL_FAULT_STATE_UNAVAILABLE",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
