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
  readonly schemaVersion: "2.1";
  readonly strategyVersion: string;
  readonly chart: {
    readonly rendererVersion: "completed-candles-ema-atr-v1";
    readonly mimeType: "image/png";
    readonly width: 1600;
    readonly height: 1200;
    readonly sha256: string;
    readonly completedCandlesOnly: true;
    readonly candleCounts: Readonly<Record<"M1" | "M5" | "M15", number>>;
    readonly latestEndTimes: Readonly<Record<"M1" | "M5" | "M15", string>>;
  };
  readonly executionConstraints: {
    readonly currentBid: string;
    readonly currentAsk: string;
    readonly tickSize: string;
    readonly digits: number;
    readonly brokerMinStopDistance: string;
    readonly configuredMinStopDistance: string;
    readonly minRiskRewardRatio: string;
    readonly effectiveMinRiskRewardRatio: string;
    readonly pipSize: string;
    readonly minimumCommissionCoveringTakeProfitDistance: string;
    readonly stopLossToTakeProfitRatio: "2";
    readonly effectiveRiskRewardRatio: "0.5";
    readonly maxAffordableStopDistance: string;
    readonly maxStopDistanceAtr: string;
    readonly maxEntryDistanceAtr: string;
    readonly buyEntryMinimum: string;
    readonly buyEntryMaximum: string;
    readonly sellEntryMinimum: string;
    readonly sellEntryMaximum: string;
    readonly minimumStopDistance: string;
    readonly maximumStopDistance: string;
    readonly preferredExpiresAt: string;
    readonly orderExpiryMinSeconds: number;
    readonly orderExpiryMaxSeconds: number;
    readonly preferredOrderExpirySeconds: number;
  };
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
    chart: {
      renderer_version: input.chart.rendererVersion,
      mime_type: input.chart.mimeType,
      width: input.chart.width,
      height: input.chart.height,
      sha256: input.chart.sha256,
      completed_candles_only: input.chart.completedCandlesOnly,
      candle_counts: input.chart.candleCounts,
      latest_end_times: input.chart.latestEndTimes,
    },
    execution_constraints: {
      current_bid: input.executionConstraints.currentBid,
      current_ask: input.executionConstraints.currentAsk,
      tick_size: input.executionConstraints.tickSize,
      digits: input.executionConstraints.digits,
      broker_min_stop_distance:
        input.executionConstraints.brokerMinStopDistance,
      configured_min_stop_distance:
        input.executionConstraints.configuredMinStopDistance,
      min_risk_reward_ratio: input.executionConstraints.minRiskRewardRatio,
      effective_min_risk_reward_ratio:
        input.executionConstraints.effectiveMinRiskRewardRatio,
      pip_size: input.executionConstraints.pipSize,
      minimum_commission_covering_take_profit_distance:
        input.executionConstraints.minimumCommissionCoveringTakeProfitDistance,
      stop_loss_to_take_profit_ratio:
        input.executionConstraints.stopLossToTakeProfitRatio,
      effective_risk_reward_ratio:
        input.executionConstraints.effectiveRiskRewardRatio,
      max_affordable_stop_distance:
        input.executionConstraints.maxAffordableStopDistance,
      max_stop_distance_atr: input.executionConstraints.maxStopDistanceAtr,
      max_entry_distance_atr: input.executionConstraints.maxEntryDistanceAtr,
      buy_entry_minimum: input.executionConstraints.buyEntryMinimum,
      buy_entry_maximum: input.executionConstraints.buyEntryMaximum,
      sell_entry_minimum: input.executionConstraints.sellEntryMinimum,
      sell_entry_maximum: input.executionConstraints.sellEntryMaximum,
      minimum_stop_distance: input.executionConstraints.minimumStopDistance,
      maximum_stop_distance: input.executionConstraints.maximumStopDistance,
      preferred_expires_at: input.executionConstraints.preferredExpiresAt,
      order_expiry_min_seconds:
        input.executionConstraints.orderExpiryMinSeconds,
      order_expiry_max_seconds:
        input.executionConstraints.orderExpiryMaxSeconds,
      preferred_order_expiry_seconds:
        input.executionConstraints.preferredOrderExpirySeconds,
    },
    performance: boundedPerformance(input.performanceContext),
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 4_000_000)
    throw new Error("MODEL_PAYLOAD_OVERSIZED");
  return payload;
}
