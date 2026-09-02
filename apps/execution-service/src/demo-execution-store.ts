import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import type pg from "pg";

import type {
  DemoExecutionEvent,
  DemoExecutionPersistenceResult,
  DemoExecutionStore,
  DemoTerminalEvidenceReconciliationResult,
} from "./demo-execution.js";
import type { GatewayOrder } from "../../../packages/contracts/src/index.js";

export interface PostgresDemoExecutionStoreOptions {
  readonly pool: pg.Pool;
  readonly accountId: string;
  readonly symbolId: string;
}

interface OrderMatch {
  readonly order_id: string;
  readonly order_group_id: string;
  readonly broker_order_id: string | null;
}

interface PositionMatch {
  readonly position_id: string;
  readonly order_group_id: string | null;
}

export function demoExecutionReasonCodes(event: DemoExecutionEvent): string[] {
  const reasons: string[] = [];
  if (
    event.executionType === 2 &&
    event.brokerOrderType === 4 &&
    event.closingOrder &&
    event.fill === null
  ) {
    reasons.push("DEMO_CLOSING_ORDER_AWAITING_DEAL");
  }
  if (event.executionType === 4)
    reasons.push("DEMO_ORDER_REPLACED_RECONCILIATION_REQUIRED");
  if (event.executionType === 8) reasons.push("DEMO_CANCEL_REJECTED");
  if (event.order?.state === "PARTIALLY_FILLED")
    reasons.push("DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED");
  if (event.order?.state === "UNKNOWN" || event.position?.state === "UNKNOWN")
    reasons.push("DEMO_EXECUTION_STATE_UNKNOWN");
  if (event.position?.state === "RECONCILIATION_PENDING")
    reasons.push("DEMO_POSITION_CREATED_RECONCILIATION_REQUIRED");
  if (event.position?.state === "CLOSED" && event.closeDetail === null)
    reasons.push("DEMO_TRADE_OUTCOME_MISSING");
  if (
    event.position?.state === "CLOSED" &&
    event.closeDetail?.closedVolume === null
  )
    reasons.push("DEMO_TRADE_CLOSED_VOLUME_MISSING");
  if (event.closeDetail !== null && event.position?.state !== "CLOSED")
    reasons.push("DEMO_PARTIAL_CLOSE_RECONCILIATION_REQUIRED");
  return reasons;
}

export class PostgresDemoExecutionStore implements DemoExecutionStore {
  readonly #options: PostgresDemoExecutionStoreOptions;

  constructor(options: PostgresDemoExecutionStoreOptions) {
    this.#options = options;
  }

  async readiness(): Promise<DemoExecutionPersistenceResult> {
    const result = await this.#options.pool.query<{
      mapping_state: "MAPPED" | "UNMATCHED" | "CONFLICT";
      reason_codes: unknown;
    }>(
      `SELECT mapping_state, reason_codes
       FROM broker_execution_events
       WHERE account_id = $1 AND symbol_id = $2
         AND resolved_at IS NULL
         AND (
           mapping_state <> 'MAPPED'
           OR jsonb_array_length(reason_codes) > 0
         )
       ORDER BY occurred_at, id`,
      [this.#options.accountId, this.#options.symbolId],
    );
    const reasons = new Set<string>();
    for (const row of result.rows) {
      let rowHasReason = false;
      if (Array.isArray(row.reason_codes)) {
        for (const reason of row.reason_codes) {
          if (typeof reason === "string") {
            reasons.add(reason);
            rowHasReason = true;
          }
        }
      }
      if (row.mapping_state !== "MAPPED" && !rowHasReason)
        reasons.add(`DEMO_EXECUTION_${row.mapping_state}`);
    }
    return {
      certain: result.rows.length === 0,
      reasonCodes: [...reasons].sort(),
    };
  }

  async reconcileTerminalEvidence(): Promise<DemoTerminalEvidenceReconciliationResult> {
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          `${this.#options.accountId}:${this.#options.symbolId}:terminal-evidence`,
        ],
      );
      const result = await client.query<{
        resolved_event_count: string;
        terminal_proof_hash: string | null;
        terminal_order_group_id: string | null;
        terminal_broker_fill_id: string | null;
      }>(
        `WITH terminal_proofs AS MATERIALIZED (
           SELECT DISTINCT ON (terminal.order_group_id)
                  terminal.order_group_id,
                  terminal.broker_event_key,
                  terminal.payload_hash,
                  terminal.broker_fill_id,
                  terminal.occurred_at
           FROM broker_execution_events terminal
           JOIN order_groups og ON og.id = terminal.order_group_id
           JOIN analysis_runs ar ON ar.id = og.analysis_id
           JOIN positions p ON p.id = terminal.position_id
           JOIN trades t ON t.order_group_id = og.id AND t.position_id = p.id
           WHERE terminal.account_id = $1 AND terminal.symbol_id = $2
             AND ar.account_id = $1 AND ar.symbol_id = $2
             AND og.mode = 'demo' AND og.state = 'CLOSED'
             AND terminal.mapping_state = 'MAPPED'
             AND jsonb_array_length(terminal.reason_codes) = 0
             AND terminal.execution_type IN (3, 11)
             AND terminal.broker_order_type = 4
             AND terminal.closing_order = true
             AND terminal.broker_fill_id IS NOT NULL
             AND terminal.normalized_payload -> 'fill' <> 'null'::jsonb
             AND terminal.normalized_payload -> 'closeDetail' <> 'null'::jsonb
             AND p.account_id = $1 AND p.symbol_id = $2
             AND p.state = 'CLOSED' AND p.strategy_owned = true
             AND p.closed_at = terminal.occurred_at
             AND EXISTS (
               SELECT 1 FROM fills terminal_fill
               WHERE terminal_fill.position_id = p.id
                 AND terminal_fill.broker_fill_id = terminal.broker_fill_id
                 AND terminal_fill.occurred_at = terminal.occurred_at
             )
             AND (SELECT count(*) FROM positions gp
                  WHERE gp.order_group_id = og.id) BETWEEN 1 AND 2
             AND (SELECT count(*) FROM orders goi
                  WHERE goi.order_group_id = og.id) = 2
             AND (SELECT count(*) FROM orders filled_order
                  WHERE filled_order.order_group_id = og.id
                    AND filled_order.state = 'FILLED') =
                 (SELECT count(*) FROM positions gp
                  WHERE gp.order_group_id = og.id)
             AND (SELECT count(*) FROM orders peer_order
                  WHERE peer_order.order_group_id = og.id
                    AND peer_order.state IN ('CANCELLED','EXPIRED','REJECTED')) =
                 2 - (SELECT count(*) FROM positions gp
                      WHERE gp.order_group_id = og.id)
             AND NOT EXISTS (
               SELECT 1 FROM orders active_order
               WHERE active_order.order_group_id = og.id
                 AND (active_order.strategy_owned = false OR active_order.state IN
                   ('INTENT','SUBMITTING','PENDING','PARTIALLY_FILLED',
                    'CANCEL_PENDING','UNKNOWN'))
             )
             AND NOT EXISTS (
               SELECT 1 FROM positions active_position
               WHERE active_position.order_group_id = og.id
                 AND (active_position.strategy_owned = false OR active_position.state <>
                   'CLOSED')
             )
             AND NOT EXISTS (
               SELECT 1 FROM positions terminal_position
               WHERE terminal_position.order_group_id = og.id
                 AND NOT EXISTS (
                   SELECT 1 FROM trades terminal_trade
                   WHERE terminal_trade.order_group_id = og.id
                     AND terminal_trade.position_id = terminal_position.id
                 )
             )
           ORDER BY terminal.order_group_id, terminal.occurred_at DESC,
                    terminal.id DESC
         ), resolved AS (
           UPDATE broker_execution_events blocked
           SET resolved_at = GREATEST(proof.occurred_at, blocked.occurred_at),
               resolution_event_key = proof.broker_event_key
           FROM terminal_proofs proof
           WHERE blocked.account_id = $1 AND blocked.symbol_id = $2
             AND blocked.order_group_id = proof.order_group_id
             AND blocked.mapping_state = 'CONFLICT'
             AND blocked.resolved_at IS NULL
             AND (
               (blocked.reason_codes =
                  '["DEMO_BROKER_EVENT_KEY_CONFLICT"]'::jsonb
                AND blocked.occurred_at <= proof.occurred_at)
               OR
               (blocked.reason_codes =
                  '["DEMO_TRADE_OUTCOME_CONFLICT"]'::jsonb
                AND blocked.position_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM positions recovered_position
                  JOIN trades recovered_trade
                    ON recovered_trade.order_group_id = blocked.order_group_id
                   AND recovered_trade.position_id = recovered_position.id
                  JOIN fills recovered_fill
                    ON recovered_fill.position_id = recovered_position.id
                   AND recovered_fill.broker_fill_id = blocked.broker_fill_id
                   AND recovered_fill.occurred_at = blocked.occurred_at
                  WHERE recovered_position.id = blocked.position_id
                    AND recovered_position.order_group_id = blocked.order_group_id
                    AND recovered_position.state = 'CLOSED'
                    AND recovered_position.closed_at = blocked.occurred_at
                    AND recovered_trade.closed_at = blocked.occurred_at
                ))
             )
           RETURNING blocked.id
         )
         SELECT (SELECT count(*)::text FROM resolved) AS resolved_event_count,
                (SELECT payload_hash FROM terminal_proofs
                 ORDER BY occurred_at DESC, order_group_id DESC LIMIT 1)
                   AS terminal_proof_hash,
                (SELECT order_group_id::text FROM terminal_proofs
                 ORDER BY occurred_at DESC, order_group_id DESC LIMIT 1)
                   AS terminal_order_group_id,
                (SELECT broker_fill_id FROM terminal_proofs
                 ORDER BY occurred_at DESC, order_group_id DESC LIMIT 1)
                   AS terminal_broker_fill_id`,
        [this.#options.accountId, this.#options.symbolId],
      );
      const resolvedText = result.rows[0]?.resolved_event_count;
      const terminalProofHash = result.rows[0]?.terminal_proof_hash ?? null;
      const terminalOrderGroupId =
        result.rows[0]?.terminal_order_group_id ?? null;
      const terminalBrokerFillId =
        result.rows[0]?.terminal_broker_fill_id ?? null;
      if (
        resolvedText === undefined ||
        !/^(?:0|[1-9][0-9]*)$/.test(resolvedText) ||
        (terminalProofHash !== null &&
          !/^[0-9a-f]{64}$/.test(terminalProofHash)) ||
        (terminalOrderGroupId !== null &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            terminalOrderGroupId,
          )) ||
        (terminalBrokerFillId !== null &&
          !/^[0-9]{1,32}$/.test(terminalBrokerFillId)) ||
        (terminalProofHash === null) !== (terminalOrderGroupId === null) ||
        (terminalProofHash === null) !== (terminalBrokerFillId === null)
      ) {
        throw new Error("DEMO_TERMINAL_EVIDENCE_RESULT_INVALID");
      }
      await client.query("COMMIT");
      const readiness = await this.readiness();
      return {
        ...readiness,
        terminalProofKey:
          terminalProofHash === null ? null : `terminal:${terminalProofHash}`,
        terminalOrderGroupId,
        terminalBrokerFillId,
        resolvedEventCount: Number(resolvedText),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async persist(
    event: DemoExecutionEvent,
  ): Promise<DemoExecutionPersistenceResult> {
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${this.#options.accountId}:${event.eventKey}`],
      );
      const existing = await client.query<{
        payload_hash: string;
        mapping_state: "MAPPED" | "UNMATCHED" | "CONFLICT";
        reason_codes: unknown;
        resolved_at: Date | null;
      }>(
        `SELECT payload_hash, mapping_state, reason_codes, resolved_at
         FROM broker_execution_events
         WHERE account_id = $1 AND broker_event_key = $2
         FOR UPDATE`,
        [this.#options.accountId, event.eventKey],
      );
      const duplicate = existing.rows[0];
      let replayTradeOutcomeConflict = false;
      if (duplicate !== undefined) {
        if (duplicate.payload_hash !== event.payloadHash) {
          await client.query(
            `UPDATE broker_execution_events
             SET mapping_state = 'CONFLICT',
                 reason_codes = '["DEMO_BROKER_EVENT_KEY_CONFLICT"]'::jsonb
             WHERE account_id = $1 AND broker_event_key = $2`,
            [this.#options.accountId, event.eventKey],
          );
          await client.query("COMMIT");
          return {
            certain: false,
            reasonCodes: ["DEMO_BROKER_EVENT_KEY_CONFLICT"],
          };
        }
        const reasonCodes = Array.isArray(duplicate.reason_codes)
          ? duplicate.reason_codes.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        replayTradeOutcomeConflict =
          duplicate.mapping_state === "CONFLICT" &&
          duplicate.resolved_at === null &&
          reasonCodes.length === 1 &&
          reasonCodes[0] === "DEMO_TRADE_OUTCOME_CONFLICT" &&
          event.position?.state === "CLOSED" &&
          event.closeDetail !== null &&
          event.fill !== null;
        if (replayTradeOutcomeConflict) {
          // Continue through the normal locked persistence path. The retained
          // conflict row is resolved only after exact position/fill/trade and
          // terminal group evidence agree; it is never deleted or overwritten.
        } else {
          await client.query("COMMIT");
          const unresolvedReasonCodes =
            duplicate.resolved_at === null ? reasonCodes : [];
          return {
            certain:
              duplicate.mapping_state === "MAPPED" &&
              unresolvedReasonCodes.length === 0,
            reasonCodes: unresolvedReasonCodes,
          };
        }
      }

      const orders = await client.query<OrderMatch>(
        `SELECT o.id AS order_id, o.order_group_id, o.broker_order_id
         FROM orders o
         JOIN order_groups og ON og.id = o.order_group_id
         JOIN analysis_runs ar ON ar.id = og.analysis_id
         WHERE o.account_id = $1 AND ar.symbol_id = $2
           AND (($3::text IS NOT NULL AND o.client_order_id = $3)
             OR ($4::text IS NOT NULL AND o.broker_order_id = $4))
         FOR UPDATE`,
        [
          this.#options.accountId,
          this.#options.symbolId,
          event.clientOrderId,
          event.brokerOrderId,
        ],
      );
      const uniqueOrderIds = new Set(orders.rows.map((row) => row.order_id));
      if (uniqueOrderIds.size > 1) {
        await this.#insertEvent(client, event, null, null, "CONFLICT", [
          "DEMO_EXECUTION_ORDER_AMBIGUOUS",
        ]);
        await client.query("COMMIT");
        return {
          certain: false,
          reasonCodes: ["DEMO_EXECUTION_ORDER_AMBIGUOUS"],
        };
      }
      let order = orders.rows[0] ?? null;
      const positions =
        event.brokerPositionId === null
          ? { rows: [] as PositionMatch[] }
          : await client.query<PositionMatch>(
              `SELECT id AS position_id, order_group_id
               FROM positions
               WHERE account_id = $1 AND symbol_id = $2
                 AND broker_position_id = $3
               FOR UPDATE`,
              [
                this.#options.accountId,
                this.#options.symbolId,
                event.brokerPositionId,
              ],
            );
      if (positions.rows.length > 1) {
        await this.#insertEvent(client, event, order, null, "CONFLICT", [
          "DEMO_EXECUTION_POSITION_AMBIGUOUS",
        ]);
        await client.query("COMMIT");
        return {
          certain: false,
          reasonCodes: ["DEMO_EXECUTION_POSITION_AMBIGUOUS"],
        };
      }
      let position = positions.rows[0] ?? null;
      const brokerGeneratedClosingOrder =
        event.brokerOrderType === 4 &&
        event.closingOrder &&
        event.brokerPositionId !== null &&
        position !== null;
      if (order !== null && brokerGeneratedClosingOrder) {
        if (position?.order_group_id !== order.order_group_id) {
          await this.#insertEvent(client, event, order, position, "CONFLICT", [
            "DEMO_EXECUTION_CLOSING_ORDER_GROUP_CONFLICT",
          ]);
          await client.query("COMMIT");
          return {
            certain: false,
            reasonCodes: ["DEMO_EXECUTION_CLOSING_ORDER_GROUP_CONFLICT"],
          };
        }
        // cTrader assigns a distinct broker order identity to its server-side
        // SL/TP close while it may retain the entry's clientOrderId. The child
        // is evidence for the position, never a mutation of the entry order.
        order = null;
      }
      if (
        order !== null &&
        order.broker_order_id !== null &&
        event.brokerOrderId !== null &&
        order.broker_order_id !== event.brokerOrderId
      ) {
        await this.#insertEvent(client, event, order, position, "CONFLICT", [
          "DEMO_EXECUTION_BROKER_ORDER_ID_CONFLICT",
        ]);
        await client.query("COMMIT");
        return {
          certain: false,
          reasonCodes: ["DEMO_EXECUTION_BROKER_ORDER_ID_CONFLICT"],
        };
      }
      const orderGroupId =
        order?.order_group_id ?? position?.order_group_id ?? null;
      if (orderGroupId === null) {
        await this.#insertEvent(client, event, null, position, "UNMATCHED", [
          "DEMO_EXECUTION_LOCAL_INTENT_NOT_FOUND",
        ]);
        await client.query("COMMIT");
        return {
          certain: false,
          reasonCodes: ["DEMO_EXECUTION_LOCAL_INTENT_NOT_FOUND"],
        };
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`demo-order-group:${orderGroupId}`],
      );
      if (event.position?.state === "CLOSED" && event.closeDetail !== null) {
        const existingTrade = await client.query(
          "SELECT 1 FROM trades WHERE position_id = $1",
          [position?.position_id ?? null],
        );
        if ((existingTrade.rowCount ?? 0) > 0) {
          await this.#insertEvent(client, event, order, position, "CONFLICT", [
            "DEMO_TRADE_OUTCOME_CONFLICT",
          ]);
          await client.query("COMMIT");
          return {
            certain: false,
            reasonCodes: ["DEMO_TRADE_OUTCOME_CONFLICT"],
          };
        }
      }

      let storedOrderState: GatewayOrder["state"] | null = null;
      const tradeReasonCodes: string[] = [];
      if (event.order !== null && order !== null) {
        const updatedOrder = await client.query<{
          state: GatewayOrder["state"];
        }>(
          `UPDATE orders
           SET broker_order_id = COALESCE(broker_order_id, $2),
               state = CASE
                 WHEN broker_updated_at IS NULL OR $6 >= broker_updated_at THEN $3
                 ELSE state
               END,
               filled_volume = GREATEST(filled_volume, $4),
               broker_updated_at = GREATEST(COALESCE(broker_updated_at, $6), $6),
               updated_at = GREATEST(updated_at, $6),
               version = version + 1
           WHERE id = $1 AND account_id = $5
           RETURNING state`,
          [
            order.order_id,
            event.brokerOrderId,
            event.order.state,
            event.order.filledVolume,
            this.#options.accountId,
            event.order.updatedAt,
          ],
        );
        storedOrderState = updatedOrder.rows[0]?.state ?? null;
        if (storedOrderState === null)
          throw new Error("DEMO_EXECUTION_ORDER_PERSIST_FAILED");
      }

      if (event.position !== null) {
        const positionId = position?.position_id ?? randomUUID();
        const stored = await client.query<{
          id: string;
          order_group_id: string;
          side: "BUY" | "SELL";
          state: string;
          opened_at: Date | null;
          closed_at: Date | null;
        }>(
          `INSERT INTO positions
            (id, account_id, symbol_id, order_group_id, broker_position_id, side,
             state, strategy_owned, volume, entry_price, stop_loss, take_profit,
             opened_at, closed_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (account_id, broker_position_id)
             WHERE broker_position_id IS NOT NULL
           DO UPDATE SET
             order_group_id = COALESCE(positions.order_group_id, EXCLUDED.order_group_id),
             state = CASE WHEN EXCLUDED.updated_at >= positions.updated_at
                          THEN EXCLUDED.state ELSE positions.state END,
             volume = CASE WHEN EXCLUDED.updated_at >= positions.updated_at
                           THEN EXCLUDED.volume ELSE positions.volume END,
             entry_price = CASE WHEN EXCLUDED.updated_at >= positions.updated_at
                                THEN COALESCE(EXCLUDED.entry_price, positions.entry_price)
                                ELSE positions.entry_price END,
             stop_loss = CASE WHEN EXCLUDED.updated_at >= positions.updated_at
                              THEN EXCLUDED.stop_loss ELSE positions.stop_loss END,
             take_profit = CASE WHEN EXCLUDED.updated_at >= positions.updated_at
                                THEN EXCLUDED.take_profit ELSE positions.take_profit END,
             opened_at = COALESCE(positions.opened_at, EXCLUDED.opened_at),
             closed_at = CASE WHEN EXCLUDED.updated_at >= positions.updated_at
                              THEN COALESCE(EXCLUDED.closed_at, positions.closed_at)
                              ELSE positions.closed_at END,
             updated_at = GREATEST(positions.updated_at, EXCLUDED.updated_at),
             reconciliation_version = positions.reconciliation_version + 1
           RETURNING id, order_group_id, side, state, opened_at, closed_at`,
          [
            positionId,
            this.#options.accountId,
            this.#options.symbolId,
            orderGroupId,
            event.position.brokerPositionId,
            event.position.side,
            event.position.state,
            event.position.volume,
            event.position.entryPrice,
            event.position.stopLoss,
            event.position.takeProfit,
            event.position.openedAt,
            event.position.closedAt,
            event.position.updatedAt,
          ],
        );
        const storedId = stored.rows[0]?.id;
        if (storedId === undefined)
          throw new Error("DEMO_EXECUTION_POSITION_PERSIST_FAILED");
        position = { position_id: storedId, order_group_id: orderGroupId };
        if (event.position.state === "CLOSED" && event.closeDetail !== null) {
          const tradeReason = await this.#persistClosedTrade(
            client,
            stored.rows[0]!,
            event.closeDetail,
          );
          if (tradeReason !== null) tradeReasonCodes.push(tradeReason);
        }
      }

      if (event.fill !== null) {
        if (order === null && position === null)
          throw new Error("DEMO_EXECUTION_FILL_OWNER_MISSING");
        await client.query(
          `INSERT INTO fills
            (id, order_id, position_id, broker_event_key, broker_fill_id,
             price, volume, commission, occurred_at, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (broker_event_key) DO NOTHING`,
          [
            randomUUID(),
            order?.order_id ?? null,
            position?.position_id ?? null,
            `${this.#options.accountId}:${event.eventKey}`,
            event.fill.brokerFillId,
            event.fill.price,
            event.fill.volume,
            event.fill.commission,
            event.fill.occurredAt,
            event.receivedAt,
          ],
        );
      }

      await client.query(
        `UPDATE order_groups og
         SET state = CASE
           WHEN EXISTS (SELECT 1 FROM trades t WHERE t.order_group_id = og.id)
            AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.order_group_id = og.id
                             AND p.state IN ('OPEN','CLOSING','UNKNOWN','RECONCILIATION_PENDING'))
            AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                             AND o.state IN ('INTENT','SUBMITTING','PENDING','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN'))
            AND NOT EXISTS (
              SELECT 1 FROM positions p
              WHERE p.order_group_id = og.id
                AND (p.state <> 'CLOSED' OR NOT EXISTS (
                  SELECT 1 FROM trades t
                  WHERE t.order_group_id = og.id AND t.position_id = p.id
                ))
            )
             THEN 'CLOSED'
           WHEN EXISTS (SELECT 1 FROM positions p WHERE p.order_group_id = og.id
                         AND p.state = 'CLOSED')
             THEN 'RECONCILIATION_REQUIRED'
           WHEN EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                         AND o.state IN ('PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN'))
             THEN 'RECONCILIATION_REQUIRED'
           WHEN EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                         AND o.state = 'FILLED')
            AND EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                         AND o.state IN ('INTENT','SUBMITTING','PENDING'))
             THEN 'CANCELLING_PEER'
           WHEN EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                         AND o.state = 'FILLED')
             THEN 'POSITION_OPEN'
           WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                            AND o.state IN ('INTENT','SUBMITTING','PENDING'))
            AND EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                         AND o.state = 'EXPIRED')
             THEN 'EXPIRED'
           WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_group_id = og.id
                            AND o.state IN ('INTENT','SUBMITTING','PENDING'))
             THEN 'FAILED'
           ELSE 'ACTIVE'
         END,
         cancellation_reason = CASE
           WHEN og.cancellation_reason IS NULL
            AND (SELECT count(*) FROM orders o
                 WHERE o.order_group_id = og.id) = 2
            AND NOT EXISTS (
              SELECT 1 FROM orders o
              WHERE o.order_group_id = og.id
                AND (o.strategy_owned = false OR o.state <> 'CANCELLED'
                     OR o.filled_volume <> 0)
            )
            AND NOT EXISTS (
              SELECT 1 FROM fills f
              JOIN orders o ON o.id = f.order_id
              WHERE o.order_group_id = og.id
            )
            AND NOT EXISTS (SELECT 1 FROM positions p
                            WHERE p.order_group_id = og.id)
             THEN 'DEMO_BROKER_ZERO_FILL_CANCELLED'
           ELSE og.cancellation_reason
         END,
         updated_at = GREATEST(updated_at, $2)
         WHERE id = $1 AND state NOT IN ('CLOSED','EXPIRED')`,
        [orderGroupId, event.occurredAt],
      );

      const reasons = demoExecutionReasonCodes(event);
      for (const reason of tradeReasonCodes) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
      if (
        storedOrderState === "PARTIALLY_FILLED" &&
        !reasons.includes("DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED")
      ) {
        reasons.push("DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED");
      }
      if (!replayTradeOutcomeConflict) {
        await this.#insertEvent(
          client,
          event,
          order,
          position,
          "MAPPED",
          reasons,
        );
      }
      if (storedOrderState === "FILLED" && event.brokerOrderId !== null) {
        await client.query(
          `UPDATE broker_execution_events
           SET resolved_at = $3,
               resolution_event_key = $4
           WHERE account_id = $1 AND broker_order_id = $2
             AND broker_event_key <> $4
             AND mapping_state = 'MAPPED'
             AND resolved_at IS NULL
             AND reason_codes = '["DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED"]'::jsonb`,
          [
            this.#options.accountId,
            event.brokerOrderId,
            event.occurredAt,
            event.eventKey,
          ],
        );
      }
      if (
        event.position?.state === "CLOSED" &&
        event.closeDetail !== null &&
        event.brokerOrderType === 4 &&
        event.closingOrder &&
        event.brokerOrderId !== null
      ) {
        await client.query(
          `UPDATE broker_execution_events
           SET mapping_state = 'MAPPED',
               resolved_at = $3,
               resolution_event_key = $4
           WHERE account_id = $1 AND broker_order_id = $2
             AND broker_event_key <> $4
             AND resolved_at IS NULL
             AND (
               reason_codes = '["DEMO_CLOSING_ORDER_AWAITING_DEAL"]'::jsonb
               OR reason_codes = '["DEMO_EXECUTION_BROKER_ORDER_ID_CONFLICT"]'::jsonb
             )`,
          [
            this.#options.accountId,
            event.brokerOrderId,
            event.occurredAt,
            event.eventKey,
          ],
        );
      }
      await client.query("COMMIT");
      const persistenceReasons = replayTradeOutcomeConflict
        ? ["DEMO_TRADE_OUTCOME_CONFLICT"]
        : reasons;
      return {
        certain: persistenceReasons.length === 0,
        reasonCodes: persistenceReasons,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #persistClosedTrade(
    client: pg.PoolClient,
    position: {
      readonly id: string;
      readonly order_group_id: string;
      readonly side: "BUY" | "SELL";
      readonly state: string;
      readonly opened_at: Date | null;
      readonly closed_at: Date | null;
    },
    closeDetail: NonNullable<DemoExecutionEvent["closeDetail"]>,
  ): Promise<string | null> {
    if (position.state !== "CLOSED")
      throw new Error("DEMO_TRADE_POSITION_NOT_CLOSED");
    if (position.opened_at === null || position.closed_at === null)
      return "DEMO_TRADE_TIMESTAMPS_MISSING";
    const context = await client.query<{
      mode: string;
      strategy_version: string;
      model: string | null;
      prompt_version: string | null;
      schema_version: string | null;
      parsed_payload: unknown;
      filled_volume: string;
    }>(
      `SELECT ar.mode, sv.version AS strategy_version,
              model.model, model.prompt_version, model.schema_version,
              model.parsed_payload,
              COALESCE((SELECT sum(f.volume)::text FROM fills f
                        WHERE f.position_id = $2 AND f.order_id IS NOT NULL), '0')
                AS filled_volume
       FROM order_groups og
       JOIN analysis_runs ar ON ar.id = og.analysis_id
       JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
       LEFT JOIN LATERAL (
         SELECT mr.model, mr.prompt_version, mr.schema_version, mres.parsed_payload
         FROM model_requests mr
         JOIN model_responses mres ON mres.model_request_id = mr.id
         WHERE mr.analysis_id = ar.id
         ORDER BY mr.requested_at DESC LIMIT 1
       ) model ON true
       WHERE og.id = $1`,
      [position.order_group_id, position.id],
    );
    const row = context.rows[0];
    if (
      row === undefined ||
      row.mode !== "demo" ||
      row.model === null ||
      row.prompt_version === null ||
      row.schema_version === null
    ) {
      return "DEMO_TRADE_MODEL_CONTEXT_MISSING";
    }
    if (closeDetail.closedVolume === null)
      return "DEMO_TRADE_CLOSED_VOLUME_MISSING";
    if (!new Decimal(closeDetail.closedVolume).eq(row.filled_volume))
      return "DEMO_TRADE_CLOSED_VOLUME_MISMATCH";
    if (
      row.parsed_payload === null ||
      typeof row.parsed_payload !== "object" ||
      Array.isArray(row.parsed_payload)
    ) {
      return "DEMO_TRADE_MODEL_CONTEXT_INVALID";
    }
    const payload = row.parsed_payload as Record<string, unknown>;
    const confidence = payload.confidence;
    const overall =
      confidence !== null &&
      typeof confidence === "object" &&
      !Array.isArray(confidence)
        ? (confidence as Record<string, unknown>).overall
        : undefined;
    const setupTags = payload.setup_tags;
    const marketRegime = payload.market_regime;
    if (
      typeof overall !== "number" ||
      !Number.isInteger(overall) ||
      overall < 0 ||
      overall > 100 ||
      !Array.isArray(setupTags) ||
      !setupTags.every((tag) => typeof tag === "string") ||
      typeof marketRegime !== "string"
    ) {
      return "DEMO_TRADE_MODEL_CONTEXT_INVALID";
    }
    const fees = new Decimal(closeDetail.swap)
      .plus(closeDetail.commission)
      .plus(closeDetail.pnlConversionFee);
    const realizedPnl = new Decimal(closeDetail.grossProfit).plus(fees);
    const inserted = await client.query(
      `INSERT INTO trades
        (id, order_group_id, position_id, mode, direction, setup_tags,
         market_regime, confidence_bucket, realized_pnl, fees, opened_at,
         closed_at, model_version, prompt_version, schema_version,
         strategy_version)
       VALUES ($1, $2, $3, 'demo', $4, $5::jsonb, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15)
       ON CONFLICT (position_id) WHERE position_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        position.order_group_id,
        position.id,
        position.side === "BUY" ? "LONG" : "SHORT",
        JSON.stringify(setupTags),
        marketRegime,
        overall >= 75 ? "HIGH" : overall >= 50 ? "MEDIUM" : "LOW",
        realizedPnl.toString(),
        fees.toString(),
        position.opened_at,
        position.closed_at,
        row.model,
        row.prompt_version,
        row.schema_version,
        row.strategy_version,
      ],
    );
    if ((inserted.rowCount ?? 0) !== 1)
      throw new Error("DEMO_TRADE_OUTCOME_CONCURRENT_CONFLICT");
    return null;
  }

  async #insertEvent(
    client: pg.PoolClient,
    event: DemoExecutionEvent,
    order: OrderMatch | null,
    position: PositionMatch | null,
    mappingState: "MAPPED" | "UNMATCHED" | "CONFLICT",
    reasonCodes: readonly string[],
  ): Promise<void> {
    await client.query(
      `INSERT INTO broker_execution_events
        (id, account_id, symbol_id, order_group_id, order_id, position_id,
         broker_event_key, payload_hash, schema_version, execution_type,
         client_order_id, broker_order_id, broker_position_id, broker_fill_id,
         broker_order_type, closing_order, mapping_state, reason_codes,
         normalized_payload, occurred_at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20, $21)`,
      [
        randomUUID(),
        this.#options.accountId,
        this.#options.symbolId,
        order?.order_group_id ?? position?.order_group_id ?? null,
        order?.order_id ?? null,
        position?.position_id ?? null,
        event.eventKey,
        event.payloadHash,
        event.schemaVersion,
        event.executionType,
        event.clientOrderId,
        event.brokerOrderId,
        event.brokerPositionId,
        event.brokerFillId,
        event.brokerOrderType,
        event.closingOrder,
        mappingState,
        JSON.stringify(reasonCodes),
        JSON.stringify(event),
        event.occurredAt,
        event.receivedAt,
      ],
    );
  }
}
