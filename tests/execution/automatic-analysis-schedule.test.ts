import { describe, expect, it } from "vitest";

import {
  alignedSchedulerDelayMs,
  evaluateAutomaticAnalysisWindow,
} from "../../apps/execution-service/src/automatic-analysis-schedule.js";

describe("automatic analysis broker-time schedule", () => {
  it("aligns a relative service timer to the next wall-clock cadence boundary", () => {
    expect(
      alignedSchedulerDelayMs(Date.parse("2026-08-27T01:17:59.110Z"), 5),
    ).toBe(890);
    expect(
      alignedSchedulerDelayMs(Date.parse("2026-08-27T01:18:00.000Z"), 5),
    ).toBe(5_000);
    expect(
      alignedSchedulerDelayMs(Date.parse("2026-08-27T01:17:58.500Z"), 5, 1_000),
    ).toBe(500);
    expect(
      alignedSchedulerDelayMs(Date.parse("2026-08-27T01:17:59.110Z"), 5, 1_000),
    ).toBe(4_890);
  });

  it("rejects unsafe wall-clock scheduler inputs", () => {
    for (const input of [
      { nowMs: -1, intervalSeconds: 5 },
      { nowMs: 1.5, intervalSeconds: 5 },
      { nowMs: 1, intervalSeconds: 0 },
      { nowMs: 1, intervalSeconds: 61 },
      { nowMs: 1, intervalSeconds: 1.5 },
    ]) {
      expect(() =>
        alignedSchedulerDelayMs(input.nowMs, input.intervalSeconds),
      ).toThrow("AUTOMATIC_ANALYSIS_INTERVAL_INVALID");
    }
    expect(() => alignedSchedulerDelayMs(1, 5, -1)).toThrow(
      "AUTOMATIC_ANALYSIS_INTERVAL_INVALID",
    );
    expect(() => alignedSchedulerDelayMs(1, 5, 5_000)).toThrow(
      "AUTOMATIC_ANALYSIS_INTERVAL_INVALID",
    );
  });

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
