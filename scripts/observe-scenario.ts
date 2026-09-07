import "dotenv/config";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { resolveRuntimeEnvironment } from "../packages/config/src/policy.js";
import { MarketDataHttpClient } from "../packages/market-data-client/src/client.js";
import { AnalyticsHttpClient } from "../packages/analytics-client/src/client.js";
import { ScenarioPlanner } from "../packages/scenario-engine/src/planner.js";
import { observeScenario } from "../packages/scenario-engine/src/observe.js";

// Explicit invocation makes one bounded, potentially chargeable model request; it cannot trade.
let output: string | null = null;
let descriptor: number | null = null;
try {
  const target = process.argv[2];
  if (!target || !target.endsWith(".json") || process.argv.length !== 3)
    throw new Error("SCENARIO_OUTPUT_REQUIRED");
  mkdirSync(path.dirname(target), { recursive: true });
  descriptor = openSync(target, "wx", 0o600);
  output = target;
  const env = resolveRuntimeEnvironment(process.env);
  const result = await observeScenario(
    {
      market: new MarketDataHttpClient({
        baseUrl: "http://127.0.0.1:8081",
        timeoutMs: 10_000,
        maxRetries: 0,
      }),
      analytics: new AnalyticsHttpClient({
        baseUrl: "http://127.0.0.1:8090",
        timeoutMs: 10_000,
      }),
      planner: new ScenarioPlanner({
        baseUrl: env.AI_BASE_URL ?? "",
        apiKey: env.AI_API_KEY ?? "",
      }),
    },
    env.TRADING_SYMBOL ?? "XAUUSD",
  );
  writeFileSync(
    descriptor,
    JSON.stringify(
      {
        label: "OBSERVED_SCENARIO_NOT_A_TRADE",
        capturedAt: result.response.captured_at,
        availableAt: new Date().toISOString(),
        plan: result.response,
        latencyMs: result.latencyMs,
        telemetry: result.telemetry,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      completed: true,
      tradingEnabled: false,
      latencyMs: result.latencyMs,
      ...result.telemetry,
    }),
  );
} catch (error) {
  if (output) {
    try {
      unlinkSync(output);
    } catch {
      /* no partial evidence is published */
    }
  }
  const reason =
    error instanceof Error &&
    /^(AI|SCENARIO|MARKET_DATA|ANALYTICS)_[A-Z0-9_:]{1,120}$/.test(
      error.message,
    )
      ? error.message
      : "SCENARIO_OBSERVATION_FAILED";
  console.error(
    JSON.stringify({ completed: false, reason, tradingEnabled: false }),
  );
  process.exitCode = 1;
} finally {
  if (descriptor !== null) closeSync(descriptor);
}
