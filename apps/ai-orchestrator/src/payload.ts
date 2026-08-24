export type ModelPayloadMode = "full" | "compact";

export interface ModelPayloadInput {
  readonly mode: ModelPayloadMode;
  readonly analysisId: string;
  readonly symbol: string;
  readonly analysisTime: string;
  readonly serverTime: string;
  readonly analyticsFeatures: Readonly<Record<string, unknown>>;
  readonly performanceContext: Readonly<Record<string, unknown>>;
  readonly promptVersion: string;
  readonly schemaVersion: "1.0";
  readonly strategyVersion: string;
}

function boundedPerformance(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 64_000)
    throw new Error("PERFORMANCE_CONTEXT_OVERSIZED");
  return value;
}

function timeframePayload(
  features: Record<string, unknown>,
  mode: ModelPayloadMode,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [timeframe, value] of Object.entries(features)) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("ANALYTICS_TIMEFRAME_INVALID");
    const source = value as Record<string, unknown>;
    if (mode === "full") {
      if (!Array.isArray(source.full_candles))
        throw new Error("ANALYTICS_FULL_CANDLES_MISSING");
      output[timeframe] = { candles: source.full_candles };
    } else {
      const compact = { ...source };
      delete compact.full_candles;
      output[timeframe] = compact;
    }
  }
  return output;
}

export function buildModelPayload(
  input: ModelPayloadInput,
): Readonly<Record<string, unknown>> {
  const timeframes = input.analyticsFeatures.timeframes;
  if (
    timeframes === null ||
    typeof timeframes !== "object" ||
    Array.isArray(timeframes)
  ) {
    throw new Error("ANALYTICS_TIMEFRAMES_MISSING");
  }
  const payload = {
    schema_version: input.schemaVersion,
    analysis_id: input.analysisId,
    symbol: input.symbol,
    analysis_time: input.analysisTime,
    server_time: input.serverTime,
    payload_mode: input.mode,
    versions: {
      prompt: input.promptVersion,
      schema: input.schemaVersion,
      strategy: input.strategyVersion,
    },
    market: {
      timeframes: timeframePayload(
        timeframes as Record<string, unknown>,
        input.mode,
      ),
      order_book: input.analyticsFeatures.order_book,
      spread_atr_ratio_m1: input.analyticsFeatures.spread_atr_ratio_m1,
    },
    performance: boundedPerformance(input.performanceContext),
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 4_000_000)
    throw new Error("MODEL_PAYLOAD_OVERSIZED");
  return payload;
}
