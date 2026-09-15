import { describe, expect, it } from "vitest";

import { applyFadeLimitExitPolicy } from "../../apps/execution-service/src/proposal-transform.js";
import type {
  ModelResponse,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";

const analysisId = "44444444-4444-4444-8444-444444444444";

function metadata(): SymbolMetadata {
  return {
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
    contractSize: "100",
    volumeScale: "0.01",
    minVolume: "1",
    maxVolume: "100000",
    volumeStep: "1",
    minStopDistance: "0.10",
    commission: {
      type: "USD_PER_MILLION_USD",
      rate: "30",
      minimum: "0",
      minimumType: "QUOTE_CURRENCY",
      minimumAsset: "USD",
      pnlConversionFeeRate: "0",
    },
    metadataTime: "2026-01-01T00:00:00.000Z",
  };
}

function response(): ModelResponse {
  return {
    schema_version: "2.1",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-01-01T00:00:00.000Z",
    valid_until: "2026-01-01T00:05:00.000Z",
    market_regime: "UNCERTAIN",
    technical_map: {
      decision_zone: { lower: "1998.00", upper: "2002.00" },
      resistance_zones: [{ lower: "2001.50", upper: "2002.00" }],
      support_zones: [{ lower: "1998.00", upper: "1998.50" }],
      bullish_confirmation: {
        price: "2001.60",
        condition_code: "BUFFERED_BREAKOUT_ABOVE_RESISTANCE",
      },
      bearish_confirmation: {
        price: "1998.40",
        condition_code: "BUFFERED_BREAKDOWN_BELOW_SUPPORT",
      },
      upside_targets: ["2001.50"],
      downside_targets: ["1998.50"],
    },
    waiting_area: {
      lower: "1998.00",
      upper: "2002.00",
      description_code: "IMMEDIATE_DECISION_ZONE",
    },
    buy_stop: {
      trigger_price: "2001.50",
      entry_price: "2001.50",
      stop_loss: "1999.00",
      take_profit: "2003.00",
      invalidation_price: "1999.00",
      risk_reward_ratio: "1.0",
      expires_at: "2026-01-01T00:03:00.000Z",
    },
    sell_stop: {
      trigger_price: "1998.50",
      entry_price: "1998.50",
      stop_loss: "2001.00",
      take_profit: "1997.00",
      invalidation_price: "2001.00",
      risk_reward_ratio: "1.0",
      expires_at: "2026-01-01T00:03:00.000Z",
    },
    confidence: {
      overall: 0,
      buy: 0,
      sell: 0,
      original_overall: 0,
      original_buy: 0,
      original_sell: 0,
    },
    setup_tags: ["DIRECT_ENTRY_PAIR_OCO"],
    evidence_codes: [],
    risk_flags: [],
    performance_adjustment: {
      applied: false,
      confidence_delta: 0,
      reason_codes: [],
    },
    data_quality: { warnings: [] },
  };
}

describe("applyFadeLimitExitPolicy (ISSUE-103b hotfix)", () => {
  it("clamps the BUY entry to bid - tick when the LLM support is at/above bid", () => {
    const out = applyFadeLimitExitPolicy({
      response: response(),
      metadata: metadata(),
      atr: "1.50",
      slAtr: "2.5",
      tpAtr: "1.0",
      maximumStopDistance: "10",
      quote: { bid: "2000.10", ask: "2000.40" },
    });
    expect(out.accepted).toBe(true);
    expect(out.response?.buy_stop.entry_price).toBe("2000.09");
    expect(out.response?.sell_stop.entry_price).toBe("2000.41");
  });

  it("always clamps the BUY/SELL entries to bid-tick / ask+tick regardless of LLM levels", () => {
    const out = applyFadeLimitExitPolicy({
      response: response(),
      metadata: metadata(),
      atr: "1.50",
      slAtr: "2.5",
      tpAtr: "1.0",
      maximumStopDistance: "10",
      quote: { bid: "1998.20", ask: "1998.60" },
    });
    expect(out.accepted).toBe(true);
    expect(out.response?.buy_stop.entry_price).toBe("1998.19");
    expect(out.response?.sell_stop.entry_price).toBe("1998.61");
  });

  it("falls back to the LLM levels when no quote is supplied", () => {
    const out = applyFadeLimitExitPolicy({
      response: response(),
      metadata: metadata(),
      atr: "1.50",
      slAtr: "2.5",
      tpAtr: "1.0",
      maximumStopDistance: "10",
    });
    expect(out.accepted).toBe(true);
    expect(out.response?.buy_stop.entry_price).toBe("1998.50");
    expect(out.response?.sell_stop.entry_price).toBe("2001.50");
  });

  it("rejects when the LLM-anchored distances exceed the maximum stop distance", () => {
    const tight = applyFadeLimitExitPolicy({
      response: response(),
      metadata: metadata(),
      atr: "1.50",
      slAtr: "2.5",
      tpAtr: "1.0",
      maximumStopDistance: "2",
      quote: { bid: "2000.10", ask: "2000.40" },
    });
    expect(tight.accepted).toBe(false);
  });
});
