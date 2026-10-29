import { describe, expect, it } from "vitest";
import { recordsField } from "../../packages/ctrader-client/src/protocol.js";
describe("broker repeated fields", () => {
  it("accepts an omitted or empty repeated field", () => {
    expect(recordsField({}, "order")).toEqual([]);
    expect(recordsField({ order: null }, "order")).toEqual([]);
    expect(recordsField({ order: [] }, "order")).toEqual([]);
  });
  it.each(["invalid", 3, {}, true])(
    "rejects a malformed present repeated field %#",
    (value) => {
      expect(() => recordsField({ order: value }, "order")).toThrow(
        "CTRADER_REPEATED_FIELD_INVALID",
      );
    },
  );
});
