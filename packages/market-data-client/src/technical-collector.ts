import { randomUUID } from "node:crypto";
import type {
  MarketDataAdapter,
  MarketSnapshot,
} from "../../contracts/src/index.js";
import type { TechnicalContextRequestV11 } from "../../contracts/src/technical-context.js";
import {
  CandidateHistoryCache,
  TECHNICAL_HISTORY_COUNTS,
} from "./candidate-history.js";

/** Fixed candidate recipe; never a replacement for production execution configuration. */
export function technicalContextRequest(
  snapshot: MarketSnapshot,
): TechnicalContextRequestV11 {
  return {
    schemaVersion: "technical-context-request-1.1",
    snapshotTime: snapshot.capturedAt,
    request: {
      schemaVersion: "1.0",
      requestId: randomUUID(),
      analysisId: randomUUID(),
      symbol: snapshot.metadata.symbolName,
      analysisTime: snapshot.serverTime,
      serverTime: snapshot.serverTime,
      candles: snapshot.candles,
      orderBook: snapshot.orderBook,
      config: {
        atrPeriod: 15,
        emaFastPeriod: 5,
        emaSlowPeriod: 19,
        adxEnabled: true,
        adxPeriod: 14,
        rsiEnabled: true,
        rsiPeriod: 14,
        bollingerEnabled: false,
        bollingerPeriod: 20,
        bollingerStddev: "2",
        swingPivotLeft: 3,
        swingPivotRight: 3,
        compactTail: { M1: 12, M5: 12, M15: 12 },
        expectedCounts: TECHNICAL_HISTORY_COUNTS,
      },
    },
    quote: snapshot.quote,
    tickSize: snapshot.metadata.tickSize,
    minimumEntryDistance: snapshot.metadata.minStopDistance,
  };
}

type Reader = Pick<
  MarketDataAdapter,
  | "discoverSymbol"
  | "getServerTime"
  | "getTradingSchedule"
  | "getCompletedCandles"
  | "getQuote"
  | "getOrderBookSnapshot"
>;
/** One connected read-only adapter per collector. Reset on every reconnect/scope change. */
export class TechnicalContextCollector {
  #history: CandidateHistoryCache | null = null;
  #symbolId: string | null = null;
  #tail: Promise<unknown> = Promise.resolve();
  #generation = 0;
  constructor(
    private readonly reader: Reader,
    private readonly now: () => number = Date.now,
  ) {}
  reset(): void {
    this.#generation++;
    this.#history?.reset();
    this.#history = null;
    this.#symbolId = null;
  }
  collect(): Promise<TechnicalContextRequestV11> {
    const generation = this.#generation;
    const verifyGeneration = (): void => {
      if (generation !== this.#generation)
        throw new Error("TECHNICAL_COLLECTOR_GENERATION_CHANGED");
    };
    const task = this.#tail
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.#generation)
          throw new Error("TECHNICAL_COLLECTOR_GENERATION_CHANGED");
        try {
          const metadata = await this.reader.discoverSymbol("XAUUSD");
          verifyGeneration();
          if (metadata.symbolName !== "XAUUSD")
            throw new Error("TECHNICAL_COLLECTOR_SYMBOL_MISMATCH");
          if (this.#symbolId !== metadata.symbolId) {
            this.#history?.reset();
            this.#symbolId = metadata.symbolId;
            this.#history = new CandidateHistoryCache((tf, n, to) =>
              this.reader.getCompletedCandles(
                metadata.symbolId,
                tf,
                n,
                to,
                7 * 86400_000,
              ),
            );
          }
          const serverTime = await this.reader.getServerTime();
          const schedule = await this.reader.getTradingSchedule(
            metadata.symbolId,
          );
          verifyGeneration();
          const history = this.#history;
          if (history === null)
            throw new Error("TECHNICAL_COLLECTOR_HISTORY_UNAVAILABLE");
          const candles = await history.read(serverTime, schedule);
          verifyGeneration();
          // Quote and book are captured after historical collection, not before it.
          const quote = await this.reader.getQuote(metadata.symbolId);
          verifyGeneration();
          const orderBook = await this.reader.getOrderBookSnapshot(
            metadata.symbolId,
            4,
          );
          const latestTime = await this.reader.getServerTime();
          if (generation !== this.#generation)
            throw new Error("TECHNICAL_COLLECTOR_GENERATION_CHANGED");
          return technicalContextRequest({
            metadata,
            serverTime: latestTime,
            capturedAt: new Date(this.now()).toISOString(),
            observedSkewMs: Math.abs(
              Date.parse(quote.receivedAt) - Date.parse(orderBook.receivedAt),
            ),
            candles,
            quote,
            orderBook,
          });
        } catch (error) {
          this.#history?.reset();
          throw error;
        }
      });
    this.#tail = task;
    return task;
  }
}
