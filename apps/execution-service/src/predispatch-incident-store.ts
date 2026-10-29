import { createHash } from "node:crypto";
import type pg from "pg";
import { ModelResponseValidator } from "../../../packages/risk-engine/src/model-validator.js";
import { assertPredispatchIncidentEvidence } from "./predispatch-incident-proof.js";

const brokerSummaryValidator = new ModelResponseValidator(
  "schemas/predispatch-broker-observation-1.0.json",
);

interface Receipt {
  evidence: string;
  capturedAt: string;
  processStartedAt: string;
  processRestarts: number;
  gatewaySha256: string;
  brokerMutation: boolean;
  rows: Array<{ created_at: string; rejected_at: string; expires_at: string }>;
}
interface ActivationReceipt {
  at: string;
  commit: string;
  sourceSha256: string;
  servicesOnline: number;
  workerMatched: boolean;
  flightMatched: boolean;
  pauseRestored: boolean;
  oldRecordsPreserved: boolean;
  protectedFilesUnchanged: boolean;
  forcedBrokerCommands: number;
  forcedProviderCalls: number;
}
export interface BrokerObservation {
  from: string;
  until: string;
  observedAt: string;
  orders: number;
  deals: number;
  ordersHasMore: boolean;
  dealsHasMore: boolean;
  openOrders: number;
  openPositions: number;
  digest: string;
  accountBound: boolean;
  anchorDigest: string;
  anchorEventId: string;
}
interface IncidentRow {
  group_id: string;
  order_id: string;
  analysis_id: string;
  created_at: Date;
  expires_at: Date;
  rejected_at: Date;
  group_state: string;
  order_state: string;
  cancellation_reason: string;
  side: string;
  time_in_force: string;
  execution_type: string;
  filled_volume: string;
  broker_order_id: string | null;
  submitted_at: Date | null;
  analysis_state: string;
  strategy: string;
  symbol: string;
  mode: string;
  intent_count: number;
  all_intents: number;
  all_rejections: number;
  rejection_count: number;
  order_count: number;
  active_groups: number;
  fills: number;
  positions: number;
  trades: number;
  events: number;
  variants: number;
  proofs: number;
  other_unresolved: number;
  intent_id: string;
  rejection_id: string;
  inflight: number;
}

/** Internal administrative operation; the caller must supply an independently read broker snapshot. */
export async function recoverPredispatchIncident(options: {
  pool: pg.Pool;
  accountId: string;
  symbolId: string;
  scope: string;
  pauseActor: string;
  receiptBytes: Buffer;
  activationBytes: Buffer;
  executionStopped: () => boolean | Promise<boolean>;
  observeBroker: () => BrokerObservation | Promise<BrokerObservation>;
}): Promise<void> {
  const receiptHash = createHash("sha256")
    .update(options.receiptBytes)
    .digest("hex");
  const activationHash = createHash("sha256")
    .update(options.activationBytes)
    .digest("hex");
  const activation = JSON.parse(
    options.activationBytes.toString("utf8"),
  ) as ActivationReceipt;
  const receipt = JSON.parse(options.receiptBytes.toString("utf8")) as Receipt;
  if (
    receipt.evidence !== "READ_ONLY_INCIDENT_OBSERVATION_V1" ||
    receipt.brokerMutation !== false ||
    receipt.rows.length !== 1
  )
    throw new Error("PREDISPATCH_INCIDENT_RECEIPT_INVALID");
  const client = await options.pool.connect();
  let commitAttempted = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='20s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='45s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      JSON.stringify([options.accountId, options.symbolId, "demo"]),
    ]);
    const result = await client.query<IncidentRow>(
      `
      SELECT g.id group_id,o.id order_id,ar.id analysis_id,g.created_at,g.expires_at,
        g.state group_state,o.state order_state,g.cancellation_reason,o.side,g.time_in_force,
        o.execution_order_type execution_type,o.filled_volume::text,o.broker_order_id,o.submitted_at,
        ar.state analysis_state,sv.version strategy,s.name symbol,g.mode,
        (SELECT count(*)::int FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='risk_intent_persisted' AND x.outcome='accepted' AND jsonb_array_length(x.details->'commands')=1 AND x.details->'commands'->0->>'execution_order_type'='STOP_LIMIT' AND x.details->'commands'->0->>'time_in_force'='GTD' AND x.details->'commands'->0->>'side'='BUY' AND x.occurred_at='2026-10-28T23:16:11.370947Z'::timestamptz
          AND (x.details->'commands'->0->>'entry_price')::numeric=o.entry_price
          AND (x.details->'commands'->0->>'stop_loss')::numeric=o.stop_loss
          AND (x.details->'commands'->0->>'take_profit')::numeric=o.take_profit
          AND (x.details->'commands'->0->>'normalized_volume')::numeric=o.normalized_volume
          AND (x.details->'commands'->0->>'expires_at')::timestamptz=g.expires_at
          AND (x.details->'commands'->0->>'submission_valid_until')::timestamptz=g.submission_valid_until) intent_count,
        (SELECT min(x.id::text) FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='risk_intent_persisted' AND x.outcome='accepted' AND jsonb_array_length(x.details->'commands')=1 AND x.details->'commands'->0->>'execution_order_type'='STOP_LIMIT' AND x.details->'commands'->0->>'time_in_force'='GTD' AND x.details->'commands'->0->>'side'='BUY' AND x.occurred_at='2026-10-28T23:16:11.370947Z'::timestamptz
          AND (x.details->'commands'->0->>'entry_price')::numeric=o.entry_price
          AND (x.details->'commands'->0->>'stop_loss')::numeric=o.stop_loss
          AND (x.details->'commands'->0->>'take_profit')::numeric=o.take_profit
          AND (x.details->'commands'->0->>'normalized_volume')::numeric=o.normalized_volume
          AND (x.details->'commands'->0->>'expires_at')::timestamptz=g.expires_at
          AND (x.details->'commands'->0->>'submission_valid_until')::timestamptz=g.submission_valid_until) intent_id,
        (SELECT count(*)::int FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='risk_intent_persisted') all_intents,
        (SELECT count(*)::int FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='analysis_transition' AND x.outcome='rejected') all_rejections,
        (SELECT count(*)::int FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='analysis_transition' AND x.outcome='rejected' AND x.reason_code='DEMO_DIRECTIONAL_COMMAND_INVALID' AND x.occurred_at='2026-10-28T23:16:11.375624Z'::timestamptz) rejection_count,
        (SELECT min(x.id::text) FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='analysis_transition' AND x.outcome='rejected' AND x.reason_code='DEMO_DIRECTIONAL_COMMAND_INVALID' AND x.occurred_at='2026-10-28T23:16:11.375624Z'::timestamptz) rejection_id,
        (SELECT min(x.occurred_at) FROM audit_events x WHERE x.analysis_id=ar.id AND x.event_name='analysis_transition' AND x.outcome='rejected' AND x.reason_code='DEMO_DIRECTIONAL_COMMAND_INVALID' AND x.occurred_at='2026-10-28T23:16:11.375624Z'::timestamptz) rejected_at,
        (SELECT count(*)::int FROM orders z WHERE z.order_group_id=g.id) order_count,
        (SELECT count(*)::int FROM order_groups z JOIN analysis_runs za ON za.id=z.analysis_id WHERE za.account_id=$1 AND za.symbol_id=$2 AND z.mode='demo' AND z.state NOT IN ('CLOSED','EXPIRED','FAILED')) active_groups,
        (SELECT count(*)::int FROM fills z WHERE z.order_id=o.id) fills,
        (SELECT count(*)::int FROM positions z WHERE z.order_group_id=g.id) positions,
        (SELECT count(*)::int FROM trades z WHERE z.order_group_id=g.id) trades,
        (SELECT count(*)::int FROM broker_execution_events z WHERE z.order_group_id=g.id OR z.order_id=o.id OR z.client_order_id=o.client_order_id) events,
        (SELECT count(*)::int FROM broker_execution_event_variants z WHERE z.normalized_payload->>'clientOrderId'=o.client_order_id OR z.normalized_payload->'order'->>'clientOrderId'=o.client_order_id) variants,
        (SELECT count(*)::int FROM local_unsent_entry_proofs z WHERE z.order_id=o.id) proofs,
        (SELECT count(*)::int FROM broker_execution_events z WHERE z.account_id=$1 AND z.symbol_id=$2 AND z.resolved_at IS NULL AND (z.mapping_state<>'MAPPED' OR jsonb_array_length(z.reason_codes)>0)) other_unresolved,
        (SELECT count(*)::int FROM scenario_contexts z WHERE z.account_id=$1 AND z.symbol_id=$2 AND z.mode='demo' AND z.state='REQUESTING') inflight
      FROM order_groups g JOIN orders o ON o.order_group_id=g.id JOIN analysis_runs ar ON ar.id=g.analysis_id
      JOIN strategy_versions sv ON sv.id=ar.strategy_version_id JOIN symbols s ON s.id=ar.symbol_id AND s.account_id=ar.account_id
      JOIN accounts ac ON ac.id=ar.account_id AND ac.provider='ctrader' AND ac.environment='demo' AND ac.account_type='demo'
      WHERE ar.account_id=$1 AND ar.symbol_id=$2 AND o.account_id=$1 AND o.strategy_owned
        AND g.mode='demo' AND g.state='RECONCILIATION_REQUIRED' AND g.entry_side='BUY' AND g.execution_mode='SINGLE_STOP_LIMIT' AND o.time_in_force='GTD'
        AND g.created_at='2026-10-28T23:16:11.329147Z'::timestamptz AND o.expires_at=g.expires_at
      FOR UPDATE OF g,o`,
      [options.accountId, options.symbolId],
    );
    if (result.rowCount !== 1)
      throw new Error("PREDISPATCH_INCIDENT_SCOPE_AMBIGUOUS");
    const row = result.rows[0]!;
    const isPaused = async () =>
      (
        await client.query(
          "SELECT 1 FROM runtime_controls WHERE control_key='PAUSE_NEW_ANALYSES' AND scope=$1 AND enabled AND actor=$2 AND revoked_at IS NULL FOR SHARE",
          [options.scope, options.pauseActor],
        )
      ).rowCount === 1;
    if (
      row.all_intents !== 1 ||
      row.all_rejections !== 1 ||
      receipt.rows[0]!.created_at !== row.created_at.toISOString() ||
      receipt.rows[0]!.rejected_at !== row.rejected_at?.toISOString() ||
      receipt.rows[0]!.expires_at !== row.expires_at?.toISOString()
    )
      throw new Error("PREDISPATCH_INCIDENT_RECEIPT_INVALID");
    const check = async (broker: BrokerObservation) => {
      if (
        !/^[a-f0-9]{64}$/.test(broker.digest) ||
        !/^[a-f0-9]{64}$/.test(broker.anchorDigest)
      )
        throw new Error("PREDISPATCH_INCIDENT_BROKER_INVALID");
      const brokerObserved = Date.parse(broker.observedAt);
      const current = Date.now();
      if (
        !Number.isFinite(brokerObserved) ||
        brokerObserved > current ||
        current - brokerObserved > 15_000
      )
        throw new Error("PREDISPATCH_INCIDENT_BROKER_STALE");
      assertPredispatchIncidentEvidence({
        executionStopped: await options.executionStopped(),
        analysisPaused: await isPaused(),
        inflightRequests: row.inflight,
        mode: row.mode,
        symbol: row.symbol,
        strategy: row.strategy,
        analysisState: row.analysis_state,
        activeGroups: row.active_groups,
        cancellationReason: row.cancellation_reason,
        executionType: row.execution_type,
        zeroFilled: Number(row.filled_volume) === 0,
        receiptSha256: receiptHash,
        activationSha256: activationHash,
        activationAt: activation.at,
        activationCommit: activation.commit,
        activationSource: activation.sourceSha256,
        activationVerified:
          activation.servicesOnline === 5 &&
          activation.workerMatched === true &&
          activation.flightMatched === true &&
          activation.pauseRestored === true &&
          activation.oldRecordsPreserved === true &&
          activation.protectedFilesUnchanged === true &&
          activation.forcedBrokerCommands === 0 &&
          activation.forcedProviderCalls === 0,
        gatewaySha256: receipt.gatewaySha256,
        processStartedAt: receipt.processStartedAt,
        processRestarts: receipt.processRestarts,
        receiptCapturedAt: receipt.capturedAt,
        createdAt: row.created_at.toISOString(),
        rejectedAt: row.rejected_at.toISOString(),
        intentAudits: row.intent_count,
        rejectionAudits: row.rejection_count,
        orderCount: row.order_count,
        groupState: row.group_state,
        orderState: row.order_state,
        side: row.side,
        timeInForce: row.time_in_force,
        submitted: row.submitted_at !== null,
        brokerId: row.broker_order_id !== null,
        fills: row.fills,
        positions: row.positions,
        trades: row.trades,
        brokerEvents: row.events,
        eventVariants: row.variants,
        localProofs: row.proofs,
        otherUnresolvedEvents: row.other_unresolved,
        historyFrom: broker.from,
        historyUntil: broker.until,
        observedAt: broker.observedAt,
        historyOrders: broker.orders,
        historyDeals: broker.deals,
        historyOrdersHasMore: broker.ordersHasMore,
        historyDealsHasMore: broker.dealsHasMore,
        openOrders: broker.openOrders,
        openPositions: broker.openPositions,
        brokerAccountBound: broker.accountBound,
      });
    };
    const firstBroker = await options.observeBroker();
    await check(firstBroker);
    const broker = await options.observeBroker();
    await check(broker);
    if (
      broker.anchorEventId !== firstBroker.anchorEventId ||
      broker.anchorDigest !== firstBroker.anchorDigest
    )
      throw new Error("PREDISPATCH_BROKER_ANCHOR_CHANGED");
    const anchor = await client.query(
      `SELECT 1 FROM broker_execution_events e JOIN orders o ON o.id=e.order_id
       JOIN order_groups g ON g.id=o.order_group_id JOIN analysis_runs a ON a.id=g.analysis_id
       WHERE e.id=$1 AND e.account_id=$2 AND e.symbol_id=$3 AND a.account_id=$2 AND a.symbol_id=$3
         AND o.account_id=$2 AND o.strategy_owned AND g.mode='demo' AND e.mapping_state='MAPPED'
         AND e.execution_type=2 AND jsonb_array_length(e.reason_codes)=0
         AND e.broker_order_id=o.broker_order_id AND e.client_order_id=o.client_order_id
         AND e.occurred_at<'2026-10-28T23:16:11.329147Z'::timestamptz
       FOR SHARE OF e,o`,
      [broker.anchorEventId, options.accountId, options.symbolId],
    );
    if (anchor.rowCount !== 1)
      throw new Error("PREDISPATCH_BROKER_ANCHOR_INVALID");
    const brokerSummary = JSON.stringify({
      orders: broker.orders,
      deals: broker.deals,
      ordersHasMore: broker.ordersHasMore,
      dealsHasMore: broker.dealsHasMore,
      openOrders: broker.openOrders,
      openPositions: broker.openPositions,
      brokerAccountBound: broker.accountBound,
      observedAt: broker.observedAt,
    });
    if (!brokerSummaryValidator.parse(brokerSummary).accepted)
      throw new Error("PREDISPATCH_INCIDENT_BROKER_INVALID");
    await client.query(
      `INSERT INTO predispatch_recovery_evidence
      (order_id,order_group_id,analysis_id,account_id,symbol_id,rejection_audit_id,intent_audit_id,anchor_event_id,
       source_receipt_sha256,activation_receipt_sha256,broker_evidence_sha256,broker_anchor_sha256,broker_evidence,broker_from,broker_until,prior_order_state,prior_group_state,prior_cancellation_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)`,
      [
        row.order_id,
        row.group_id,
        row.analysis_id,
        options.accountId,
        options.symbolId,
        row.rejection_id,
        row.intent_id,
        broker.anchorEventId,
        receiptHash,
        activationHash,
        broker.digest,
        broker.anchorDigest,
        brokerSummary,
        broker.from,
        broker.until,
        row.order_state,
        row.group_state,
        row.cancellation_reason,
      ],
    );
    const order = await client.query(
      "UPDATE orders SET state='REJECTED',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CANCEL_PENDING' AND broker_order_id IS NULL AND submitted_at IS NULL AND filled_volume=0",
      [row.order_id],
    );
    const group = await client.query(
      "UPDATE order_groups SET state='FAILED',cancellation_reason='LOCAL_PRE_DISPATCH_REJECTION',updated_at=clock_timestamp() WHERE id=$1 AND state='RECONCILIATION_REQUIRED'",
      [row.group_id],
    );
    if (order.rowCount !== 1 || group.rowCount !== 1)
      throw new Error("PREDISPATCH_INCIDENT_STATE_CHANGED");
    commitAttempted = true;
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A failed rollback cannot prove whether a commit reached PostgreSQL.
    }
    if (commitAttempted)
      throw new Error("PREDISPATCH_COMMIT_OUTCOME_UNKNOWN", { cause: error });
    throw error;
  } finally {
    client.release();
  }
}
