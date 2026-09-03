import "dotenv/config";

import pg from "pg";

import { summarizeSignalDecay } from "../apps/execution-service/src/signal-decay.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_REQUIRED");
const release = process.argv[2];
if (release === undefined || !/^[A-Za-z0-9._-]{1,120}$/.test(release))
  throw new Error("SIGNAL_DECAY_STRATEGY_VERSION_REQUIRED");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
});

try {
  const [trades, groups] = await Promise.all([
    pool.query<{ fill_age_seconds: string; net_pnl: string; fees: string }>(
      `SELECT extract(epoch FROM (opening_fill.occurred_at - og.created_at))::text
                AS fill_age_seconds,
              t.realized_pnl::text AS net_pnl, t.fees::text
       FROM trades t
       JOIN order_groups og ON og.id = t.order_group_id
       JOIN LATERAL (
         SELECT min(f.occurred_at) AS occurred_at
         FROM orders o JOIN fills f ON f.order_id = o.id
         WHERE o.order_group_id = og.id
       ) opening_fill ON opening_fill.occurred_at IS NOT NULL
       WHERE t.mode = 'demo' AND t.strategy_version = $1
       ORDER BY opening_fill.occurred_at`,
      [release],
    ),
    pool.query<{ state: string; count: string }>(
      `SELECT og.state, count(*)::text
       FROM order_groups og
       JOIN analysis_runs ar ON ar.id = og.analysis_id
       JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
       WHERE og.mode = 'demo' AND sv.version = $1
       GROUP BY og.state ORDER BY og.state`,
      [release],
    ),
  ]);
  const buckets = summarizeSignalDecay(
    trades.rows.map((row) => ({
      fillAgeSeconds: Number(row.fill_age_seconds),
      netPnl: row.net_pnl,
      fees: row.fees,
    })),
  );
  console.log(
    JSON.stringify(
      {
        label: "DEMO_FEE_INCLUSIVE_SIGNAL_DECAY_NOT_PROFITABILITY_EVIDENCE",
        strategyVersion: release,
        closedTrades: trades.rowCount,
        groupStates: groups.rows,
        buckets,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
