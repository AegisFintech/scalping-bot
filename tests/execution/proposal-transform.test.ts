import { describe, expect, it } from "vitest";

import {
  applyCommissionAwareExitPolicy,
  deriveCommissionAwareMinimumDistances,
} from "../../apps/execution-service/src/proposal-transform.js";
import type {
  ModelResponse,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";

function response(): ModelResponse {
  return {
    schema_version: "2.1",
    analysis_id: "22222222-2222-4222-8222-222222222222",
    symbol: "XAUUSD",
    generated_at: "2026-09-01T00:00:00.000Z",
    valid_until: "2026-09-01T00:05:00.000Z",
    market_regime: "RANGING",
    technical_map: {
      decision_zone: { lower: "4443", upper: "4444" },
      resistance_zones: [{ lower: "4443.8", upper: "4444" }],
      support_zones: [{ lower: "4443", upper: "4443.2" }],
      bullish_confirmation: {
        price: "4444",
        condition_code: "BUFFERED_BREAKOUT_ABOVE_RESISTANCE",
      },
      bearish_confirmation: {
        price: "4443",
        condition_code: "BUFFERED_BREAKDOWN_BELOW_SUPPORT",
      },
      upside_targets: ["4445"],
      downside_targets: ["4442"],
    },
    waiting_area: {
      lower: "4443",
      upper: "4444",
      description_code: "RANGE",
    },
    buy_stop: {
      trigger_price: "4444",
      entry_price: "4444",
      stop_loss: "4443",
      take_profit: "4445",
      risk_reward_ratio: "1",
      expires_at: "2026-09-01T00:05:00.000Z",
      invalidation_price: "4443",
    },
    sell_stop: {
      trigger_price: "4443",
      entry_price: "4443",
      stop_loss: "4444",
      take_profit: "4442",
      risk_reward_ratio: "1",
      expires_at: "2026-09-01T00:05:00.000Z",
      invalidation_price: "4444",
    },
    confidence: {
      overall: 50,
      buy: 50,
      sell: 50,
      original_overall: 50,
      original_buy: 50,
      original_sell: 50,
    },
    setup_tags: [],
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

function metadata(): SymbolMetadata {
  return {
    symbolId: "7",
    symbolName: "XAUUSD",
    digits: 2,
    pipPosition: 2,
    pipSize: "0.01",
    tickSize: "0.01",
    tickValue: "0.0001",
    baseAsset: "XAU",
    quoteAsset: "USD",
    accountAsset: "USD",
    quoteToAccountConversionRate: "1",
    contractSize: "100",
    volumeScale: "0.01",
    minVolume: "100",
    maxVolume: "1000000",
    volumeStep: "100",
    minStopDistance: "0",
    commission: {
      type: "USD_PER_MILLION_USD",
      rate: "30",
      minimum: "0",
      minimumType: "QUOTE_CURRENCY",
      minimumAsset: "USD",
      pnlConversionFeeRate: "0",
    },
    metadataTime: "2026-09-01T00:00:00.000Z",
  };
}

describe("commission-aware exit transform", () => {
  it("chooses the first commission-positive pip and sets SL to twice TP", () => {
    const original = response();
    const result = applyCommissionAwareExitPolicy(
      original,
      metadata(),
      "0.01",
      "4",
    );

    expect(result).toMatchObject({ accepted: true, reasonCodes: [] });
    expect(result.response?.buy_stop).toMatchObject({
      entry_price: "4444",
      stop_loss: "4443.46",
      take_profit: "4444.27",
      invalidation_price: "4443.46",
      risk_reward_ratio: "0.5",
    });
    expect(result.response?.sell_stop).toMatchObject({
      entry_price: "4443",
      stop_loss: "4443.54",
      take_profit: "4442.73",
      invalidation_price: "4443.54",
      risk_reward_ratio: "0.5",
    });
    expect(result.details?.buy).toMatchObject({
      pip_size: "0.01",
      take_profit_pips: "27",
      gross_profit: "0.27",
      total_estimated_fees: "0.2666481",
      expected_net_profit: "0.0033519",
      stop_loss_distance: "0.54",
    });
    expect(result.details?.sell.take_profit_pips).toBe("27");
    expect(original.buy_stop.take_profit).toBe("4445");
    expect(original.buy_stop.stop_loss).toBe("4443");
  });

  it("derives a conservative pre-model floor at broker minimum volume", () => {
    const result = deriveCommissionAwareMinimumDistances({
      buyEntryPrice: "4445",
      sellEntryPrice: "4444",
      minimumStopDistance: "0.01",
      maximumStopDistance: "4",
      metadata: metadata(),
    });

    expect(result).toMatchObject({
      accepted: true,
      reasonCodes: [],
      takeProfitDistance: "0.27",
      stopLossDistance: "0.54",
    });
  });

  it("fails closed when the broker commission type is unsupported", () => {
    const unsupported: SymbolMetadata = {
      ...metadata(),
      commission: { ...metadata().commission, type: "USD_PER_LOT" },
    };
    expect(
      applyCommissionAwareExitPolicy(response(), unsupported, "0.01", "4"),
    ).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: ["COMMISSION_TYPE_UNSUPPORTED"],
    });
  });

  it("rejects an AI technical envelope inside the commission-aware exits", () => {
    const original = response();
    const tooNarrow: ModelResponse = {
      ...original,
      technical_map: {
        ...original.technical_map,
        upside_targets: ["4444.2"],
      },
      buy_stop: {
        ...original.buy_stop,
        take_profit: "4444.2",
        stop_loss: "4443.6",
        invalidation_price: "4443.6",
      },
    };

    expect(
      applyCommissionAwareExitPolicy(tooNarrow, metadata(), "0.01", "4"),
    ).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: [
        "BUY_AI_INVALIDATION_DOES_NOT_CONTAIN_DOUBLE_SL",
        "BUY_AI_STOP_DOES_NOT_CONTAIN_DOUBLE_SL",
        "BUY_AI_TARGET_BELOW_COMMISSION_POSITIVE_TP",
      ],
    });
  });

  it("rejects when no commission-positive target fits the stop ceiling", () => {
    expect(
      applyCommissionAwareExitPolicy(response(), metadata(), "0.01", "0.4"),
    ).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: [
        "BUY_COMMISSION_POSITIVE_TP_UNAVAILABLE",
        "SELL_COMMISSION_POSITIVE_TP_UNAVAILABLE",
      ],
    });
  });
});
