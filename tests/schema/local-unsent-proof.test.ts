import { describe, expect, it } from "vitest";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
const validator = new ModelResponseValidator(
  "schemas/local-unsent-entry-proof-1.0.json",
);
const proof = {
  orderId: "11111111-1111-4111-8111-111111111111",
  groupId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  symbolId: "44444444-4444-4444-8444-444444444444",
  clientId: "cas-fixture",
  reason: "DEMO_PEER_WITHHELD_BEFORE_DISPATCH",
  sourceUpdatedAt: "2026-10-20T00:00:00Z",
  recordedAt: "2026-10-20T00:00:01Z",
};
describe("local unsent evidence schema", () => {
  it("accepts scoped local evidence", () =>
    expect(validator.parse(JSON.stringify(proof)).accepted).toBe(true));
  it.each([
    { reason: "BROKER_ACCEPTED" },
    { orderId: "unknown" },
    { brokerOrderId: "101" },
    { recordedAt: "yesterday" },
  ])("rejects fabricated or malformed evidence %j", (patch) =>
    expect(
      validator.parse(JSON.stringify({ ...proof, ...patch })).accepted,
    ).toBe(false),
  );
});
