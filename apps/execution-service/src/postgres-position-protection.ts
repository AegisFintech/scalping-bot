import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PositionProtection } from "../../../packages/contracts/src/position-protection.js";
import type {
  ProtectionPosition,
  ProtectionSession,
  ProtectionStore,
} from "./position-protection.js";

export class PostgresPositionProtection implements ProtectionStore {
  constructor(
    private readonly options: {
      pool: pg.Pool;
      accountId: string;
      symbolId: string;
    },
  ) {}
  async exclusive(
    work: (session: ProtectionSession) => Promise<void>,
  ): Promise<void> {
    const client = await this.options.pool.connect();
    const lock = `position-protection:${this.options.accountId}:${this.options.symbolId}`;
    let acquired = false;
    try {
      acquired =
        (
          await client.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
            [lock],
          )
        ).rows[0]?.acquired === true;
      if (!acquired) return;
      await work(
        new PostgresProtectionSession(
          client,
          this.options.accountId,
          this.options.symbolId,
        ),
      );
    } finally {
      try {
        if (acquired)
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            [lock],
          );
      } finally {
        client.release();
      }
    }
  }
}

class PostgresProtectionSession implements ProtectionSession {
  constructor(
    private readonly client: pg.PoolClient,
    private readonly accountId: string,
    private readonly symbolId: string,
  ) {}
  async positions(): Promise<readonly ProtectionPosition[]> {
    const result = await this.client.query<ProtectionPosition>(
      `SELECT p.id, p.broker_position_id AS "brokerPositionId", p.side, p.volume::text,
              p.entry_price::text AS "entryPrice", o.entry_price::text AS "orderEntry",
              o.stop_loss::text AS "orderStopLoss", o.take_profit::text AS "orderTakeProfit",
              o.strategy_label AS label, COALESCE(pp.repair_attempts, 0) AS "repairAttempts",
              pp.command_at AS "commandAt", pp.close_requested_at AS "closeRequestedAt"
       FROM positions p JOIN order_groups og ON og.id = p.order_group_id
       JOIN analysis_runs ar ON ar.id = og.analysis_id
       JOIN orders o ON o.order_group_id = og.id AND o.side = p.side
       LEFT JOIN position_protection pp ON pp.position_id = p.id
       WHERE p.account_id = $1 AND p.symbol_id = $2 AND ar.account_id = $1 AND ar.symbol_id = $2
         AND o.account_id = $1 AND og.mode = 'demo'
         AND p.strategy_owned = true AND o.strategy_owned = true
         AND p.state IN ('OPEN','CLOSING') AND o.state IN ('FILLED','PARTIALLY_FILLED')
         AND p.broker_position_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM fills f WHERE f.position_id = p.id AND f.order_id = o.id)
       ORDER BY p.id`,
      [this.accountId, this.symbolId],
    );
    return result.rows.map((p) => ({
      ...p,
      commandAt:
        p.commandAt === null ? null : new Date(p.commandAt).toISOString(),
      closeRequestedAt:
        p.closeRequestedAt === null
          ? null
          : new Date(p.closeRequestedAt).toISOString(),
    }));
  }
  async observe(
    position: ProtectionPosition,
    observation: PositionProtection,
  ): Promise<void> {
    await this.transaction(async () => {
      await this.client.query(
        `INSERT INTO position_protection (position_id,status,stop_loss,take_profit,expected_stop_loss,expected_take_profit,observed_at,reason_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (position_id) DO UPDATE SET status=EXCLUDED.status,
           stop_loss=EXCLUDED.stop_loss,take_profit=EXCLUDED.take_profit,
           expected_stop_loss=EXCLUDED.expected_stop_loss,expected_take_profit=EXCLUDED.expected_take_profit,
           observed_at=EXCLUDED.observed_at,reason_code=EXCLUDED.reason_code,updated_at=now()`,
        [
          position.id,
          observation.status,
          observation.stopLoss,
          observation.takeProfit,
          observation.expectedStopLoss,
          observation.expectedTakeProfit,
          observation.observedAt,
          observation.reasonCode,
        ],
      );
      await this.event(position, "OBSERVATION", observation);
      if (observation.status === "VERIFIED") {
        // This fresh position proof resolves only non-fill SL/TP child acknowledgements.
        // Fill, ownership, partial-close and other reconciliation failures remain latched.
        await this.client.query(
          `UPDATE broker_execution_events SET resolved_at=$2,
             resolution_event_key='protection:' || $1::text || ':' || $2::text
           WHERE position_id=$1 AND account_id=$3 AND symbol_id=$4
             AND mapping_state='MAPPED' AND resolved_at IS NULL AND occurred_at <= $2
             AND broker_order_type=4 AND closing_order=true AND execution_type IN (2,4)
             AND normalized_payload->'fill'='null'::jsonb
             AND (reason_codes='["DEMO_CLOSING_ORDER_AWAITING_DEAL"]'::jsonb
               OR reason_codes='["DEMO_ORDER_REPLACED_RECONCILIATION_REQUIRED"]'::jsonb)`,
          [position.id, observation.observedAt, this.accountId, this.symbolId],
        );
      }
    });
  }
  async claimRepair(
    position: ProtectionPosition,
    at: string,
  ): Promise<boolean> {
    return this.transaction(async () => {
      const result = await this.client.query(
        `UPDATE position_protection SET repair_attempts=repair_attempts+1,command_at=$2,
           status='REPAIR_SENT',reason_code='POSITION_PROTECTION_REPAIR_SENT',updated_at=now()
         WHERE position_id=$1 AND repair_attempts<2 AND close_requested_at IS NULL
           AND (command_at IS NULL OR command_at <= $2::timestamptz - interval '5 seconds')
           AND EXISTS (SELECT 1 FROM positions p WHERE p.id=$1 AND p.state='OPEN') RETURNING position_id`,
        [position.id, at],
      );
      if (result.rows.length !== 1) return false;
      await this.event(position, "REPAIR_CLAIM", { at });
      return true;
    });
  }
  async claimClose(
    position: ProtectionPosition,
    at: string,
    volume: string,
  ): Promise<boolean> {
    return this.transaction(async () => {
      const result = await this.client.query(
        `UPDATE position_protection SET close_requested_at=$2,close_volume=$3,command_at=$2,
           status='CLOSE_SENT',reason_code='POSITION_PROTECTION_CLOSE_AWAITING_DEAL',updated_at=now()
         WHERE position_id=$1 AND close_requested_at IS NULL
           AND status='CLOSE_REQUIRED' AND stop_loss IS NULL
           AND observed_at <= $2::timestamptz
           AND observed_at >= $2::timestamptz - interval '2 seconds'
           AND EXISTS (SELECT 1 FROM positions p JOIN order_groups og ON og.id=p.order_group_id
             WHERE p.id=$1 AND p.state='OPEN' AND p.volume=$3
               AND p.account_id=$4 AND p.symbol_id=$5 AND p.strategy_owned=true AND og.mode='demo')
         RETURNING position_id`,
        [position.id, at, volume, this.accountId, this.symbolId],
      );
      if (result.rows.length !== 1) return false;
      await this.event(position, "CLOSE_CLAIM", { at, volume });
      return true;
    });
  }
  async closeAcknowledged(
    position: ProtectionPosition,
    brokerOrderId: string,
  ): Promise<void> {
    await this.transaction(async () => {
      const result = await this.client.query(
        `UPDATE position_protection SET broker_close_order_id=$2,updated_at=now()
         WHERE position_id=$1 AND close_requested_at IS NOT NULL
           AND (broker_close_order_id IS NULL OR broker_close_order_id=$2) RETURNING position_id`,
        [position.id, brokerOrderId],
      );
      if (result.rows.length !== 1)
        throw new Error("POSITION_PROTECTION_CLOSE_ACK_CONFLICT");
      await this.event(position, "CLOSE_ACK", { brokerOrderId });
    });
  }
  private async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.client.query("BEGIN");
    try {
      const result = await work();
      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }
  private async event(
    position: ProtectionPosition,
    kind: string,
    details: object,
  ): Promise<void> {
    await this.client.query(
      "INSERT INTO position_protection_events(id,position_id,kind,details) VALUES($1,$2,$3,$4)",
      [randomUUID(), position.id, kind, JSON.stringify(details)],
    );
  }
}
