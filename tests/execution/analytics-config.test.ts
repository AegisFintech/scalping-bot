import { describe, expect, it } from "vitest";

import { compactTailCounts } from "../../apps/execution-service/src/analytics-config.js";

const collected = { M1: 600, M5: 500, M15: 300 } as const;

describe("analytics request configuration", () => {
  it("uses bounded compact tails without changing collected history", () => {
    expect(compactTailCounts({}, collected)).toEqual({
      M1: 30,
      M5: 18,
      M15: 12,
    });
    expect(collected).toEqual({ M1: 600, M5: 500, M15: 300 });
  });

  it("accepts explicit positive tails within collected history", () => {
    expect(
      compactTailCounts(
        {
          MODEL_COMPACT_RAW_TAIL_1M: "120",
          MODEL_COMPACT_RAW_TAIL_5M: "60",
          MODEL_COMPACT_RAW_TAIL_15M: "30",
        },
        collected,
      ),
    ).toEqual({ M1: 120, M5: 60, M15: 30 });
  });

  it("rejects zero, fractional, or oversized compact tails", () => {
    expect(() =>
      compactTailCounts({ MODEL_COMPACT_RAW_TAIL_1M: "0" }, collected),
    ).toThrow("CONFIG_POSITIVE_INTEGER_INVALID:MODEL_COMPACT_RAW_TAIL_1M");
    expect(() =>
      compactTailCounts({ MODEL_COMPACT_RAW_TAIL_5M: "1.5" }, collected),
    ).toThrow("CONFIG_POSITIVE_INTEGER_INVALID:MODEL_COMPACT_RAW_TAIL_5M");
    expect(() =>
      compactTailCounts({ MODEL_COMPACT_RAW_TAIL_15M: "301" }, collected),
    ).toThrow("CONFIG_COMPACT_TAIL_EXCEEDS_HISTORY:M15");
  });
});
