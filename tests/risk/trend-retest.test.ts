import { expect, it } from "vitest";
import {
  trendPayoffEvidence,
  validateDemoTrialScalpCommands,
} from "../../packages/strategy-candidates/src/directional-scalp.js";
import { trendProfiles } from "../../packages/strategy-candidates/src/trend-retest-profile.js";
import { metadata } from "../helpers/breakout-candidate.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
it("charges adverse stop-limit entry against both reward and risk", () => {
  const m = metadata();
  const limit = trendPayoffEvidence(m, "BUY", "4001", "4005", "4000", "100", 0);
  const stop = trendPayoffEvidence(m, "BUY", "4001", "4005", "4000", "100", 30);
  expect(limit.admitted).toBe(true);
  expect(stop.admitted).toBe(true);
  expect(stop.worst_entry_price).toBe("4001.3");
  expect(Number(stop.modeled_net_reward_price)).toBeLessThan(
    Number(limit.modeled_net_reward_price),
  );
  expect(Number(stop.modeled_stop_loss_price)).toBeGreaterThan(
    Number(limit.modeled_stop_loss_price),
  );
  expect(
    trendPayoffEvidence(m, "BUY", "4001", "4002", "4000", "100", 30).admitted,
  ).toBe(false);
  expect(
    trendPayoffEvidence(m, "SELL", "3999", "3995", "4000", "100", 30)
      .worst_entry_price,
  ).toBe("3998.7");
  expect(() =>
    trendPayoffEvidence(m, "BUY", "4001", "4005", "4000", "100", 10),
  ).toThrow("SCALP_TREND_RANGE_INVALID");
});
it("late actual volume gate rejects fee-heavy geometry and stop ranges on limit orders", () => {
  const c: PendingOrderCommand = {
    idempotencyKey: "fixture",
    analysisId: "fixture",
    orderGroupId: "fixture",
    clientOrderId: "fixture",
    symbol: "XAUUSD",
    side: "BUY",
    volume: "100",
    entryPrice: "4001",
    stopLoss: "4000",
    takeProfit: "4005",
    expiresAt: "2026-11-05T00:01:00Z",
    strategyLabel: "ctrader-ai-scalper:0.11.0-trend-retest.1-codex.1",
    executionOrderType: "LIMIT",
    timeInForce: "GTD",
  };
  const profile = trendProfiles.find((p) => p.id === "TREND_RETEST")!;
  expect(
    validateDemoTrialScalpCommands([c], metadata(), profile).approved,
  ).toBe(true);
  expect(
    validateDemoTrialScalpCommands(
      [{ ...c, entryRangePoints: "30" }],
      metadata(),
      profile,
    ).approved,
  ).toBe(false);
  expect(
    validateDemoTrialScalpCommands(
      [{ ...c, takeProfit: "4002" }],
      metadata(),
      profile,
    ).approved,
  ).toBe(false);
  const expensive = metadata();
  Object.assign(expensive.commission, { minimum: "5" });
  expect(validateDemoTrialScalpCommands([c], expensive, profile).approved).toBe(
    false,
  );
});

it("admits tick-aligned structural levels when the broker pip is larger than its tick", () => {
  const profile = trendProfiles.find((p) => p.id === "TREND_CONFIRMED")!;
  const c: PendingOrderCommand = {
    idempotencyKey: "tick",
    analysisId: "fixture",
    orderGroupId: "fixture",
    clientOrderId: "fixture",
    symbol: "XAUUSD",
    side: "BUY",
    volume: "100",
    entryPrice: "4001.31",
    stopLoss: "4000",
    takeProfit: "4005.5",
    expiresAt: "2026-11-05T00:01:00Z",
    strategyLabel: "ctrader-ai-scalper:0.11.0-trend-retest.1-codex.1",
    executionOrderType: "STOP_LIMIT",
    entryRangePoints: "30",
    timeInForce: "GTD",
  };
  const m = { ...metadata(), pipSize: "0.1", pipPosition: 1 };
  expect(validateDemoTrialScalpCommands([c], m, profile).approved).toBe(true);
  expect(
    validateDemoTrialScalpCommands(
      [{ ...c, entryPrice: "4001.315" }],
      m,
      profile,
    ).approved,
  ).toBe(false);
});

it("rejects metadata that cannot equate broker range points with reserved ticks", () => {
  expect(() =>
    trendPayoffEvidence(
      { ...metadata(), tickSize: "0.1" },
      "BUY",
      "4001",
      "4005",
      "4000",
      "100",
      30,
    ),
  ).toThrow("SCALP_TRIAL_POINT_BASIS_UNSUPPORTED");
});
