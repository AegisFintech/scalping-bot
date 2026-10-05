import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
const ajv = new Ajv2020({ strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/forward-summary-1.0.json", "utf8"),
  ) as AnySchema,
);
it("keeps retained collection HOLD, no authority and unavailable economics", () => {
  const body = {
    reportVersion: "forward-summary-1.0",
    label: "RETAINED_CONDITIONAL_WINDOWS_NOT_PORTFOLIO_RETURN",
    studySha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    asOf: "2026-10-05T00:00:00.000Z",
    registeredWindows: 30,
    completedWindows: 0,
    dueUnreportedWindows: 2,
    windows: [],
    actualClosedTradeTotals: {
      trades: 0,
      wins: 0,
      matchedCloseEvidence: 0,
      netPnl: "0",
      grossPnl: "0",
      signedCosts: "0",
    },
    counterfactualNetPnl: null,
    providerCost: null,
    decision: "HOLD",
    brokerAuthority: false,
    productionChanged: false,
    qualification: "COLLECTION_ONLY_NOT_STRATEGY_QUALIFICATION",
  };
  const envelope = { body, sha256: "c".repeat(64) };
  expect(validate(envelope)).toBe(true);
  expect(
    validate({ ...envelope, body: { ...body, counterfactualNetPnl: "1" } }),
  ).toBe(false);
  expect(
    validate({ ...envelope, body: { ...body, decision: "PROMOTE" } }),
  ).toBe(false);
});
