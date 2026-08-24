import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AnalyticsHttpClient } from "../../packages/analytics-client/src/client.js";
import type {
  AnalyticsRequest,
  Timeframe,
} from "../../packages/contracts/src/index.js";

const port = 20_000 + Math.floor(Math.random() * 10_000);
let server: ChildProcess;

async function ready(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) return;
    } catch {
      // Process startup is asynchronous.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ANALYTICS_TEST_SERVER_NOT_READY");
}

function request(): AnalyticsRequest {
  const analysisTime = new Date("2026-01-02T12:00:00Z");
  const series = (["M1", "M5", "M15"] as const).map((timeframe) => {
    const minutes = { M1: 1, M5: 5, M15: 15 }[timeframe];
    return {
      timeframe,
      candles: Array.from({ length: 40 }, (_, index) => {
        const start = new Date(
          analysisTime.getTime() - (40 - index) * minutes * 60_000,
        );
        return {
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
          open: `${2000 + index}`,
          high: `${2002 + index}`,
          low: `${1999 + index}`,
          close: `${2001 + index}`,
          volume: "100",
          complete: true,
          qualityFlags: [],
        };
      }),
    };
  });
  return {
    schemaVersion: "1.0",
    requestId: "11111111-1111-4111-8111-111111111111",
    analysisId: "22222222-2222-4222-8222-222222222222",
    symbol: "XAUUSD",
    analysisTime: analysisTime.toISOString(),
    serverTime: analysisTime.toISOString(),
    candles: series,
    orderBook: {
      sourceTime: analysisTime.toISOString(),
      receivedAt: analysisTime.toISOString(),
      bids: Array.from({ length: 20 }, (_, index) => ({
        price: (2040 - index / 10).toFixed(2),
        size: `${10 + index}`,
      })),
      asks: Array.from({ length: 20 }, (_, index) => ({
        price: (2040.2 + index / 10).toFixed(2),
        size: `${12 + index}`,
      })),
      complete: true,
      discontinuity: false,
      reconnectSequence: 0,
      aggregates: [
        {
          windowMs: 60000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 300000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 900000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
      ],
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
      compactTail: { M1: 10, M5: 10, M15: 10 } satisfies Record<
        Timeframe,
        number
      >,
      expectedCounts: { M1: 40, M5: 40, M15: 40 } satisfies Record<
        Timeframe,
        number
      >,
    },
  };
}

describe("Node to Python analytics integration", () => {
  beforeAll(async () => {
    server = spawn(
      ".venv/bin/uvicorn",
      [
        "python.analytics.api:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { cwd: process.cwd(), stdio: "ignore" },
    );
    await ready();
  });

  afterAll(() => {
    server.kill("SIGTERM");
  });

  it("validates the typed request and response across HTTP", async () => {
    const client = new AnalyticsHttpClient({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    const result = await client.analyze(request());
    expect(result.acceptable).toBe(true);
    expect(result.analysisId).toBe("22222222-2222-4222-8222-222222222222");
    const timeframes = result.features.timeframes as Record<
      string,
      Record<string, unknown>
    >;
    expect(timeframes.M1?.atr).toMatch(
      /^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$/,
    );
    await expect(
      client.summarizePerformance([
        { netPnl: "18", closedAt: new Date().toISOString() },
        { netPnl: "-11", closedAt: new Date().toISOString() },
      ]),
    ).resolves.toMatchObject({ realized_pnl: "7", sample_size: 2 });
  });
});
