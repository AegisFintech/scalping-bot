import type pg from "pg";

import type { CycleResult } from "./coordinator.js";

const M1_INTERVAL_MS = 60_000;

export function alignedSchedulerDelayMs(
  nowMs: number,
  intervalSeconds: number,
  leadMs = 0,
): number {
  const intervalMs = intervalSeconds * 1_000;
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(intervalSeconds) ||
    intervalSeconds < 1 ||
    intervalSeconds > 60 ||
    !Number.isSafeInteger(intervalMs) ||
    !Number.isSafeInteger(leadMs) ||
    leadMs < 0 ||
    leadMs >= intervalMs
  ) {
    throw new Error("AUTOMATIC_ANALYSIS_INTERVAL_INVALID");
  }
  const remainder = nowMs % intervalMs;
  const targetRemainder = (intervalMs - leadMs) % intervalMs;
  const delay = (targetRemainder - remainder + intervalMs) % intervalMs;
  return delay === 0 ? intervalMs : delay;
}

export interface AutomaticAnalysisWindow {
  readonly allowed: boolean;
  readonly intervalStart: string | null;
  readonly reasonCodes: readonly string[];
}

export function evaluateAutomaticAnalysisWindow(input: {
  readonly serverTime: string;
  readonly startWindowSeconds: number;
}): AutomaticAnalysisWindow {
  if (
    !Number.isSafeInteger(input.startWindowSeconds) ||
    input.startWindowSeconds < 1 ||
    input.startWindowSeconds > 30
  ) {
    return {
      allowed: false,
      intervalStart: null,
      reasonCodes: ["AUTOMATIC_ANALYSIS_START_WINDOW_INVALID"],
    };
  }
  const serverTime = Date.parse(input.serverTime);
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.serverTime) ||
    !Number.isFinite(serverTime) ||
    serverTime < 0
  ) {
    return {
      allowed: false,
      intervalStart: null,
      reasonCodes: ["AUTOMATIC_ANALYSIS_SERVER_TIME_INVALID"],
    };
  }
  const intervalStartMs =
    Math.floor(serverTime / M1_INTERVAL_MS) * M1_INTERVAL_MS;
  const intervalStart = new Date(intervalStartMs).toISOString();
  if (serverTime - intervalStartMs >= input.startWindowSeconds * 1_000) {
    return {
      allowed: false,
      intervalStart,
      reasonCodes: ["AUTOMATIC_ANALYSIS_OUTSIDE_M1_START_WINDOW"],
    };
  }
  return { allowed: true, intervalStart, reasonCodes: [] };
}

export class PostgresAutomaticAnalysisSchedule {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
  }

  async claim(input: {
    readonly intervalStart: string;
    readonly brokerServerTime: string;
  }): Promise<boolean> {
    const result = await this.#pool.query(
      `INSERT INTO automatic_analysis_intervals
        (account_id, symbol_id, interval_start, broker_server_time)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, symbol_id, interval_start) DO NOTHING
       RETURNING interval_start`,
      [
        this.#accountId,
        this.#symbolId,
        input.intervalStart,
        input.brokerServerTime,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async complete(intervalStart: string, result: CycleResult): Promise<void> {
    const updated = await this.#pool.query(
      `UPDATE automatic_analysis_intervals
       SET cycle_id = $4,
           analysis_id = (SELECT id FROM analysis_runs WHERE id = $4),
           outcome = $5, completed_at = now()
       WHERE account_id = $1 AND symbol_id = $2 AND interval_start = $3
         AND completed_at IS NULL`,
      [
        this.#accountId,
        this.#symbolId,
        intervalStart,
        result.analysisId,
        result.outcome,
      ],
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new Error("AUTOMATIC_ANALYSIS_INTERVAL_COMPLETION_MISSING");
    }
  }
}
