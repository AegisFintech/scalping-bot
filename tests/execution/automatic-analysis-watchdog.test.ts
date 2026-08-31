import { describe, expect, it } from "vitest";

import { evaluateAutomaticAnalysisActivity } from "../../apps/execution-service/src/automatic-analysis-watchdog.js";

const now = new Date("2026-08-31T01:00:00.000Z");
const defaults = {
  now,
  serviceStartedAt: new Date("2026-08-31T00:50:00.000Z"),
  automaticAnalysisEnabled: true,
  paused: false,
  managedSetupActive: false,
  stallAfterMs: 180_000,
  marketActiveWithinMs: 120_000,
  lastClaimedAt: new Date("2026-08-31T00:59:00.000Z"),
  lastCompletedAt: new Date("2026-08-31T00:59:40.000Z"),
  lastLifecycleAt: null,
  latestMarketAt: new Date("2026-08-31T00:59:30.000Z"),
};

describe("automatic analysis activity", () => {
  it("reports a current completed cycle as running", () => {
    expect(evaluateAutomaticAnalysisActivity(defaults)).toMatchObject({
      state: "RUNNING",
      lastProgressAt: "2026-08-31T00:59:40.000Z",
      stalledSince: null,
      reasonCodes: [],
    });
  });

  it("reports a genuine market-active cycle stall", () => {
    expect(
      evaluateAutomaticAnalysisActivity({
        ...defaults,
        lastClaimedAt: new Date("2026-08-31T00:40:00.000Z"),
        lastCompletedAt: new Date("2026-08-31T00:40:45.000Z"),
        lastLifecycleAt: new Date("2026-08-31T00:42:00.000Z"),
      }),
    ).toEqual({
      state: "STALLED",
      lastClaimedAt: "2026-08-31T00:40:00.000Z",
      lastCompletedAt: "2026-08-31T00:40:45.000Z",
      lastLifecycleAt: "2026-08-31T00:42:00.000Z",
      lastProgressAt: "2026-08-31T00:50:00.000Z",
      latestMarketAt: "2026-08-31T00:59:30.000Z",
      stalledSince: "2026-08-31T00:50:00.000Z",
      reasonCodes: ["AUTOMATIC_ANALYSIS_STALLED"],
    });
  });

  it("does not call a managed setup or closed market a scheduler stall", () => {
    expect(
      evaluateAutomaticAnalysisActivity({
        ...defaults,
        managedSetupActive: true,
        lastCompletedAt: new Date("2026-08-31T00:30:00.000Z"),
      }).state,
    ).toBe("MANAGING_SETUP");
    expect(
      evaluateAutomaticAnalysisActivity({
        ...defaults,
        latestMarketAt: new Date("2026-08-30T20:00:00.000Z"),
      }).state,
    ).toBe("WAITING_FOR_MARKET");
  });

  it("keeps disabled and paused operation explicit", () => {
    expect(
      evaluateAutomaticAnalysisActivity({
        ...defaults,
        automaticAnalysisEnabled: false,
      }).state,
    ).toBe("DISABLED");
    expect(
      evaluateAutomaticAnalysisActivity({ ...defaults, paused: true }).state,
    ).toBe("PAUSED");
  });

  it("rejects an unsafe watchdog configuration", () => {
    expect(() =>
      evaluateAutomaticAnalysisActivity({
        ...defaults,
        stallAfterMs: 30_000,
      }),
    ).toThrow("AUTOMATIC_WATCHDOG_CONFIG_INVALID");
  });
});
