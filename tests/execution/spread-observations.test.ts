import { Decimal } from "decimal.js";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  PostgresSpreadObservationStore,
  SpreadObservationSampler,
  spreadContextFromValues,
  validateSpreadObservation,
  type SpreadQuoteSnapshot,
} from "../../apps/execution-service/src/spread-observations.js";

const now = new Date("2026-08-24T00:00:01.000Z");
const quote: SpreadQuoteSnapshot = {
  serverTime: "2026-08-24T00:00:00.950Z",
  metadata: { symbolId: "41", symbolName: "XAUUSD" },
  quote: {
    bid: "4649.12",
    ask: "4649.21",
    sourceTime: "2026-08-24T00:00:00.900Z",
    receivedAt: "2026-08-24T00:00:00.980Z",
  },
};

describe("spread observation validation", () => {
  it("preserves canonical decimal values and the broker-source UTC minute", () => {
    expect(validateSpreadObservation(quote, 3_000, now)).toEqual({
      sourceMinute: 29_792_160,
      sourceTime: quote.quote.sourceTime,
      receivedAt: quote.quote.receivedAt,
      serverTime: quote.serverTime,
      bid: "4649.12",
      ask: "4649.21",
      spread: "0.09",
    });
  });

  it.each([
    [
      "SPREAD_OBSERVATION_CROSSED",
      { quote: { ...quote.quote, bid: "4649.22" } },
    ],
    [
      "SPREAD_OBSERVATION_STALE",
      {
        quote: {
          ...quote.quote,
          sourceTime: "2026-08-23T23:59:50.000Z",
        },
      },
    ],
    [
      "SPREAD_OBSERVATION_SOURCE_TIME_FUTURE",
      {
        quote: {
          ...quote.quote,
          sourceTime: "2026-08-24T00:00:00.951Z",
        },
      },
    ],
    [
      "SPREAD_OBSERVATION_RECEIVED_TIME_FUTURE",
      {
        quote: {
          ...quote.quote,
          receivedAt: "2026-08-24T00:00:01.001Z",
        },
      },
    ],
    [
      "SPREAD_OBSERVATION_BID_INVALID",
      { quote: { ...quote.quote, bid: "4649.12345678901" } },
    ],
    ["SPREAD_OBSERVATION_SERVER_TIME_INVALID", { serverTime: "not-a-time" }],
  ])("rejects invalid input with %s", (reason, override) => {
    expect(() =>
      validateSpreadObservation({ ...quote, ...override }, 3_000, now),
    ).toThrow(reason);
  });
});

describe("spread observation persistence and context", () => {
  it("uses a conflict-safe minute insert and reports duplicates", async () => {
    const query = vi
      .fn<
        (
          sql: string,
          parameters: readonly unknown[],
        ) => Promise<{ rowCount: number; rows: readonly { id?: string }[] }>
      >()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "first" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresSpreadObservationStore({
      pool: { query } as unknown as pg.Pool,
      accountId: "account-id",
      symbolId: "symbol-id",
    });

    await expect(store.record(quote, 3_000, now)).resolves.toBe(true);
    await expect(store.record(quote, 3_000, now)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain(
      "ON CONFLICT (account_id, symbol_id, source_minute) DO NOTHING",
    );
    expect(query.mock.calls[0]?.[1]?.slice(1, 4)).toEqual([
      "account-id",
      "symbol-id",
      29_792_160,
    ]);
  });

  it("withholds history below the minimum and computes it at the boundary", () => {
    const history = Array.from({ length: 30 }, (_, index) =>
      new Decimal(index + 1).div(100).toFixed(2),
    );
    expect(
      spreadContextFromValues({
        historicalSpreads: history.slice(0, 29),
        bid: "100",
        ask: "100.10",
        minimumSamples: 30,
        abnormalMultiplier: new Decimal(3),
      }),
    ).toEqual({ observedPercentile: null, sessionAbnormal: false });
    expect(
      spreadContextFromValues({
        historicalSpreads: history,
        bid: "100",
        ask: "100.10",
        minimumSamples: 30,
        abnormalMultiplier: new Decimal(3),
      }),
    ).toEqual({
      observedPercentile: "33.3333333333",
      sessionAbnormal: false,
    });
  });

  it("rejects a symbol mismatch before persistence", async () => {
    const record = vi.fn(() => Promise.resolve(true));
    const sampler = new SpreadObservationSampler({
      symbol: "XAUUSD",
      providerSymbolId: "41",
      maxQuoteAgeMs: 3_000,
      quote: () =>
        Promise.resolve({
          ...quote,
          metadata: { ...quote.metadata, symbolId: "42" },
        }),
      record,
    });

    await expect(sampler.sample(now)).rejects.toThrow(
      "SPREAD_OBSERVATION_SYMBOL_MISMATCH",
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("does not persist when the typed quote source is unavailable", async () => {
    const record = vi.fn(() => Promise.resolve(true));
    const sampler = new SpreadObservationSampler({
      symbol: "XAUUSD",
      providerSymbolId: "41",
      maxQuoteAgeMs: 3_000,
      quote: () => Promise.reject(new Error("MARKET_QUOTE_HTTP_ERROR:503")),
      record,
    });

    await expect(sampler.sample(now)).rejects.toThrow(
      "MARKET_QUOTE_HTTP_ERROR:503",
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("captures local validation time after quote retrieval", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
      const record = vi.fn<
        (snapshot: SpreadQuoteSnapshot, capturedAt: Date) => Promise<boolean>
      >(() => Promise.resolve(true));
      const laterQuote: SpreadQuoteSnapshot = {
        ...quote,
        serverTime: "2026-08-24T00:00:01.100Z",
        quote: {
          ...quote.quote,
          sourceTime: "2026-08-24T00:00:01.000Z",
          receivedAt: "2026-08-24T00:00:01.100Z",
        },
      };
      const sampler = new SpreadObservationSampler({
        symbol: "XAUUSD",
        providerSymbolId: "41",
        maxQuoteAgeMs: 3_000,
        quote: () => {
          vi.setSystemTime(new Date("2026-08-24T00:00:01.200Z"));
          return Promise.resolve(laterQuote);
        },
        record,
      });

      await expect(sampler.sample()).resolves.toBe(true);
      expect(record.mock.calls[0]?.[1].toISOString()).toBe(
        "2026-08-24T00:00:01.200Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
