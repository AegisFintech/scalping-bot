import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { DemoExecutionHistoryClient } from "./demo-execution-recovery.js";
import {
  proveTerminalGroup,
  terminalSnapshotHash,
  type TerminalGroupSnapshot,
  type TerminalHistoryEvidence,
} from "./terminal-group-proof.js";

export async function readTerminalGroup(
  client: Pick<pg.PoolClient, "query">,
  groupId: string,
  includeVariantTable = true,
): Promise<TerminalGroupSnapshot> {
  const result = await client.query<{ snapshot: TerminalGroupSnapshot }>(
    `SELECT jsonb_build_object(
      'group', jsonb_build_object('id',og.id,'accountId',ar.account_id,'symbolId',ar.symbol_id,'mode',og.mode,'state',og.state),
      'orders', COALESCE((SELECT jsonb_agg(x.data ORDER BY x.id) FROM (
        SELECT id, jsonb_build_object('id',id,'accountId',account_id,'clientId',client_order_id,'brokerId',broker_order_id,
          'side',side,'state',state,'owned',strategy_owned,'volume',normalized_volume::text,'filled',filled_volume::text,'updatedAt',broker_updated_at) AS data
        FROM orders WHERE order_group_id=og.id ORDER BY id LIMIT 3) x),'[]'::jsonb),
      'positions', COALESCE((SELECT jsonb_agg(x.data ORDER BY x.id) FROM (
        SELECT id, jsonb_build_object('id',id,'accountId',account_id,'symbolId',symbol_id,'brokerId',broker_position_id,
          'side',side,'state',state,'owned',strategy_owned,'entryPrice',entry_price::text,'openedAt',opened_at,'closedAt',closed_at) AS data
        FROM positions WHERE order_group_id=og.id ORDER BY id LIMIT 3) x),'[]'::jsonb),
      'fills', COALESCE((SELECT jsonb_agg(x.data ORDER BY x.id) FROM (
        SELECT f.id, jsonb_build_object('id',f.id,'orderId',f.order_id,'positionId',f.position_id,'brokerId',f.broker_fill_id,
          'price',f.price::text,'volume',f.volume::text,'commission',f.commission::text,'occurredAt',f.occurred_at) AS data
        FROM fills f WHERE f.position_id IN (SELECT id FROM positions WHERE order_group_id=og.id)
          OR f.order_id IN (SELECT id FROM orders WHERE order_group_id=og.id) ORDER BY f.id LIMIT 17) x),'[]'::jsonb),
      'trades', COALESCE((SELECT jsonb_agg(x.data ORDER BY x.id) FROM (
        SELECT id, jsonb_build_object('positionId',position_id,'mode',mode,'direction',direction,'pnl',realized_pnl::text,
          'fees',fees::text,'openedAt',opened_at,'closedAt',closed_at) AS data
        FROM trades WHERE order_group_id=og.id ORDER BY id LIMIT 3) x),'[]'::jsonb),
      'events', COALESCE((SELECT jsonb_agg(x.data ORDER BY x.id) FROM (
        SELECT id, jsonb_build_object('id',id,'accountId',account_id,'symbolId',symbol_id,'positionId',position_id,
          'mapping',mapping_state,'reasons',reason_codes,'resolved',resolved_at IS NOT NULL,'payload',normalized_payload) AS data
        FROM broker_execution_events WHERE order_group_id=og.id ORDER BY id LIMIT 129) x),'[]'::jsonb),
      'variants', ${
        includeVariantTable
          ? `COALESCE((SELECT jsonb_agg(x.data ORDER BY x.id) FROM (
        SELECT v.id, jsonb_build_object('id',v.id,'eventId',v.event_id,'payload',v.normalized_payload,'source',v.evidence_source,
          'originalMappingState',v.original_mapping_state,'originalReasonCodes',v.original_reason_codes) AS data
        FROM broker_execution_event_variants v JOIN broker_execution_events e ON e.id=v.event_id
        WHERE e.order_group_id=og.id ORDER BY v.id LIMIT 65) x),'[]'::jsonb)`
          : `'[]'::jsonb`
      }
    ) AS snapshot FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id WHERE og.id=$1`,
    [groupId],
  );
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot) throw new Error("DEMO_TERMINAL_GROUP_MISSING");
  return snapshot;
}

export class TerminalHistoryAttestor {
  constructor(
    private readonly options: {
      readonly pool: pg.Pool;
      readonly accountId: string;
      readonly symbolId: string;
      readonly brokerSymbol: string;
      readonly client: DemoExecutionHistoryClient;
      readonly now?: () => Date;
    },
  ) {}

  /** One durably claimed bounded group per pass. No orders or synthetic callbacks. */
  async run(): Promise<void> {
    const now = this.options.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime()))
      throw new Error("DEMO_TERMINAL_HISTORY_CLOCK_INVALID");
    const db = await this.options.pool.connect();
    let claim: {
      id: string;
      groupId: string;
      snapshot: TerminalGroupSnapshot;
      snapshotHash: string;
    } | null = null;
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='5s'");
      await db.query("SET LOCAL statement_timeout='15s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${this.options.accountId}:${this.options.symbolId}:history-attestation`,
      ]);
      const candidates = await db.query<{ id: string }>(
        `SELECT DISTINCT og.id, (SELECT max(a.claimed_at) FROM broker_terminal_history_attempts a WHERE a.order_group_id=og.id) AS last_attempt FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id
         JOIN broker_execution_events e ON e.order_group_id=og.id
         WHERE ar.account_id=$1 AND ar.symbol_id=$2 AND og.mode='demo' AND og.state='CLOSED'
           AND e.account_id=$1 AND e.symbol_id=$2 AND e.mapping_state='CONFLICT' AND e.resolved_at IS NULL
           AND e.reason_codes='["DEMO_BROKER_EVENT_KEY_CONFLICT"]'::jsonb
           AND e.closing_order=true AND e.execution_type=3 AND e.broker_order_type=4
           AND NOT EXISTS (SELECT 1 FROM broker_terminal_history_attempts a WHERE a.order_group_id=og.id
             AND a.status IN ('VERIFIED','REJECTED') AND a.variant_ids=ARRAY(
               SELECT v.id FROM broker_execution_event_variants v JOIN broker_execution_events ve ON ve.id=v.event_id
               WHERE ve.order_group_id=og.id ORDER BY v.id))
           AND NOT EXISTS (SELECT 1 FROM broker_terminal_history_attempts a WHERE a.order_group_id=og.id
             AND a.claimed_at > $3::timestamptz - interval '5 minutes')
           AND (SELECT count(*) FROM broker_terminal_history_attempts a WHERE a.order_group_id=og.id
             AND a.claimed_at > $3::timestamptz - interval '24 hours') < 3
         ORDER BY last_attempt NULLS FIRST, og.id LIMIT 8`,
        [this.options.accountId, this.options.symbolId, now],
      );
      for (const candidate of candidates.rows) {
        const snapshot = await readTerminalGroup(db, candidate.id);
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 4_000_000)
          throw new Error("DEMO_TERMINAL_SNAPSHOT_OVERSIZED");
        const snapshotHash = terminalSnapshotHash(snapshot);
        const existing = await db.query(
          `SELECT 1 FROM broker_terminal_history_attempts WHERE order_group_id=$1 AND snapshot_hash=$2
           AND status IN ('VERIFIED','REJECTED') LIMIT 1`,
          [candidate.id, snapshotHash],
        );
        if (existing.rows.length) continue;
        const id = randomUUID();
        await db.query(
          `INSERT INTO broker_terminal_history_attempts
           (id,order_group_id,account_id,symbol_id,snapshot_hash,local_snapshot,status,claimed_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,'CLAIMED',$7)`,
          [
            id,
            candidate.id,
            this.options.accountId,
            this.options.symbolId,
            snapshotHash,
            JSON.stringify(snapshot),
            now,
          ],
        );
        claim = { id, groupId: candidate.id, snapshot, snapshotHash };
        break;
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    if (claim === null) return;
    let status = "FAILED";
    let reason: string | null = "DEMO_TERMINAL_HISTORY_FETCH_FAILED";
    let history: TerminalHistoryEvidence | null = null;
    let eventHashes: Readonly<Record<string, string>> = {};
    let evidenceHash: string | null = null;
    try {
      const times = claim.snapshot.events.map((e) =>
        Date.parse(e.payload.occurredAt),
      );
      const earliest = Math.min(...times);
      if (
        !Number.isFinite(earliest) ||
        earliest > now.getTime() ||
        now.getTime() - earliest > 7 * 86_400_000
      ) {
        status = "REJECTED";
        reason = "DEMO_TERMINAL_HISTORY_WINDOW_INVALID";
      } else {
        // Broker requests are serial; the transport owns its existing deadlines.
        const from = new Date(Math.max(0, earliest - 300_000));
        const orders = await this.options.client.orderHistoryRaw(from, now);
        const deals = await this.options.client.dealHistoryRaw(from, now, 1000);
        const reconciliation = await this.options.client.reconcileRaw();
        history = { orders, deals, reconciliation };
        if (Buffer.byteLength(JSON.stringify(history)) > 4_000_000) {
          history = null;
          reason = "DEMO_TERMINAL_HISTORY_OVERSIZED";
        } else {
          const proof = proveTerminalGroup(
            claim.snapshot,
            history,
            this.options.brokerSymbol,
            this.options.now?.() ?? new Date(),
          );
          reason = proof.reason;
          eventHashes = proof.eventHashes;
          evidenceHash = proof.evidenceHash;
          status =
            reason === null
              ? "VERIFIED"
              : [
                    "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED",
                    "DEMO_TERMINAL_VARIANT_FACT_CONFLICT",
                    "DEMO_TERMINAL_ADDITIONAL_UNCERTAINTY",
                  ].includes(reason)
                ? "REJECTED"
                : "FAILED";
        }
      }
    } catch {
      /* Retain a safe failed attempt; never expose raw broker errors. */
    }
    const finish = await this.options.pool.connect();
    try {
      await finish.query("BEGIN");
      await finish.query("SET LOCAL lock_timeout='5s'");
      await finish.query("SET LOCAL statement_timeout='15s'");
      await finish.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [
          `${this.options.accountId}:${this.options.symbolId}:terminal-evidence`,
        ],
      );
      // Lock all current event rows before the final snapshot, against concurrent
      // conflict persistence. A new variant invalidates this attempt instead.
      await finish.query(
        "SELECT id FROM broker_execution_events WHERE order_group_id=$1 ORDER BY id FOR UPDATE",
        [claim.groupId],
      );
      const current = await readTerminalGroup(finish, claim.groupId);
      if (terminalSnapshotHash(current) !== claim.snapshotHash) {
        status = "FAILED";
        reason = "DEMO_TERMINAL_HISTORY_SOURCE_CHANGED";
        eventHashes = {};
        evidenceHash = null;
      }
      await finish.query(
        `UPDATE broker_terminal_history_attempts SET status=$2,reason_code=$3,history_evidence=$4::jsonb,
          evidence_hash=$5,event_hashes=$6::jsonb,variant_ids=$7::uuid[],completed_at=$8
         WHERE id=$1 AND status='CLAIMED'`,
        [
          claim.id,
          status,
          reason,
          history === null ? null : JSON.stringify(history),
          evidenceHash,
          JSON.stringify(eventHashes),
          current.variants.map((v) => v.id),
          this.options.now?.() ?? new Date(),
        ],
      );
      await finish.query("COMMIT");
    } catch (error) {
      await finish.query("ROLLBACK");
      throw error;
    } finally {
      finish.release();
    }
  }
}
