import { describe, expect, it } from "vitest";

import type { SymbolMetadata } from "../../packages/contracts/src/index.js";
import {
  evaluateCommissionCoverage,
  minimumCommissionPositiveTarget,
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
        metadata,
      });
      expect(result.approved, `${pips} pips`).toBe(false);
      expect(result.evidence?.take_profit_pips).toBe(String(pips));
    }
  });

  it("selects 27 pips as the first strictly commission-positive target", () => {
    expect(
      minimumCommissionPositiveTarget({
        side: "BUY",
        entryPrice: "4444",
        volume: "100",
        maximumTakeProfitDistance: "5",
        metadata,
      }),
    ).toMatchObject({
      approved: true,
      reasonCodes: [],
      evidence: {
        take_profit: "4444.27",
        take_profit_pips: "27",
        gross_profit: "0.27",
        total_estimated_fees: "0.2666481",
        expected_net_profit: "0.0033519",
      },
    });
  });

  it("rechecks coverage at actual deterministic volume", () => {
    const result = evaluateCommissionCoverage({
      side: "SELL",
      entryPrice: "4444",
      takeProfit: "4443.73",
      volume: "500",
      metadata,
    });
    expect(result).toMatchObject({
      approved: true,
      evidence: {
        gross_profit: "1.35",
        total_estimated_fees: "1.3331595",
        expected_net_profit: "0.0168405",
      },
    });
  });

  it("requires gross profit to be strictly greater than estimated fees", () => {
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
        takeProfit: "4444.27",
        volume: "100",
        metadata: equalCost,
      }),
    ).toMatchObject({
      approved: false,
      reasonCodes: ["BUY_TAKE_PROFIT_DOES_NOT_COVER_COMMISSION"],
      evidence: {
        gross_profit: "0.27",
        total_estimated_fees: "0.27",
        expected_net_profit: "0",
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
        metadata: unsupported,
      }),
    ).toMatchObject({
      approved: false,
      evidence: null,
      reasonCodes: ["COMMISSION_USD_NOTIONAL_CONVERSION_UNAVAILABLE"],
    });
  });
});
