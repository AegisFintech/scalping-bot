import { describe, expect, it } from "vitest";

import {
  checkSpread,
  dailyLoss,
  performanceAdjustment,
  sizeOcoPair,
  sizePosition,
} from "../../packages/risk-engine/src/index.js";

const metadata = {
  symbolId: "1",
  symbolName: "XAUUSD",
  digits: 2,
  tickSize: "0.01",
  tickValue: "0.01",
  contractSize: "1",
  volumeScale: "1",
  minVolume: "1",
  maxVolume: "1000",
  volumeStep: "1",
  minStopDistance: "0.10",
  metadataTime: "2026-01-01T00:00:00Z",
};

describe("risk engine", () => {
  it("rounds volume down and stays within budget", () => {
    const result = sizePosition({
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "1",
      maxRiskPercent: "5",
      entryPrice: "2000",
      stopLoss: "1998.7",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      metadata,
    });
    expect(result.approved).toBe(true);
    expect(result.rawVolume).toBe("76.92307692307692307692307692307692307692");
    expect(result.normalizedVolume).toBe("76");
    expect(Number(result.maximumLoss)).toBeLessThanOrEqual(100);
  });

  it("never permits the five-percent hard ceiling to be exceeded", () => {
    const result = sizePosition({
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "6",
      maxRiskPercent: "6",
      entryPrice: "2000",
      stopLoss: "1999",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      metadata,
    });
    expect(result).toMatchObject({
      approved: false,
      reasonCodes: ["RISK_PERCENT_INVALID"],
    });
  });

  it("locks at the daily threshold", () => {
    expect(
      dailyLoss({
        baselineEquity: "10000",
        currentEquity: "9000",
        netFlows: "0",
        thresholdPercent: "10",
      }),
    ).toEqual({
      lockedOut: true,
      lossPercent: "10",
      reasonCode: "DAILY_LOSS_LOCKOUT",
    });
  });

  it("requires spread protection in live mode", () => {
    expect(
      checkSpread({
        bid: "100",
        ask: "100.1",
        tickSize: "0.01",
        atr: "1",
        maxPoints: null,
        maxAtrRatio: null,
        observedPercentile: null,
        maxPercentile: null,
        sessionAbnormal: false,
        liveMode: true,
      }).reasonCodes,
    ).toEqual(["SPREAD_PROTECTION_REQUIRED"]);
  });

  it("accepts a canonical ten-place analytics ATR", () => {
    expect(
      checkSpread({
        bid: "4647.59",
        ask: "4647.70",
        tickSize: "0.01",
        atr: "2.8400954573",
        maxPoints: "12",
        maxAtrRatio: "0.10",
        observedPercentile: null,
        maxPercentile: null,
        sessionAbnormal: false,
        liveMode: false,
      }),
    ).toMatchObject({ approved: true, reasonCodes: [] });
  });

  it("performance history can only reduce confidence", () => {
    const result = performanceAdjustment(
      Array.from({ length: 30 }, (_, age) => ({ won: age % 4 === 0, age })),
    );
    expect(result.applied).toBe(true);
    expect(result.confidenceDelta).toBeLessThan(0);
  });

  it("shares setup risk across both OCO race-exposed legs", () => {
    const leg = {
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "1",
      maxRiskPercent: "5",
      entryPrice: "2000",
      stopLoss: "1999",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      metadata,
    };
    const result = sizeOcoPair({
      setupRiskPercent: "1",
      buy: leg,
      sell: { ...leg, entryPrice: "1999", stopLoss: "2000" },
    });
    expect(result.approved).toBe(true);
    expect(Number(result.combinedMaximumLoss)).toBeLessThanOrEqual(100);
  });
});
