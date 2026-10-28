import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import proposalSchema from "../../schemas/engineering-proposal-1.0.json" with { type: "json" };
import treeSchema from "../../schemas/publisher-tree-snapshot-1.0.json" with { type: "json" };
import decisionSchema from "../../schemas/publisher-policy-decision-1.0.json" with { type: "json" };
import proposal from "../fixtures/engineering-proposal-1.0.json" with { type: "json" };
import tree from "../fixtures/publisher-tree-snapshot-1.0.json" with { type: "json" };
import decision from "../fixtures/publisher-policy-decision-1.0.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
describe("offline publisher scope contracts", () => {
  it.each([
    [proposalSchema, proposal],
    [treeSchema, tree],
    [decisionSchema, decision],
  ])("accepts its fixture", (schema, fixture) => {
    const validate = ajv.compile(schema);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
  it.each([
    [proposalSchema, proposal],
    [decisionSchema, decision],
  ])("rejects publication authority", (schema, fixture) => {
    expect(ajv.compile(schema)({ ...fixture, publishAuthority: true })).toBe(
      false,
    );
  });
});
