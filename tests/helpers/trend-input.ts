import type { CandleSeries } from "../../packages/contracts/src/index.js";
import type { EntryPlannerInput } from "../../packages/scenario-engine/src/entry-planner.js";
export function trendInput(): EntryPlannerInput {
  const at = Date.parse("2026-11-05T03:00:01Z");
  const candles: CandleSeries[] = (["M1", "M5", "M15"] as const).map(
    (timeframe) => {
      const ms =
        (timeframe === "M1" ? 60 : timeframe === "M5" ? 300 : 900) * 1000;
      const end = Math.floor(at / ms) * ms;
      return {
        timeframe,
        candles: Array.from({ length: 12 }, (_, i) => ({
          startTime: new Date(end - (12 - i) * ms).toISOString(),
          endTime: new Date(end - (11 - i) * ms).toISOString(),
          open: "4000.2",
          high: timeframe !== "M1" && i === 5 ? "4005" : "4001",
          low: "4000",
          close:
            timeframe === "M5" && i >= 9
              ? ((400010 + (i - 9) * 10) / 100).toFixed(2)
              : "4000.2",
          volume: "1",
          complete: true,
          qualityFlags: [],
        })),
      };
    },
  );
  Object.assign(candles[0]!.candles.at(-1)!, {
    high: "4001.3",
    close: "4001.2",
  });
  return {
    analysisId: "00000000-0000-4000-8000-000000000536",
    symbol: "XAUUSD",
    capturedAt: new Date(at).toISOString(),
    tickSize: "0.01",
    pipSize: "0.01",
    minimumStopDistance: "0.01",
    maximumStopDistance: "7",
    chart: null,
    candles,
    quote: {
      bid: "4001.25",
      ask: "4001.28",
      sourceTime: new Date(at).toISOString(),
      receivedAt: new Date(at).toISOString(),
    },
  };
}
