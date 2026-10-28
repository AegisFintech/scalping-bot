import { expect, it } from "vitest";
import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  AccountState,
} from "../../packages/contracts/src/index.js";
import {
  directionalScalpTransform,
  validateDirectionalScalpCommands,
} from "../../packages/strategy-candidates/src/directional-scalp.js";
import { OcoRiskEvaluator } from "../../apps/execution-service/src/oco-risk-evaluator.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
const m = metadata();
function proposal() {
  const r = response();
  Object.assign(r.buy_stop, {
    stop_loss: "4437",
    invalidation_price: "4437",
    take_profit: "4444.4",
    risk_reward_ratio: "0.0571428571",
  });
  return r;
}
it("preserves selected model geometry and rejects costs instead of widening", () => {
  const r = proposal(),
    snapshot = { metadata: m } as MarketSnapshot;
  const actual = directionalScalpTransform({
    snapshot,
    response: r,
    side: "BUY",
    maximumStopDistance: "10",
  });
  expect(actual.accepted).toBe(true);
  expect(actual.response).toBe(r);
  expect(
    directionalScalpTransform({
      snapshot,
      response: r,
      maximumStopDistance: "10",
    }).accepted,
  ).toBe(false);
  expect(
    directionalScalpTransform({
      snapshot,
      response: r,
      side: "BUY",
      maximumStopDistance: "6",
    }).accepted,
  ).toBe(false);
  expect(
    directionalScalpTransform({
      snapshot: {
        metadata: { ...m, commission: { ...m.commission, rate: "3000" } },
      } as MarketSnapshot,
      response: r,
      side: "BUY",
      maximumStopDistance: "10",
    }).accepted,
  ).toBe(false);
});
it("keeps one GTD order at the former leg ceiling and sizes dynamically", async () => {
  const evaluator = new OcoRiskEvaluator({
    operatorEntryModes: true,
    modelDefinedScalp: true,
    executionOrderType: "STOP_LIMIT",
    timeInForce: "GTD",
    strategyVersion: "fixture",
    adverseSlippagePoints: "65",
    baseRiskPercent: "5",
    maxRiskPercent: "5",
    maxPositionNotional: null,
    maxMarginUsagePercent: "100",
    marginEstimator: {
      estimate: (_s, _d, v) =>
        Promise.resolve(new Decimal(v).mul("0.02").toFixed()),
    },
  });
  let prior = new Decimal(Infinity);
  for (const equity of ["100000", "50000"]) {
    const account = {
      certain: true,
      equity,
      balance: equity,
      availableMargin: equity,
      relevantPositionCount: 0,
      relevantPendingOrderCount: 0,
      hasPartialFill: false,
      hasCancellationPending: false,
    } as AccountState;
    const input = {
      response: proposal(),
      account,
      metadata: m,
      selectedSide: "BUY" as const,
      quote: {
        bid: "4443.4",
        ask: "4443.5",
        sourceTime: m.metadataTime,
        receivedAt: m.metadataTime,
      },
    };
    const r = await evaluator.evaluate(input);
    expect(r.approved, r.reasonCodes.join(",")).toBe(true);
    expect(r.commands).toBeNull();
    expect(r.perLegRiskPercent).toBe("2.5");
    expect(
      new Decimal(r.directionalRisk!.maximumLoss!).lte(
        new Decimal(equity).mul("0.025"),
      ),
    ).toBe(true);
    const c = r.directionalCommand!;
    expect(c.timeInForce).toBe("GTD");
    expect(new Decimal(c.volume).lt(prior)).toBe(true);
    prior = new Decimal(c.volume);
    expect(validateDirectionalScalpCommands([c], m).approved).toBe(true);
    expect(validateDirectionalScalpCommands([c, c], m).approved).toBe(false);
    expect(
      validateDirectionalScalpCommands([{ ...c, timeInForce: "GTC" }], m)
        .approved,
    ).toBe(false);
    expect(
      validateDirectionalScalpCommands([{ ...c, takeProfit: "4445" }], m)
        .approved,
    ).toBe(false);
    for (const patch of [
      { certain: false },
      { hasPartialFill: true },
      { hasCancellationPending: true },
      { relevantPendingOrderCount: 1 },
      { availableMargin: "0" },
    ])
      expect(
        (
          await evaluator.evaluate({
            ...input,
            account: { ...account, ...patch },
          })
        ).approved,
      ).toBe(false);
  }
});
