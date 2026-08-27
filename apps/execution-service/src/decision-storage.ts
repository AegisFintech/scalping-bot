import type {
  AnalyticsResponse,
  MarketSnapshot,
  Timeframe,
} from "../../../packages/contracts/src/index.js";
import { redact, type LogValue } from "../../../packages/logging/src/index.js";

export const MAX_PERSISTED_CANDLE_TAILS: Readonly<Record<Timeframe, number>> = {
  M1: 60,
  M5: 36,
  M15: 24,
};

export const MAX_PERSISTED_ANALYTICS_FEATURE_BYTES = 64_000;

export function validatePersistedCandleTails(
  tails: Readonly<Record<Timeframe, number>>,
): void {
  for (const timeframe of ["M1", "M5", "M15"] as const) {
    const value = tails[timeframe];
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > MAX_PERSISTED_CANDLE_TAILS[timeframe]
    ) {
      throw new Error(`TRAIL_CANDLE_TAIL_INVALID:${timeframe}`);
    }
  }
}

export function compactMarketCandles(
  snapshot: MarketSnapshot,
  tails: Readonly<Record<Timeframe, number>>,
): MarketSnapshot["candles"] {
  validatePersistedCandleTails(tails);
  return snapshot.candles.map((series) => ({
    timeframe: series.timeframe,
    candles: series.candles.slice(-tails[series.timeframe]),
  }));
}

export function compactAnalyticsFeatures(
  features: AnalyticsResponse["features"],
): string {
  const timeframes = features.timeframes;
  if (
    timeframes === null ||
    typeof timeframes !== "object" ||
    Array.isArray(timeframes)
  ) {
    throw new Error("TRAIL_ANALYTICS_TIMEFRAMES_INVALID");
  }
  const compactTimeframes: Record<string, unknown> = {};
  for (const [timeframe, value] of Object.entries(timeframes)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("TRAIL_ANALYTICS_TIMEFRAME_INVALID");
    }
    const compact = { ...(value as Record<string, unknown>) };
    delete compact.full_candles;
    delete compact.raw_tail;
    compactTimeframes[timeframe] = compact;
  }
  const serialized = JSON.stringify(
    redact({
      ...features,
      timeframes: compactTimeframes,
      storage_profile: "DECISION_COMPACT_V1",
    } as LogValue),
  );
  if (
    Buffer.byteLength(serialized, "utf8") >
    MAX_PERSISTED_ANALYTICS_FEATURE_BYTES
  ) {
    throw new Error("TRAIL_ANALYTICS_FEATURES_OVERSIZED");
  }
  return serialized;
}
