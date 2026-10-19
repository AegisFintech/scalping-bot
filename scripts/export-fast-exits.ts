import "dotenv/config";
import pg from "pg";
import { fastExitWindow } from "../packages/evaluation/src/fast-exit-input.js";
import type { FastExitRow } from "../packages/evaluation/src/fast-exit-input.js";

// Projection only: no account/order identifiers, raw payloads or credentials.
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  const { release, from, until } = fastExitWindow(process.argv.slice(2));
  if (Date.parse(until) - Date.parse(from) > 31 * 86400000)
    throw new Error("PAIRED_WINDOW_TOO_LARGE");
  if (!process.env.DATABASE_URL) throw new Error("PAIRED_DATABASE_REQUIRED");
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
  const args = [release, from, until];
  const scope = await client.query<{ scopes: string }>(
    `SELECT count(DISTINCT (ar.account_id,ar.symbol_id))::text scopes
     FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id
     JOIN strategy_versions sv ON sv.id=ar.strategy_version_id
     WHERE og.mode='demo' AND sv.version=$1 AND og.created_at >= $2 AND og.created_at < $3`,
    args,
  );
  const scopes = Number(scope.rows[0]?.scopes);
  if (!Number.isInteger(scopes) || scopes < 0 || scopes > 1)
    throw new Error("PAIRED_SINGLE_SCOPE_REQUIRED");
  const result = await client.query<FastExitRow>(
    `SELECT og.created_at AS created, sc.captured_at AS captured,
       sc.available_at AS available, sc.valid_until,
       og.submission_valid_until, sc.tick_size,
       sc.plan->>'sell_stop' AS model_buy, sc.plan->>'buy_stop' AS model_sell,
       sc.plan->>'schema_version' AS model_schema,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'side',o.side,'accepted',(SELECT min(e.occurred_at) FROM broker_execution_events e
           WHERE e.order_id=o.id AND e.order_group_id=og.id AND e.account_id=ar.account_id
             AND e.symbol_id=ar.symbol_id AND e.mapping_state='MAPPED'
             AND e.execution_type=2 AND NOT e.closing_order AND e.occurred_at < $3),
         'entry',o.entry_price::text,
         'sl',abs(o.stop_loss-o.entry_price)::text,
         'tp',abs(o.take_profit-o.entry_price)::text,
         'volume',o.normalized_volume::text,'budget',rd.risk_budget::text,
         'equity',rd.equity::text,'order_type',o.execution_order_type,
         'tif',o.time_in_force,
         'fill_count',(SELECT count(*) FROM fills f WHERE f.order_id=o.id AND f.occurred_at < $3),
         'cancelled_at',(SELECT max(GREATEST(e.occurred_at,e.received_at)) FROM broker_execution_events e
           WHERE e.order_id=o.id AND e.order_group_id=og.id AND e.account_id=ar.account_id
             AND e.symbol_id=ar.symbol_id AND e.mapping_state='MAPPED'
             AND e.execution_type=5 AND NOT e.closing_order AND e.occurred_at < $3 AND e.received_at < $3
             AND o.filled_volume=0 AND NOT EXISTS(SELECT 1 FROM fills f WHERE f.order_id=o.id)),
         'fee_evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'at',v.validated_at,'fees',item->>'total_estimated_fees',
           'gross',item->>'gross_profit','pips',item->>'take_profit_pips',
           'pip_size',item->>'pip_size','volume',item->>'volume'))
           FROM validation_results v CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(v.details->'fee_buffer_evidence')='array'
               THEN v.details->'fee_buffer_evidence' ELSE '[]'::jsonb END) item
           WHERE v.analysis_id=ar.id AND v.stage='RISK' AND v.accepted
             AND v.details->>'validation_scope'='ACTUAL_VOLUME_FEE_BUFFER'
             AND v.validated_at<=og.created_at AND item->>'side'=o.side),'[]'::jsonb),
         'fill',(SELECT CASE WHEN count(*)=1 AND min(f.volume)=o.normalized_volume
           THEN jsonb_build_object('time',min(f.occurred_at),'price',min(f.price)::text)
           END FROM fills f WHERE f.order_id=o.id AND f.occurred_at < $3)
       ) ORDER BY o.side)
       FROM orders o LEFT JOIN risk_decisions rd ON rd.analysis_id=ar.id
         AND rd.side=o.side AND rd.approved AND rd.decided_at <= og.created_at
       WHERE o.order_group_id=og.id),'[]'::jsonb) AS legs
     FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id
     JOIN strategy_versions sv ON sv.id=ar.strategy_version_id
     LEFT JOIN scenario_contexts sc ON sc.id=og.context_plan_id
       AND sc.account_id=ar.account_id AND sc.symbol_id=ar.symbol_id AND sc.mode='demo'
     WHERE og.mode='demo' AND sv.version=$1 AND og.created_at >= $2 AND og.created_at < $3
     ORDER BY og.created_at,og.id LIMIT 1001`,
    args,
  );
  if (result.rows.length > 1000) throw new Error("PAIRED_TOO_MANY_SETUPS");
  if (scopes === 0 && result.rows.length !== 0)
    throw new Error("PAIRED_SINGLE_SCOPE_REQUIRED");
  await client.query("ROLLBACK");
  console.log(
    JSON.stringify({
      label: "FAST_EXIT_INPUT_V1",
      release,
      from,
      until,
      cohort: "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
      economics: null,
      setups: result.rows,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error && /^(PAIRED|LEARNING)_[A-Z_]+$/.test(error.message)
      ? error.message
      : "PAIRED_EXPORT_FAILED",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
