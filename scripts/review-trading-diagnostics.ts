import "dotenv/config";
import pg from "pg";
import {
  diagnosticReport,
  diagnosticWindow,
  type DiagnosticRow,
} from "../packages/evaluation/src/trading-diagnostics.js";

// Explicit release and immutable end time: no implicit moving-window optimization.
const { release, from, until } = diagnosticWindow(process.argv.slice(2));
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  if (!process.env.DATABASE_URL)
    throw new Error("DIAGNOSTIC_DATABASE_REQUIRED");
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
  const scope = await client.query<{ scopes: string }>(
    `
    SELECT count(DISTINCT (ar.account_id, ar.symbol_id))::text scopes
    FROM trades t JOIN order_groups og ON og.id=t.order_group_id
    JOIN analysis_runs ar ON ar.id=og.analysis_id
    WHERE t.mode='demo' AND t.strategy_version=$1 AND t.closed_at >= $2 AND t.closed_at < $3`,
    [release, from, until],
  );
  if (Number(scope.rows[0]?.scopes) > 1)
    throw new Error("DIAGNOSTIC_MULTIPLE_SCOPES");
  const result = await client.query<DiagnosticRow>(
    `
    WITH protection_history AS MATERIALIZED (
      SELECT e.*
      FROM position_protection_events e
      WHERE e.kind='OBSERVATION' AND e.position_id IN (
        SELECT t.position_id FROM trades t WHERE t.mode='demo' AND t.strategy_version=$1
          AND t.closed_at >= $2 AND t.closed_at < $3
      )
    )
    SELECT t.direction, to_char(t.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') opened_at,
      to_char(t.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') closed_at,
      t.realized_pnl::text net, t.fees::text fees, rd.risk_budget::text,
      CASE WHEN sc.plan->>'schema_version'='entry-pair-1.0' THEN
        sc.plan->>CASE WHEN t.direction='LONG' THEN 'sell_stop' ELSE 'buy_stop' END
      END model_level,
      rd.entry_price::text effective_entry,
      indicator.ema_alignment,
      COALESCE(events.evidence, '[]'::jsonb) close_evidence,
      rd.equity::text equity,
      to_char(og.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') intent_at,
      to_char(rd.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') decided_at,
      o.normalized_volume::text expected_volume,
      COALESCE(entry_fills.evidence, '[]'::jsonb) fills,
      protection.evidence protection
    FROM trades t JOIN order_groups og ON og.id=t.order_group_id
    JOIN analysis_runs ar ON ar.id=og.analysis_id
    LEFT JOIN scenario_contexts sc ON sc.id=og.context_plan_id
    LEFT JOIN risk_decisions rd ON rd.analysis_id=ar.id AND rd.approved
      AND rd.side=CASE WHEN t.direction='LONG' THEN 'BUY' ELSE 'SELL' END
      AND rd.decided_at <= og.created_at
    LEFT JOIN positions p ON p.id=t.position_id AND p.order_group_id=t.order_group_id
      AND p.account_id=ar.account_id AND p.symbol_id=ar.symbol_id AND p.strategy_owned
      AND p.side=CASE WHEN t.direction='LONG' THEN 'BUY' ELSE 'SELL' END
    LEFT JOIN orders o ON o.order_group_id=t.order_group_id AND o.strategy_owned
      AND o.side=p.side AND o.state='FILLED' AND o.filled_volume=o.normalized_volume
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('price', f.price::text, 'volume', f.volume::text)
        ORDER BY f.occurred_at, f.id) evidence
      FROM (SELECT * FROM fills f WHERE f.order_id=o.id AND f.position_id=p.id
        AND f.occurred_at >= t.opened_at AND f.occurred_at <= t.closed_at
        ORDER BY f.occurred_at, f.id LIMIT 1001) f
    ) entry_fills ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('samples',count(*),
        'verified',count(*) FILTER (WHERE e.details->>'status'='VERIFIED'
          AND (e.details->>'stopLoss')::numeric > 0 AND (e.details->>'takeProfit')::numeric > 0),
        'missingStop',count(*) FILTER (WHERE e.details->>'stopLoss' IS NULL)) evidence
      FROM protection_history e WHERE e.position_id=p.id
        AND e.created_at >= t.opened_at AND e.created_at <= t.closed_at
        AND (e.details->>'observedAt')::timestamptz >= t.opened_at
        AND (e.details->>'observedAt')::timestamptz <= t.closed_at
    ) protection ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*)=1 THEN min(i.features->'timeframes'->'M1'->>'ema_alignment') END ema_alignment
      FROM indicator_snapshots i WHERE i.candle_snapshot_id=ar.candle_snapshot_id
        AND i.acceptable AND i.generated_at <= og.created_at
    ) indicator ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'gross', e.normalized_payload->'closeDetail'->>'grossProfit',
        'swap', e.normalized_payload->'closeDetail'->>'swap',
        'commission', e.normalized_payload->'closeDetail'->>'commission',
        'conversion', e.normalized_payload->'closeDetail'->>'pnlConversionFee',
        'order_type', e.broker_order_type)) evidence
      FROM broker_execution_events e WHERE e.position_id=t.position_id
        AND e.order_group_id=t.order_group_id AND e.account_id=ar.account_id AND e.symbol_id=ar.symbol_id
        AND e.mapping_state='MAPPED' AND e.closing_order AND e.execution_type=3
        AND e.occurred_at=t.closed_at
        AND jsonb_typeof(e.normalized_payload->'closeDetail')='object'
    ) events ON true
    WHERE t.mode='demo' AND t.strategy_version=$1 AND t.closed_at >= $2 AND t.closed_at < $3
    ORDER BY t.closed_at, t.id LIMIT 10001`,
    [release, from, until],
  );
  if (result.rows.length > 10000)
    throw new Error("DIAGNOSTIC_WINDOW_TOO_LARGE");
  const report = diagnosticReport([release, from, until], result.rows);
  await client.query("ROLLBACK");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Never print database exceptions/connection strings or raw broker payloads.
  console.error(
    error instanceof Error && /^DIAGNOSTIC_[A-Z_]+$/.test(error.message)
      ? error.message
      : "DIAGNOSTIC_REVIEW_FAILED: database read or evidence validation failed",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
