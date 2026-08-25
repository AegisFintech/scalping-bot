import { describe, expect, it, vi } from "vitest";

import { MarketDataHttpClient } from "../../packages/market-data-client/src/client.js";

describe("market-data HTTP client", () => {
  it("rejects URLs containing credentials", () => {
    expect(
      () =>
        new MarketDataHttpClient({
          baseUrl: "http://user:secret@127.0.0.1:8081",
        }),
    ).toThrow("MARKET_DATA_BASE_URL_CREDENTIALS_FORBIDDEN");
  });

  it("retries one transient 503 and validates only the fresh successful snapshot", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"error":"temporary"}', { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          serverTime: "2026-08-25T12:00:01.000Z",
          capturedAt: "2026-08-25T12:00:01.050Z",
          observedSkewMs: 0,
          metadata: {
            symbolId: "7",
            symbolName: "XAUUSD",
            digits: 2,
            tickSize: "0.01",
            tickValue: "0.01",
            contractSize: "100",
            volumeScale: "0.01",
            minVolume: "100",
            maxVolume: "100000",
            volumeStep: "100",
            minStopDistance: "0.1",
            metadataTime: "2026-08-25T12:00:01.000Z",
          },
          quote: {
            bid: "4640.1",
            ask: "4640.2",
            sourceTime: "2026-08-25T12:00:01.000Z",
            receivedAt: "2026-08-25T12:00:01.010Z",
          },
          candles: ["M1", "M5", "M15"].map((timeframe) => ({
            timeframe,
            candles: [],
          })),
          orderBook: {
            sourceTime: "2026-08-25T12:00:01.000Z",
            receivedAt: "2026-08-25T12:00:01.010Z",
            bids: [{ price: "4640.1", size: "1" }],
            asks: [{ price: "4640.2", size: "1" }],
            complete: true,
            discontinuity: false,
            reconnectSequence: 0,
            aggregates: [
              {
                windowMs: 60_000,
                sampleCount: 1,
                bidLiquidityChange: "0",
                askLiquidityChange: "0",
                additions: 0,
                removals: 0,
              },
              {
                windowMs: 300_000,
                sampleCount: 1,
                bidLiquidityChange: "0",
                askLiquidityChange: "0",
                additions: 0,
                removals: 0,
              },
              {
                windowMs: 900_000,
                sampleCount: 1,
                bidLiquidityChange: "0",
                askLiquidityChange: "0",
                additions: 0,
                removals: 0,
              },
            ],
          },
        }),
      );
    const client = new MarketDataHttpClient({
      baseUrl: "http://127.0.0.1:8081",
      maxRetries: 1,
      retryDelayMs: 0,
      fetchImpl,
    });

    await expect(
      client.snapshot("XAUUSD", { M1: 60, M5: 36, M15: 24 }, 4),
    ).resolves.toMatchObject({ metadata: { symbolName: "XAUUSD" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed after the configured transient retry is exhausted", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const client = new MarketDataHttpClient({
      baseUrl: "http://127.0.0.1:8081",
      maxRetries: 1,
      retryDelayMs: 0,
      fetchImpl,
    });

    await expect(client.quote("XAUUSD")).rejects.toThrow(
      "MARKET_QUOTE_HTTP_ERROR:503",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
