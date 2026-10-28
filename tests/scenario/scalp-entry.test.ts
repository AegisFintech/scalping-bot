import { expect, it } from "vitest";
import {
  bindScalpDecision,
  validateScalpPlan,
} from "../../packages/scenario-engine/src/scalp-entry.js";
const context = {
  analysisId: "fixture",
  symbol: "XAUUSD",
  capturedAt: "2026-10-28T01:00:02.000Z",
  tickSize: "0.01",
  observedM1End: "2026-10-28T01:00:00.000Z",
};
const proposal = {
  decision: "BUY",
  reason: "Trend continuation",
  entry_price: "4002",
  take_profit: "4002.4",
  stop_loss: "3995",
  pending_seconds: 120,
};
it("binds one model proposal with fixed capture-relative pending expiry", () => {
  const plan = bindScalpDecision(JSON.stringify(proposal), context);
  expect(plan).toMatchObject({
    schema_version: "entry-scalp-1.0",
    entry_side: "BUY",
    buy_stop: "4002",
    sell_stop: "3995",
    take_profit: "4002.4",
    stop_loss: "3995",
    valid_until: "2026-10-28T01:02:02.000Z",
  });
  expect(
    validateScalpPlan(JSON.stringify(plan), {
      ...context,
      availableAt: "2026-10-28T01:00:12.000Z",
    }),
  ).toEqual(plan);
  expect(() =>
    validateScalpPlan(JSON.stringify(plan), {
      ...context,
      availableAt: plan.valid_until,
    }),
  ).toThrow();
});
it.each([
  { take_profit: "4002.41" },
  { stop_loss: "3994.99" },
  { take_profit: "4001" },
  { pending_seconds: 59 },
  { pending_seconds: 301 },
  { stop_loss: "4002" },
  { entry_price: "4002.001" },
  { volume: "100" },
])("rejects invalid or excessive proposal %j", (change) => {
  expect(() =>
    bindScalpDecision(JSON.stringify({ ...proposal, ...change }), context),
  ).toThrow();
});
it("mirrors SELL without granting the invalidation another order", () => {
  expect(
    bindScalpDecision(
      JSON.stringify({
        ...proposal,
        decision: "SELL",
        take_profit: "4001.6",
        stop_loss: "4009",
      }),
      context,
    ),
  ).toMatchObject({ entry_side: "SELL", buy_stop: "4009", sell_stop: "4002" });
});
it("preserves WAIT and rejects injected or duplicate authority", () => {
  const wait = {
    decision: "WAIT",
    reason: "No continuation",
    entry_price: null,
    take_profit: null,
    stop_loss: null,
    pending_seconds: null,
  };
  expect(bindScalpDecision(JSON.stringify(wait), context).schema_version).toBe(
    "entry-wait-1.0",
  );
  expect(() =>
    bindScalpDecision(
      JSON.stringify({ ...wait, entry_price: "4000" }),
      context,
    ),
  ).toThrow();
  expect(() =>
    bindScalpDecision('{"decision":"WAIT","decision":"BUY"}', context),
  ).toThrow();
});

it("derives selected exits and expiry without using a guessed OCO geometry", async () => {
  const { scenarioOco } =
    await import("../../packages/scenario-engine/src/oco.js");
  const p = bindScalpDecision(JSON.stringify(proposal), {
    ...context,
    analysisId: "00000000-0000-4000-8000-000000000001",
  });
  if (p.schema_version !== "entry-scalp-1.0") throw Error("SCALP_REQUIRED");
  const r = scenarioOco(p, {
    analysis_id: p.analysis_id,
    server_time: "2026-10-28T01:00:12.000Z",
    performance: {},
    execution_constraints: {
      tick_size: "0.01",
      current_ask: "4000.1",
      current_bid: "4000",
      minimum_fee_buffered_take_profit_distance: "0.1",
      minimum_stop_distance: "0.1",
      maximum_stop_distance: "20",
      order_expiry_min_seconds: 1,
      order_expiry_max_seconds: 300,
      preferred_expires_at: "2026-10-28T01:02:12.000Z",
    },
  });
  expect(r.buy_stop).toMatchObject({
    entry_price: "4002",
    take_profit: "4002.4",
    stop_loss: "3995",
    expires_at: p.valid_until,
  });
  expect(r.valid_until).toBe(p.valid_until);
  expect(r.setup_tags).toContain("SINGLE_SCALP_BUY_BREAKOUT");
});
