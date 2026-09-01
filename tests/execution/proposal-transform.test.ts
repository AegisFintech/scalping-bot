import { describe, expect, it } from "vitest";

import {
  halveTakeProfitAndStopLossDistances,
  proposalMinimumRiskRewardRatio,
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
    generated_at: "2026-08-25T00:00:00.000Z",
    valid_until: "2026-08-25T00:05:00.000Z",
    market_regime: "RANGING",
    technical_map: {
      decision_zone: { lower: "1999", upper: "2001" },
      resistance_zones: [{ lower: "2000", upper: "2001" }],
      support_zones: [{ lower: "1999", upper: "2000" }],
      bullish_confirmation: {
        price: "2001",
        condition_code: "BUFFERED_BREAKOUT_ABOVE_RESISTANCE",
      },
      bearish_confirmation: {
        price: "1999",
        condition_code: "BUFFERED_BREAKDOWN_BELOW_SUPPORT",
      },
      upside_targets: ["2002"],
      downside_targets: ["1998"],
    },
    waiting_area: {
      lower: "1999",
      upper: "2001",
      description_code: "RANGE",
    },
    buy_stop: {
      trigger_price: "2001",
      entry_price: "2001",
      stop_loss: "2000",
      take_profit: "2005",
      risk_reward_ratio: "4",
      expires_at: "2026-08-25T00:05:00.000Z",
      invalidation_price: "2000.5",
    },
    sell_stop: {
      trigger_price: "1999",
      entry_price: "1999",
      stop_loss: "2000",
      take_profit: "1995",
      risk_reward_ratio: "4",
      expires_at: "2026-08-25T00:05:00.000Z",
      invalidation_price: "1999.5",
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

function metadata(tickSize = "0.01"): SymbolMetadata {
  return {
    symbolId: "7",
    symbolName: "XAUUSD",
    digits: 2,
    tickSize,
    tickValue: "0.01",
    contractSize: "100",
    volumeScale: "0.01",
    minVolume: "1",
    maxVolume: "10000",
    volumeStep: "1",
    minStopDistance: "0.1",
    metadataTime: "2026-08-25T00:00:00.000Z",
  };
}

describe("take-profit distance transform", () => {
  it("halves the prior effective TP distance and the endpoint SL distance", () => {
    const original = response();
    const result = halveTakeProfitAndStopLossDistances(original, metadata());

    expect(result).toMatchObject({ accepted: true, reasonCodes: [] });
    expect(result.response?.buy_stop).toMatchObject({
      entry_price: "2001",
      stop_loss: "2000.5",
      take_profit: "2002",
      risk_reward_ratio: "2",
    });
    expect(result.response?.sell_stop).toMatchObject({
      entry_price: "1999",
      stop_loss: "1999.5",
      take_profit: "1998",
      risk_reward_ratio: "2",
    });
    expect(original.buy_stop.stop_loss).toBe("2000");
    expect(original.buy_stop.take_profit).toBe("2005");
    expect(result.details?.buy.original_stop_loss).toBe("2000");
    expect(result.details?.buy.effective_stop_loss).toBe("2000.5");
    expect(result.details?.buy.original_take_profit).toBe("2005");
    expect(result.details?.buy.effective_take_profit).toBe("2002");
    expect(proposalMinimumRiskRewardRatio("2")).toBe("4");
  });

  it("rejects an off-tick TP quarter without rounding it", () => {
    const original = response();
    const result = halveTakeProfitAndStopLossDistances(
      {
        ...original,
        buy_stop: {
          ...original.buy_stop,
          take_profit: "2004.99",
          risk_reward_ratio: "3.99",
        },
      },
      metadata("0.01"),
    );

    expect(result).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: ["BUY_TP_QUARTER_NOT_ON_TICK"],
    });
    expect(result.details?.buy.effective_take_profit).toBe("2001.9975");
  });

  it("rejects an off-tick SL midpoint without rounding it", () => {
    const original = response();
    const result = halveTakeProfitAndStopLossDistances(
      {
        ...original,
        buy_stop: {
          ...original.buy_stop,
          stop_loss: "1999.99",
          invalidation_price: "2000.495",
        },
      },
      metadata("0.01"),
    );

    expect(result).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: ["BUY_SL_MIDPOINT_NOT_ON_TICK"],
    });
    expect(result.details?.buy.effective_stop_loss).toBe("2000.495");
  });

  it("rejects when the model invalidation does not equal the effective SL", () => {
    const original = response();
    const result = halveTakeProfitAndStopLossDistances(
      {
        ...original,
        buy_stop: {
          ...original.buy_stop,
          invalidation_price: "2000.6",
        },
      },
      metadata(),
    );

    expect(result).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: ["BUY_EFFECTIVE_SL_INVALIDATION_MISMATCH"],
    });
  });
});
