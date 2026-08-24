import { describe, expect, it } from "vitest";

import { buildModelPayload } from "../../apps/ai-orchestrator/src/payload.js";

const common = {
  analysisId: "22222222-2222-4222-8222-222222222222",
  symbol: "XAUUSD",
  analysisTime: "2026-01-01T00:00:00Z",
  serverTime: "2026-01-01T00:00:00Z",
  analyticsFeatures: {
    timeframes: {
      M1: {
        full_candles: [{ close: "1" }],
        raw_tail: [{ close: "1" }],
        atr: "0.1",
      },
      M5: {
        full_candles: [{ close: "1" }],
        raw_tail: [{ close: "1" }],
        atr: "0.2",
      },
      M15: {
        full_candles: [{ close: "1" }],
        raw_tail: [{ close: "1" }],
        atr: "0.3",
      },
    },
    order_book: { spread: "0.1" },
    spread_atr_ratio_m1: "1",
  },
  performanceContext: { sample_size: 30, confidence_delta: -5 },
  promptVersion: "system-v1",
  schemaVersion: "1.0" as const,
  strategyVersion: "test",
};

describe("model payload builder", () => {
  it("omits full histories in compact mode", () => {
    const payload = buildModelPayload({ ...common, mode: "compact" });
    const market = payload.market as {
      timeframes: Record<string, Record<string, unknown>>;
    };
    expect(market.timeframes.M1?.full_candles).toBeUndefined();
    expect(market.timeframes.M1?.raw_tail).toHaveLength(1);
  });

  it("sends deterministic per-candle features in full mode", () => {
    const payload = buildModelPayload({ ...common, mode: "full" });
    const market = payload.market as {
      timeframes: Record<string, { candles: unknown[] }>;
    };
    expect(market.timeframes.M15?.candles).toHaveLength(1);
  });
});
