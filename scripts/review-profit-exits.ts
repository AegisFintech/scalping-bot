import "dotenv/config";
import { createHash } from "node:crypto";
import pg from "pg";
import {
  profitExitAudit,
  profitExitWindow,
  type ProfitExitAuditRow,
} from "../packages/evaluation/src/profit-exit-audit.js";

const { release, from, until } = profitExitWindow(process.argv.slice(2));
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  if (
    !process.env.DATABASE_URL ||
    !process.env.ACCOUNT_KEY ||
    !process.env.TRADING_SYMBOL
  )
    throw new Error("PROFIT_AUDIT_SCOPE_REQUIRED");
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  const result = await client.query<ProfitExitAuditRow>(
    `
    SELECT e.created_at::text claimed_at,e.details->'evidence'->'quote'->>'sourceTime' quote_at,
      e.details->'evidence'->>'gross' quote_gross,e.details->'evidence'->>'requiredNet' required_net,
      e.details->'evidence'->>'executionReserve' execution_reserve,e.details->'evidence'->>'volume' claimed_volume,
      close.closed_volume,close.actual_gross,t.fees::text fees,t.realized_pnl::text net,t.closed_at::text closed_at,
      COALESCE(close.exact_match,false) exact_close_match
    FROM position_protection_events e JOIN positions p ON p.id=e.position_id
    JOIN accounts ac ON ac.id=p.account_id JOIN symbols sy ON sy.id=p.symbol_id
    JOIN order_groups g ON g.id=p.order_group_id JOIN analysis_runs ar ON ar.id=g.analysis_id
    JOIN strategy_versions sv ON sv.id=ar.strategy_version_id LEFT JOIN trades t ON t.position_id=p.id
    LEFT JOIN LATERAL (
      SELECT sum(d.closed_volume)::text closed_volume,sum(d.gross_profit)::text actual_gross,
        bool_and(EXISTS(SELECT 1 FROM position_protection_events a WHERE a.position_id=p.id
          AND a.kind='CLOSE_ACK' AND a.details->>'brokerOrderId'=d.broker_order_id)) exact_match
      FROM position_close_deals d WHERE d.position_id=p.id
    ) close ON true
    WHERE ac.provider_account_key_hash=$1 AND ac.environment='demo' AND sy.name=$2 AND sv.version=$3
      AND g.mode='demo' AND e.kind='CLOSE_CLAIM' AND e.details->>'reason'='QUICK_PROFIT_EXIT_COST_COVERED'
      AND e.details->'evidence'->>'policy'='quick-profit-exit-v1'
      AND e.created_at >= $4 AND e.created_at < $5 ORDER BY e.created_at LIMIT 10001`,
    [
      createHash("sha256").update(process.env.ACCOUNT_KEY).digest("hex"),
      process.env.TRADING_SYMBOL,
      release,
      from,
      until,
    ],
  );
  const report = profitExitAudit(result.rows);
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ release, from, until, ...report }, null, 2));
} catch {
  console.error("PROFIT_EXIT_AUDIT_FAILED");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
