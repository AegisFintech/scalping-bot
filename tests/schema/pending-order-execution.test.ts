import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { pendingOrderType } from "../../packages/contracts/src/order-type.js";
const validate = new Ajv2020({ strict: true }).compile(
  JSON.parse(
    readFileSync("schemas/pending-order-execution-1.0.json", "utf8"),
  ) as AnySchema,
);
describe("trusted pending execution contract", () => {
  it("supports both explicit types and preserves omitted legacy command semantics", () => {
    for (const type of ["STOP", "STOP_LIMIT"] as const) {
      expect(validate({ execution_order_type: type })).toBe(true);
      expect(pendingOrderType({ executionOrderType: type })).toBe(type);
    }
    expect(pendingOrderType({})).toBe("STOP_LIMIT");
  });
  it.each([
    {},
    { execution_order_type: null },
    { execution_order_type: "MARKET" },
    { execution_order_type: "STOP", size: "1" },
  ])("rejects invalid intent %j", (value) =>
    expect(validate(value)).toBe(false),
  );
  it("rejects unknown runtime types", () =>
    expect(() =>
      pendingOrderType({ executionOrderType: "MARKET" as "STOP" }),
    ).toThrow("ORDER_EXECUTION_TYPE_INVALID"));
});
