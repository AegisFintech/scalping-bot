import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
import { learningObservation } from "../../packages/evaluation/src/demo-learning.js";

const ajv = new Ajv2020({ strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/demo-learning-observation-1.0.json", "utf8"),
  ) as AnySchema,
);

it("validates explicitly missing evidence without inventing zero risk", () => {
  const observation = learningObservation({
    direction: "LONG",
    net: "10",
    fees: "-2",
    opened_at: "2026-10-01T00:00:00Z",
    closed_at: "2026-10-01T00:01:00Z",
    risk_budget: null,
    model_level: null,
    effective_entry: null,
    ema_alignment: null,
    close_evidence: [],
  });
  expect(validate(observation)).toBe(true);
  for (const patch of [
    { netPnl: 10 },
    { signedCosts: "NaN" },
    { accountId: "forbidden" },
    { exitMechanism: "TAKE_PROFIT" },
    { entryEmaAlignment: "GUESS" },
    { holdingSeconds: -1 },
  ]) {
    expect(validate({ ...observation, ...patch })).toBe(false);
  }
});
