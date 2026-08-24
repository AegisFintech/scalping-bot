import { randomUUID } from "node:crypto";

import type pg from "pg";

import type {
  DemoExecutionEvent,
  DemoExecutionPersistenceResult,
  DemoExecutionStore,
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

function eventReasons(event: DemoExecutionEvent): string[] {
  const reasons: string[] = [];
  if (event.executionType === 4)
    reasons.push("DEMO_ORDER_REPLACED_RECONCILIATION_REQUIRED");
  if (event.executionType === 8) reasons.push("DEMO_CANCEL_REJECTED");
  if (event.order?.state === "PARTIALLY_FILLED")
    reasons.push("DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED");
  if (event.order?.state === "UNKNOWN" || event.position?.state === "UNKNOWN")
    reasons.push("DEMO_EXECUTION_STATE_UNKNOWN");
  if (event.position?.state === "RECONCILIATION_PENDING")
    reasons.push("DEMO_POSITION_CREATED_RECONCILIATION_REQUIRED");
  if (event.closeDetail !== null)
    reasons.push("DEMO_TRADE_OUTCOME_MAPPING_PENDING");
  return reasons;
}

export class PostgresDemoExecutionStore implements DemoExecutionStore {
  readonly #options: PostgresDemoExecutionStoreOptions;

  constructor(options: PostgresDemoExecutionStoreOptions) {
    this.#options = options;
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
        await client.query("COMMIT");
        const reasonCodes = Array.isArray(duplicate.reason_codes)
          ? duplicate.reason_codes.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        const unresolvedReasonCodes =
          duplicate.resolved_at === null ? reasonCodes : [];
        return {
          certain:
            duplicate.mapping_state === "MAPPED" &&
            unresolvedReasonCodes.length === 0,
          reasonCodes: unresolvedReasonCodes,
        };
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
      const order = orders.rows[0] ?? null;
      if (
        order?.broker_order_id !== null &&
        event.brokerOrderId !== null &&
        order?.broker_order_id !== event.brokerOrderId
      ) {
        await this.#insertEvent(client, event, order, null, "CONFLICT", [
          "DEMO_EXECUTION_BROKER_ORDER_ID_CONFLICT",
        ]);
        await client.query("COMMIT");
        return {
          certain: false,
          reasonCodes: ["DEMO_EXECUTION_BROKER_ORDER_ID_CONFLICT"],
        };
      }

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

      let storedOrderState: GatewayOrder["state"] | null = null;
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
        const stored = await client.query<{ id: string }>(
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
           RETURNING id`,
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
         updated_at = GREATEST(updated_at, $2)
         WHERE id = $1 AND state NOT IN ('CLOSED','EXPIRED')`,
        [orderGroupId, event.occurredAt],
      );

      const reasons = eventReasons(event);
      if (
        storedOrderState === "PARTIALLY_FILLED" &&
        !reasons.includes("DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED")
      ) {
        reasons.push("DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED");
      }
      await this.#insertEvent(
        client,
        event,
        order,
        position,
        "MAPPED",
        reasons,
      );
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
      await client.query("COMMIT");
      return { certain: reasons.length === 0, reasonCodes: reasons };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
         mapping_state, reason_codes, normalized_payload, occurred_at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16::jsonb, $17::jsonb, $18, $19)`,
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
        mappingState,
        JSON.stringify(reasonCodes),
        JSON.stringify(event),
        event.occurredAt,
        event.receivedAt,
      ],
    );
  }
}
