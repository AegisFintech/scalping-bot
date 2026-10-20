import type {
  ModelResponse,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";
export function response(): ModelResponse {
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
      stop_loss: "4442",
      take_profit: "4445",
      risk_reward_ratio: "0.5",
      expires_at: "2026-09-01T00:05:00.000Z",
      invalidation_price: "4442",
    },
    sell_stop: {
      trigger_price: "4443",
      entry_price: "4443",
      stop_loss: "4445",
      take_profit: "4442",
      risk_reward_ratio: "0.5",
      expires_at: "2026-09-01T00:05:00.000Z",
      invalidation_price: "4445",
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

export function metadata(): SymbolMetadata {
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
