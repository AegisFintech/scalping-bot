import type {
  MarketSnapshot,
  PendingOrderCommand,
} from "../../packages/contracts/src/index.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  costBalancedScalpTransform,
  validateCostBalancedScalpCommands,
  costBalancedPayoffEvidence,
} from "../../packages/strategy-candidates/src/directional-scalp.js";
import { metadata, response } from "../helpers/breakout-candidate.js";
it("validates decimal cost evidence and rejects invented realized economics", () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(readFileSync("schemas/scalp-cost-admission-1.0.json", "utf8")),
  );
  const m = metadata();
  const value = costBalancedPayoffEvidence(
    m,
    "4000",
    "4004",
    "3999",
    m.minVolume,
  );
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...value, actual_exit_cost: "0" })).toBe(false);
});

it("validates the nested diagnostic at actual journal boundaries", () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(readFileSync("schemas/scalp-cost-admission-1.0.json", "utf8")),
  );
  const m = metadata(),
    r = response();
  Object.assign(r.buy_stop, {
    entry_price: "4000",
    take_profit: "4001",
    stop_loss: "3999",
  });
  const result = costBalancedScalpTransform({
    snapshot: { metadata: m } as MarketSnapshot,
    response: r,
    maximumStopDistance: "7",
    side: "BUY",
  });
  const details: Record<string, unknown> = result.details;
  expect(
    validate(details.cost_admission),
    JSON.stringify(validate.errors),
  ).toBe(true);
  const c = {
    side: "BUY",
    entryPrice: "4000",
    takeProfit: "4001",
    stopLoss: "3999",
    volume: "200",
    executionOrderType: "STOP_LIMIT",
    timeInForce: "GTD",
  } as PendingOrderCommand;
  for (const tp of ["4001", "4004"]) {
    const actual = validateCostBalancedScalpCommands(
      [{ ...c, takeProfit: tp }],
      m,
    );
    expect(
      validate(actual.evidence[0]?.cost_admission),
      JSON.stringify(validate.errors),
    ).toBe(true);
    expect(actual.approved).toBe(tp === "4004");
  }
});
