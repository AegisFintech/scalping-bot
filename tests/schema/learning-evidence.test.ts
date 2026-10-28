import fixture from "../fixtures/scalper-learning-evidence-1.0.json" with { type: "json" };
import schema from "../../schemas/scalper-learning-evidence-1.0.json" with { type: "json" };
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const validate = new Ajv2020({ strict: true }).compile(schema);

describe("read-only learning evidence JSON contract", () => {
  it("accepts a recorded WAIT without fabricating entry levels", () => {
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(["brokerAuthority", "promotionAuthority", "autonomousFinding"])(
    "rejects %s authority and truthy integers",
    (field) => {
      expect(validate({ ...fixture, [field]: true })).toBe(false);
      expect(validate({ ...fixture, [field]: 1 })).toBe(false);
    },
  );

  it("rejects private fields and claimed counterfactual money", () => {
    const extra = {
      ...fixture,
      contexts: fixture.contexts.map((row) => ({
        ...row,
        accountId: "forbidden",
      })),
    };
    expect(validate(extra)).toBe(false);
    expect(validate({ ...fixture, counterfactualNet: "1" })).toBe(false);
  });
});
