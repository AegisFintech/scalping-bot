import { describe, expect, it } from "vitest";

import { OcoRiskEvaluator } from "../../apps/execution-service/src/oco-risk-evaluator.js";
import type {
  AccountState,
  ModelResponse,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";

const analysisId = "00000000-0000-4000-8000-000000000001";
const symbolId = "1";
function metadata(): SymbolMetadata {
  return {
    symbolId,
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

function account(): AccountState {
  return {
    reconciledAt: "2026-01-01T00:00:00.000Z",
    certain: true,
    equity: "10000",
    balance: "10000",
    availableMargin: "10000",
    relevantPositionCount: 0,
    relevantPendingOrderCount: 0,
    hasPartialFill: false,
    hasCancellationPending: false,
    reasonCodes: [],
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
    setup_tags: ["DIRECT_FADE_LIMIT_PAIR_OCO"],
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

const marginEstimator = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimate(_unused: {
    symbolId: string;
    volume: string;
    quote: { bid: string; ask: string };
  }): string {
    return "100";
  },
};

describe("OcoRiskEvaluator trend filter (ISSU-102b)", () => {
  it("rejects when LIMIT mode and trend is unclear (zero)", async () => {
    const evaluator = new OcoRiskEvaluator({
      marginEstimator: marginEstimator as never,
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      strategyVersion: "0.3.0-fade-limit.1",
      executionOrderType: "LIMIT",
      adverseSlippagePoints: "65",
      timeInForce: "GTC",
      strategyLabelPrefix: "ctrader-ai-scalper",
    });
    const result = await evaluator.evaluate({
      response: response(),
      account: account(),
      metadata: metadata(),
      quote: {
        bid: "2000.00",
        ask: "2000.20",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      trend: 0,
    });
    expect(result.approved).toBe(false);
    expect(result.reasonCodes).toContain("FADE_LIMIT_TREND_UNCLEAR");
    expect(result.commands).toBeNull();
  });

  it("approves both legs when LIMIT mode and trend is clear (+1 or -1)", async () => {
    const evaluator = new OcoRiskEvaluator({
      marginEstimator: marginEstimator as never,
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      strategyVersion: "0.3.0-fade-limit.1",
      executionOrderType: "LIMIT",
      adverseSlippagePoints: "65",
      timeInForce: "GTC",
      strategyLabelPrefix: "ctrader-ai-scalper",
    });
    const deltaQuote = {
      bid: "2000.00",
      ask: "2000.20",
      sourceTime: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:00:00.000Z",
    };
    const meta = metadata();
    for (const trend of [-1, 1] as const) {
      const result = await evaluator.evaluate({
        response: response(),
        account: account(),
        metadata: meta,
        quote: deltaQuote,
        trend,
      });
      expect(result.commands).not.toBeNull();
      expect(result.commands).toHaveLength(2);
    }
  });

  it("approves both legs when STOP mode regardless of trend", async () => {
    const evaluator = new OcoRiskEvaluator({
      marginEstimator: marginEstimator as never,
      baseRiskPercent: "1",
      maxRiskPercent: "1",
      maxMarginUsagePercent: "30",
      maxPositionNotional: null,
      strategyVersion: "0.2.5-market-stop.11",
      executionOrderType: "STOP",
      adverseSlippagePoints: "30",
      timeInForce: "GTC",
      strategyLabelPrefix: "ctrader-ai-scalper",
    });
    const result = await evaluator.evaluate({
      response: response(),
      account: account(),
      metadata: metadata(),
      quote: {
        bid: "2000.00",
        ask: "2000.20",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      trend: 0,
    });
    expect(result.commands).not.toBeNull();
    expect(result.commands).toHaveLength(2);
  });
});
