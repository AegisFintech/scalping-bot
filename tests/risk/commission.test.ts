import { describe, expect, it } from "vitest";

import type { SymbolMetadata } from "../../packages/contracts/src/index.js";
import {
  evaluateCommissionCoverage,
  minimumFeeBufferedTarget,
} from "../../packages/risk-engine/src/index.js";

const metadata: SymbolMetadata = {
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

describe("commission coverage", () => {
  it("proves one to four broker pips are cost-negative", () => {
    for (const [pips, target] of [
      [1, "4444.01"],
      [2, "4444.02"],
      [3, "4444.03"],
      [4, "4444.04"],
    ] as const) {
      const result = evaluateCommissionCoverage({
        side: "BUY",
        entryPrice: "4444",
        takeProfit: target,
        volume: "100",
        minimumExpectedNetToFeesRatio: "1",
        metadata,
      });
      expect(result.approved, `${pips} pips`).toBe(false);
      expect(result.evidence?.take_profit_pips).toBe(String(pips));
    }
  });

  it("selects 54 pips as the first target leaving one full fee of net profit", () => {
    expect(
      minimumFeeBufferedTarget({
        side: "BUY",
        entryPrice: "4444",
        volume: "100",
        maximumTakeProfitDistance: "5",
        minimumExpectedNetToFeesRatio: "1",
        metadata,
      }),
    ).toMatchObject({
      approved: true,
      reasonCodes: [],
      evidence: {
        take_profit: "4444.54",
        take_profit_pips: "54",
        gross_profit: "0.54",
        total_estimated_fees: "0.2666562",
        required_minimum_net_profit: "0.2666562",
        expected_net_profit: "0.2733438",
      },
    });
  });

  it("rejects the adjacent 53-pip target below the required net buffer", () => {
    expect(
      evaluateCommissionCoverage({
        side: "BUY",
        entryPrice: "4444",
        takeProfit: "4444.53",
        volume: "100",
        minimumExpectedNetToFeesRatio: "1",
        metadata,
      }),
    ).toMatchObject({
      approved: false,
      reasonCodes: ["BUY_TAKE_PROFIT_DOES_NOT_MEET_NET_FEE_BUFFER"],
      evidence: {
        gross_profit: "0.53",
        total_estimated_fees: "0.2666559",
        required_minimum_net_profit: "0.2666559",
        expected_net_profit: "0.2633441",
      },
    });
  });

  it("rechecks coverage at actual deterministic volume", () => {
    const result = evaluateCommissionCoverage({
      side: "SELL",
      entryPrice: "4444",
      takeProfit: "4443.46",
      volume: "500",
      minimumExpectedNetToFeesRatio: "1",
      metadata,
    });
    expect(result).toMatchObject({
      approved: true,
      evidence: {
        gross_profit: "2.7",
        total_estimated_fees: "1.333119",
        required_minimum_net_profit: "1.333119",
        expected_net_profit: "1.366881",
      },
    });
  });

  it("requires expected net to be strictly greater than the fee buffer", () => {
    const equalCost: SymbolMetadata = {
      ...metadata,
      commission: {
        ...metadata.commission,
        rate: "0",
        minimum: "0.135",
      },
    };
    expect(
      evaluateCommissionCoverage({
        side: "BUY",
        entryPrice: "4444",
        takeProfit: "4444.54",
        volume: "100",
        minimumExpectedNetToFeesRatio: "1",
        metadata: equalCost,
      }),
    ).toMatchObject({
      approved: false,
      reasonCodes: ["BUY_TAKE_PROFIT_DOES_NOT_MEET_NET_FEE_BUFFER"],
      evidence: {
        gross_profit: "0.54",
        total_estimated_fees: "0.27",
        required_minimum_net_profit: "0.27",
        expected_net_profit: "0.27",
      },
    });
  });

  it("fails closed on unsupported commission currency semantics", () => {
    const unsupported: SymbolMetadata = {
      ...metadata,
      quoteAsset: "EUR",
    };
    expect(
      evaluateCommissionCoverage({
        side: "BUY",
        entryPrice: "4444",
        takeProfit: "4444.27",
        volume: "100",
        minimumExpectedNetToFeesRatio: "1",
        metadata: unsupported,
      }),
    ).toMatchObject({
      approved: false,
      evidence: null,
      reasonCodes: ["COMMISSION_USD_NOTIONAL_CONVERSION_UNAVAILABLE"],
    });
  });

  it("fails closed when the required net-to-fees ratio is below one", () => {
    expect(
      evaluateCommissionCoverage({
        side: "BUY",
        entryPrice: "4444",
        takeProfit: "4444.54",
        volume: "100",
        minimumExpectedNetToFeesRatio: "0.99",
        metadata,
      }),
    ).toMatchObject({
      approved: false,
      evidence: null,
      reasonCodes: ["COMMISSION_NET_FEE_RATIO_INVALID"],
    });
  });
});
