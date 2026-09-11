import type pg from "pg";
import type { EntryRetirementEvidence } from "../../../packages/contracts/src/index.js";
import { ModelResponseValidator } from "../../../packages/risk-engine/src/model-validator.js";
import { decimal } from "../../../packages/risk-engine/src/decimal.js";
import { FIXED_DEFAULTS } from "../../../packages/config/src/policy.js";

const validator = new ModelResponseValidator<EntryRetirementEvidence>(
  "schemas/entry-retirement-1.0.json",
);
export interface ContextScope {
  accountId: string;
  symbolId: string;
  mode: string;
}
export function contextScopeLock(scope: ContextScope): string {
  return JSON.stringify([scope.accountId, scope.symbolId, scope.mode]);
}

/** Same lock/order as provider admission; row lock also serializes broker intent. */
export async function retireEntryContext(
  pool: pg.Pool,
  scope: ContextScope,
  id: string,
  evidence: EntryRetirementEvidence,
): Promise<boolean> {
  if (!validator.parse(JSON.stringify(evidence)).accepted)
    throw new Error("SCENARIO_ENTRY_RETIREMENT_INVALID");
  const now = Date.now();
  const observed = Date.parse(evidence.observedAt);
  const received = Date.parse(evidence.quote.receivedAt);
  const source = Date.parse(evidence.quote.sourceTime);
  const minimum = decimal(evidence.minimumEntryDistance);
  const expected: string[] = [];
  if (
    minimum.lt(evidence.tickSize) ||
    decimal(evidence.quote.bid).lte(0) ||
    decimal(evidence.quote.ask).lt(evidence.quote.bid) ||
    observed > now ||
    received > observed ||
    source > observed ||
    now - observed > 3000 ||
    observed - source > 3000 ||
    observed - received > 3000
  )
    throw new Error("SCENARIO_ENTRY_RETIREMENT_INVALID");
  if (decimal(evidence.buyStop).lt(decimal(evidence.quote.ask).plus(minimum)))
    expected.push("BUY_ENTRY_TOO_CLOSE");
  if (decimal(evidence.sellStop).gt(decimal(evidence.quote.bid).minus(minimum)))
    expected.push("SELL_ENTRY_TOO_CLOSE");
  if (
    expected.length === 0 ||
    JSON.stringify(expected) !== JSON.stringify(evidence.reasonCodes)
  )
    throw new Error("SCENARIO_ENTRY_RETIREMENT_INVALID");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      contextScopeLock(scope),
    ]);
    const context = await client.query(
      `SELECT id FROM scenario_contexts WHERE id=$1 AND account_id=$2 AND symbol_id=$3 AND mode=$4
      AND state='READY' AND requested_model=$5 AND available_at<=$6::timestamptz AND captured_at<=$6::timestamptz
      AND valid_until>$6::timestamptz AND plan->>'schema_version'='entry-pair-1.0'
      AND (plan->>'buy_stop')::numeric=$7::numeric AND (plan->>'sell_stop')::numeric=$8::numeric
      AND tick_size::numeric=$9::numeric FOR UPDATE`,
      [
        id,
        scope.accountId,
        scope.symbolId,
        scope.mode,
        FIXED_DEFAULTS.AI_MODEL,
        evidence.observedAt,
        evidence.buyStop,
        evidence.sellStop,
        evidence.tickSize,
      ],
    );
    if (context.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    const result = await client.query(
      `INSERT INTO context_entry_retirements(context_id,evidence)
      SELECT $1,$2::jsonb WHERE NOT EXISTS(SELECT 1 FROM order_groups WHERE context_plan_id=$1)
      ON CONFLICT(context_id) DO NOTHING`,
      [id, JSON.stringify(evidence)],
    );
    const exists =
      result.rowCount === 1 ||
      (
        await client.query(
          "SELECT 1 FROM context_entry_retirements WHERE context_id=$1",
          [id],
        )
      ).rowCount === 1;
    await client.query("COMMIT");
    return exists;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A replacement cannot parent another replacement. Unknown earlier calls still block. */
export const entryReplacementProof = `
  c.state='READY' AND c.requested_model=$8 AND c.plan->>'schema_version'='entry-pair-1.0'
  AND c.refresh_after_entry_context_id IS NULL AND c.available_at<=clock_timestamp()
  AND c.requested_at>clock_timestamp()-interval '5 minutes'
  AND EXISTS(SELECT 1 FROM context_entry_retirements r WHERE r.context_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM order_groups g WHERE g.context_plan_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM scenario_contexts x WHERE x.refresh_after_entry_context_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM scenario_contexts x WHERE x.account_id=c.account_id AND x.symbol_id=c.symbol_id AND x.mode=c.mode AND x.requested_at>c.requested_at)
  AND NOT EXISTS(SELECT 1 FROM scenario_contexts x WHERE x.account_id=c.account_id AND x.symbol_id=c.symbol_id AND x.mode=c.mode
    AND x.requested_at>clock_timestamp()-interval '5 minutes' AND x.state<>'READY'
    AND NOT(x.state='FAILED' AND x.reason IS NOT DISTINCT FROM 'AI_CIRCUIT_OPEN'))`;
