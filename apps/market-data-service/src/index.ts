import "dotenv/config";

import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import type {
  MarketDataAdapter,
  Timeframe,
} from "../../../packages/contracts/src/index.js";
import { CTraderClient } from "../../../packages/ctrader-client/src/client.js";
import { CTraderTokenManager } from "../../../packages/ctrader-client/src/token-manager.js";
import { SecureTokenFileStore } from "../../../packages/ctrader-client/src/token-store.js";

export interface MarketDataServerOptions {
  readonly adapter: MarketDataAdapter;
  readonly maxQuoteAgeMs: number;
  readonly maxOrderBookAgeMs: number;
  readonly maxSnapshotSkewMs: number;
}

function configuredNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = Number(value === undefined || value === "" ? fallback : value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`CONFIG_NUMBER_INVALID:${name}`);
  return parsed;
}

export function createMarketDataServer(
  options: MarketDataServerOptions,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64_000 });
  let ready = true;
  app.get("/health/live", () => ({ status: "alive" }));
  app.get("/health/ready", (_request, reply) =>
    ready
      ? reply.send({ status: "ready" })
      : reply.code(503).send({ status: "not_ready" }),
  );
  app.post<{ Body: { symbol: string } }>(
    "/v1/quote",
    async (request, reply) => {
      try {
        const metadata = await options.adapter.discoverSymbol(
          request.body.symbol,
        );
        const quote = await options.adapter.getQuote(metadata.symbolId);
        const serverTime = await options.adapter.getServerTime();
        const serverMs = Date.parse(serverTime);
        const sourceMs = Date.parse(quote.sourceTime);
        const age = Date.now() - Date.parse(quote.receivedAt);
        if (
          !Number.isFinite(serverMs) ||
          !Number.isFinite(sourceMs) ||
          sourceMs > serverMs ||
          !Number.isFinite(age) ||
          age < 0 ||
          age > options.maxQuoteAgeMs
        ) {
          throw new Error("MARKET_QUOTE_STALE");
        }
        ready = true;
        return reply.send({ serverTime, metadata, quote });
      } catch (error) {
        ready = false;
        return reply.code(503).send({
          error: "MARKET_QUOTE_UNAVAILABLE",
          reason:
            error instanceof Error ? error.message : "MARKET_QUOTE_FAILED",
        });
      }
    },
  );
  app.post<{
    Body: { symbol: string; counts: Record<Timeframe, number>; depth: number };
  }>("/v1/snapshot", async (request, reply) => {
    try {
      const { symbol, counts, depth } = request.body;
      const metadata = await options.adapter.discoverSymbol(symbol);
      const quote = await options.adapter.getQuote(metadata.symbolId);
      const [m1, m5, m15, orderBook] = await Promise.all([
        options.adapter.getCompletedCandles(metadata.symbolId, "M1", counts.M1),
        options.adapter.getCompletedCandles(metadata.symbolId, "M5", counts.M5),
        options.adapter.getCompletedCandles(
          metadata.symbolId,
          "M15",
          counts.M15,
        ),
        options.adapter.getOrderBookSnapshot(metadata.symbolId, depth),
      ]);
      // Capture the authoritative broker clock after all components so source
      // timestamps cannot appear to be from the future merely due to ordering.
      const serverTime = await options.adapter.getServerTime();
      const serverMs = Date.parse(serverTime);
      const capturedAtMs = Date.now();
      const quoteReceivedMs = Date.parse(quote.receivedAt);
      const bookReceivedMs = Date.parse(orderBook.receivedAt);
      const quoteSourceMs = Date.parse(quote.sourceTime);
      const bookSourceMs = Date.parse(orderBook.sourceTime);
      const quoteAge = capturedAtMs - quoteReceivedMs;
      const bookAge = capturedAtMs - bookReceivedMs;
      const skew = Math.abs(quoteReceivedMs - bookReceivedMs);
      if (
        !Number.isFinite(serverMs) ||
        !Number.isFinite(quoteSourceMs) ||
        !Number.isFinite(bookSourceMs) ||
        !Number.isFinite(quoteAge) ||
        !Number.isFinite(bookAge) ||
        !Number.isFinite(skew) ||
        quoteAge < 0 ||
        quoteAge > options.maxQuoteAgeMs ||
        bookAge < 0 ||
        bookAge > options.maxOrderBookAgeMs ||
        skew > options.maxSnapshotSkewMs ||
        quoteSourceMs > serverMs ||
        bookSourceMs > serverMs ||
        !orderBook.complete ||
        orderBook.discontinuity
      ) {
        throw new Error("MARKET_SNAPSHOT_STALE_OR_INCOMPLETE");
      }
      ready = true;
      return reply.send({
        serverTime,
        capturedAt: new Date(capturedAtMs).toISOString(),
        observedSkewMs: skew,
        metadata,
        quote,
        candles: [
          { timeframe: "M15", candles: m15 },
          { timeframe: "M5", candles: m5 },
          { timeframe: "M1", candles: m1 },
        ],
        orderBook,
      });
    } catch (error) {
      ready = false;
      return reply.code(503).send({
        error: "MARKET_SNAPSHOT_UNAVAILABLE",
        reason:
          error instanceof Error ? error.message : "MARKET_SNAPSHOT_FAILED",
      });
    }
  });
  return app;
}

async function main(): Promise<void> {
  const connectionMode =
    process.env.CTRADER_CONNECTION_MODE === "live" ? "live" : "demo";
  const expiry = process.env.CTRADER_ACCESS_TOKEN_EXPIRES_AT;
  const tokenStore = new SecureTokenFileStore(
    process.env.CTRADER_TOKEN_STATE_FILE ?? ".runtime/ctrader-token-state.json",
  );
  const stored = await tokenStore.read();
  const tokenManager = new CTraderTokenManager({
    clientId: process.env.CTRADER_CLIENT_ID ?? "",
    clientSecret: process.env.CTRADER_CLIENT_SECRET ?? "",
    tokenUrl:
      process.env.CTRADER_TOKEN_URL ?? "https://openapi.ctrader.com/apps/token",
    accessToken: stored?.accessToken ?? process.env.CTRADER_ACCESS_TOKEN ?? "",
    refreshToken:
      stored?.refreshToken ?? process.env.CTRADER_REFRESH_TOKEN ?? "",
    ...(stored !== null
      ? { accessTokenExpiresAt: stored.expiresAt }
      : expiry === undefined || expiry === ""
        ? {}
        : { accessTokenExpiresAt: new Date(expiry) }),
    onRefresh: (tokens) => tokenStore.write(tokens),
    refreshCoordinator: (refreshToken, refresh) =>
      tokenStore.coordinateRefresh(refreshToken, refresh),
  });
  const adapter = new CTraderClient({
    clientId: process.env.CTRADER_CLIENT_ID ?? "",
    clientSecret: process.env.CTRADER_CLIENT_SECRET ?? "",
    ...(process.env.ACCOUNT_ID === undefined || process.env.ACCOUNT_ID === ""
      ? {}
      : { accountId: process.env.ACCOUNT_ID }),
    connectionMode,
    allowOrderCommands: false,
    tokenManager,
    transportOptions: {
      host:
        process.env.CTRADER_API_HOST ??
        (connectionMode === "live"
          ? "live.ctraderapi.com"
          : "demo.ctraderapi.com"),
      port: configuredNumber(
        process.env.CTRADER_API_PORT,
        5036,
        "CTRADER_API_PORT",
      ),
      requestTimeoutMs: configuredNumber(
        process.env.CTRADER_REQUEST_TIMEOUT_MS,
        10_000,
        "CTRADER_REQUEST_TIMEOUT_MS",
      ),
      reconnectMinMs: configuredNumber(
        process.env.CTRADER_RECONNECT_MIN_MS,
        1_000,
        "CTRADER_RECONNECT_MIN_MS",
      ),
      reconnectMaxMs: configuredNumber(
        process.env.CTRADER_RECONNECT_MAX_MS,
        30_000,
        "CTRADER_RECONNECT_MAX_MS",
      ),
    },
    orderBookTimeoutMs: configuredNumber(
      process.env.ORDER_BOOK_SNAPSHOT_TIMEOUT_MS,
      3_000,
      "ORDER_BOOK_SNAPSHOT_TIMEOUT_MS",
    ),
  });
  await adapter.connect();
  const app = createMarketDataServer({
    adapter,
    maxQuoteAgeMs: configuredNumber(
      process.env.MAX_QUOTE_AGE_MS,
      3_000,
      "MAX_QUOTE_AGE_MS",
    ),
    maxOrderBookAgeMs: configuredNumber(
      process.env.ORDER_BOOK_MAX_AGE_MS,
      3_000,
      "ORDER_BOOK_MAX_AGE_MS",
    ),
    maxSnapshotSkewMs: configuredNumber(
      process.env.MAX_CANDLE_SKEW_MS,
      5_000,
      "MAX_CANDLE_SKEW_MS",
    ),
  });
  const shutdown = async (): Promise<void> => {
    await app.close();
    await adapter.disconnect();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: configuredNumber(
      process.env.MARKET_DATA_PORT,
      8081,
      "MARKET_DATA_PORT",
    ),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
