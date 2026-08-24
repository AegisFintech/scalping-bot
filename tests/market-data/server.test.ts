import { afterEach, describe, expect, it, vi } from "vitest";

import { createMarketDataServer } from "../../apps/market-data-service/src/index.js";
import type {
  Candle,
  MarketDataAdapter,
  OrderBookSnapshot,
  Quote,
  SymbolMetadata,
} from "../../packages/contracts/src/index.js";

const metadata: SymbolMetadata = {
  symbolId: "41",
  symbolName: "XAUUSD",
  digits: 2,
  tickSize: "0.01",
  tickValue: "0.0001",
  contractSize: "100",
  volumeScale: "0.01",
  minVolume: "100",
  maxVolume: "1000000",
  volumeStep: "100",
  minStopDistance: "0",
  metadataTime: "2026-08-24T00:00:00.000Z",
};

const candle: Candle = {
  startTime: "2026-08-23T23:59:00.000Z",
  endTime: "2026-08-24T00:00:00.000Z",
  open: "4500",
  high: "4501",
  low: "4499",
  close: "4500",
  volume: "1",
  complete: true,
  qualityFlags: [],
};

function adapter(
  quote: Quote,
  orderBook: OrderBookSnapshot,
): MarketDataAdapter {
  return {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    getServerTime: vi.fn(() => Promise.resolve("2026-08-24T00:00:00.000Z")),
    discoverSymbol: vi.fn(() => Promise.resolve(metadata)),
    getCompletedCandles: vi.fn(() => Promise.resolve([candle])),
    getOrderBookSnapshot: vi.fn(() => Promise.resolve(orderBook)),
    getQuote: vi.fn(() => Promise.resolve(quote)),
  };
}

const orderBook: OrderBookSnapshot = {
  sourceTime: "2026-08-24T00:00:00.090Z",
  receivedAt: "2026-08-24T00:00:00.090Z",
  bids: [{ price: "4499.99", size: "1" }],
  asks: [{ price: "4500.01", size: "1" }],
  complete: true,
  discontinuity: false,
  reconnectSequence: 0,
  aggregates: [],
};

afterEach(() => vi.restoreAllMocks());

describe("market-data freshness", () => {
  it("compares quote and book receive times in the same clock domain", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-08-24T00:00:00.100Z"),
    );
    const app = createMarketDataServer({
      adapter: adapter(
        {
          bid: "4499.99",
          ask: "4500.01",
          sourceTime: "2026-08-23T23:59:59.900Z",
          receivedAt: "2026-08-24T00:00:00.080Z",
        },
        orderBook,
      ),
      maxQuoteAgeMs: 3_000,
      maxOrderBookAgeMs: 3_000,
      maxSnapshotSkewMs: 5_000,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/snapshot",
      payload: {
        symbol: "XAUUSD",
        counts: { M1: 1, M5: 1, M15: 1 },
        depth: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ observedSkewMs: 10 });
    await app.close();
  });

  it("rejects a stale locally received quote even if broker time is current", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-08-24T00:00:10.000Z"),
    );
    const app = createMarketDataServer({
      adapter: adapter(
        {
          bid: "4499.99",
          ask: "4500.01",
          sourceTime: "2026-08-24T00:00:10.000Z",
          receivedAt: "2026-08-24T00:00:00.000Z",
        },
        orderBook,
      ),
      maxQuoteAgeMs: 3_000,
      maxOrderBookAgeMs: 3_000,
      maxSnapshotSkewMs: 5_000,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/quote",
      payload: { symbol: "XAUUSD" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: "MARKET_QUOTE_STALE" });
    await app.close();
  });
});
