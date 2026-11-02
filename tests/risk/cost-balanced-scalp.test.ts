import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import {
  costBalancedScalpTransform,
  costBalancedModeledCost,
  validateCostBalancedScalpCommands,
} from "../../packages/strategy-candidates/src/directional-scalp.js";
import {
  bindScalpDecision,
  validateScalpPlan,
} from "../../packages/scenario-engine/src/scalp-entry.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
import type {
  MarketSnapshot,
  PendingOrderCommand,
} from "../../packages/contracts/src/index.js";
const version = "0.9.0-cost-balanced.1-codex.1";
const context = {
  analysisId: "fixture",
  symbol: "XAUUSD",
  capturedAt: "2026-10-28T01:00:02.000Z",
  tickSize: "0.01",
  observedM1End: "2026-10-28T01:00:00.000Z",
};
const decision = {
  decision: "BUY",
  reason: "Strong nearby continuation",
  entry_price: "4444",
  take_profit: "4447",
  stop_loss: "4443",
  pending_seconds: 120,
};
function proposal() {
  const r = response();
  Object.assign(r.buy_stop, {
    entry_price: "4444",
    take_profit: "4447",
    stop_loss: "4443",
    invalidation_price: "4443",
    risk_reward_ratio: "3",
  });
  return r;
}
it("admits larger cost-balanced targets only under the explicit new release", () => {
  const p = bindScalpDecision(JSON.stringify(decision), context, version);
  expect(p).toMatchObject({
    schema_version: "entry-scalp-1.0",
    take_profit: "4447",
    stop_loss: "4443",
  });
  expect(
    validateScalpPlan(JSON.stringify(p), {
      ...context,
      strategyVersion: version,
      availableAt: "2026-10-28T01:00:12.000Z",
    }),
  ).toEqual(p);
  expect(() => bindScalpDecision(JSON.stringify(decision), context)).toThrow();
  expect(() =>
    validateScalpPlan(JSON.stringify(p), {
      ...context,
      availableAt: "2026-10-28T01:00:12.000Z",
    }),
  ).toThrow();
});
it("preserves model geometry and checks net reward against modeled stop loss", () => {
  const r = proposal();
  const snapshot = { metadata: metadata() } as MarketSnapshot;
  const result = costBalancedScalpTransform({
    snapshot,
    response: r,
    maximumStopDistance: "7",
    side: "BUY",
  });
  expect(result.accepted, result.reasonCodes.join(",")).toBe(true);
  expect(result.response).toBe(r);
  const bad = proposal();
  Object.assign(bad.buy_stop, { take_profit: "4445", risk_reward_ratio: "1" });
  expect(
    costBalancedScalpTransform({
      snapshot,
      response: bad,
      maximumStopDistance: "7",
      side: "BUY",
    }).reasonCodes,
  ).toContain("SCALP_NET_REWARD_BELOW_RISK");
  expect(
    costBalancedScalpTransform({
      snapshot,
      response: r,
      maximumStopDistance: "0.5",
      side: "BUY",
    }).accepted,
  ).toBe(false);
});
it("rechecks actual-volume minimum commission, side and GTD, with no rounding rescue", () => {
  const m = metadata();
  const command = {
    side: "BUY",
    entryPrice: "4444",
    takeProfit: "4447",
    stopLoss: "4443",
    volume: m.minVolume,
    executionOrderType: "STOP_LIMIT",
    timeInForce: "GTD",
  } as PendingOrderCommand;
  expect(validateCostBalancedScalpCommands([command], m).approved).toBe(true);
  expect(
    validateCostBalancedScalpCommands([command, command], m).approved,
  ).toBe(false);
  expect(
    validateCostBalancedScalpCommands([{ ...command, timeInForce: "GTC" }], m)
      .approved,
  ).toBe(false);
  expect(
    validateCostBalancedScalpCommands([{ ...command, takeProfit: "4445" }], m)
      .approved,
  ).toBe(false);
  expect(
    validateCostBalancedScalpCommands([command], {
      ...m,
      commission: { ...m.commission, rate: "3000" },
    }).approved,
  ).toBe(false);
  expect(
    validateCostBalancedScalpCommands(
      [{ ...command, takeProfit: "4447.001" }],
      m,
    ).approved,
  ).toBe(false);
});

it("rounds EUR minimum commission context upward through the real Python request boundary", () => {
  const base = metadata();
  const eur = {
    ...base,
    accountAsset: "EUR",
    tickValue: "0.00009234",
    quoteToAccountConversionRate: "0.9234",
    commission: {
      ...base.commission,
      minimum: "1",
      minimumAsset: "EUR",
      minimumType: "CURRENCY" as const,
    },
  };
  const cost = costBalancedModeledCost({
    metadata: eur,
    quote: { ask: "4444" },
  } as MarketSnapshot);
  expect(cost).toBe("2.8159085987");
  const checked = spawnSync(
    ".venv/bin/python",
    [
      "-c",
      `import json,sys
from python.codex_entry.service import RequestV114
from tests.python.test_cost_balanced_proposals import body
v=body();v['payload']['execution_context']['modeled_round_trip_cost_price']=sys.stdin.read()
RequestV114.model_validate(v)`,
    ],
    { input: cost, encoding: "utf8" },
  );
  expect(checked.status, checked.stderr).toBe(0);
});

it("keeps minima and actual-volume checks independent without rescuing an unaffordable minimum", () => {
  const base = metadata();
  const m = {
    ...base,
    accountAsset: "EUR",
    tickValue: "0.00009234",
    quoteToAccountConversionRate: "0.9234",
    commission: {
      ...base.commission,
      minimum: "1",
      minimumAsset: "EUR",
      minimumType: "CURRENCY" as const,
    },
  };
  const command = {
    side: "BUY",
    entryPrice: "4444",
    takeProfit: "4447",
    stopLoss: "4443",
    volume: m.minVolume,
    executionOrderType: "STOP_LIMIT",
    timeInForce: "GTD",
  } as PendingOrderCommand;
  expect(validateCostBalancedScalpCommands([command], m).approved).toBe(false);
  expect(
    validateCostBalancedScalpCommands([{ ...command, volume: "10000" }], m)
      .approved,
  ).toBe(true);
  expect(
    costBalancedScalpTransform({
      snapshot: { metadata: m } as MarketSnapshot,
      response: proposal(),
      maximumStopDistance: "7",
      side: "BUY",
    }).accepted,
  ).toBe(false);
  expect(
    validateCostBalancedScalpCommands(
      [
        {
          ...command,
          side: "SELL",
          takeProfit: "4441",
          stopLoss: "4445",
          volume: "10000",
        },
      ],
      m,
    ).approved,
  ).toBe(true);
  expect(
    validateCostBalancedScalpCommands([command], {
      ...m,
      quoteToAccountConversionRate: "0",
    }).approved,
  ).toBe(false);
});
