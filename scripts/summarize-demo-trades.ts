import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createPool } from "../packages/database/src/index.js";

const output = process.argv[2];
if (output === undefined) {
  console.error("Usage: tsx scripts/summarize-demo-trades.ts <output.json>");
  process.exitCode = 1;
  process.exit(0);
}

const pool = createPool({ connectionString: process.env.DATABASE_URL ?? "" });

interface DailyRow {
  day: string;
  trades: number;
  winners: number;
  losers: number;
  net_pnl_usd: number;
  fees_usd: number;
  commission_per_round_trip_usd: number;
  avg_hold_minutes: number;
  avg_entry_slippage_vs_trigger: number;
  avg_stop_overshoot_vs_sl: number;
}

interface ReleaseRow {
  release: string;
  trades: number;
  winners: number;
  losers: number;
  net_pnl_usd: number;
}

interface AccountStateRow {
  reference_equity: number;
  high_water_equity: number;
  adjusted_equity: number;
  drawdown_percent: number;
  risk_multiplier: number;
  locked_out: boolean;
  reconciled_at: string;
}

interface ReleaseExecRow {
  release: string;
  execution_order_type: string;
  trades: number;
  winners: number;
  losers: number;
  net_pnl_usd: number;
  fees_usd: number;
  avg_entry_slippage: number;
  avg_stop_overshoot: number;
}

interface Artifact {
  generated_at: string;
  per_day: DailyRow[];
  per_release: ReleaseRow[];
  per_release_per_execution_type: ReleaseExecRow[];
  account_state: AccountStateRow | null;
  notes: string[];
}

const dailyQuery = `
SELECT date_trunc('day', closed_at)::date AS day,
       count(*)::int AS trades,
       sum(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END)::int AS winners,
       sum(CASE WHEN realized_pnl <= 0 THEN 1 ELSE 0 END)::int AS losers,
       round(sum(realized_pnl)::numeric, 2) AS net_pnl_usd,
       round(sum(fees)::numeric, 2) AS fees_usd,
       round(sum(fees)::numeric / NULLIF(count(*), 0), 2) AS commission_per_round_trip_usd,
       round(avg(EXTRACT(EPOCH FROM (closed_at - opened_at)) / 60.0)::numeric, 3) AS avg_hold_minutes,
       round(avg(entry_slip)::numeric, 4) AS avg_entry_slippage_vs_trigger,
       round(avg(stop_overshoot)::numeric, 4) AS avg_stop_overshoot_vs_sl
FROM (
  SELECT t.id,
         t.realized_pnl,
         t.fees,
         t.opened_at,
         t.closed_at,
         CASE WHEN o.side = 'BUY' THEN ef.price - o.entry_price
              ELSE o.entry_price - ef.price END AS entry_slip,
         xf.gap AS stop_overshoot
  FROM trades t
  JOIN order_groups og ON og.id = t.order_group_id
  JOIN orders o ON o.order_group_id = og.id AND o.state = 'FILLED'
  JOIN LATERAL (
    SELECT price FROM fills WHERE position_id = t.position_id ORDER BY occurred_at ASC LIMIT 1
  ) ef ON true
  JOIN LATERAL (
    SELECT (price - o.stop_loss) AS gap
    FROM fills WHERE position_id = t.position_id AND price::numeric <> o.entry_price::numeric
    ORDER BY occurred_at DESC LIMIT 1
  ) xf ON true
  WHERE t.mode = 'demo'
) AS per_trade
GROUP BY 1
ORDER BY 1
`;

const releaseQuery = `
SELECT sv.version AS release,
       count(*)::int AS trades,
       sum(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END)::int AS winners,
       sum(CASE WHEN t.realized_pnl <= 0 THEN 1 ELSE 0 END)::int AS losers,
       round(sum(t.realized_pnl)::numeric, 2) AS net_pnl_usd
FROM trades t
JOIN order_groups og ON og.id = t.order_group_id
JOIN analysis_runs ar ON ar.id = og.analysis_id
JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
JOIN orders o ON o.order_group_id = og.id AND o.state = 'FILLED'
WHERE t.mode = 'demo'
GROUP BY 1
ORDER BY 1
`;

const accountQuery = `
SELECT reference_equity::numeric, high_water_equity::numeric, adjusted_equity::numeric,
       drawdown_percent::numeric, risk_multiplier::numeric, locked_out, reconciled_at
FROM capital_risk_state
ORDER BY updated_at DESC LIMIT 1
`;

const releaseExecQuery = `
WITH filled_legs AS (
  SELECT DISTINCT ON (og.id) og.id AS order_group_id,
         o.execution_order_type
  FROM orders o
  JOIN order_groups og ON og.id = o.order_group_id
  WHERE o.state = 'FILLED'
)
SELECT sv.version AS release,
       fl.execution_order_type,
       count(*)::int AS trades,
       sum(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END)::int AS winners,
       sum(CASE WHEN t.realized_pnl <= 0 THEN 1 ELSE 0 END)::int AS losers,
       round(sum(t.realized_pnl)::numeric, 2) AS net_pnl_usd,
       round(sum(t.fees)::numeric, 2) AS fees_usd,
       round(avg(entry_slip)::numeric, 4) AS avg_entry_slippage,
       round(avg(stop_overshoot)::numeric, 4) AS avg_stop_overshoot
FROM trades t
JOIN order_groups og ON og.id = t.order_group_id
JOIN analysis_runs ar ON ar.id = og.analysis_id
JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
JOIN filled_legs fl ON fl.order_group_id = og.id
JOIN LATERAL (
  SELECT (ef.price - o.entry_price) AS entry_slip
  FROM fills ef JOIN orders o ON o.id = ef.order_id
  WHERE o.order_group_id = og.id
  ORDER BY ef.occurred_at ASC LIMIT 1
) ef ON true
JOIN LATERAL (
  SELECT (xf.price - o.stop_loss) AS stop_overshoot
  FROM fills xf JOIN orders o ON o.id = xf.order_id
  WHERE o.order_group_id = og.id AND o.state = 'FILLED'
  ORDER BY xf.occurred_at DESC LIMIT 1
) xf ON true
WHERE t.mode = 'demo'
GROUP BY 1, 2
ORDER BY 1, 2
`;

try {
  await pool.query("SET default_transaction_read_only=on");
  const [daily, release, releaseExec, account] = await Promise.all([
    pool.query<DailyRow>(dailyQuery),
    pool.query<ReleaseRow>(releaseQuery),
    pool.query<ReleaseExecRow>(releaseExecQuery),
    pool.query<AccountStateRow>(accountQuery),
  ]);
  const artifact: Artifact = {
    generated_at: new Date().toISOString(),
    per_day: daily.rows,
    per_release: release.rows,
    per_release_per_execution_type: releaseExec.rows,
    account_state: account.rows[0] ?? null,
    notes: [
      "Demo trade summary, sourced directly from the trades / orders / fills audit.",
      "avg_entry_slippage_vs_trigger = fill - trigger on the entry leg (adverse when positive).",
      "avg_stop_overshoot_vs_sl = last non-entry fill - stop loss (negative when exits fill favourably).",
    ],
  };
  writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      label: "DEMO_TRADE_SUMMARY_WRITTEN",
      trades: artifact.per_day.reduce((sum, day) => sum + day.trades, 0),
      net_pnl_usd: artifact.per_day.reduce(
        (sum, day) => sum + Number(day.net_pnl_usd),
        0,
      ),
      output,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "DEMO_TRADE_SUMMARY_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
