import { describe, expect, it } from "vitest";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
const validator = new ModelResponseValidator(
  "schemas/entry-retirement-1.0.json",
);
const evidence = {
  schemaVersion: "1.0",
  phase: "PROVIDER_RETURN",
  reasonCodes: ["BUY_ENTRY_TOO_CLOSE"],
  observedAt: "2026-09-11T00:00:00.000Z",
  quote: {
    bid: "4355.23",
    ask: "4355.32",
    sourceTime: "2026-09-11T00:00:00.000Z",
    receivedAt: "2026-09-11T00:00:00.000Z",
  },
  tickSize: "0.01",
  minimumEntryDistance: "0.01",
  buyStop: "4351",
  sellStop: "4349.44",
};
describe("entry retirement evidence schema", () => {
  it("accepts explicit price-side evidence with decimal strings", () =>
    expect(validator.parse(JSON.stringify(evidence)).accepted).toBe(true));
  it.each([
    { reasonCodes: [] },
    { reasonCodes: ["QUOTE_STALE"] },
    { reasonCodes: ["BUY_ENTRY_TOO_CLOSE", "BUY_ENTRY_TOO_CLOSE"] },
    { buyStop: 4351 },
    { observedAt: "yesterday" },
    { extra: "not allowed" },
  ])("rejects incomplete, unrelated or imprecise evidence %j", (patch) =>
    expect(
      validator.parse(JSON.stringify({ ...evidence, ...patch })).accepted,
    ).toBe(false),
  );
});
