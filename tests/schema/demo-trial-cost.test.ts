import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { trialPayoffEvidence } from "../../packages/strategy-candidates/src/directional-scalp.js";
import { profiles } from "../../packages/strategy-candidates/src/demo-trial.js";
import { metadata } from "../helpers/breakout-candidate.js";
it("schema checks emitted actual-volume trial cost evidence and rejects invented closing proceeds", () => {
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(
      readFileSync("schemas/demo-trial-cost-1.0.json", "utf8"),
    ) as AnySchema,
  );
  const m = metadata(),
    value = trialPayoffEvidence(
      m,
      "4000",
      "4000.4",
      "3998",
      m.minVolume,
      profiles[3]!,
    );
  expect(validate(value)).toBe(true);
  expect(validate({ ...value, actual_exit_cost: "0" })).toBe(false);
  expect(validate({ ...value, guaranteed_closing_proceeds: true })).toBe(false);
});
