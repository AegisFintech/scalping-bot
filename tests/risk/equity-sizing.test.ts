import { readFileSync } from "node:fs";
import { Decimal } from "decimal.js";
import { describe, expect, it, vi } from "vitest";
import { OcoRiskEvaluator } from "../../apps/execution-service/src/oco-risk-evaluator.js";
import type {
  AccountState,
  ModelResponse,
  Quote,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";
import {
  sizeOcoPair,
  sizePosition,
} from "../../packages/risk-engine/src/risk.js";

const metadata = (
  JSON.parse(
    readFileSync(
      "tests/fixtures/scenario/manual-levels-synthetic.json",
      "utf8",
    ),
  ) as { metadata: SymbolMetadata }
).metadata;
const leg = {
  equity: "999832.16",
  availableMargin: "999832.16",
  baseRiskPercent: "1",
  maxRiskPercent: "1",
  entryPrice: "4414.15",
  stopLoss: "4413.09",
  estimatedMarginPerVolume: "0.0442",
  currentMargin: "0",
  maxMarginUsagePercent: "1",
  maxPositionNotional: null,
  metadata: {
    ...metadata,
    contractSize: "100",
    volumeScale: "0.01",
    tickValue: "0.0001",
    minVolume: "100",
    volumeStep: "100",
    maxVolume: "1000000",
  },
};
const account: AccountState = {
  equity: leg.equity,
  balance: leg.equity,
  availableMargin: leg.availableMargin,
  certain: true,
  relevantPositionCount: 0,
  relevantPendingOrderCount: 0,
  hasPartialFill: false,
  hasCancellationPending: false,
  reasonCodes: [],
  reconciledAt: "2026-09-08T01:00:00Z",
};
const response = {
  analysis_id: "fixture",
  schema_version: "2.1",
  symbol: "XAUUSD",
  buy_stop: {
    entry_price: leg.entryPrice,
    stop_loss: leg.stopLoss,
    take_profit: "4414.68",
    expires_at: "2026-09-08T01:01:00Z",
  },
  sell_stop: {
    entry_price: "4412.71",
    stop_loss: "4413.77",
    take_profit: "4412.18",
    expires_at: "2026-09-08T01:01:00Z",
  },
} as ModelResponse;
const evaluate = (
  estimate: (
    symbol: string,
    side: "BUY" | "SELL",
    volume: string,
  ) => Promise<string>,
) =>
  new OcoRiskEvaluator({
    marginEstimator: { estimate },
    baseRiskPercent: "1",
    maxRiskPercent: "1",
    maxMarginUsagePercent: "1",
    maxPositionNotional: null,
    strategyVersion: "fixture",
  }).evaluate({
    account,
    response,
    metadata: leg.metadata,
    quote: {} as Quote,
  });

describe("equity sizing on identical synthetic execution inputs", () => {
  it("applies the fixed maximum to the combined setup even when each half would fit", () => {
    expect(
      sizeOcoPair({ setupRiskPercent: "1.5", buy: leg, sell: leg }),
    ).toMatchObject({
      approved: false,
      reasonCodes: ["OCO_RISK_PERCENT_INVALID"],
    });
  });
  it("removes the fixed-dollar bottleneck without exceeding combined loss or margin budgets", () => {
    const old = sizeOcoPair({
      setupRiskPercent: "1",
      buy: { ...leg, maxPositionNotional: "5500" },
      sell: { ...leg, maxPositionNotional: "5500" },
    });
    expect(old.buy.normalizedVolume).toBe("100");
    const result = sizeOcoPair({ setupRiskPercent: "1", buy: leg, sell: leg });
    expect(result.approved).toBe(true);
    expect(new Decimal(result.buy.normalizedVolume!).gt(100)).toBe(true);
    expect(
      new Decimal(result.combinedMaximumLoss!).lte(
        new Decimal(leg.equity).div(100),
      ),
    ).toBe(true);
    expect(
      new Decimal(result.buy.estimatedMargin!)
        .plus(result.sell.estimatedMargin!)
        .lte(new Decimal(leg.equity).div(100)),
    ).toBe(true);
  });
  it("fits broker increments to available margin and never rounds up an unaffordable minimum", () => {
    expect(sizePosition({ ...leg, availableMargin: "8.83" })).toMatchObject({
      approved: true,
      normalizedVolume: "100",
    });
    expect(sizePosition({ ...leg, availableMargin: "4.41" })).toMatchObject({
      approved: false,
      reasonCodes: ["RISK_MARGIN_MIN_VOLUME_UNAFFORDABLE"],
    });
    expect(
      sizePosition({ ...leg, estimatedMarginPerVolume: "0" }).approved,
    ).toBe(false);
    expect(
      sizeOcoPair({
        setupRiskPercent: "1",
        buy: { ...leg, currentMargin: "10000" },
        sell: leg,
      }).approved,
    ).toBe(false);
  });
  it("uses exact broker margin and bounds retries when the broker changes tiers", async () => {
    const estimate = vi.fn(
      (_symbol: string, _side: "BUY" | "SELL", volume: string) =>
        Promise.resolve(
          new Decimal(volume)
            .mul(volume === "100" ? "0.0442" : "0.442")
            .toFixed(),
        ),
    );
    const result = await evaluate(estimate);
    expect(result.approved).toBe(true);
    expect(estimate).toHaveBeenCalledTimes(6);
    expect(
      new Decimal(result.risk!.buy.estimatedMargin!)
        .plus(result.risk!.sell.estimatedMargin!)
        .lte(new Decimal(leg.equity).div(100)),
    ).toBe(true);
    expect(result.risk!.buy.estimatedMargin).toBe(
      new Decimal(result.commands![0].volume).mul("0.442").toFixed(),
    );
  });
  it("rounds recurring broker margin rates upward within the strict decimal contract", async () => {
    let queries = 0;
    const result = await evaluate((_symbol, _side, volume) => {
      queries++;
      return Promise.resolve(
        queries <= 2
          ? "4.42"
          : queries <= 4
            ? "10000.01"
            : new Decimal(volume).mul("0.09").toFixed(),
      );
    });
    expect(result.approved).toBe(true);
    expect(queries).toBeLessThanOrEqual(8);
    expect(
      new Decimal(result.risk!.buy.estimatedMargin!)
        .plus(result.risk!.sell.estimatedMargin!)
        .lte(new Decimal(leg.equity).div(100)),
    ).toBe(true);
  });
  it("rejects unavailable, invalid and persistently inconsistent broker margin without leaking errors", async () => {
    expect((await evaluate(() => Promise.resolve("0"))).approved).toBe(false);
    const failed = await evaluate(() =>
      Promise.reject(new Error("private provider response")),
    );
    expect(failed.reasonCodes).toEqual(["RISK_EVALUATION_FAILED"]);
    let round = 0;
    const estimate = vi.fn(
      (_symbol: string, _side: "BUY" | "SELL", volume: string) => {
        const rate = new Decimal("0.0442").mul(
          new Decimal(10).pow(Math.floor(round++ / 2)),
        );
        return Promise.resolve(new Decimal(volume).mul(rate).toFixed());
      },
    );
    const result = await evaluate(estimate);
    expect(result.approved).toBe(false);
    expect(result.commands).toBeNull();
    expect(estimate.mock.calls.length).toBeLessThanOrEqual(8);
  });
});
