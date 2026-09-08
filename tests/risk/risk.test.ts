import { describe, expect, it } from "vitest";

import {
  checkSpread,
  dailyLoss,
  maximumAffordableStopDistance,
  performanceAdjustment,
  sizeOcoPair,
  sizePosition,
} from "../../packages/risk-engine/src/index.js";

const metadata = {
  symbolId: "1",
  symbolName: "XAUUSD",
  digits: 2,
  pipPosition: 2,
  pipSize: "0.01",
  tickSize: "0.01",
  tickValue: "0.01",
  baseAsset: "XAU",
  quoteAsset: "USD",
  accountAsset: "USD",
  quoteToAccountConversionRate: "1",
  contractSize: "1",
  volumeScale: "1",
  minVolume: "1",
  maxVolume: "1000",
  volumeStep: "1",
  minStopDistance: "0.10",
  commission: {
    type: "USD_PER_MILLION_USD" as const,
    rate: "30",
    minimum: "0",
    minimumType: "QUOTE_CURRENCY" as const,
    minimumAsset: "USD",
    pnlConversionFeeRate: "0",
  },
  metadataTime: "2026-01-01T00:00:00Z",
};

describe("risk engine", () => {
  it("reserves costs before minimum volume and floors an off-grid broker maximum", () => {
    const input = {
      equity: "10000",
      availableMargin: "10000",
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      entryPrice: "2000",
      stopLoss: "1999",
      estimatedMarginPerVolume: "1",
      currentMargin: "0",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      metadata,
    };
    expect(sizePosition({ ...input, equity: "100" })).toMatchObject({
      approved: false,
      reasonCodes: ["RISK_COSTS_VOLUME_BELOW_MIN"],
    });
    expect(
      sizePosition({
        ...input,
        metadata: {
          ...metadata,
          minVolume: "2",
          maxVolume: "10",
          volumeStep: "3",
        },
      }),
    ).toMatchObject({ approved: true, normalizedVolume: "8" });
    expect(
      sizePosition({
        ...input,
        metadata: { ...metadata, quoteToAccountConversionRate: "0" },
      }).approved,
    ).toBe(false);
    expect(
      sizePosition({
        ...input,
        maxPositionNotional: "2000",
        metadata: {
          ...metadata,
          accountAsset: "EUR",
          quoteToAccountConversionRate: "2",
        },
      }).approved,
    ).toBe(false);
  });
  it("fails closed on nonfinite capital flows and bounds recurring loss ratios conservatively", () => {
    expect(
      dailyLoss({
        baselineEquity: "999834.02",
        currentEquity: "999833.99",
        netFlows: "NaN",
        thresholdPercent: "1",
      }).lockedOut,
    ).toBe(true);
    expect(
      dailyLoss({
        baselineEquity: "999834.02",
        currentEquity: "999833.99",
        netFlows: "0",
        thresholdPercent: "1",
      }).lossPercent,
    ).toBe("0.00000301");
  });
  it("floors the broker-minimum affordable OCO stop distance to whole ticks", () => {
    const result = maximumAffordableStopDistance({
      equity: "10000",
      setupRiskPercent: "1",
      maxRiskPercent: "5",
      metadata: {
        ...metadata,
        minVolume: "100",
      },
    });

    expect(result).toEqual({
      approved: true,
      reasonCodes: [],
      maxStopDistance: "0.5",
    });
  });

  it("rejects before inference when even one tick at minimum volume is unaffordable", () => {
    const result = maximumAffordableStopDistance({
      equity: "100",
      setupRiskPercent: "1",
      maxRiskPercent: "5",
      metadata: {
        ...metadata,
        minVolume: "100",
      },
    });

    expect(result).toEqual({
      approved: false,
      reasonCodes: ["RISK_MIN_VOLUME_UNAFFORDABLE"],
      maxStopDistance: null,
    });
  });

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
    expect(result.normalizedVolume).toBe("65");
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
      maximumLoss: "6.10003",
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
      maximumLoss: "2.679012",
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
    const combinedMargin = sizeOcoPair({
      setupRiskPercent: "1",
      buy: { ...leg, availableMargin: "70" },
      sell: { ...leg, availableMargin: "70" },
    });
    expect(combinedMargin.buy.approved).toBe(true);
    expect(combinedMargin.sell.approved).toBe(true);
    expect(combinedMargin.approved).toBe(true);
    expect(
      Number(combinedMargin.buy.estimatedMargin) +
        Number(combinedMargin.sell.estimatedMargin),
    ).toBeLessThanOrEqual(70);
    const combinedUsage = sizeOcoPair({
      setupRiskPercent: "1",
      buy: { ...leg, maxMarginUsagePercent: "0.5" },
      sell: { ...leg, maxMarginUsagePercent: "0.5" },
    });
    expect(combinedUsage.approved).toBe(true);
    expect(
      Number(combinedUsage.buy.estimatedMargin) +
        Number(combinedUsage.sell.estimatedMargin),
    ).toBeLessThanOrEqual(50);
  });
});
