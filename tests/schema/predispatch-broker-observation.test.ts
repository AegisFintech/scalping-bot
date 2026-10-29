import { describe, expect, it } from "vitest";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
const validator = new ModelResponseValidator(
  "schemas/predispatch-broker-observation-1.0.json",
);
const observation = {
  orders: 0,
  deals: 0,
  ordersHasMore: false,
  dealsHasMore: false,
  openOrders: 0,
  openPositions: 0,
  brokerAccountBound: true,
  observedAt: "2026-10-29T01:00:00Z",
};
describe("pre-dispatch broker observation schema", () => {
  it("accepts a complete empty scoped observation", () =>
    expect(validator.parse(JSON.stringify(observation)).accepted).toBe(true));
  it.each([
    { orders: 1 },
    { deals: 1 },
    { ordersHasMore: true },
    { dealsHasMore: true },
    { openOrders: 1 },
    { openPositions: 1 },
    { brokerAccountBound: false },
    { observedAt: "unknown" },
    { accountId: "private" },
  ])("rejects ambiguous or extra evidence %j", (patch) =>
    expect(
      validator.parse(JSON.stringify({ ...observation, ...patch })).accepted,
    ).toBe(false),
  );
});
