import { z } from "zod";

import type { MarketSnapshot, Timeframe } from "../../contracts/src/index.js";

const decimal = z.string().regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/);
const signedDecimal = z
  .string()
  .regex(/^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/);
const timestamp = z.string().datetime({ offset: true });
const candle = z
  .object({
    startTime: timestamp,
    endTime: timestamp,
    open: decimal,
    high: decimal,
    low: decimal,
    close: decimal,
    volume: decimal.nullable(),
    complete: z.boolean(),
    qualityFlags: z.array(z.string()),
  })
  .strict();
const snapshotSchema = z
  .object({
    serverTime: timestamp,
    capturedAt: timestamp,
    observedSkewMs: z.number().int().nonnegative(),
    metadata: z
      .object({
        symbolId: z.string(),
        symbolName: z.string(),
        digits: z.number().int().nonnegative(),
        pipPosition: z.number().int().nonnegative(),
        pipSize: decimal,
        tickSize: decimal,
        tickValue: decimal,
        baseAsset: z.string().regex(/^[A-Z0-9._-]{2,16}$/),
        quoteAsset: z.string().regex(/^[A-Z0-9._-]{2,16}$/),
        accountAsset: z.string().regex(/^[A-Z0-9._-]{2,16}$/),
        quoteToAccountConversionRate: decimal,
        contractSize: decimal,
        volumeScale: decimal,
        minVolume: decimal,
        maxVolume: decimal,
        volumeStep: decimal,
        minStopDistance: decimal,
        commission: z
          .object({
            type: z.enum([
              "USD_PER_MILLION_USD",
              "USD_PER_LOT",
              "PERCENTAGE_OF_VALUE",
              "QUOTE_CCY_PER_LOT",
            ]),
            rate: decimal,
            minimum: decimal,
            minimumType: z.enum(["CURRENCY", "QUOTE_CURRENCY"]),
            minimumAsset: z.string().regex(/^[A-Z0-9._-]{2,16}$/),
            pnlConversionFeeRate: decimal,
          })
          .strict(),
        metadataTime: timestamp,
      })
      .strict(),
    quote: z
      .object({
        bid: decimal,
        ask: decimal,
        sourceTime: timestamp,
        receivedAt: timestamp,
      })
      .strict(),
    candles: z.array(
      z
        .object({
          timeframe: z.enum(["M1", "M5", "M15"]),
          candles: z.array(candle),
        })
        .strict(),
    ),
    orderBook: z
      .object({
        sourceTime: timestamp,
        receivedAt: timestamp,
        bids: z.array(z.object({ price: decimal, size: decimal }).strict()),
        asks: z.array(z.object({ price: decimal, size: decimal }).strict()),
        complete: z.boolean(),
        discontinuity: z.boolean(),
        reconnectSequence: z.number().int().nonnegative(),
        aggregates: z
          .array(
            z
              .object({
                windowMs: z.union([
                  z.literal(60_000),
                  z.literal(300_000),
                  z.literal(900_000),
                ]),
                sampleCount: z.number().int().nonnegative(),
                bidLiquidityChange: signedDecimal,
                askLiquidityChange: signedDecimal,
                additions: z.number().int().nonnegative(),
                removals: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .length(3),
      })
      .strict(),
  })
  .strict();
const quoteSnapshotSchema = z
  .object({
    serverTime: timestamp,
    metadata: snapshotSchema.shape.metadata,
    quote: snapshotSchema.shape.quote,
  })
  .strict();

export interface MarketDataHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class MarketDataHttpClient {
  readonly #options: MarketDataHttpClientOptions;

  constructor(options: MarketDataHttpClientOptions) {
    const target = new URL(options.baseUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("MARKET_DATA_BASE_URL_PROTOCOL_INVALID");
    }
    if (target.username !== "" || target.password !== "") {
      throw new Error("MARKET_DATA_BASE_URL_CREDENTIALS_FORBIDDEN");
    }
    if (
      !Number.isSafeInteger(options.maxRetries ?? 0) ||
      (options.maxRetries ?? 0) < 0 ||
      (options.maxRetries ?? 0) > 3 ||
      !Number.isSafeInteger(options.retryDelayMs ?? 250) ||
      (options.retryDelayMs ?? 250) < 0 ||
      (options.retryDelayMs ?? 250) > 5_000
    ) {
      throw new Error("MARKET_DATA_RETRY_CONFIG_INVALID");
    }
    this.#options = options;
  }

  async #request(
    path: string,
    body: unknown,
    errorPrefix: string,
  ): Promise<Response> {
    const maxRetries = this.#options.maxRetries ?? 0;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await (this.#options.fetchImpl ?? fetch)(
        new URL(path, this.#options.baseUrl),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? 15_000),
        },
      );
      if (response.ok) return response;
      if (response.status !== 503 || attempt === maxRetries) {
        throw new Error(`${errorPrefix}:${response.status}`);
      }
      const delayMs = this.#options.retryDelayMs ?? 250;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error(`${errorPrefix}:RETRY_EXHAUSTED`);
  }

  async snapshot(
    symbol: string,
    counts: Readonly<Record<Timeframe, number>>,
    depth: number,
  ): Promise<MarketSnapshot> {
    const response = await this.#request(
      "/v1/snapshot",
      { symbol, counts, depth },
      "MARKET_DATA_HTTP_ERROR",
    );
    const parsed = snapshotSchema.parse(await response.json());
    if (parsed.metadata.symbolName !== symbol)
      throw new Error("MARKET_DATA_SYMBOL_MISMATCH");
    if (new Set(parsed.candles.map((series) => series.timeframe)).size !== 3) {
      throw new Error("MARKET_DATA_TIMEFRAMES_INCOMPLETE");
    }
    return parsed;
  }

  async quote(symbol: string): Promise<z.infer<typeof quoteSnapshotSchema>> {
    const response = await this.#request(
      "/v1/quote",
      { symbol },
      "MARKET_QUOTE_HTTP_ERROR",
    );
    const parsed = quoteSnapshotSchema.parse(await response.json());
    if (parsed.metadata.symbolName !== symbol)
      throw new Error("MARKET_QUOTE_SYMBOL_MISMATCH");
    return parsed;
  }
}
