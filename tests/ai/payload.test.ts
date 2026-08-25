import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildModelPayload } from "../../apps/ai-orchestrator/src/payload.js";

const common = {
  analysisId: "22222222-2222-4222-8222-222222222222",
  symbol: "XAUUSD",
  analysisTime: "2026-01-01T00:00:00Z",
  serverTime: "2026-01-01T00:00:00Z",
  analyticsFeatures: {
    timeframes: {
      M1: {
        full_candles: [{ close: "1" }],
        raw_tail: [{ close: "1" }],
        atr: "0.1",
      },
      M5: {
        full_candles: [{ close: "1" }],
        raw_tail: [{ close: "1" }],
        atr: "0.2",
      },
      M15: {
        full_candles: [{ close: "1" }],
        raw_tail: [{ close: "1" }],
        atr: "0.3",
      },
    },
    order_book: { spread: "0.1" },
    spread_atr_ratio_m1: "1",
  },
  performanceContext: { sample_size: 30, confidence_delta: -5 },
  promptVersion: "system-v2",
  schemaVersion: "2.0" as const,
  strategyVersion: "test",
  executionConstraints: {
    currentBid: "1999.9",
    currentAsk: "2000.1",
    tickSize: "0.01",
    digits: 2,
    brokerMinStopDistance: "0.1",
    configuredMinStopDistance: "0.1",
    minRiskRewardRatio: "4",
    effectiveMinRiskRewardRatio: "2",
    takeProfitDistanceDivisor: "2" as const,
    maxAffordableStopDistance: "0.5",
    maxStopDistanceAtr: "3",
    orderExpiryMinSeconds: 15,
    orderExpiryMaxSeconds: 1800,
  },
};

describe("model payload builder", () => {
  it("omits full histories in compact mode", () => {
    const payload = buildModelPayload({ ...common, mode: "compact" });
    const market = payload.market as {
      timeframes: Record<string, Record<string, unknown>>;
    };
    expect(market.timeframes.M1?.full_candles).toBeUndefined();
    expect(market.timeframes.M1?.raw_tail).toHaveLength(1);
  });

  it("sends deterministic per-candle features in full mode", () => {
    const payload = buildModelPayload({ ...common, mode: "full" });
    const market = payload.market as {
      timeframes: Record<string, { candles: unknown[] }>;
    };
    expect(market.timeframes.M15?.candles).toHaveLength(1);
  });

  it("supplies exact non-sizing execution constraints to the model", () => {
    const payload = buildModelPayload({ ...common, mode: "compact" });
    expect(payload.execution_constraints).toEqual({
      current_bid: "1999.9",
      current_ask: "2000.1",
      tick_size: "0.01",
      digits: 2,
      broker_min_stop_distance: "0.1",
      configured_min_stop_distance: "0.1",
      min_risk_reward_ratio: "4",
      effective_min_risk_reward_ratio: "2",
      take_profit_distance_divisor: "2",
      max_affordable_stop_distance: "0.5",
      max_stop_distance_atr: "3",
      order_expiry_min_seconds: 15,
      order_expiry_max_seconds: 1800,
    });
  });

  it("versions the TP transform instructions in the current prompt", () => {
    const prompt = readFileSync("prompts/system-v4.md", "utf8");
    expect(prompt).toContain("take_profit_distance_divisor");
    expect(prompt).toContain("effective_min_risk_reward_ratio");
    expect(prompt).toContain("derived midpoint remains exactly");
    expect(prompt).toContain("max_affordable_stop_distance");
  });
});
