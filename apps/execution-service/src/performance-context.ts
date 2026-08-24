import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import type pg from "pg";

import type {
  AnalyticsResponse,
  PerformanceOutcome,
  PerformanceSummary,
  TradingMode,
} from "../../../packages/contracts/src/index.js";
import { canonical } from "../../../packages/risk-engine/src/decimal.js";
import { performanceAdjustment } from "../../../packages/risk-engine/src/performance.js";
import { tradingDayStart } from "./daily-risk-store.js";

interface TradeRow {
  readonly realized_pnl: string;
  readonly fees: string;
  readonly direction: string;
  readonly closed_at: Date;
  readonly market_regime: string;
  readonly confidence_bucket: string;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statisticText(value: Decimal): string {
  return canonical(value.toDecimalPlaces(10, Decimal.ROUND_DOWN));
}

function setupDimensions(analytics: AnalyticsResponse): Record<string, string> {
  const m1 = object(object(analytics.features.timeframes).M1);
  const top20 = object(object(analytics.features.order_book).top_20);
  const atrPercentile = Number(m1.atr_percentile ?? 0);
  const imbalance = Number(top20.imbalance ?? 0);
  return {
    ema_alignment:
      typeof m1.ema_alignment === "string" ? m1.ema_alignment : "UNKNOWN",
    volatility_condition:
      atrPercentile >= 0.8 ? "HIGH" : atrPercentile <= 0.2 ? "LOW" : "NORMAL",
    order_book_condition:
      imbalance >= 0.15
        ? "BID_HEAVY"
        : imbalance <= -0.15
          ? "ASK_HEAVY"
          : "BALANCED",
  };
}

export function summarizeTrades(rows: readonly TradeRow[]): PerformanceSummary {
  const outcomes = rows.map((row) =>
    new Decimal(row.realized_pnl).minus(row.fees),
  );
  const wins = outcomes.filter((value) => value.gt(0));
  const losses = outcomes.filter((value) => value.lt(0));
  const total = outcomes.reduce(
    (sum, value) => sum.plus(value),
    new Decimal(0),
  );
  const grossProfit = wins.reduce(
    (sum, value) => sum.plus(value),
    new Decimal(0),
  );
  const grossLoss = losses.reduce(
    (sum, value) => sum.plus(value.abs()),
    new Decimal(0),
  );
  let equity = new Decimal(0);
  let peak = new Decimal(0);
  let drawdown = new Decimal(0);
  for (const outcome of [...outcomes].reverse()) {
    equity = equity.plus(outcome);
    peak = Decimal.max(peak, equity);
    drawdown = Decimal.max(drawdown, peak.minus(equity));
  }
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  for (const outcome of outcomes) {
    if (outcome.gt(0)) {
      if (consecutiveLosses > 0) break;
      consecutiveWins += 1;
    } else if (outcome.lt(0)) {
      if (consecutiveWins > 0) break;
      consecutiveLosses += 1;
    } else break;
  }
  return {
    sample_size: rows.length,
    wins: wins.length,
    losses: losses.length,
    win_rate:
      rows.length === 0
        ? null
        : statisticText(new Decimal(wins.length).div(rows.length)),
    loss_rate:
      rows.length === 0
        ? null
        : statisticText(new Decimal(losses.length).div(rows.length)),
    profit_factor: grossLoss.eq(0)
      ? null
      : statisticText(grossProfit.div(grossLoss)),
    expectancy:
      rows.length === 0 ? null : statisticText(total.div(rows.length)),
    average_win:
      wins.length === 0 ? null : statisticText(grossProfit.div(wins.length)),
    average_loss:
      losses.length === 0
        ? null
        : statisticText(grossLoss.neg().div(losses.length)),
    realized_pnl: statisticText(total),
    drawdown: statisticText(drawdown),
    consecutive_wins: consecutiveWins,
    consecutive_losses: consecutiveLosses,
  };
}

export class PostgresPerformanceContext {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;
  readonly #mode: TradingMode;
  readonly #timezone: string;
  readonly #minimumSamples: number;
  readonly #decay: number;
  readonly #window: number;
  readonly #summarize: (
    outcomes: readonly PerformanceOutcome[],
  ) => Promise<PerformanceSummary>;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly mode: TradingMode;
    readonly timezone: string;
    readonly minimumSamples?: number;
    readonly decay?: number;
    readonly window?: number;
    readonly summarize: (
      outcomes: readonly PerformanceOutcome[],
    ) => Promise<PerformanceSummary>;
  }) {
    if (
      !Number.isSafeInteger(input.minimumSamples ?? 20) ||
      (input.minimumSamples ?? 20) < 1 ||
      !Number.isFinite(input.decay ?? 0.97) ||
      (input.decay ?? 0.97) <= 0 ||
      (input.decay ?? 0.97) > 1 ||
      !Number.isSafeInteger(input.window ?? 200) ||
      (input.window ?? 200) < 1 ||
      (input.window ?? 200) > 5_000
    ) {
      throw new Error("PERFORMANCE_CONFIG_INVALID");
    }
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#mode = input.mode;
    this.#timezone = input.timezone;
    this.#minimumSamples = input.minimumSamples ?? 20;
    this.#decay = input.decay ?? 0.97;
    this.#window = input.window ?? 200;
    this.#summarize = input.summarize;
  }

  async build(
    analytics: AnalyticsResponse,
    now = new Date(),
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.#pool.query<TradeRow>(
      `SELECT t.realized_pnl::text, t.fees::text, t.direction, t.closed_at,
              t.market_regime, t.confidence_bucket
       FROM trades t
       JOIN order_groups og ON og.id = t.order_group_id
       JOIN analysis_runs ar ON ar.id = og.analysis_id
       WHERE ar.account_id = $1 AND ar.symbol_id = $2 AND t.mode = $3
       ORDER BY t.closed_at DESC
       LIMIT $4`,
      [this.#accountId, this.#symbolId, this.#mode, this.#window],
    );
    const rows = result.rows;
    const dayStart = tradingDayStart(now, this.#timezone);
    const outcomes = rows.map((row) => ({
      netPnl: canonical(new Decimal(row.realized_pnl).minus(row.fees)),
      closedAt: row.closed_at.toISOString(),
    }));
    const [overall, session] = await Promise.all([
      this.#summarize(outcomes),
      this.#summarize(
        outcomes.filter((outcome) => new Date(outcome.closedAt) >= dayStart),
      ),
    ]);
    const dimensions = setupDimensions(analytics);
    const setupKey = [
      dimensions.ema_alignment,
      dimensions.volatility_condition,
      dimensions.order_book_condition,
    ].join(":");
    const adjustment = performanceAdjustment(
      rows.map((row, age) => ({
        won: new Decimal(row.realized_pnl).minus(row.fees).gt(0),
        age,
      })),
      this.#minimumSamples,
      this.#decay,
    );
    await this.#persist(
      now,
      dayStart,
      setupKey,
      dimensions,
      overall,
      session,
      adjustment.effectiveSampleSize,
      adjustment.confidenceDelta,
      adjustment.reasonCodes,
    );
    return {
      cohort_scope: "ACCOUNT_SYMBOL_MODE_ROLLING",
      setup_key: setupKey,
      setup_dimensions: dimensions,
      rolling: overall,
      current_session: session,
      recent_outcomes: rows.slice(0, 20).map((row) => ({
        closed_at: row.closed_at.toISOString(),
        direction: row.direction,
        net_pnl: canonical(new Decimal(row.realized_pnl).minus(row.fees)),
        market_regime: row.market_regime,
        confidence_bucket: row.confidence_bucket,
      })),
      performance_adjustment: {
        applied: adjustment.applied,
        confidence_delta: adjustment.confidenceDelta,
        reason_codes: adjustment.reasonCodes,
        effective_sample_size: adjustment.effectiveSampleSize,
        minimum_sample_size: this.#minimumSamples,
        decay: this.#decay,
      },
    };
  }

  async #persist(
    now: Date,
    dayStart: Date,
    setupKey: string,
    dimensions: Readonly<Record<string, string>>,
    overall: PerformanceSummary,
    session: PerformanceSummary,
    effectiveSampleSize: number,
    confidenceDelta: number,
    reasonCodes: readonly string[],
  ): Promise<void> {
    const sessionKey = `${this.#timezone}:${dayStart.toISOString()}`;
    await this.#pool.query(
      `INSERT INTO session_statistics
        (id, account_id, symbol_id, mode, session_key, window_start, window_end,
         trade_count, realized_pnl, unrealized_pnl, win_rate, profit_factor, expectancy,
         average_win, average_loss, drawdown, consecutive_wins, consecutive_losses, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12, $13, $14,
               $15, $16, $17, $7)
       ON CONFLICT (account_id, symbol_id, mode, session_key, window_start)
       DO UPDATE SET window_end = EXCLUDED.window_end, trade_count = EXCLUDED.trade_count,
         realized_pnl = EXCLUDED.realized_pnl, win_rate = EXCLUDED.win_rate,
         profit_factor = EXCLUDED.profit_factor, expectancy = EXCLUDED.expectancy,
         average_win = EXCLUDED.average_win, average_loss = EXCLUDED.average_loss,
         drawdown = EXCLUDED.drawdown, consecutive_wins = EXCLUDED.consecutive_wins,
         consecutive_losses = EXCLUDED.consecutive_losses, computed_at = EXCLUDED.computed_at`,
      [
        randomUUID(),
        this.#accountId,
        this.#symbolId,
        this.#mode,
        sessionKey,
        dayStart.toISOString(),
        now.toISOString(),
        session.sample_size,
        session.realized_pnl,
        session.win_rate,
        session.profit_factor,
        session.expectancy,
        session.average_win,
        session.average_loss,
        session.drawdown,
        session.consecutive_wins,
        session.consecutive_losses,
      ],
    );
    const windowEnd = new Date(
      Math.floor(now.getTime() / 3_600_000) * 3_600_000,
    );
    const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60_000);
    await this.#pool.query(
      `INSERT INTO setup_statistics
        (id, account_id, symbol_id, mode, setup_key, dimensions, sample_size,
         effective_sample_size, win_rate, profit_factor, expectancy, confidence_adjustment,
         reason_codes, window_start, window_end, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12,
               $13::jsonb, $14, $15, $16)
       ON CONFLICT (account_id, symbol_id, mode, setup_key, window_end)
       DO UPDATE SET dimensions = EXCLUDED.dimensions, sample_size = EXCLUDED.sample_size,
         effective_sample_size = EXCLUDED.effective_sample_size, win_rate = EXCLUDED.win_rate,
         profit_factor = EXCLUDED.profit_factor, expectancy = EXCLUDED.expectancy,
         confidence_adjustment = EXCLUDED.confidence_adjustment,
         reason_codes = EXCLUDED.reason_codes, computed_at = EXCLUDED.computed_at`,
      [
        randomUUID(),
        this.#accountId,
        this.#symbolId,
        this.#mode,
        setupKey,
        JSON.stringify(dimensions),
        overall.sample_size,
        effectiveSampleSize,
        overall.win_rate,
        overall.profit_factor,
        overall.expectancy,
        confidenceDelta,
        JSON.stringify(reasonCodes),
        windowStart.toISOString(),
        windowEnd.toISOString(),
        now.toISOString(),
      ],
    );
  }
}
