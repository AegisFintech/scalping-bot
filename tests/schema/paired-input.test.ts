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
    readFileSync("schemas/paired-replay-input-1.0.json", "utf8"),
  ) as AnySchema,
);
const input = {
  label: "PAIRED_REPLAY_INPUT_V1",
  release: "0.3.0-fade-limit.3",
  from: "2026-09-21T00:00:00Z",
  until: "2026-10-02T02:00:00Z",
  cohort: "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
  economics: null,
  setups: [
    {
      created: "2026-09-25T00:00:00Z",
      captured: null,
      available: null,
      valid_until: null,
      submission_valid_until: null,
      tick_size: null,
      model_buy: null,
      model_sell: null,
      model_schema: null,
      legs: [],
    },
  ],
};
it("preserves missing evidence for explicit exclusion; forbids fabricated economics and private fields", () => {
  expect(validate(input)).toBe(true);
  expect(validate({ ...input, economics: { commission: 0 } })).toBe(false);
  expect(validate({ ...input, accountId: "forbidden" })).toBe(false);
  expect(
    validate({ ...input, setups: [{ ...input.setups[0], tick_size: 0.01 }] }),
  ).toBe(false);
  expect(
    validate({ ...input, setups: [{ ...input.setups[0], model_buy: "NaN" }] }),
  ).toBe(false);
});
