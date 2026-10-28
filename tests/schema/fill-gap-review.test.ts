import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
const compile = (name: string) =>
  new Ajv2020({ strict: true }).compile(
    JSON.parse(readFileSync(`schemas/${name}.json`, "utf8")) as AnySchema,
  );
const review = compile("fill-gap-review-1.0");
const pattern = compile("native-tp-fill-pattern-1.0");

it("keeps fill gaps descriptive without cause or authority", () => {
  const report = {
    schemaVersion: "fill-gap-review-1.0",
    from: "2026-10-27T00:00:00Z",
    until: "2026-10-28T00:00:00Z",
    fills: [
      {
        setup: "c".repeat(24),
        originRelease: "fixture",
        kind: "CLOSE",
        side: "BUY",
        fillAt: "2026-10-27T05:30:14.950Z",
        fillPrice: "4001.49",
        units: "246",
        volumeBucket: "200-300",
        executableSide: "bid",
        counterfactualNet: null,
        closeClass: "NATIVE_AT_OR_BEYOND_SL",
        closeClassBasis:
          "CLOSING_ORDER_TYPE_AND_PRICE_VS_LAST_OBSERVED_PROTECTION",
        levelSlippage: "0.21",
        tpCrossing: null,
        quoteReference: null,
        visibleBook: null,
      },
    ],
    summary: {},
    flightQuotePoints: 0,
    marketEvidence: null,
    brokerAuthority: false,
    promotion: "HOLD",
    counterfactualNet: null,
    causeInference: null,
    completeTickTape: false,
  };
  expect(review(report)).toBe(true);
  for (const update of [
    { brokerAuthority: true },
    { promotion: "PROMOTE" },
    { counterfactualNet: "10" },
    { causeInference: "BROKER_DELAY" },
    { completeTickTape: true },
  ])
    expect(review({ ...report, ...update })).toBe(false);
  const fill = { ...report.fills[0], closeClass: "TAKE_PROFIT" };
  expect(review({ ...report, fills: [fill] })).toBe(false);
});

it("keeps the native TP pattern a retained diagnostic", () => {
  const document = JSON.parse(
    readFileSync("docs/evidence/native-tp-fill-pattern.json", "utf8"),
  ) as Record<string, unknown>;
  expect(pattern(document)).toBe(true);
  for (const update of [
    { selection: "SELECTED_WINNERS" },
    { causeInference: "LIQUIDITY" },
    { brokerAuthority: true },
  ])
    expect(pattern({ ...document, ...update })).toBe(false);
});
