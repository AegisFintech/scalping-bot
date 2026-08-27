import { describe, expect, it } from "vitest";

import { stableFailureReason } from "../../apps/execution-service/src/failure-reasons.js";

describe("stable failure reasons", () => {
  it("maps database capacity details to one operator-safe reason", () => {
    expect(
      stableFailureReason(
        new Error(
          "could not extend file because project size limit was exceeded",
        ),
        "SCHEDULER_FAILED",
      ),
    ).toBe("DATABASE_STORAGE_LIMIT_EXCEEDED");
  });

  it("keeps stable internal codes and hides arbitrary provider details", () => {
    expect(
      stableFailureReason(new Error("AI_PROVIDER_TIMEOUT"), "FAILED"),
    ).toBe("AI_PROVIDER_TIMEOUT");
    expect(
      stableFailureReason(
        new Error("connection to private-host failed"),
        "FAILED",
      ),
    ).toBe("FAILED");
    expect(stableFailureReason("unknown", "FAILED")).toBe("FAILED");
  });
});
