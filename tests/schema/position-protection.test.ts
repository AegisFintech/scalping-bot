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
    readFileSync("schemas/position-protection-1.0.json", "utf8"),
  ) as AnySchema,
);
const value = {
  schemaVersion: "1.0",
  status: "VERIFIED",
  stopLoss: "4398.95",
  takeProfit: "4397.36",
  expectedStopLoss: "4398.95",
  expectedTakeProfit: "4397.36",
  observedAt: "2026-09-09T06:21:14Z",
  reasonCode: "POSITION_PROTECTION_CONFIRMED",
};
it("requires actual prices and time for confirmed protection", () => {
  expect(validate(value)).toBe(true);
  for (const patch of [
    { stopLoss: null },
    { takeProfit: 4397.36 },
    { observedAt: null },
    { observedAt: "bad" },
    { stopLoss: "0" },
    { stopLoss: "NaN" },
    { guessed: true },
  ])
    expect(validate({ ...value, ...patch })).toBe(false);
  expect(
    validate({
      ...value,
      status: "UNCERTAIN",
      stopLoss: null,
      observedAt: null,
    }),
  ).toBe(true);
});
