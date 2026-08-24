import type pg from "pg";

import {
  redact,
  type BetterStackTransport,
  type LogValue,
} from "../../../packages/logging/src/index.js";

export interface ObservabilityOutboxOptions {
  readonly pool: pg.Pool;
  readonly transport: Pick<BetterStackTransport, "send">;
  readonly batchSize?: number;
  readonly leaseMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly now?: () => Date;
}

export interface ObservabilityFlushResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
}

export interface AuditOutboxRow {
  readonly id: string;
  readonly audit_event_id: string;
  readonly attempt_count: number;
  readonly occurred_at: Date;
  readonly severity: string;
  readonly service: string;
  readonly instance_id: string;
  readonly environment: string;
  readonly trading_mode: string;
  readonly trace_id: string | null;
  readonly request_id: string | null;
  readonly analysis_id: string | null;
  readonly order_group_id: string | null;
  readonly symbol: string | null;
  readonly event_name: string;
  readonly outcome: string;
  readonly reason_code: string | null;
  readonly retry_count: number;
  readonly schema_version: string | null;
  readonly model_version: string | null;
  readonly duration_ms: number | null;
  readonly details: unknown;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`OBSERVABILITY_${name}_INVALID`);
  }
  return value;
}

export function retryDelayMs(
  attemptCount: number,
  baseMs: number,
  maxMs: number,
): number {
  positiveInteger(attemptCount, "ATTEMPT_COUNT");
  positiveInteger(baseMs, "RETRY_BASE_MS");
  positiveInteger(maxMs, "RETRY_MAX_MS");
  if (baseMs > maxMs) throw new Error("OBSERVABILITY_RETRY_RANGE_INVALID");
  const exponent = Math.min(attemptCount - 1, 20);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

export function auditEventPayload(row: AuditOutboxRow): LogValue {
  return redact({
    dt: row.occurred_at.toISOString(),
    message: row.event_name,
    event_id: row.audit_event_id,
    delivery_attempt: row.attempt_count,
    severity: row.severity,
    service: row.service,
    instance_id: row.instance_id,
    environment: row.environment,
    trading_mode: row.trading_mode,
    trace_id: row.trace_id,
    request_id: row.request_id,
    analysis_id: row.analysis_id,
    order_group_id: row.order_group_id,
    symbol: row.symbol,
    event_name: row.event_name,
    outcome: row.outcome,
    reason_code: row.reason_code,
    audit_retry_count: row.retry_count,
    schema_version: row.schema_version,
    model_version: row.model_version,
    duration_ms: row.duration_ms,
    details: row.details as LogValue,
  });
}

export class PostgresObservabilityOutbox {
  readonly #options: Required<
    Omit<ObservabilityOutboxOptions, "pool" | "transport">
  > &
    Pick<ObservabilityOutboxOptions, "pool" | "transport">;
  #flushing = false;

  constructor(options: ObservabilityOutboxOptions) {
    this.#options = {
      ...options,
      batchSize: positiveInteger(options.batchSize ?? 50, "BATCH_SIZE"),
      leaseMs: positiveInteger(options.leaseMs ?? 30_000, "LEASE_MS"),
      retryBaseMs: positiveInteger(
        options.retryBaseMs ?? 5_000,
        "RETRY_BASE_MS",
      ),
      retryMaxMs: positiveInteger(
        options.retryMaxMs ?? 300_000,
        "RETRY_MAX_MS",
      ),
      now: options.now ?? (() => new Date()),
    };
    if (this.#options.retryBaseMs > this.#options.retryMaxMs) {
      throw new Error("OBSERVABILITY_RETRY_RANGE_INVALID");
    }
  }

  async flush(): Promise<ObservabilityFlushResult> {
    if (this.#flushing) return { claimed: 0, delivered: 0, retried: 0 };
    this.#flushing = true;
    try {
      const rows = await this.#claim();
      let delivered = 0;
      let retried = 0;
      for (const row of rows) {
        let accepted = false;
        try {
          accepted = await this.#options.transport.send(auditEventPayload(row));
        } catch {
          accepted = false;
        }
        if (accepted) {
          await this.#delivered(row);
          delivered += 1;
        } else {
          await this.#retry(row);
          retried += 1;
        }
      }
      return { claimed: rows.length, delivered, retried };
    } finally {
      this.#flushing = false;
    }
  }

  async #claim(): Promise<readonly AuditOutboxRow[]> {
    const now = this.#options.now();
    const leaseExpiresAt = new Date(now.getTime() + this.#options.leaseMs);
    const client = await this.#options.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<AuditOutboxRow>(
        `WITH due AS (
           SELECT id
           FROM observability_outbox
           WHERE next_attempt_at <= $1
             AND (
               status IN ('PENDING', 'RETRY')
               OR (status = 'DELIVERING' AND lease_expires_at <= $1)
             )
           ORDER BY next_attempt_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         ), claimed AS (
           UPDATE observability_outbox outbox
           SET status = 'DELIVERING',
               attempt_count = outbox.attempt_count + 1,
               lease_expires_at = $3,
               last_error_code = NULL,
               updated_at = $1
           FROM due
           WHERE outbox.id = due.id
           RETURNING outbox.id, outbox.audit_event_id, outbox.attempt_count
         )
         SELECT claimed.id, claimed.audit_event_id, claimed.attempt_count,
                event.occurred_at, event.severity, event.service,
                event.instance_id, event.environment, event.trading_mode,
                event.trace_id, event.request_id, event.analysis_id,
                event.order_group_id, event.symbol, event.event_name,
                event.outcome, event.reason_code, event.retry_count,
                event.schema_version, event.model_version, event.duration_ms,
                event.details
         FROM claimed
         JOIN audit_events event ON event.id = claimed.audit_event_id
         ORDER BY event.occurred_at, claimed.id`,
        [now, this.#options.batchSize, leaseExpiresAt],
      );
      await client.query("COMMIT");
      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #delivered(row: AuditOutboxRow): Promise<void> {
    const result = await this.#options.pool.query(
      `UPDATE observability_outbox
       SET status = 'DELIVERED', delivered_at = $2, lease_expires_at = NULL,
           last_error_code = NULL, updated_at = $2
       WHERE id = $1 AND status = 'DELIVERING' AND attempt_count = $3`,
      [row.id, this.#options.now(), row.attempt_count],
    );
    if (result.rowCount !== 1) {
      throw new Error("OBSERVABILITY_DELIVERY_STATE_CONFLICT");
    }
  }

  async #retry(row: AuditOutboxRow): Promise<void> {
    const now = this.#options.now();
    const nextAttemptAt = new Date(
      now.getTime() +
        retryDelayMs(
          row.attempt_count,
          this.#options.retryBaseMs,
          this.#options.retryMaxMs,
        ),
    );
    const result = await this.#options.pool.query(
      `UPDATE observability_outbox
       SET status = 'RETRY', next_attempt_at = $2, lease_expires_at = NULL,
           last_error_code = 'BETTER_STACK_DELIVERY_REJECTED', updated_at = $3
       WHERE id = $1 AND status = 'DELIVERING' AND attempt_count = $4`,
      [row.id, nextAttemptAt, now, row.attempt_count],
    );
    if (result.rowCount !== 1) {
      throw new Error("OBSERVABILITY_RETRY_STATE_CONFLICT");
    }
  }
}
