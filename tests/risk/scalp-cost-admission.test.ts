import { expect, it } from "vitest";
import {
  costBalancedPayoffEvidence,
  costBalancedScalpTransform,
} from "../../packages/strategy-candidates/src/directional-scalp.js";
import { metadata, response } from "../helpers/breakout-candidate.js";
import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
it("decomposes fees and reserve without labelling either as an actual debit", () => {
  const m = metadata();
  const e = costBalancedPayoffEvidence(
    m,
    "4000",
    "4000.4",
    "3999",
    m.minVolume,
  );
  expect(e.modeled_exit_reserve_price).toBe("0.65");
  expect(Number(e.minimum_target_distance_price)).toBeGreaterThan(2.3);
  expect(Number(e.modeled_target_shortfall_price)).toBeGreaterThan(1.9);
  expect(e.actual_exit_cost).toBeNull();
  expect(e.modeled_break_even_win_fraction).toBeNull();
});
it("retains numeric rejection evidence and never changes the supplied proposal", () => {
  const m = metadata(),
    r = response();
  Object.assign(r.buy_stop, {
    entry_price: "4000",
    take_profit: "4001",
    stop_loss: "3999",
  });
  const before = JSON.stringify(r);
  const result = costBalancedScalpTransform({
    snapshot: { metadata: m } as MarketSnapshot,
    response: r,
    maximumStopDistance: "7",
    side: "BUY",
  });
  expect(result.accepted).toBe(false);
  expect(result.reasonCodes).toContain("SCALP_NET_REWARD_BELOW_RISK");
  expect(result.details).toMatchObject({
    evidence_version: "scalp-cost-admission-1.0",
    target_distance_price: "1",
    stop_distance_price: "1",
  });
  expect(JSON.stringify(r)).toBe(before);
});
it("keeps volume-dependent broker minimum commissions and conversion in the cost floor", () => {
  const m = metadata();
  const a = costBalancedPayoffEvidence(m, "4000", "4004", "3999", m.minVolume);
  expect(Number(a.modeled_break_even_win_fraction)).toBeGreaterThan(0);
  expect(a.spread_deducted_again).toBe(false);
  expect(() =>
    costBalancedPayoffEvidence(m, "bad", "4004", "3999", m.minVolume),
  ).toThrow();
});
