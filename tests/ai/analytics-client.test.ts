import { describe, expect, it, vi } from "vitest";

import { AnalyticsHttpClient } from "../../packages/analytics-client/src/client.js";
import type { AnalyticsRequest } from "../../packages/contracts/src/index.js";
import { analysisChart } from "../helpers/analysis-chart.js";

const request: AnalyticsRequest = {
  schemaVersion: "1.0",
  requestId: "11111111-1111-4111-8111-111111111111",
  analysisId: "22222222-2222-4222-8222-222222222222",
  symbol: "XAUUSD",
  analysisTime: "2026-01-01T00:00:00.000Z",
  serverTime: "2026-01-01T00:00:00.000Z",
  candles: [],
  orderBook: {
    sourceTime: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:00.000Z",
    bids: [],
    asks: [],
    complete: true,
    discontinuity: false,
    reconnectSequence: 0,
    aggregates: [],
  },
  config: {
    atrPeriod: 15,
    emaFastPeriod: 5,
    emaSlowPeriod: 19,
    adxEnabled: true,
    adxPeriod: 14,
    rsiEnabled: true,
    rsiPeriod: 14,
    bollingerEnabled: false,
    bollingerPeriod: 20,
    bollingerStddev: "2",
    swingPivotLeft: 3,
    swingPivotRight: 3,
    compactTail: { M1: 1, M5: 1, M15: 1 },
    expectedCounts: { M1: 1, M5: 1, M15: 1 },
  },
};

describe("analytics image contract", () => {
  it("rejects a chart whose bytes do not match its declared hash", async () => {
    const chart = analysisChart();
    const client = new AnalyticsHttpClient({
      baseUrl: "http://127.0.0.1:8090",
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.1",
              requestId: request.requestId,
              analysisId: request.analysisId,
              generatedAt: "2026-01-01T00:00:00.000Z",
              acceptable: true,
              rejectionReasons: [],
              features: {},
              chart: { ...chart, sha256: "0".repeat(64) },
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(client.analyze(request)).rejects.toThrow(
      "ANALYTICS_CHART_INVALID",
    );
  });

  it("accepts a rejected analysis only when no partial chart is returned", async () => {
    const client = new AnalyticsHttpClient({
      baseUrl: "http://127.0.0.1:8090",
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              schemaVersion: "1.1",
              requestId: request.requestId,
              analysisId: request.analysisId,
              generatedAt: "2026-01-01T00:00:00.000Z",
              acceptable: false,
              rejectionReasons: ["M1_FORMING_CANDLE"],
              features: {},
              chart: null,
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(client.analyze(request)).resolves.toMatchObject({
      acceptable: false,
      chart: null,
    });
  });
});
