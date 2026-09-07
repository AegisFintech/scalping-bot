import { randomUUID } from "node:crypto";
import type { AnalyticsHttpClient } from "../../analytics-client/src/client.js";
import type { MarketDataHttpClient } from "../../market-data-client/src/client.js";
import { FIXED_DEFAULTS as F } from "../../config/src/policy.js";
import type { ScenarioPlanner } from "./planner.js";

/** One read-only observation using the existing typed local services. No execution imports. */
export async function observeScenario(
  ports: {
    market: Pick<MarketDataHttpClient, "snapshot">;
    analytics: Pick<AnalyticsHttpClient, "analyze">;
    planner: Pick<ScenarioPlanner, "generate">;
  },
  symbol: string,
) {
  const counts = {
    M1: Number(F.BARS_1M),
    M5: Number(F.BARS_5M),
    M15: Number(F.BARS_15M),
  };
  const snapshot = await ports.market.snapshot(
    symbol,
    counts,
    Number(F.ORDER_BOOK_DEPTH),
  );
  const analysisId = randomUUID();
  const analytics = await ports.analytics.analyze({
    schemaVersion: "1.0",
    requestId: randomUUID(),
    analysisId,
    symbol,
    analysisTime: snapshot.serverTime,
    serverTime: snapshot.serverTime,
    candles: snapshot.candles,
    orderBook: snapshot.orderBook,
    config: {
      atrPeriod: Number(F.ATR_PERIOD),
      emaFastPeriod: Number(F.EMA_FAST_PERIOD),
      emaSlowPeriod: Number(F.EMA_SLOW_PERIOD),
      adxEnabled: F.ADX_ENABLED === "true",
      adxPeriod: Number(F.ADX_PERIOD),
      rsiEnabled: F.RSI_ENABLED === "true",
      rsiPeriod: Number(F.RSI_PERIOD),
      bollingerEnabled: false,
      bollingerPeriod: Number(F.BOLLINGER_PERIOD),
      bollingerStddev: F.BOLLINGER_STDDEV,
      swingPivotLeft: Number(F.SWING_PIVOT_LEFT),
      swingPivotRight: Number(F.SWING_PIVOT_RIGHT),
      compactTail: { M1: 30, M5: 18, M15: 12 },
      expectedCounts: counts,
    },
  });
  if (!analytics.acceptable || analytics.chart === null)
    throw new Error("SCENARIO_ANALYTICS_UNAVAILABLE");
  return ports.planner.generate({
    analysisId,
    symbol,
    capturedAt: snapshot.serverTime,
    tickSize: snapshot.metadata.tickSize,
    candles: snapshot.candles,
    chart: analytics.chart,
  });
}
