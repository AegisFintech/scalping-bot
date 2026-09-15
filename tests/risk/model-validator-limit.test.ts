import { describe, expect, it } from "vitest";

import { validateSemantics } from "../../packages/risk-engine/src/index.js";
import type {
  ModelResponse,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";

const analysisId = "33333333-3333-4333-8333-333333333333";

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

function baseContext(brackets: "STOP" | "LIMIT") {
  return {
    entryBrackets: brackets,
    analysisId,
    symbol: "XAUUSD",
    now: new Date("2026-01-01T00:00:00.000Z"),
    quote: {
      bid: "1999.80",
      ask: "2000.20",
      sourceTime: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:00:00.000Z",
    },
    metadata: metadata(),
    atr: "1.50",
    minRiskRewardRatio: "0.30",
    minExpirySeconds: 60,
    maxExpirySeconds: 600,
    maxStopDistanceAtr: "5",
    maxEntryDistanceAtr: "2",
    minStopDistancePoints: null,
    maxQuoteAgeMs: 10_000,
    expiryReferenceTime: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function response(leg: Partial<ModelResponse["buy_stop"]>): ModelResponse {
  return {
    schema_version: "2.1",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-01-01T00:00:00.000Z",
    valid_until: "2026-01-01T00:00:05.000Z",
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
      trigger_price: "1999.50",
      entry_price: "1999.50",
      stop_loss: "1997.20",
      take_profit: "2002.10",
      invalidation_price: "1997.20",
      risk_reward_ratio: "0.7",
      expires_at: "2026-01-01T00:04:00.000Z",
      ...leg,
    },
    sell_stop: {
      trigger_price: "2000.50",
      entry_price: "2000.50",
      stop_loss: "2003.00",
      take_profit: "1997.90",
      invalidation_price: "2003.00",
      risk_reward_ratio: "0.7",
      expires_at: "2026-01-01T00:04:00.000Z",
      ...leg,
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

describe("LIMIT bracket quote-side semantics", () => {
  it("accepts a BUY limit below bid minus minStopDistance", () => {
    const result = validateSemantics(
      response({
        entry_price: "1999.40",
        trigger_price: "1999.40",
        stop_loss: "1997.00",
        take_profit: "2001.50",
        invalidation_price: "1997.00",
        risk_reward_ratio: "0.8",
      }),
      baseContext("LIMIT"),
    );
    expect(result.reasonCodes).not.toContain("BUY_ENTRY_TOO_CLOSE");
  });

  it("rejects a BUY limit resting on the wrong side of the spread", () => {
    const result = validateSemantics(
      response({
        entry_price: "2000.30",
        trigger_price: "2000.30",
        stop_loss: "1997.80",
        take_profit: "2002.50",
        invalidation_price: "1997.80",
        risk_reward_ratio: "0.7",
      }),
      baseContext("LIMIT"),
    );
    expect(result.reasonCodes).toContain("BUY_LIMIT_ABOVE_BID");
  });

  it("rejects the same BUY limit under STOP bracket semantics", () => {
    const result = validateSemantics(
      response({
        entry_price: "1999.40",
        trigger_price: "1999.40",
        stop_loss: "1997.00",
        take_profit: "2001.50",
        invalidation_price: "1997.00",
        risk_reward_ratio: "0.8",
      }),
      baseContext("STOP"),
    );
    expect(result.reasonCodes).toContain("BUY_ENTRY_TOO_CLOSE");
  });

  it("accepts a SELL limit above ask plus minStopDistance", () => {
    const result = validateSemantics(
      response({
        entry_price: "2000.60",
        trigger_price: "2000.60",
        stop_loss: "2003.00",
        take_profit: "1997.90",
        invalidation_price: "2003.00",
        risk_reward_ratio: "0.8",
      }),
      baseContext("LIMIT"),
    );
    expect(result.reasonCodes).not.toContain("SELL_ENTRY_TOO_CLOSE");
  });
});
