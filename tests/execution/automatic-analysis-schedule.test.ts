import { describe, expect, it } from "vitest";

import { evaluateAutomaticAnalysisWindow } from "../../apps/execution-service/src/automatic-analysis-schedule.js";

describe("automatic analysis broker-time schedule", () => {
  it("allows the bounded opening window of a broker M1 interval", () => {
    expect(
      evaluateAutomaticAnalysisWindow({
        serverTime: "2026-08-24T04:05:00.000Z",
        startWindowSeconds: 10,
      }),
    ).toEqual({
      allowed: true,
      intervalStart: "2026-08-24T04:05:00.000Z",
      reasonCodes: [],
    });
    expect(
      evaluateAutomaticAnalysisWindow({
        serverTime: "2026-08-24T04:05:09.999Z",
        startWindowSeconds: 10,
      }).allowed,
    ).toBe(true);
  });

  it("rejects the exact closing boundary and later broker times", () => {
    expect(
      evaluateAutomaticAnalysisWindow({
        serverTime: "2026-08-24T04:05:10.000Z",
        startWindowSeconds: 10,
      }),
    ).toEqual({
      allowed: false,
      intervalStart: "2026-08-24T04:05:00.000Z",
      reasonCodes: ["AUTOMATIC_ANALYSIS_OUTSIDE_M1_START_WINDOW"],
    });
  });

  it("derives a new idempotency interval after the broker minute rolls", () => {
    expect(
      evaluateAutomaticAnalysisWindow({
        serverTime: "2026-08-24T04:06:00.001Z",
        startWindowSeconds: 10,
      }).intervalStart,
    ).toBe("2026-08-24T04:06:00.000Z");
  });

  it("fails closed on invalid broker time or window configuration", () => {
    expect(
      evaluateAutomaticAnalysisWindow({
        serverTime: "not-a-time",
        startWindowSeconds: 10,
      }).reasonCodes,
    ).toEqual(["AUTOMATIC_ANALYSIS_SERVER_TIME_INVALID"]);
    expect(
      evaluateAutomaticAnalysisWindow({
        serverTime: "2026-08-24T04:05:00",
        startWindowSeconds: 10,
      }).reasonCodes,
    ).toEqual(["AUTOMATIC_ANALYSIS_SERVER_TIME_INVALID"]);
    for (const startWindowSeconds of [0, 31, 1.5]) {
      expect(
        evaluateAutomaticAnalysisWindow({
          serverTime: "2026-08-24T04:05:00.000Z",
          startWindowSeconds,
        }).reasonCodes,
      ).toEqual(["AUTOMATIC_ANALYSIS_START_WINDOW_INVALID"]);
    }
  });
});
