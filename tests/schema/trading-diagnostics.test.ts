import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, it } from "vitest";
import { diagnosticReport } from "../../packages/evaluation/src/trading-diagnostics.js";
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/trading-diagnostics-1.0.json", "utf8"),
  ) as AnySchema,
);
it("validates observed demo reports and forbids broker authority", () => {
  const report = diagnosticReport(
    ["0.3.0-fade-limit.3", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"],
    [],
  );
  expect(validate(report)).toBe(true);
  expect(validate({ ...report, brokerAuthority: true })).toBe(false);
});
