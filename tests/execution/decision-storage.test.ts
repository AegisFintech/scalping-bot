import { describe, expect, it } from "vitest";

import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
import {
  compactAnalyticsFeatures,
  compactMarketCandles,
  validatePersistedCandleTails,
} from "../../apps/execution-service/src/decision-storage.js";

function snapshot(): MarketSnapshot {
  const candles = ["M1", "M5", "M15"].map((timeframe) => ({
    timeframe: timeframe as "M1" | "M5" | "M15",
    candles: [1, 2, 3].map((minute) => ({
      startTime: `2026-08-27T00:0${minute - 1}:00.000Z`,
      endTime: `2026-08-27T00:0${minute}:00.000Z`,
      open: `${minute}`,
      high: `${minute}`,
      low: `${minute}`,
      close: `${minute}`,
      volume: `${minute}`,
      complete: true,
      qualityFlags: [],
    })),
  }));
  return { candles } as unknown as MarketSnapshot;
}

describe("compact decision storage", () => {
  it("keeps only the configured completed-candle tail without mutating input", () => {
    const input = snapshot();
    const compact = compactMarketCandles(input, { M1: 1, M5: 2, M15: 3 });
    expect(compact.map((series) => series.candles.length)).toEqual([1, 2, 3]);
    expect(compact[0]?.candles[0]?.close).toBe("3");
    expect(input.candles[0]?.candles).toHaveLength(3);
  });

  it("retains scalar decision features but removes duplicated candle arrays", () => {
    const full = {
      schema_version: "1.0",
      timeframes: {
        M1: {
          atr: "1.25",
          full_candles: [{ close: "1" }],
          raw_tail: [{ close: "1" }],
        },
        M5: { ema_fast: "2", full_candles: [], raw_tail: [] },
        M15: { ema_slow: "3", full_candles: [], raw_tail: [] },
      },
      order_book: { spread: "0.1" },
    };
    const compact: unknown = JSON.parse(compactAnalyticsFeatures(full));
    expect(compact).toMatchObject({
      storage_profile: "DECISION_COMPACT_V1",
      timeframes: { M1: { atr: "1.25" } },
    });
    expect(full.timeframes.M1.full_candles).toHaveLength(1);
  });

  it("rejects unbounded candle tails and oversized feature summaries", () => {
    expect(() =>
      validatePersistedCandleTails({ M1: 61, M5: 18, M15: 12 }),
    ).toThrow("TRAIL_CANDLE_TAIL_INVALID:M1");
    expect(() =>
      compactAnalyticsFeatures({
        timeframes: {
          M1: { arbitrary: "x".repeat(65_000) },
          M5: {},
          M15: {},
        },
      }),
    ).toThrow("TRAIL_ANALYTICS_FEATURES_OVERSIZED");
  });
});
