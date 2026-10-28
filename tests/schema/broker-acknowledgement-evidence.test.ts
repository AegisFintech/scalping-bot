import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import schema from "../../schemas/broker-acknowledgement-evidence-1.0.json" with { type: "json" };
import fixture from "../fixtures/broker-acknowledgement-evidence-1.0.json" with { type: "json" };

describe("broker acknowledgement evidence contract", () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  it("accepts a bounded evidence fixture", () => {
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });
  it("rejects broker or promotion authority", () => {
    expect(validate({ ...fixture, brokerAuthority: true })).toBe(false);
    expect(validate({ ...fixture, promotionAuthority: true })).toBe(false);
  });
});
