import { describe, it, expect } from "vitest";
import {
  bindDirectionalDecision,
  validateDirectionalPlan,
} from "../../packages/scenario-engine/src/directional-entry.js";
import { validateEntryDecision } from "../../packages/scenario-engine/src/entry-decision.js";
import { checkEntryPrices } from "../../packages/scenario-engine/src/entry-prices.js";
import { readFileSync } from "node:fs";
import type { SymbolMetadata } from "../../packages/contracts/src/index.js";
const context = {
  analysisId: "00000000-0000-4000-8000-000000000001",
  symbol: "XAUUSD",
  capturedAt: "2026-10-23T01:00:02Z",
  tickSize: "0.01",
  observedM1End: "2026-10-23T01:00:00Z",
};
const raw = (decision = "BUY") =>
  JSON.stringify({
    decision,
    reason: "Established uptrend, completed M1 range",
    upper_breakout: decision === "WAIT" ? null : "4002",
    lower_breakout: decision === "WAIT" ? null : "3999",
  });
describe("directional range authority", () => {
  it.each(["BUY", "SELL"])(
    "binds exactly one %s side with two structural references",
    (side) => {
      const plan = bindDirectionalDecision(raw(side), context);
      expect(plan).toMatchObject({
        schema_version: "entry-direction-1.0",
        entry_side: side,
        buy_stop: "4002",
        sell_stop: "3999",
      });
      expect(
        validateEntryDecision(JSON.stringify(plan), {
          ...context,
          availableAt: "2026-10-23T01:00:10Z",
        }),
      ).toEqual(plan);
    },
  );
  it("WAIT has no directional fields or price authority", () =>
    expect(bindDirectionalDecision(raw("WAIT"), context)).toMatchObject({
      schema_version: "entry-wait-1.0",
    }));
  it.each(["OCO", "reverse", "buy"])("rejects unapproved decision %s", (side) =>
    expect(() => bindDirectionalDecision(raw(side), context)).toThrow(),
  );
  it("rejects duplicates, injected quantity, missing range, tick drift and invalid context", () => {
    for (const value of [
      raw().replace('"decision":"BUY"', '"decision":"SELL","decision":"BUY"'),
      raw().replace('"reason":', '"quantity":"100","reason":'),
      raw().replace('"3999"', "null"),
      raw().replace('"4002"', '"4002.001"'),
    ])
      expect(() => bindDirectionalDecision(value, context)).toThrow();
    const p = bindDirectionalDecision(raw(), context);
    expect(() =>
      validateDirectionalPlan(JSON.stringify({ ...p, entry_side: "BOTH" }), {
        ...context,
        availableAt: context.capturedAt,
      }),
    ).toThrow();
  });
});

it("ignores a crossed unselected reference but retires a crossed selected entry", () => {
  const metadata = (
    JSON.parse(
      readFileSync(
        "tests/fixtures/scenario/manual-levels-synthetic.json",
        "utf8",
      ),
    ) as { metadata: SymbolMetadata }
  ).metadata;
  const snapshot = {
    metadata: {
      ...metadata,
      symbolName: "XAUUSD",
      tickSize: "0.01",
      metadataTime: context.capturedAt,
    },
    serverTime: context.capturedAt,
    quote: {
      bid: "3998",
      ask: "3998.1",
      sourceTime: context.capturedAt,
      receivedAt: context.capturedAt,
    },
  };
  const options = {
    maxQuoteAgeMs: 3000,
    maxMetadataAgeMs: 86400000,
    minimumPoints: null,
  };
  const buy = bindDirectionalDecision(raw("BUY"), context),
    sell = bindDirectionalDecision(raw("SELL"), context);
  if (
    buy.schema_version !== "entry-direction-1.0" ||
    sell.schema_version !== "entry-direction-1.0"
  )
    throw Error("fixture");
  expect(
    checkEntryPrices(
      buy,
      snapshot,
      "LOCAL_REUSE",
      Date.parse(context.capturedAt),
      options,
    ),
  ).toBeNull();
  expect(
    checkEntryPrices(
      sell,
      snapshot,
      "LOCAL_REUSE",
      Date.parse(context.capturedAt),
      options,
    )?.reasonCodes,
  ).toEqual(["SELL_ENTRY_TOO_CLOSE"]);
});
