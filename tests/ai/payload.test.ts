import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildModelPayload } from "../../apps/ai-orchestrator/src/payload.js";
import { analysisChart } from "../helpers/analysis-chart.js";

const chart = analysisChart();

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
  promptVersion: "system-v8",
  schemaVersion: "2.1" as const,
  strategyVersion: "test",
  chart,
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
    maxEntryDistanceAtr: "2.5",
    buyEntryMinimum: "2000.2",
    buyEntryMaximum: "2002.6",
    sellEntryMinimum: "1997.4",
    sellEntryMaximum: "1999.8",
    minimumStopDistance: "0.1",
    maximumStopDistance: "0.5",
    preferredExpiresAt: "2026-01-01T00:25:00.000Z",
    orderExpiryMinSeconds: 15,
    orderExpiryMaxSeconds: 1800,
    preferredOrderExpirySeconds: 1500,
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
      max_entry_distance_atr: "2.5",
      buy_entry_minimum: "2000.2",
      buy_entry_maximum: "2002.6",
      sell_entry_minimum: "1997.4",
      sell_entry_maximum: "1999.8",
      minimum_stop_distance: "0.1",
      maximum_stop_distance: "0.5",
      preferred_expires_at: "2026-01-01T00:25:00.000Z",
      order_expiry_min_seconds: 15,
      order_expiry_max_seconds: 1800,
      preferred_order_expiry_seconds: 1500,
    });
  });

  it("links the numeric request to the exact completed-candle image", () => {
    const payload = buildModelPayload({ ...common, mode: "compact" });
    expect(payload.chart).toEqual({
      renderer_version: chart.rendererVersion,
      mime_type: "image/png",
      width: 1600,
      height: 1200,
      sha256: chart.sha256,
      completed_candles_only: true,
      candle_counts: chart.candleCounts,
      latest_end_times: chart.latestEndTimes,
    });
    expect(JSON.stringify(payload)).not.toContain(chart.dataBase64);
  });

  it("versions the TP transform instructions in the current prompt", () => {
    const prompt = readFileSync("prompts/system-v8.md", "utf8");
    const previousPrompt = readFileSync("prompts/system-v7.md", "utf8");
    expect(prompt).toContain("take_profit_distance_divisor");
    expect(prompt).toContain("effective_min_risk_reward_ratio");
    expect(prompt).toContain("midpoint must be");
    expect(prompt).toContain("max_affordable_stop_distance");
    expect(prompt).toContain("preferred_expires_at");
    expect(prompt).toContain("[buy_entry_minimum,buy_entry_maximum]");
    expect(prompt).toContain("[sell_entry_minimum,sell_entry_maximum]");
    expect(prompt).toContain("[minimum_stop_distance,maximum_stop_distance]");
    expect(prompt).toContain("technical_map.bullish_confirmation.price");
    expect(prompt).toContain("For every zone require lower<upper");
    expect(prompt).toContain("min_risk_reward_ratio+0.2");
    expect(prompt).toContain("risk_reward_ratio=reward/risk");
    expect(prompt).toContain(
      "take_profit=entry_price+2*(primary target-entry_price)",
    );
    expect(prompt).toContain("Do not mirror one leg");
    expect(prompt).toContain(
      "Read the attached deterministic 1600x1200 PNG first",
    );
    expect(prompt).not.toEqual(previousPrompt);
  });
});
