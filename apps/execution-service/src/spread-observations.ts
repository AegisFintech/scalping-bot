import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import type pg from "pg";

import {
  canonical,
  decimal,
} from "../../../packages/risk-engine/src/decimal.js";

const HISTORY_WINDOW_HOURS = 24;
const HISTORY_LIMIT = 500;

export interface SpreadQuoteSnapshot {
  readonly serverTime: string;
  readonly metadata: {
    readonly symbolId: string;
    readonly symbolName: string;
  };
  readonly quote: {
    readonly bid: string;
    readonly ask: string;
    readonly sourceTime: string;
    readonly receivedAt: string;
  };
}

interface ValidatedSpreadObservation {
  readonly sourceMinute: number;
  readonly sourceTime: string;
  readonly receivedAt: string;
  readonly serverTime: string;
  readonly bid: string;
  readonly ask: string;
  readonly spread: string;
}

function timestamp(value: string, reason: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(reason);
  return parsed;
}

export function validateSpreadObservation(
  snapshot: SpreadQuoteSnapshot,
  maxQuoteAgeMs: number,
  now = new Date(),
): ValidatedSpreadObservation {
  if (!Number.isSafeInteger(maxQuoteAgeMs) || maxQuoteAgeMs < 1) {
    throw new Error("SPREAD_OBSERVATION_MAX_AGE_INVALID");
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs))
    throw new Error("SPREAD_OBSERVATION_NOW_INVALID");
  const sourceMs = timestamp(
    snapshot.quote.sourceTime,
    "SPREAD_OBSERVATION_SOURCE_TIME_INVALID",
  );
  const receivedMs = timestamp(
    snapshot.quote.receivedAt,
    "SPREAD_OBSERVATION_RECEIVED_TIME_INVALID",
  );
  const serverMs = timestamp(
    snapshot.serverTime,
    "SPREAD_OBSERVATION_SERVER_TIME_INVALID",
  );
  if (sourceMs > serverMs) {
    throw new Error("SPREAD_OBSERVATION_SOURCE_TIME_FUTURE");
  }
  if (receivedMs > nowMs) {
    throw new Error("SPREAD_OBSERVATION_RECEIVED_TIME_FUTURE");
  }
  if (
    nowMs - receivedMs > maxQuoteAgeMs ||
    serverMs - sourceMs > maxQuoteAgeMs
  ) {
    throw new Error("SPREAD_OBSERVATION_STALE");
  }
  const bid = decimal(snapshot.quote.bid, "SPREAD_OBSERVATION_BID_INVALID");
  const ask = decimal(snapshot.quote.ask, "SPREAD_OBSERVATION_ASK_INVALID");
  if (bid.lte(0) || ask.lte(0)) {
    throw new Error("SPREAD_OBSERVATION_PRICE_NONPOSITIVE");
  }
  if (ask.lt(bid)) throw new Error("SPREAD_OBSERVATION_CROSSED");
  const sourceMinute = Math.floor(sourceMs / 60_000);
  if (!Number.isSafeInteger(sourceMinute) || sourceMinute < 0) {
    throw new Error("SPREAD_OBSERVATION_SOURCE_MINUTE_INVALID");
  }
  return {
    sourceMinute,
    sourceTime: snapshot.quote.sourceTime,
    receivedAt: snapshot.quote.receivedAt,
    serverTime: snapshot.serverTime,
    bid: canonical(bid),
    ask: canonical(ask),
    spread: canonical(ask.minus(bid)),
  };
}

export function spreadContextFromValues(input: {
  readonly historicalSpreads: readonly string[];
  readonly bid: string;
  readonly ask: string;
  readonly minimumSamples: number;
  readonly abnormalMultiplier: Decimal;
}): {
  readonly observedPercentile: string | null;
  readonly sessionAbnormal: boolean;
} {
  if (!Number.isSafeInteger(input.minimumSamples) || input.minimumSamples < 1) {
    throw new Error("SPREAD_HISTORY_MINIMUM_INVALID");
  }
  if (!input.abnormalMultiplier.isFinite() || input.abnormalMultiplier.lte(0)) {
    throw new Error("SPREAD_ABNORMAL_MULTIPLIER_INVALID");
  }
  if (input.historicalSpreads.length < input.minimumSamples) {
    return { observedPercentile: null, sessionAbnormal: false };
  }
  const values = input.historicalSpreads
    .map((value) => decimal(value, "SPREAD_HISTORY_VALUE_INVALID"))
    .sort((left, right) => left.comparedTo(right));
  const current = decimal(input.ask, "SPREAD_CURRENT_ASK_INVALID").minus(
    decimal(input.bid, "SPREAD_CURRENT_BID_INVALID"),
  );
  if (current.lt(0)) throw new Error("SPREAD_CURRENT_CROSSED");
  const percentile = new Decimal(
    values.filter((value) => value.lte(current)).length,
  )
    .div(values.length)
    .mul(100);
  const median = values[Math.floor((values.length - 1) / 2)];
  return {
    observedPercentile: canonical(
      percentile.toDecimalPlaces(10, Decimal.ROUND_DOWN),
    ),
    sessionAbnormal:
      median === undefined || median.eq(0)
        ? false
        : current.gt(median.mul(input.abnormalMultiplier)),
  };
}

export class PostgresSpreadObservationStore {
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

  async record(
    snapshot: SpreadQuoteSnapshot,
    maxQuoteAgeMs: number,
    now = new Date(),
  ): Promise<boolean> {
    const observation = validateSpreadObservation(snapshot, maxQuoteAgeMs, now);
    const result = await this.#pool.query(
      `INSERT INTO spread_observations
        (id, account_id, symbol_id, source_minute, source_time, received_at,
         server_time, bid, ask, spread, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (account_id, symbol_id, source_minute) DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        this.#accountId,
        this.#symbolId,
        observation.sourceMinute,
        observation.sourceTime,
        observation.receivedAt,
        observation.serverTime,
        observation.bid,
        observation.ask,
        observation.spread,
        now,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async context(input: {
    readonly bid: string;
    readonly ask: string;
    readonly minimumSamples: number;
    readonly abnormalMultiplier: Decimal;
  }): Promise<{
    readonly observedPercentile: string | null;
    readonly sessionAbnormal: boolean;
  }> {
    const result = await this.#pool.query<{ spread: string }>(
      `SELECT spread::text
       FROM spread_observations
       WHERE account_id = $1 AND symbol_id = $2
         AND source_time >= now() - ($3 * interval '1 hour')
       ORDER BY source_time DESC
       LIMIT $4`,
      [this.#accountId, this.#symbolId, HISTORY_WINDOW_HOURS, HISTORY_LIMIT],
    );
    return spreadContextFromValues({
      historicalSpreads: result.rows.map((row) => row.spread),
      ...input,
    });
  }
}

export class SpreadObservationSampler {
  readonly #symbol: string;
  readonly #providerSymbolId: string;
  readonly #maxQuoteAgeMs: number;
  readonly #quote: () => Promise<SpreadQuoteSnapshot>;
  readonly #record: (
    snapshot: SpreadQuoteSnapshot,
    now: Date,
  ) => Promise<boolean>;

  constructor(input: {
    readonly symbol: string;
    readonly providerSymbolId: string;
    readonly maxQuoteAgeMs: number;
    readonly quote: () => Promise<SpreadQuoteSnapshot>;
    readonly record: (
      snapshot: SpreadQuoteSnapshot,
      now: Date,
    ) => Promise<boolean>;
  }) {
    this.#symbol = input.symbol;
    this.#providerSymbolId = input.providerSymbolId;
    this.#maxQuoteAgeMs = input.maxQuoteAgeMs;
    this.#quote = input.quote;
    this.#record = input.record;
  }

  async sample(now?: Date): Promise<boolean> {
    const snapshot = await this.#quote();
    const validatedAt = now ?? new Date();
    if (
      snapshot.metadata.symbolName !== this.#symbol ||
      snapshot.metadata.symbolId !== this.#providerSymbolId
    ) {
      throw new Error("SPREAD_OBSERVATION_SYMBOL_MISMATCH");
    }
    validateSpreadObservation(snapshot, this.#maxQuoteAgeMs, validatedAt);
    return await this.#record(snapshot, validatedAt);
  }
}
