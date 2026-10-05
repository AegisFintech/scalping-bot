import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
const validate = new Ajv2020({ strict: true }).compile(
  JSON.parse(
    readFileSync("schemas/market-readiness-1.0.json", "utf8"),
  ) as AnySchema,
);
it("retains explicitly unknown and independent failed health components", () => {
  const health = {
    schemaVersion: "1.0",
    status: "not_ready",
    components: { session: "FAILED", quote: "HEALTHY", snapshot: "UNKNOWN" },
  };
  expect(validate(health)).toBe(true);
  expect(validate({ ...health, components: { session: "FAILED" } })).toBe(
    false,
  );
  expect(
    validate({
      ...health,
      components: { ...health.components, quote: "ASSUMED" },
    }),
  ).toBe(false);
});
