import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
const validate = new Ajv2020({ strict: true }).compile(
  JSON.parse(
    readFileSync("schemas/breakout-entry-review-1.0.json", "utf8"),
  ) as AnySchema,
);
it("keeps diagnostic triggers separate from fills, net returns and promotion", () => {
  const report = {
    schemaVersion: "breakout-entry-observer-1.0",
    cohort: "ALL_SCOPED_INTENTS_NOT_SELECTED_CLOSED_TRADES",
    release: "fixture",
    from: "2026-10-27T00:00:00Z",
    until: "2026-10-28T00:00:00Z",
    sourceSha256: "a".repeat(64),
    setups: [],
    summary: {},
    brokerAuthority: false,
    promotion: "HOLD",
    counterfactualNet: null,
    economicPairedReplay: false,
    completeTickTape: false,
  };
  expect(validate(report)).toBe(true);
  for (const update of [
    { brokerAuthority: true },
    { promotion: "PROMOTE" },
    { counterfactualNet: "100" },
    { economicPairedReplay: true },
    { completeTickTape: true },
  ])
    expect(validate({ ...report, ...update })).toBe(false);
});
