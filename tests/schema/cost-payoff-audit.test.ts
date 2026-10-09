import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
import { costPayoffReport } from "../../packages/evaluation/src/cost-payoff-audit.js";
import { auditRow } from "../fixtures/cost-payoff-audit.js";
const ajv = new Ajv2020({ strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/cost-payoff-audit-1.0.json", "utf8"),
  ) as AnySchema,
);
it("validates observed demo reports and forbids broker authority", () => {
  const report = costPayoffReport(
    ["0.3.0-fade-limit.3", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"],
    [auditRow],
  );
  expect(validate(report)).toBe(true);
  expect(validate({ ...report, brokerAuthority: true })).toBe(false);
  expect(validate({ ...report, promotionAuthority: true })).toBe(false);
  expect(
    validate({
      ...report,
      observations: [{ ...report.observations[0], exactExitReason: "TP" }],
    }),
  ).toBe(false);
});
