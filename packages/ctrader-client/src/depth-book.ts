import { Decimal } from "decimal.js";

import type { OrderBookSnapshot } from "../../contracts/src/index.js";
import { canonical } from "../../risk-engine/src/decimal.js";
import { optionalStringField, recordsField, stringField } from "./protocol.js";

interface DepthQuote {
  readonly id: string;
  readonly side: "BID" | "ASK";
  readonly price: Decimal;
  readonly size: Decimal;
}

export interface DepthAggregate {
  readonly windowMs: 60_000 | 300_000 | 900_000;
  readonly sampleCount: number;
  readonly bidLiquidityChange: string;
  readonly askLiquidityChange: string;
  readonly additions: number;
  readonly removals: number;
}

interface BookSample {
  readonly timestamp: number;
  readonly bidDepth: Decimal;
  readonly askDepth: Decimal;
  readonly additions: number;
  readonly removals: number;
}

export class CTraderDepthBook {
  readonly #quotes = new Map<string, DepthQuote>();
  readonly #samples: BookSample[] = [];
  #updatedAt: Date | null = null;
  #receivedAt: Date | null = null;
  #reconnectSequence = 0;
  #discontinuity = true;

  markReconnect(): void {
    this.#quotes.clear();
    this.#reconnectSequence += 1;
    this.#discontinuity = true;
    this.#updatedAt = null;
    this.#receivedAt = null;
  }

  apply(
    payload: Record<string, unknown>,
    sourceAt = new Date(),
    receivedAt = sourceAt,
  ): void {
    if (
      !Number.isFinite(sourceAt.getTime()) ||
      !Number.isFinite(receivedAt.getTime())
    ) {
      throw new Error("CTRADER_DEPTH_TIMESTAMP_INVALID");
    }
    const deleted = Array.isArray(payload.deletedQuotes)
      ? payload.deletedQuotes
      : [];
    let removals = 0;
    for (const id of deleted) {
      if (this.#quotes.delete(String(id))) removals += 1;
    }
    let additions = 0;
    for (const raw of recordsField(payload, "newQuotes")) {
      const id = stringField(raw, "id");
      const bid = optionalStringField(raw, "bid");
      const ask = optionalStringField(raw, "ask");
      if ((bid === undefined) === (ask === undefined)) continue;
      const relative = new Decimal(bid ?? ask ?? "0");
      const quote: DepthQuote = {
        id,
        side: bid === undefined ? "ASK" : "BID",
        price: relative.div(100_000),
        size: new Decimal(stringField(raw, "size")).div(100),
      };
      if (!this.#quotes.has(id)) additions += 1;
      this.#quotes.set(id, quote);
    }
    this.#updatedAt = sourceAt;
    this.#receivedAt = receivedAt;
    if (this.bids.length > 0 && this.asks.length > 0)
      this.#discontinuity = false;
    this.#samples.push({
      timestamp: receivedAt.getTime(),
      bidDepth: this.bids.reduce(
        (total, quote) => total.plus(quote.size),
        new Decimal(0),
      ),
      askDepth: this.asks.reduce(
        (total, quote) => total.plus(quote.size),
        new Decimal(0),
      ),
      additions,
      removals,
    });
    const cutoff = receivedAt.getTime() - 15 * 60_000;
    while ((this.#samples[0]?.timestamp ?? cutoff) < cutoff)
      this.#samples.shift();
  }

  get bids(): readonly DepthQuote[] {
    return [...this.#quotes.values()]
      .filter((quote) => quote.side === "BID")
      .sort((left, right) => right.price.comparedTo(left.price));
  }

  get asks(): readonly DepthQuote[] {
    return [...this.#quotes.values()]
      .filter((quote) => quote.side === "ASK")
      .sort((left, right) => left.price.comparedTo(right.price));
  }

  snapshot(depth: number, now = new Date()): OrderBookSnapshot {
    if (this.#updatedAt === null || this.#receivedAt === null)
      throw new Error("CTRADER_DEPTH_UNAVAILABLE");
    const bids = this.bids.slice(0, depth);
    const asks = this.asks.slice(0, depth);
    return {
      sourceTime: this.#updatedAt.toISOString(),
      receivedAt: this.#receivedAt.toISOString(),
      bids: bids.map((quote) => ({
        price: canonical(quote.price),
        size: canonical(quote.size),
      })),
      asks: asks.map((quote) => ({
        price: canonical(quote.price),
        size: canonical(quote.size),
      })),
      complete: bids.length >= depth && asks.length >= depth,
      discontinuity: this.#discontinuity,
      reconnectSequence: this.#reconnectSequence,
      aggregates: ([60_000, 300_000, 900_000] as const).map((window) =>
        this.aggregate(window, now.getTime()),
      ),
    };
  }

  aggregate(
    windowMs: 60_000 | 300_000 | 900_000,
    now = Date.now(),
  ): DepthAggregate {
    const samples = this.#samples.filter(
      (sample) => sample.timestamp >= now - windowMs,
    );
    const first = samples[0];
    const last = samples.at(-1);
    return {
      windowMs,
      sampleCount: samples.length,
      bidLiquidityChange:
        first === undefined || last === undefined
          ? "0"
          : canonical(last.bidDepth.minus(first.bidDepth)),
      askLiquidityChange:
        first === undefined || last === undefined
          ? "0"
          : canonical(last.askDepth.minus(first.askDepth)),
      additions: samples.reduce((total, sample) => total + sample.additions, 0),
      removals: samples.reduce((total, sample) => total + sample.removals, 0),
    };
  }
}
