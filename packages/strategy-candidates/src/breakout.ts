import type {
  ModelResponse,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { decimal, isTickAligned } from "../../risk-engine/src/index.js";

/** Separately reviewable candidate; deliberately not imported by execution. */
export const BREAKOUT_CANDIDATE = {
  version: "breakout-stop-limit-candidate-1.0",
  authority: "RESEARCH_ONLY",
  orderType: "STOP_LIMIT",
  timeInForce: "GTC",
  maxQuoteAgeMs: 3000,
  maxMetadataAgeMs: 86400000,
  /** Broker STOP_LIMIT range, in tick-size points, not a profit guarantee. */
  maxSlippagePoints: "30",
} as const;

export interface BreakoutCandidateInput {
  readonly response: ModelResponse;
  readonly metadata: SymbolMetadata;
  readonly quote: {
    readonly bid: string;
    readonly ask: string;
    readonly sourceTime: string;
    readonly receivedAt: string;
  };
  readonly now: string;
  /** Actual provider-result availability; never request/placement persistence time. */
  readonly availableAt: string;
}

export interface BreakoutCandidateResult {
  readonly version: typeof BREAKOUT_CANDIDATE.version;
  readonly authority: "RESEARCH_ONLY";
  readonly accepted: boolean;
  readonly reasonCodes: readonly string[];
  readonly response: ModelResponse | null;
  readonly orderType: "STOP_LIMIT";
  readonly timeInForce: "GTC";
  readonly maxSlippagePoints: "30";
}

function time(value: string): number {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return Number.NaN;
  return Date.parse(value);
}

function result(
  response: ModelResponse | null,
  reasons: string[],
): BreakoutCandidateResult {
  return {
    ...BREAKOUT_CANDIDATE,
    accepted: response !== null,
    response,
    reasonCodes: reasons,
  };
}

/** Preserve model breakout direction/levels. Crossed levels wait; never reprice. */
export function buildBreakoutCandidate(
  input: BreakoutCandidateInput,
): BreakoutCandidateResult {
  try {
    const { response, metadata, quote } = input;
    const now = time(input.now);
    const available = time(input.availableAt);
    const source = time(quote.sourceTime);
    const received = time(quote.receivedAt);
    const meta = time(metadata.metadataTime);
    const generated = time(response.generated_at);
    const expires = time(response.valid_until);
    if (
      ![now, available, source, received, meta, generated, expires].every(
        Number.isFinite,
      ) ||
      generated > available ||
      available > now ||
      source > received ||
      received > now ||
      now - source > BREAKOUT_CANDIDATE.maxQuoteAgeMs ||
      meta > now ||
      now - meta > BREAKOUT_CANDIDATE.maxMetadataAgeMs ||
      expires <= now
    )
      return result(null, ["BREAKOUT_CANDIDATE_PROVENANCE_INVALID"]);
    if (response.symbol !== metadata.symbolName)
      return result(null, ["BREAKOUT_CANDIDATE_SYMBOL_MISMATCH"]);
    const bid = decimal(quote.bid),
      ask = decimal(quote.ask),
      tick = decimal(metadata.tickSize);
    const minimumDistance = decimal(metadata.minStopDistance);
    if (
      bid.lte(0) ||
      ask.lt(bid) ||
      tick.lte(0) ||
      !isTickAligned(bid, tick) ||
      !isTickAligned(ask, tick)
    )
      throw new Error("invalid quote");
    const reasons: string[] = [];
    for (const [side, leg] of [
      ["BUY", response.buy_stop],
      ["SELL", response.sell_stop],
    ] as const) {
      const entry = decimal(leg.entry_price),
        trigger = decimal(leg.trigger_price);
      const stop = decimal(leg.stop_loss),
        target = decimal(leg.take_profit);
      if (
        [entry, trigger, stop, target].some((value) => value.lte(0)) ||
        ![
          leg.entry_price,
          leg.trigger_price,
          leg.stop_loss,
          leg.take_profit,
        ].every((value) => isTickAligned(decimal(value), tick))
      )
        reasons.push(`${side}_BREAKOUT_PRICE_INVALID`);
      if (
        !entry.eq(trigger) ||
        (side === "BUY" ? entry.lte(ask) : entry.gte(bid))
      )
        reasons.push(`${side}_BREAKOUT_LEVEL_CROSSED_OR_INVALID`);
      if (
        side === "BUY"
          ? !(stop.lt(entry) && target.gt(entry))
          : !(stop.gt(entry) && target.lt(entry))
      )
        reasons.push(`${side}_BREAKOUT_PROTECTION_INVALID`);
      const entryRoom = side === "BUY" ? entry.minus(ask) : bid.minus(entry);
      if (
        entryRoom.lt(minimumDistance) ||
        entry.minus(stop).abs().lt(minimumDistance) ||
        target.minus(entry).abs().lt(minimumDistance)
      )
        reasons.push(`${side}_BREAKOUT_BROKER_DISTANCE_INVALID`);
      const expiry = time(leg.expires_at);
      if (!Number.isFinite(expiry) || expiry <= now || expiry > expires)
        reasons.push(`${side}_BREAKOUT_SUBMISSION_EXPIRED`);
    }
    if (
      decimal(response.buy_stop.entry_price).lte(
        decimal(response.sell_stop.entry_price),
      )
    )
      reasons.push("BREAKOUT_RANGE_INVALID");
    return reasons.length
      ? result(null, reasons)
      : result(structuredClone(response), []);
  } catch {
    return result(null, ["BREAKOUT_CANDIDATE_INPUT_INVALID"]);
  }
}
