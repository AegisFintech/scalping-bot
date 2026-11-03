import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { costBalancedPayoffEvidence } from "../../packages/strategy-candidates/src/directional-scalp.js";
import { metadata } from "../helpers/breakout-candidate.js";
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
