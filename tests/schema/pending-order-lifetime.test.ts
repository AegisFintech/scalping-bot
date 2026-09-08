import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { describe, it, expect } from "vitest";
const ajv = new Ajv2020({ strict: true });
(formatsModule.default as unknown as (a: Ajv2020) => Ajv2020)(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/pending-order-lifetime-1.0.json", "utf8"),
  ) as AnySchema,
);
const deadline = "2026-09-08T12:00:00Z";
describe("trusted pending lifetime contract", () => {
  it("accepts explicit non-expiring GTC and historical dated orders", () => {
    expect(
      validate({
        time_in_force: "GTC",
        expires_at: null,
        submission_valid_until: deadline,
      }),
    ).toBe(true);
    expect(
      validate({
        time_in_force: "GTD",
        expires_at: deadline,
        submission_valid_until: deadline,
      }),
    ).toBe(true);
  });
  it.each([
    {
      time_in_force: "GTC",
      expires_at: deadline,
      submission_valid_until: deadline,
    },
    {
      time_in_force: "GTD",
      expires_at: null,
      submission_valid_until: deadline,
    },
    { time_in_force: "GTC", expires_at: null },
    {
      time_in_force: "UNKNOWN",
      expires_at: null,
      submission_valid_until: deadline,
    },
  ])("rejects contradictory or missing lifetime evidence %j", (value) =>
    expect(validate(value)).toBe(false),
  );
});
