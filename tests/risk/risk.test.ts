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

  it("normalizes volume downward to the configured notional cap", () => {
    const result = sizePosition({
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "1",
      maxRiskPercent: "5",
      entryPrice: "2000",
      stopLoss: "1999",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: "10000",
      metadata,
    });

    expect(result).toMatchObject({
      approved: true,
      rawVolume: "100",
      normalizedVolume: "5",
      maximumLoss: "5",
    });
  });

  it("accepts the exact minimum-volume notional boundary", () => {
    const result = sizePosition({
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "1",
      maxRiskPercent: "5",
      entryPrice: "2000",
      stopLoss: "1999",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: "2000",
      metadata,
    });

    expect(result).toMatchObject({ approved: true, normalizedVolume: "1" });
  });

  it("rejects when the notional cap cannot support broker minimum volume", () => {
    const result = sizePosition({
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "1",
      maxRiskPercent: "5",
      entryPrice: "2000",
      stopLoss: "1999",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: "1999.99",
      metadata,
    });

    expect(result).toMatchObject({
      approved: false,
      reasonCodes: ["RISK_NOTIONAL_EXCEEDED"],
      normalizedVolume: null,
    });
  });

  it("caps the observed demo XAUUSD risk volume to one broker step", () => {
    const result = sizePosition({
      equity: "1000000",
      availableMargin: "1000000",
      baseRiskPercent: "0.0005",
      maxRiskPercent: "0.001",
      entryPrice: "4650.10",
      stopLoss: "4647.80",
      estimatedMarginPerVolume: "0.01",
      currentMargin: "0",
      maxMarginUsagePercent: "1",
      maxPositionNotional: "5500",
      metadata: {
        ...metadata,
        tickValue: "0.0001",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "100",
        maxVolume: "1000000",
        volumeStep: "100",
      },
    });

    expect(result).toMatchObject({
      approved: true,
      normalizedVolume: "100",
      maximumLoss: "2.3",
    });
  });

  it("still rejects broker minimum volume above the configured loss budget", () => {
    const result = sizePosition({
      equity: "1000000",
      availableMargin: "1000000",
      baseRiskPercent: "0.0005",
      maxRiskPercent: "0.001",
      entryPrice: "4650.10",
      stopLoss: "4645.00",
      estimatedMarginPerVolume: "0.01",
      currentMargin: "0",
      maxMarginUsagePercent: "1",
      maxPositionNotional: "5500",
      metadata: {
        ...metadata,
        tickValue: "0.0001",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "100",
        maxVolume: "1000000",
        volumeStep: "100",
      },
    });

    expect(result).toMatchObject({
      approved: false,
      reasonCodes: ["RISK_VOLUME_BELOW_MIN"],
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
