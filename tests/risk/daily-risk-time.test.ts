import { describe, expect, it } from "vitest";

import {
  assertReconciledBaselineEvidence,
  tradingDay,
  tradingDayStart,
} from "../../apps/execution-service/src/daily-risk-store.js";

describe("daily risk trading-day boundary", () => {
  it("finds the exact IANA-zone day boundary", () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    expect(tradingDay(now, "Asia/Singapore")).toBe("2026-08-23");
    expect(tradingDayStart(now, "Asia/Singapore").toISOString()).toBe(
      "2026-08-22T16:00:00.000Z",
    );
  });

  it("handles a daylight-saving boundary", () => {
    const now = new Date("2026-03-08T16:00:00.000Z");
    expect(tradingDayStart(now, "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });
});

describe("reconciled baseline evidence", () => {
  it("accepts only empty broker activity with valid flow evidence", () => {
    expect(() =>
      assertReconciledBaselineEvidence({
        brokerDealCount: 0,
        brokerPositionCount: 0,
        brokerOrderCount: 0,
        externalFlowOperationCount: 2,
      }),
    ).not.toThrow();
  });

  it("rejects any deal, position, order, or malformed count", () => {
    for (const evidence of [
      { brokerDealCount: 1, brokerPositionCount: 0, brokerOrderCount: 0 },
      { brokerDealCount: 0, brokerPositionCount: 1, brokerOrderCount: 0 },
      { brokerDealCount: 0, brokerPositionCount: 0, brokerOrderCount: 1 },
    ]) {
      expect(() =>
        assertReconciledBaselineEvidence({
          ...evidence,
          externalFlowOperationCount: 0,
        }),
      ).toThrow("DAILY_RISK_BASELINE_BROKER_ACTIVITY_PRESENT");
    }
    expect(() =>
      assertReconciledBaselineEvidence({
        brokerDealCount: 0,
        brokerPositionCount: 0,
        brokerOrderCount: 0,
        externalFlowOperationCount: -1,
      }),
    ).toThrow("DAILY_RISK_BASELINE_EVIDENCE_INVALID");
  });
});
