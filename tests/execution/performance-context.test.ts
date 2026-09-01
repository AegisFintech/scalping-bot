import { describe, expect, it, vi } from "vitest";

import {
  PostgresPerformanceContext,
  summarizeFeeCoverage,
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
        strategy_version: "test-v1",
      },
      {
        realized_pnl: "-10",
        fees: "1",
        direction: "SHORT",
        closed_at: now,
        market_regime: "RANGING",
        confidence_bucket: "LOW",
        strategy_version: "test-v1",
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
        strategy_version: "test-v1",
      },
    ]);
    expect(summary).toMatchObject({
      wins: 0,
      losses: 1,
      realized_pnl: "-0.02",
      expectancy: "-0.02",
    });
  });

  it("separates gross-positive closes whose fees erase the gain", () => {
    expect(
      summarizeFeeCoverage([
        {
          realized_pnl: "-0.12",
          fees: "-0.26",
          direction: "SHORT",
          closed_at: new Date("2026-09-01T00:00:00.000Z"),
          market_regime: "VOLATILE",
          confidence_bucket: "LOW",
          strategy_version: "release-.37",
        },
        {
          realized_pnl: "0.30",
          fees: "-0.26",
          direction: "SHORT",
          closed_at: new Date("2026-09-01T00:01:00.000Z"),
          market_regime: "VOLATILE",
          confidence_bucket: "LOW",
          strategy_version: "release-.37",
        },
        {
          realized_pnl: "0",
          fees: "-0.26",
          direction: "LONG",
          closed_at: new Date("2026-09-01T00:02:00.000Z"),
          market_regime: "VOLATILE",
          confidence_bucket: "LOW",
          strategy_version: "release-.37",
        },
      ]),
    ).toEqual({
      sample_size: 3,
      gross_positive_closes: 3,
      net_positive_closes: 1,
      gross_positive_but_net_nonpositive_closes: 2,
      gross_positive_fee_defeat_rate: "0.6666666666",
      gross_pnl: "0.96",
      fees: "-0.78",
      net_pnl: "0.18",
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
            strategy_version: "release-.37",
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
        strategy_version: "release-.37",
        gross_pnl: "0.1",
        fees: "-0.12",
        net_pnl: "-0.02",
        result_after_fees: "GROSS_PROFIT_ERASED_BY_FEES",
        market_regime: "RANGING",
        confidence_bucket: "LOW",
      },
    ]);
    expect(result.fee_coverage).toEqual({
      rolling: {
        sample_size: 1,
        gross_positive_closes: 1,
        net_positive_closes: 0,
        gross_positive_but_net_nonpositive_closes: 1,
        gross_positive_fee_defeat_rate: "1",
        gross_pnl: "0.1",
        fees: "-0.12",
        net_pnl: "-0.02",
      },
      current_session: {
        sample_size: 1,
        gross_positive_closes: 1,
        net_positive_closes: 0,
        gross_positive_but_net_nonpositive_closes: 1,
        gross_positive_fee_defeat_rate: "1",
        gross_pnl: "0.1",
        fees: "-0.12",
        net_pnl: "-0.02",
      },
    });
  });
});
