import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createPool } from "../packages/database/src/index.js";

const output = process.argv[2];
if (!output) throw new Error("VARIANT_INPUTS_OUTPUT_REQUIRED");
const historyPath = process.argv[3];
if (historyPath !== undefined && !/^[A-Za-z0-9._/-]{1,300}$/.test(historyPath))
  throw new Error("VARIANT_INPUTS_HISTORY_PATH_INVALID");

const pool = createPool({ connectionString: process.env.DATABASE_URL ?? "" });

interface SetupRow {
  context_id: string;
  analysis_id: string;
  captured_at: Date;
  valid_until: Date;
  buy_stop: string;
  sell_stop: string;
  release: string | null;
}

interface CandleRow {
  start_time: Date;
  end_time: Date;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface OutcomeRow {
  release: string | null;
  n: number;
  entry_slip_mean: string | null;
  entry_slip_p50: string | null;
  entry_slip_p90: string | null;
  entry_slip_p95: string | null;
  exit_overshoot_mean: string | null;
  exit_overshoot_p50: string | null;
  exit_overshoot_p90: string | null;
  exit_overshoot_p95: string | null;
  exit_overshoot_max: string | null;
  tp_excess_mean: string | null;
  hold_minutes_mean: string | null;
  winners: number;
  losers: number;
  dollars_per_point_mean: string | null;
  commission_round_trip_mean: string | null;
  avg_net_usd_mean: string | null;
  total_net_usd: string | null;
}

// Signed distances are measured fill-anchored: adverse entry slip is positive
// when the fill is worse than the trigger; exit overshoot is positive when the
// losing exit is worse than the fill-anchored stop-loss distance.
const OUTCOME_SQL = `
WITH ordered AS (
  SELECT o.order_group_id, o.side, o.entry_price AS trigger_price,
         o.stop_loss, o.take_profit, o.normalized_volume,
         sv.version AS release, p.id AS position_id, p.symbol_id,
         t.realized_pnl
  FROM orders o
  JOIN positions p ON p.order_group_id = o.order_group_id
  JOIN trades t ON t.position_id = p.id
  JOIN order_groups og ON og.id = o.order_group_id
  JOIN analysis_runs ar ON ar.id = og.analysis_id
  JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
  WHERE o.state = 'FILLED' AND o.order_type = 'STOP'
), fills_ranked AS (
  SELECT f.position_id, f.price, f.commission, f.occurred_at,
         row_number() OVER (PARTITION BY f.position_id ORDER BY f.occurred_at ASC) rn,
         count(*) OVER (PARTITION BY f.position_id) fill_count,
         sum(f.commission) OVER (PARTITION BY f.position_id) total_commission
  FROM fills f
  WHERE f.position_id IS NOT NULL
), pairs AS (
  SELECT od.release, od.side, od.trigger_price, od.stop_loss, od.take_profit,
         od.normalized_volume, od.symbol_id, od.realized_pnl,
         ef.price AS fill_price, xf.price AS exit_price,
         xf.total_commission AS commissions,
         ef.occurred_at AS filled_at, xf.occurred_at AS exited_at
  FROM ordered od
  JOIN fills_ranked ef ON ef.position_id = od.position_id AND ef.rn = 1
  JOIN fills_ranked xf ON xf.position_id = od.position_id
    AND xf.rn = xf.fill_count AND xf.fill_count >= 2
), derived AS (
  SELECT p.*,
         CASE WHEN p.side = 'BUY' THEN p.fill_price - p.trigger_price
              ELSE p.trigger_price - p.fill_price END AS entry_slip,
         abs(p.take_profit - p.trigger_price) AS tp_distance,
         abs(p.trigger_price - p.stop_loss) AS sl_distance,
         CASE WHEN p.side = 'BUY' THEN p.exit_price - p.fill_price
              ELSE p.fill_price - p.exit_price END AS gross_move,
         (EXTRACT(EPOCH FROM (p.exited_at - p.filled_at)) / 60.0) AS hold_minutes
  FROM pairs p
)
SELECT d.release,
       count(*)::int AS n,
       round(avg(d.entry_slip)::numeric, 4)::text AS entry_slip_mean,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY d.entry_slip))::numeric, 4)::text AS entry_slip_p50,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY d.entry_slip))::numeric, 4)::text AS entry_slip_p90,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY d.entry_slip))::numeric, 4)::text AS entry_slip_p95,
       round(avg(CASE WHEN d.gross_move < 0 THEN (-d.gross_move) - d.sl_distance END)::numeric, 4)::text AS exit_overshoot_mean,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN d.gross_move < 0 THEN (-d.gross_move) - d.sl_distance END))::numeric, 4)::text AS exit_overshoot_p50,
       round((percentile_cont(0.9) WITHIN GROUP (ORDER BY CASE WHEN d.gross_move < 0 THEN (-d.gross_move) - d.sl_distance END))::numeric, 4)::text AS exit_overshoot_p90,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY CASE WHEN d.gross_move < 0 THEN (-d.gross_move) - d.sl_distance END))::numeric, 4)::text AS exit_overshoot_p95,
       round(max(CASE WHEN d.gross_move < 0 THEN (-d.gross_move) - d.sl_distance END)::numeric, 4)::text AS exit_overshoot_max,
       round(avg(CASE WHEN d.gross_move > 0 THEN d.gross_move - d.tp_distance END)::numeric, 4)::text AS tp_excess_mean,
       round(avg(d.hold_minutes)::numeric, 3)::text AS hold_minutes_mean,
       count(*) FILTER (WHERE d.gross_move > 0)::int AS winners,
       count(*) FILTER (WHERE d.gross_move <= 0)::int AS losers,
       round(avg(d.normalized_volume * s.tick_value / s.tick_size)::numeric, 4)::text AS dollars_per_point_mean,
       round(avg(-d.commissions)::numeric, 4)::text AS commission_round_trip_mean,
       round(avg(d.realized_pnl)::numeric, 2)::text AS avg_net_usd_mean,
       round(sum(d.realized_pnl)::numeric, 2)::text AS total_net_usd
FROM derived d
JOIN symbols s ON s.id = d.symbol_id
GROUP BY d.release
ORDER BY d.release`;

try {
  await pool.query("SET default_transaction_read_only=on");

  const symbol = process.env.TRADING_SYMBOL ?? "XAUUSD";
  const symbolRows = await pool.query<{
    id: string;
    tick_size: string;
    tick_value: string;
  }>(
    `SELECT id, tick_size::text, tick_value::text FROM symbols WHERE name = $1`,
    [symbol],
  );
  const symbolRow = symbolRows.rows[0];
  if (symbolRows.rows.length !== 1 || symbolRow === undefined)
    throw new Error("VARIANT_INPUTS_SYMBOL_MISSING");
  const symbolId = symbolRow.id;
  const tickSize = symbolRow.tick_size;

  const setups = await pool.query<SetupRow>(
    `SELECT c.id::text AS context_id, c.source_analysis_id::text AS analysis_id,
            c.captured_at, c.valid_until,
            c.plan->>'buy_stop' AS buy_stop, c.plan->>'sell_stop' AS sell_stop,
            sv.version AS release
     FROM scenario_contexts c
     JOIN analysis_runs ar ON ar.id = c.source_analysis_id
     JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
     WHERE c.state = 'READY' AND c.mode = 'demo' AND c.plan IS NOT NULL
       AND c.plan->>'schema_version' = 'entry-pair-1.0'
       AND c.symbol_id = $1
     ORDER BY c.captured_at`,
    [symbolId],
  );

  const candles = await pool.query<CandleRow>(
    `SELECT DISTINCT ON (start_time) start_time, end_time, open::text, high::text,
            low::text, close::text
     FROM candle_values
     WHERE symbol_id = $1 AND timeframe = 'M1' AND complete
     ORDER BY start_time`,
    [symbolId],
  );

  interface SeriesCandle {
    start_time: string;
    end_time: string;
    open: string;
    high: string;
    low: string;
    close: string;
  }
  const mergedCandles = new Map<string, SeriesCandle>();
  if (historyPath !== undefined) {
    const history = JSON.parse(readFileSync(historyPath, "utf8")) as {
      label?: string;
      timeframe?: string;
      candles?: Array<{
        startTime: string;
        endTime: string;
        open: string;
        high: string;
        low: string;
        close: string;
      }>;
    };
    if (
      history.label !== "CANDLE_HISTORY_BACKFILL_V1" ||
      history.timeframe !== "M1" ||
      !Array.isArray(history.candles)
    )
      throw new Error("VARIANT_INPUTS_HISTORY_LABEL_INVALID");
    for (const candle of history.candles) {
      mergedCandles.set(candle.startTime, {
        start_time: candle.startTime,
        end_time: candle.endTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
    }
  }
  for (const row of candles.rows) {
    mergedCandles.set(row.start_time.toISOString(), {
      start_time: row.start_time.toISOString(),
      end_time: row.end_time.toISOString(),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    });
  }
  const candleSeries = [...mergedCandles.values()].sort(
    (left, right) => Date.parse(left.start_time) - Date.parse(right.start_time),
  );

  const spreads = await pool.query<{
    mean: string;
    p95: string;
    max: string;
    n: number;
  }>(
    `SELECT round(avg(spread)::numeric, 4)::text AS mean,
            round((percentile_cont(0.95) WITHIN GROUP (ORDER BY spread))::numeric, 4)::text AS p95,
            round(max(spread)::numeric, 4)::text AS max,
            count(*)::int AS n
     FROM spread_observations WHERE symbol_id = $1`,
    [symbolId],
  );

  const outcomes = await pool.query<OutcomeRow>(OUTCOME_SQL);

  const artifact = {
    label: "VARIANT_REPLAY_INPUTS_V1",
    exported_at: new Date().toISOString(),
    symbol,
    tick_size: tickSize,
    setups: setups.rows.map((row) => ({
      context_id: row.context_id,
      analysis_id: row.analysis_id,
      captured_at: row.captured_at.toISOString(),
      valid_until: row.valid_until.toISOString(),
      buy_stop: row.buy_stop,
      sell_stop: row.sell_stop,
      release: row.release,
    })),
    candles: candleSeries,
    spread_calibration: spreads.rows[0] ?? null,
    outcome_calibration: outcomes.rows,
    notes: [
      "Setups are journaled entry-pair-1.0 provider levels with capture times.",
      "Calibration is measured from actual demo fills, fill-anchored.",
      "Read-only export; no broker identifiers are included.",
    ],
  };

  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      label: "VARIANT_INPUTS_EXPORTED",
      setups: artifact.setups.length,
      candles: artifact.candles.length,
      merged_history: historyPath !== undefined,
      outcome_groups: artifact.outcome_calibration.length,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "VARIANT_INPUTS_EXPORT_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
