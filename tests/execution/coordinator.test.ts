import { describe, expect, it, vi } from "vitest";

import {
  AnalysisCoordinator,
  InMemoryDecisionTrail,
  type CoordinatorOptions,
} from "../../apps/execution-service/src/coordinator.js";
import type { SafetyGateInput } from "../../apps/execution-service/src/safety-gates.js";
import type {
  AnalyticsRequest,
  MarketSnapshot,
  ModelResponse,
} from "../../packages/contracts/src/index.js";

function safety(): SafetyGateInput {
  return {
    tradingMode: "paper",
    liveTradingEnabled: false,
    liveAcknowledgement: "",
    environmentEmergencyStop: false,
    filesystemControlsCertain: true,
    filesystemEmergencyStop: false,
    liveEnablementFileValid: false,
    runtimeControlsCertain: true,
    databaseEmergencyStop: false,
    dashboardAcknowledged: false,
    pauseNewAnalyses: false,
    startupChecksPassed: true,
    serviceHealthy: true,
    accountAuthenticated: true,
    accountReconciled: true,
    reconciliationCertain: true,
    relevantPositionCount: 0,
    relevantPendingOrderCount: 0,
    partialFillPresent: false,
    cancellationPending: false,
    previousAnalysisExpired: true,
    candlesSynchronized: true,
    orderBookFresh: true,
    marketDataFresh: true,
    dailyLossLockout: false,
    operationalRiskLockout: false,
    aiCircuitOpen: false,
    symbolMetadataValid: true,
    aiResponseValid: false,
    deterministicRiskApproved: false,
    spreadSafe: false,
    duplicateFree: true,
    criticalAuditAvailable: true,
  };
}

function noTrade(analysisId: string): ModelResponse {
  const now = Date.now();
  const order = {
    enabled: false,
    trigger_price: "1",
    entry_price: "1",
    stop_loss: "1",
    take_profit: "1",
    risk_reward_ratio: "2",
    expires_at: new Date(now + 60_000).toISOString(),
    invalidation_price: "1",
  };
  return {
    schema_version: "1.0",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: new Date(now).toISOString(),
    valid_until: new Date(now + 60_000).toISOString(),
    decision: "NO_TRADE",
    market_regime: "UNCERTAIN",
    waiting_area: { lower: "1", upper: "2", description_code: "NO_VALID_ZONE" },
    buy_stop: order,
    sell_stop: order,
    confidence: {
      overall: 0,
      buy: 0,
      sell: 0,
      original_overall: 0,
      original_buy: 0,
      original_sell: 0,
    },
    setup_tags: [],
    evidence_codes: [],
    risk_flags: ["INSUFFICIENT_EVIDENCE"],
    performance_adjustment: {
      applied: false,
      confidence_delta: 0,
      reason_codes: [],
    },
    data_quality: { acceptable: true, warnings: [] },
  };
}

function snapshot(): MarketSnapshot {
  const now = new Date().toISOString();
  return {
    serverTime: now,
    capturedAt: now,
    observedSkewMs: 0,
    metadata: {
      symbolId: "7",
      symbolName: "XAUUSD",
      digits: 2,
      tickSize: "0.01",
      tickValue: "0.01",
      contractSize: "100",
      volumeScale: "0.01",
      minVolume: "1",
      maxVolume: "10000",
      volumeStep: "1",
      minStopDistance: "0.1",
      metadataTime: now,
    },
    quote: { bid: "1999.9", ask: "2000.1", sourceTime: now, receivedAt: now },
    candles: ["M1", "M5", "M15"].map((timeframe) => ({
      timeframe: timeframe as "M1" | "M5" | "M15",
      candles: [],
    })),
    orderBook: {
      sourceTime: now,
      receivedAt: now,
      bids: [{ price: "1999.9", size: "1" }],
      asks: [{ price: "2000.1", size: "1" }],
      complete: true,
      discontinuity: false,
      reconnectSequence: 0,
      aggregates: [
        {
          windowMs: 60000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 300000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 900000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
      ],
    },
  };
}

function options(
  overrides: Partial<CoordinatorOptions> = {},
): CoordinatorOptions {
  const marketSnapshot = snapshot();
  return {
    symbol: "XAUUSD",
    mode: "paper",
    candleCounts: { M1: 1, M5: 1, M15: 1 },
    orderBookDepth: 1,
    analyticsConfig: {
      atrPeriod: 15,
      emaFastPeriod: 5,
      emaSlowPeriod: 19,
      adxEnabled: true,
      adxPeriod: 14,
      rsiEnabled: true,
      rsiPeriod: 14,
      bollingerEnabled: false,
      bollingerPeriod: 20,
      bollingerStddev: "2",
      swingPivotLeft: 3,
      swingPivotRight: 3,
      compactTail: { M1: 1, M5: 1, M15: 1 },
      expectedCounts: { M1: 1, M5: 1, M15: 1 },
    },
    modelPayloadMode: "compact",
    promptVersion: "system-v1",
    schemaVersion: "1.0",
    strategyVersion: "test",
    minRiskRewardRatio: "2",
    minExpirySeconds: 15,
    maxExpirySeconds: 1800,
    maxStopDistanceAtr: "3",
    minStopDistancePoints: null,
    maxQuoteAgeMs: 3000,
    maxMetadataAgeMs: 86400000,
    maxOrderBookAgeMs: 3000,
    maxSpreadPoints: "50",
    maxSpreadAtrRatio: "0.1",
    maxSpreadPercentile: null,
    spreadContext: () =>
      Promise.resolve({ observedPercentile: null, sessionAbnormal: false }),
    market: { snapshot: vi.fn(() => Promise.resolve(marketSnapshot)) },
    analytics: {
      analyze: vi.fn((request: AnalyticsRequest) =>
        Promise.resolve({
          schemaVersion: "1.0" as const,
          requestId: request.requestId,
          analysisId: request.analysisId,
          generatedAt: new Date().toISOString(),
          acceptable: true,
          rejectionReasons: [],
          features: {
            timeframes: {
              M1: { atr: "5", raw_tail: [], full_candles: [] },
              M5: { atr: "5", raw_tail: [], full_candles: [] },
              M15: { atr: "5", raw_tail: [], full_candles: [] },
            },
            order_book: {},
            spread_atr_ratio_m1: "0.04",
          },
        }),
      ),
    },
    model: {
      circuitOpen: false,
      analyze: vi.fn((request: { readonly analysisId: string }) =>
        Promise.resolve({
          response: noTrade(request.analysisId),
          rawResponse: "{}",
        }),
      ),
    },
    account: {
      authenticate: () => Promise.resolve(),
      reconcile: () => Promise.reject(new Error("not used for no trade")),
    },
    risk: {
      evaluate: () => Promise.reject(new Error("not used for no trade")),
    },
    gateway: {
      kind: "paper",
      canSubmitToBroker: false,
      placeOco: vi.fn(() => Promise.reject(new Error("must not place"))),
      cancelStrategyOrder: () => Promise.reject(new Error("not used")),
      reconcile: () => Promise.reject(new Error("not used")),
    },
    trail: new InMemoryDecisionTrail(),
    safety: () => Promise.resolve(safety()),
    performance: () => Promise.resolve({ sample_size: 0 }),
    ...overrides,
  };
}

describe("analysis coordinator", () => {
  it("accepts a valid NO_TRADE response without invoking risk or execution", async () => {
    const configured = options();
    const result = await new AnalysisCoordinator(configured).runOnce();
    expect(result.outcome).toBe("NO_TRADE");
  });

  it("rejects before market collection when emergency stopped", async () => {
    const market = {
      snapshot: vi.fn(() => Promise.reject(new Error("must not run"))),
    };
    const configured = options({
      market,
      safety: () =>
        Promise.resolve({ ...safety(), environmentEmergencyStop: true }),
    });
    const result = await new AnalysisCoordinator(configured).runOnce();
    expect(result).toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["EMERGENCY_STOP_ENV"],
    });
    expect(market.snapshot).not.toHaveBeenCalled();
  });
});
