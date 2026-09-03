import { describe, expect, it } from "vitest";

import { summarizeSignalDecay } from "../../apps/execution-service/src/signal-decay.js";

describe("demo signal-decay summary", () => {
  it("separates fee-inclusive outcomes into non-overlapping fill-age buckets", () => {
    const result = summarizeSignalDecay([
      { fillAgeSeconds: 12, netPnl: "0.4", fees: "-0.2" },
      { fillAgeSeconds: 30, netPnl: "-1.2", fees: "-0.2" },
      { fillAgeSeconds: 31, netPnl: "0.3", fees: "-0.2" },
      { fillAgeSeconds: 901, netPnl: "-1.1", fees: "-0.2" },
    ]);

    expect(result[0]).toMatchObject({
      label: "[0,30]s",
      minimumAgeExclusive: null,
      trades: 2,
      winsAfterFees: 1,
      winRate: "0.5",
      grossPnl: "-0.4",
      fees: "-0.4",
      netPnl: "-0.8",
    });
    expect(result[1]).toMatchObject({
      label: "(30,60]s",
      trades: 1,
      netPnl: "0.3",
    });
    expect(result.at(-1)).toMatchObject({ label: ">900s", trades: 1 });
    expect(result.reduce((sum, bucket) => sum + bucket.trades, 0)).toBe(4);
  });

  it("rejects invalid age and money rather than emitting misleading evidence", () => {
    expect(() =>
      summarizeSignalDecay([{ fillAgeSeconds: -1, netPnl: "0", fees: "0" }]),
    ).toThrow("SIGNAL_DECAY_FILL_AGE_INVALID");
    expect(() =>
      summarizeSignalDecay([{ fillAgeSeconds: 1, netPnl: "NaN", fees: "0" }]),
    ).toThrow("SIGNAL_DECAY_MONEY_INVALID");
  });
});
