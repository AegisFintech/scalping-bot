import { describe, expect, it, vi } from "vitest";

import {
  PostgresPerformanceContext,
  summarizeTrades,
} from "../../apps/execution-service/src/performance-context.js";
import type {
  AnalyticsResponse,
  PerformanceOutcome,
  PerformanceSummary,
} from "../../packages/contracts/src/index.js";

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
      realized_pnl: "10",
      expectancy: "5",
      profit_factor: "2",
    });
  });

  it("classifies a positive gross move as a loss when stored net P/L is negative", () => {
    const summary = summarizeTrades([
      {
        // Gross was 0.10, signed fees were -0.12, and the durable value is net.
        realized_pnl: "-0.02",
        fees: "-0.12",
        direction: "LONG",
        closed_at: new Date("2026-01-01T00:00:00.000Z"),
        market_regime: "RANGING",
        confidence_bucket: "LOW",
      },
    ]);
    expect(summary).toMatchObject({
      wins: 0,
      losses: 1,
      realized_pnl: "-0.02",
      expectancy: "-0.02",
    });
  });

  it("passes fee-inclusive net P/L unchanged into AI performance context", async () => {
    const summary: PerformanceSummary = {
      sample_size: 1,
      wins: 0,
      losses: 1,
      win_rate: "0",
      loss_rate: "1",
      profit_factor: "0",
      expectancy: "-0.02",
      average_win: null,
      average_loss: "-0.02",
      realized_pnl: "-0.02",
      drawdown: "0.02",
      consecutive_wins: 0,
      consecutive_losses: 1,
    };
    const summarize = vi.fn((outcomes: readonly PerformanceOutcome[]) => {
      void outcomes;
      return Promise.resolve(summary);
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            realized_pnl: "-0.02",
            fees: "-0.12",
            direction: "LONG",
            closed_at: new Date("2026-09-01T00:00:00.000Z"),
            market_regime: "RANGING",
            confidence_bucket: "LOW",
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const context = new PostgresPerformanceContext({
      pool: { query } as never,
      accountId: "11111111-1111-4111-8111-111111111111",
      symbolId: "22222222-2222-4222-8222-222222222222",
      mode: "demo",
      timezone: "UTC",
      summarize,
    });
    const analytics = {
      features: {
        timeframes: { M1: { ema_alignment: "BULLISH", atr_percentile: 0.5 } },
        order_book: { top_20: { imbalance: 0 } },
      },
    } as unknown as AnalyticsResponse;

    const result = await context.build(
      analytics,
      new Date("2026-09-01T00:01:00.000Z"),
    );

    expect(summarize.mock.calls[0]?.[0]).toEqual([
      { netPnl: "-0.02", closedAt: "2026-09-01T00:00:00.000Z" },
    ]);
    expect(result.recent_outcomes).toEqual([
      {
        closed_at: "2026-09-01T00:00:00.000Z",
        direction: "LONG",
        net_pnl: "-0.02",
        market_regime: "RANGING",
        confidence_bucket: "LOW",
      },
    ]);
  });
});
