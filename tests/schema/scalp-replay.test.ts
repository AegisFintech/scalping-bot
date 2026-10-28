import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import reportSchema from "../../schemas/scalp-replay-report-1.0.json" with { type: "json" };
import draftSchema from "../../schemas/scalp-evaluation-draft-1.0.json" with { type: "json" };
import pathsSchema from "../../schemas/scalp-replay-paths-1.0.json" with { type: "json" };
import report from "../fixtures/scalp-replay-report-1.0.json" with { type: "json" };
import draft from "../fixtures/scalp-evaluation-draft-1.0.json" with { type: "json" };
import paths from "../fixtures/scalp-replay-paths-1.0.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });

describe("offline scalp replay contracts", () => {
  it.each([
    [reportSchema, report],
    [draftSchema, draft],
    [pathsSchema, paths],
  ])("accepts its fixture and rejects broker authority", (schema, fixture) => {
    const validate = ajv.compile(schema);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...fixture, brokerAuthority: true })).toBe(false);
  });
  it("never permits a counterfactual monetary result", () => {
    expect(
      ajv.compile(reportSchema)({ ...report, counterfactualNet: "10" }),
    ).toBe(false);
  });
});
