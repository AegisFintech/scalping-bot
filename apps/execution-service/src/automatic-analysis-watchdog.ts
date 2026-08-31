import { randomUUID } from "node:crypto";

import type pg from "pg";

export type AutomaticAnalysisActivityState =
  | "UNAVAILABLE"
  | "DISABLED"
  | "PAUSED"
  | "MANAGING_SETUP"
  | "WAITING_FOR_MARKET"
  | "STARTING"
  | "RUNNING"
  | "STALLED";

export interface AutomaticAnalysisActivity {
  readonly state: AutomaticAnalysisActivityState;
  readonly lastClaimedAt: string | null;
  readonly lastCompletedAt: string | null;
  readonly lastLifecycleAt: string | null;
  readonly lastProgressAt: string | null;
  readonly latestMarketAt: string | null;
  readonly stalledSince: string | null;
  readonly reasonCodes: readonly string[];
}

interface ActivityRows {
  readonly last_claimed_at: Date | null;
  readonly last_completed_at: Date | null;
  readonly last_lifecycle_at: Date | null;
  readonly latest_market_at: Date | null;
}

function time(value: string | Date | null, reason: string): number | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(reason);
  return parsed;
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function evaluateAutomaticAnalysisActivity(input: {
  readonly now: Date;
  readonly serviceStartedAt: Date;
  readonly automaticAnalysisEnabled: boolean;
  readonly paused: boolean;
  readonly managedSetupActive: boolean;
  readonly stallAfterMs: number;
  readonly marketActiveWithinMs: number;
  readonly lastClaimedAt: Date | null;
  readonly lastCompletedAt: Date | null;
  readonly lastLifecycleAt: Date | null;
  readonly latestMarketAt: Date | null;
}): AutomaticAnalysisActivity {
  const now = time(input.now, "AUTOMATIC_WATCHDOG_CLOCK_INVALID");
  const started = time(
    input.serviceStartedAt,
    "AUTOMATIC_WATCHDOG_START_TIME_INVALID",
  );
  if (
    now === null ||
    started === null ||
    started > now ||
    !Number.isSafeInteger(input.stallAfterMs) ||
    input.stallAfterMs < 60_000 ||
    input.stallAfterMs > 3_600_000 ||
    !Number.isSafeInteger(input.marketActiveWithinMs) ||
    input.marketActiveWithinMs < 60_000 ||
    input.marketActiveWithinMs > input.stallAfterMs
  ) {
    throw new Error("AUTOMATIC_WATCHDOG_CONFIG_INVALID");
  }
  const claimed = time(
    input.lastClaimedAt,
    "AUTOMATIC_WATCHDOG_CLAIM_TIME_INVALID",
  );
  const completed = time(
    input.lastCompletedAt,
    "AUTOMATIC_WATCHDOG_COMPLETION_TIME_INVALID",
  );
  const lifecycle = time(
    input.lastLifecycleAt,
    "AUTOMATIC_WATCHDOG_LIFECYCLE_TIME_INVALID",
  );
  const market = time(
    input.latestMarketAt,
    "AUTOMATIC_WATCHDOG_MARKET_TIME_INVALID",
  );
  const progress = Math.max(
    started,
    claimed ?? 0,
    completed ?? 0,
    lifecycle ?? 0,
  );
  const base = {
    lastClaimedAt: iso(claimed),
    lastCompletedAt: iso(completed),
    lastLifecycleAt: iso(lifecycle),
    lastProgressAt: iso(progress),
    latestMarketAt: iso(market),
    stalledSince: null,
    reasonCodes: [] as readonly string[],
  };
  if (!input.automaticAnalysisEnabled) return { state: "DISABLED", ...base };
  if (input.paused) return { state: "PAUSED", ...base };
  if (input.managedSetupActive) return { state: "MANAGING_SETUP", ...base };
  if (market === null || now - market > input.marketActiveWithinMs)
    return { state: "WAITING_FOR_MARKET", ...base };
  if (
    claimed === null &&
    completed === null &&
    now - started <= input.stallAfterMs
  )
    return { state: "STARTING", ...base };
  if (now - progress <= input.stallAfterMs)
    return { state: "RUNNING", ...base };
  return {
    state: "STALLED",
    ...base,
    stalledSince: iso(progress),
    reasonCodes: ["AUTOMATIC_ANALYSIS_STALLED"],
  };
}

export class PostgresAutomaticAnalysisWatchdog {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;
  readonly #strategyVersionId: string;
  readonly #strategyVersion: string;
  readonly #symbol: string;
  readonly #accountKey: string;
  readonly #instanceId: string;
  readonly #environment: string;
  readonly #mode: string;
  readonly #serviceStartedAt: Date;
  readonly #stallAfterMs: number;
  readonly #marketActiveWithinMs: number;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly strategyVersionId: string;
    readonly strategyVersion: string;
    readonly symbol: string;
    readonly accountKey: string;
    readonly instanceId: string;
    readonly environment: string;
    readonly mode: string;
    readonly serviceStartedAt: Date;
    readonly stallAfterMs: number;
    readonly marketActiveWithinMs?: number;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#strategyVersionId = input.strategyVersionId;
    this.#strategyVersion = input.strategyVersion;
    this.#symbol = input.symbol;
    this.#accountKey = input.accountKey;
    this.#instanceId = input.instanceId;
    this.#environment = input.environment;
    this.#mode = input.mode;
    this.#serviceStartedAt = input.serviceStartedAt;
    this.#stallAfterMs = input.stallAfterMs;
    this.#marketActiveWithinMs = input.marketActiveWithinMs ?? 120_000;
  }

  async snapshot(input: {
    readonly automaticAnalysisEnabled: boolean;
    readonly paused: boolean;
    readonly managedSetupActive: boolean;
    readonly now?: Date;
  }): Promise<AutomaticAnalysisActivity> {
    const result = await this.#pool.query<ActivityRows>(
      `SELECT
         (SELECT max(ai.claimed_at)
          FROM automatic_analysis_intervals ai
          JOIN strategy_versions sv ON sv.id = $3
          LEFT JOIN analysis_runs ar ON ar.id = ai.analysis_id
          WHERE ai.account_id = $1 AND ai.symbol_id = $2
            AND (ar.strategy_version_id = $3
                 OR (ai.analysis_id IS NULL AND ai.claimed_at >= sv.created_at)))
           AS last_claimed_at,
         (SELECT max(ai.completed_at)
          FROM automatic_analysis_intervals ai
          JOIN analysis_runs ar ON ar.id = ai.analysis_id
          WHERE ai.account_id = $1 AND ai.symbol_id = $2
            AND ar.strategy_version_id = $3) AS last_completed_at,
         (SELECT max(og.updated_at)
          FROM order_groups og
          JOIN analysis_runs ar ON ar.id = og.analysis_id
          WHERE ar.account_id = $1 AND ar.symbol_id = $2
            AND ar.strategy_version_id = $3) AS last_lifecycle_at,
         (SELECT max(so.created_at)
          FROM spread_observations so
          WHERE so.account_id = $1 AND so.symbol_id = $2) AS latest_market_at`,
      [this.#accountId, this.#symbolId, this.#strategyVersionId],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new Error("AUTOMATIC_WATCHDOG_ACTIVITY_UNAVAILABLE");
    return evaluateAutomaticAnalysisActivity({
      ...input,
      now: input.now ?? new Date(),
      serviceStartedAt: this.#serviceStartedAt,
      stallAfterMs: this.#stallAfterMs,
      marketActiveWithinMs: this.#marketActiveWithinMs,
      lastClaimedAt: row.last_claimed_at,
      lastCompletedAt: row.last_completed_at,
      lastLifecycleAt: row.last_lifecycle_at,
      latestMarketAt: row.latest_market_at,
    });
  }

  async observe(input: {
    readonly automaticAnalysisEnabled: boolean;
    readonly paused: boolean;
    readonly managedSetupActive: boolean;
    readonly now?: Date;
  }): Promise<AutomaticAnalysisActivity> {
    const activity = await this.snapshot(input);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${this.#accountId}:${this.#symbolId}:automatic-watchdog`],
      );
      const latest = await client.query<{ event_name: string }>(
        `SELECT event_name FROM audit_events
         WHERE service = 'execution-service'
           AND event_name IN ('automatic_analysis_stalled','automatic_analysis_resumed')
           AND details ->> 'strategy_version' = $1
           AND account_key = $2 AND symbol = $3
         ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [this.#strategyVersion, this.#accountKey, this.#symbol],
      );
      const latestEvent = latest.rows[0]?.event_name ?? null;
      const progressRecovered = ["RUNNING", "MANAGING_SETUP"].includes(
        activity.state,
      );
      const event =
        activity.state === "STALLED" &&
        latestEvent !== "automatic_analysis_stalled"
          ? {
              name: "automatic_analysis_stalled",
              severity: "error",
              outcome: "blocked",
              reason: "AUTOMATIC_ANALYSIS_STALLED",
            }
          : progressRecovered && latestEvent === "automatic_analysis_stalled"
            ? {
                name: "automatic_analysis_resumed",
                severity: "info",
                outcome: "recovered",
                reason: null,
              }
            : null;
      if (event !== null) {
        await client.query(
          `INSERT INTO audit_events
            (id, occurred_at, severity, service, instance_id, environment,
             trading_mode, symbol, account_key, event_name, outcome,
             reason_code, details)
           VALUES ($1, $2, $3, 'execution-service', $4, $5, $6, $7, $8, $9,
                   $10, $11, $12::jsonb)`,
          [
            randomUUID(),
            input.now ?? new Date(),
            event.severity,
            this.#instanceId,
            this.#environment,
            this.#mode,
            this.#symbol,
            this.#accountKey,
            event.name,
            event.outcome,
            event.reason,
            JSON.stringify({
              strategy_version: this.#strategyVersion,
              activity_state: activity.state,
              last_progress_at: activity.lastProgressAt,
              latest_market_at: activity.latestMarketAt,
            }),
          ],
        );
      }
      await client.query("COMMIT");
      return activity;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
