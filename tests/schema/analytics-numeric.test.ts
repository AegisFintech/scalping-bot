import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";

it("requires an explicit numeric analytics version and null image", () => {
  const ajv = new Ajv({ strict: false });
  const addFormats = formatsModule.default as unknown as (instance: Ajv) => Ajv;
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(
      readFileSync("schemas/analytics-numeric-response-2.0.json", "utf8"),
    ),
  );
  const value = {
    schemaVersion: "2.0",
    artifactPolicy: "numeric-v1",
    requestId: "11111111-1111-4111-8111-111111111111",
    analysisId: "22222222-2222-4222-8222-222222222222",
    generatedAt: "2026-09-10T00:00:00Z",
    acceptable: true,
    rejectionReasons: [],
    features: {},
    chart: null,
  };
  expect(validate(value)).toBe(true);
  expect(validate({ ...value, chart: {} })).toBe(false);
  expect(validate({ ...value, schemaVersion: "1.1" })).toBe(false);
  const missing: Record<string, unknown> = { ...value };
  delete missing.artifactPolicy;
  expect(validate(missing)).toBe(false);
});
