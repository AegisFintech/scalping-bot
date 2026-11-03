import { expect, it } from "vitest";
import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
import {
  demoTrialScalpTransform,
  trialPayoffEvidence,
  costBalancedScalpTransform,
} from "../../packages/strategy-candidates/src/directional-scalp.js";
import { profiles } from "../../packages/strategy-candidates/src/demo-trial.js";
it("separates base target allowance from unchanged stress stop sizing", () => {
  const m = metadata(),
    p = profiles.find((p) => p.id === "TP_040")!,
    r = response();
  Object.assign(r.buy_stop, {
    entry_price: "4000",
    stop_loss: "3998",
    take_profit: "4000.4",
  });
  const input = {
    snapshot: { metadata: m } as MarketSnapshot,
    response: r,
    maximumStopDistance: "7",
    side: "BUY" as const,
  };
  const x = demoTrialScalpTransform(input, p);
  expect(x.accepted, x.reasonCodes.join(",")).toBe(true);
  expect(costBalancedScalpTransform(input).accepted).toBe(false);
  const e = trialPayoffEvidence(m, "4000", "4000.4", "3998", m.minVolume, p);
  expect(e.base_exit_reserve_price).toBe("0.05");
  expect(e.stress_exit_reserve_price).toBe("0.65");
  expect(e.actual_exit_cost).toBeNull();
  expect(Number(e.modeled_base_target_net_price)).toBeGreaterThan(0);
  expect(Number(e.modeled_stress_target_net_price)).toBeLessThan(0);
  expect(
    demoTrialScalpTransform({ ...input, maximumStopDistance: "1" }, p).accepted,
  ).toBe(false);
  expect(
    demoTrialScalpTransform(
      input,
      profiles.find((p) => p.id === "TP_060")!,
    ).accepted,
  ).toBe(false);
});

import { validateDemoTrialScalpCommands } from "../../packages/strategy-candidates/src/directional-scalp.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
it("does not confuse minimum-volume flat fees with actual risk-sized affordability", () => {
  const base = metadata(),
    m = { ...base, commission: { ...base.commission, minimum: "1" } },
    p = profiles[3]!,
    r = response();
  Object.assign(r.buy_stop, {
    entry_price: "4000",
    stop_loss: "3998",
    take_profit: "4000.4",
  });
  expect(
    demoTrialScalpTransform(
      {
        snapshot: { metadata: m } as MarketSnapshot,
        response: r,
        maximumStopDistance: "7",
        side: "BUY",
      },
      p,
    ).accepted,
  ).toBe(true);
  const command: PendingOrderCommand = {
    idempotencyKey: "fixture",
    analysisId: "fixture",
    orderGroupId: "fixture",
    clientOrderId: "fixture",
    symbol: "XAUUSD",
    side: "BUY",
    volume: "100",
    entryPrice: "4000",
    stopLoss: "3998",
    takeProfit: "4000.4",
    expiresAt: "2026-11-03T10:00:00Z",
    strategyLabel: "fixture",
    executionOrderType: "STOP_LIMIT",
    timeInForce: "GTD",
    entryRangePoints: "30",
  };
  expect(validateDemoTrialScalpCommands([command], m, p).approved).toBe(false);
  expect(
    validateDemoTrialScalpCommands([{ ...command, volume: "10000" }], m, p)
      .approved,
  ).toBe(true);
  expect(
    validateDemoTrialScalpCommands(
      [{ ...command, volume: "10000", entryRangePoints: "10" }],
      m,
      p,
    ).approved,
  ).toBe(false);
  expect(
    demoTrialScalpTransform(
      {
        snapshot: { metadata: { ...m, tickValue: "0" } } as MarketSnapshot,
        response: r,
        maximumStopDistance: "7",
        side: "BUY",
      },
      p,
    ).accepted,
  ).toBe(false);
});
