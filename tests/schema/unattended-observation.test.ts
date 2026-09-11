import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
import { checkpointSchema } from "../../scripts/observe-unattended.js";

const ajv = new Ajv2020({ strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/unattended-observation-1.0.json", "utf8"),
  ) as AnySchema,
);
const at = "2026-09-11T00:00:00Z";
const checkpoint = {
  schemaVersion: 1,
  mode: "demo",
  release: "0.2.5-market-stop.8",
  startedAt: at,
  deadline: "2026-09-12T00:00:00Z",
  lastSampleAt: at,
  complete: false,
  samples: 1,
  unavailableSamples: 1,
  notReadySamples: 1,
  samplingGaps: 0,
  maximumClosedTrades: null,
  latest: { available: false, reasons: ["OBSERVATION_STATUS_UNAVAILABLE"] },
  transitions: [
    { at, available: false, reasons: ["OBSERVATION_STATUS_UNAVAILABLE"] },
  ],
};
it("retains a failed sample in a valid restart checkpoint", () => {
  expect(checkpointSchema.safeParse(checkpoint).success).toBe(true);
  expect(validate(checkpoint)).toBe(true);
});
it("rejects invalid counts, modes, times and unexpected evidence fields", () => {
  for (const value of [
    { ...checkpoint, mode: "live" },
    { ...checkpoint, samples: -1 },
    { ...checkpoint, deadline: "unknown" },
    { ...checkpoint, privateField: "forbidden" },
    {
      ...checkpoint,
      transitions: [{ at, available: false, reasons: ["private detail"] }],
    },
  ]) {
    expect(checkpointSchema.safeParse(value).success).toBe(false);
    expect(validate(value)).toBe(false);
  }
});
