import { describe, expect, it } from "vitest";

import { summarizeTrades } from "../../apps/execution-service/src/performance-context.js";

describe("performance context", () => {
  it("computes bounded net performance statistics deterministically", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const summary = summarizeTrades([
      {
        realized_pnl: "20",
        fees: "2",
        direction: "LONG",
        closed_at: now,
        market_regime: "TRENDING",
        confidence_bucket: "HIGH",
      },
      {
        realized_pnl: "-10",
        fees: "1",
        direction: "SHORT",
        closed_at: now,
        market_regime: "RANGING",
        confidence_bucket: "LOW",
      },
    ]);
    expect(summary).toMatchObject({
      sample_size: 2,
      wins: 1,
      losses: 1,
      realized_pnl: "7",
      expectancy: "3.5",
      profit_factor: "1.6363636363",
    });
  });
});
