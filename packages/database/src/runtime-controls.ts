import { randomUUID } from "node:crypto";

import type pg from "pg";

export interface RuntimeControlSnapshot {
  readonly certain: boolean;
  readonly emergencyStop: boolean;
  readonly pauseNewAnalyses: boolean;
  readonly dashboardAcknowledged: boolean;
  readonly reasonCodes: readonly string[];
}

export interface DashboardAcknowledgementContext {
  readonly instanceId: string;
  readonly accountKey: string;
  readonly configHash: string;
}

export class RuntimeControlStore {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async snapshot(
    scope: string,
    expected: DashboardAcknowledgementContext,
  ): Promise<RuntimeControlSnapshot> {
    try {
      const result = await this.#pool.query<{
        control_key: string;
        enabled: boolean;
        value: unknown;
      }>(
        `SELECT control_key, enabled, value
         FROM runtime_controls
         WHERE scope = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
        [scope],
      );
      const controls = new Map(
        result.rows.map((row) => [row.control_key, row]),
      );
      const acknowledgement = controls.get("LIVE_DASHBOARD_ACK");
      const value = acknowledgement?.value;
      const validValue =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        certain: true,
        emergencyStop: controls.get("EMERGENCY_STOP")?.enabled ?? false,
        pauseNewAnalyses: controls.get("PAUSE_NEW_ANALYSES")?.enabled ?? false,
        dashboardAcknowledged:
          acknowledgement?.enabled === true &&
          validValue.instance_id === expected.instanceId &&
          validValue.account_key === expected.accountKey &&
          validValue.config_hash === expected.configHash,
        reasonCodes: [],
      };
    } catch {
      return {
        certain: false,
        emergencyStop: true,
        pauseNewAnalyses: true,
        dashboardAcknowledged: false,
        reasonCodes: ["RUNTIME_CONTROLS_DATABASE_UNAVAILABLE"],
      };
    }
  }

  async setControl(input: {
    readonly key:
      "EMERGENCY_STOP" | "PAUSE_NEW_ANALYSES" | "LIVE_DASHBOARD_ACK";
    readonly scope: string;
    readonly enabled: boolean;
    readonly value?: Readonly<Record<string, unknown>>;
    readonly actor: string;
    readonly reason: string;
    readonly expiresAt?: Date;
  }): Promise<void> {
    if (!input.actor || !input.reason)
      throw new Error("RUNTIME_CONTROL_AUDIT_FIELDS_REQUIRED");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE runtime_controls SET revoked_at = now(), version = version + 1 WHERE control_key = $1 AND scope = $2 AND revoked_at IS NULL",
        [input.key, input.scope],
      );
      await client.query(
        `INSERT INTO runtime_controls
          (id, control_key, scope, enabled, value, actor, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [
          randomUUID(),
          input.key,
          input.scope,
          input.enabled,
          JSON.stringify(input.value ?? {}),
          input.actor,
          input.reason,
          input.expiresAt ?? null,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
