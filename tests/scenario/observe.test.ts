import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { observeScenario } from "../../packages/scenario-engine/src/observe.js";
import type {
  AnalyticsResponse,
  MarketSnapshot,
} from "../../packages/contracts/src/index.js";
import type { AiAnalysisResult } from "../../packages/ai-client/src/client.js";
import { usageTelemetry } from "../../packages/ai-client/src/telemetry.js";
import type { ScenarioPlan } from "../../packages/scenario-engine/src/plan.js";
import type { ReplayInput } from "../../packages/scenario-engine/src/replay.js";
import { analysisChart } from "../helpers/analysis-chart.js";

function ports() {
  const f = JSON.parse(
    readFileSync(
      "tests/fixtures/scenario/manual-levels-synthetic.json",
      "utf8",
    ),
  ) as ReplayInput;
  const snapshot: MarketSnapshot = {
    serverTime: f.availableAt,
    capturedAt: f.availableAt,
    observedSkewMs: 0,
    metadata: f.metadata,
    candles: [],
    quote: {
      bid: "4403",
      ask: "4403.05",
      sourceTime: f.availableAt,
      receivedAt: f.availableAt,
    },
    orderBook: {
      sourceTime: f.availableAt,
      receivedAt: f.availableAt,
      bids: [],
      asks: [],
      complete: true,
      discontinuity: false,
      reconnectSequence: 0,
      aggregates: [],
    },
  };
  const response: AnalyticsResponse = {
    schemaVersion: "1.1",
    requestId: "fixture",
    analysisId: "fixture",
    generatedAt: f.availableAt,
    acceptable: true,
    rejectionReasons: [],
    features: {},
    chart: analysisChart(),
  };
  const result: AiAnalysisResult<ScenarioPlan> = {
    response: f.plan,
    rawResponse: JSON.stringify(f.plan),
    latencyMs: 1,
    retryCount: 0,
    model: "gpt-6-astra/u64",
    promptArtifact: {
      version: "scenario-v1",
      content: "fixture",
      sha256: "0".repeat(64),
    },
    telemetry: {
      requestedModel: "gpt-6-astra/u64",
      returnedModel: "gpt-6-astra",
      inputProfile: "chart",
      requestBytes: 1,
      responseBytes: 1,
      ...usageTelemetry({}),
    },
  };
  return {
    market: { snapshot: vi.fn(() => Promise.resolve(snapshot)) },
    analytics: { analyze: vi.fn(() => Promise.resolve(response)) },
    planner: { generate: vi.fn(() => Promise.resolve(result)) },
  };
}

describe("automatic scenario capture", () => {
  it("connects typed market, analytics and model ports without an execution dependency", async () => {
    const p = ports();
    await observeScenario(p, "XAUUSD");
    expect(p.market.snapshot).toHaveBeenCalledWith(
      "XAUUSD",
      { M1: 600, M5: 500, M15: 300 },
      4,
    );
    expect(p.analytics.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: "1.0", symbol: "XAUUSD" }),
    );
    expect(p.planner.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "XAUUSD",
        chart: analysisChart(),
      }),
    );
  });
  it("stops before inference on bad analytics or an unavailable market", async () => {
    const p = ports();
    p.analytics.analyze.mockResolvedValue({
      ...(await p.analytics.analyze()),
      acceptable: false,
    });
    await expect(observeScenario(p, "XAUUSD")).rejects.toThrow(
      "SCENARIO_ANALYTICS_UNAVAILABLE",
    );
    expect(p.planner.generate).not.toHaveBeenCalled();
    const unavailable = ports();
    unavailable.market.snapshot.mockRejectedValue(
      new Error("MARKET_DATA_HTTP_ERROR:503"),
    );
    await expect(observeScenario(unavailable, "XAUUSD")).rejects.toThrow(
      "MARKET_DATA_HTTP_ERROR:503",
    );
    expect(unavailable.analytics.analyze).not.toHaveBeenCalled();
  });
  it("keeps replay outputs exclusive and failures redacted", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "scenario-test-"));
    try {
      const out = path.join(folder, "report.json"),
        input = path.join(folder, "input.json");
      writeFileSync(input, '{"private":"fixture-secret"}');
      const run = (source: string) =>
        spawnSync(
          process.execPath,
          ["--import", "tsx", "scripts/replay-scenarios.ts", source, out],
          { encoding: "utf8" },
        );
      const bad = run(input);
      expect(bad.status).toBe(1);
      expect(bad.stderr).not.toContain("fixture-secret");
      const good = run("tests/fixtures/scenario/manual-levels-synthetic.json");
      expect(good.status).toBe(0);
      const before = readFileSync(out, "utf8");
      expect(
        run("tests/fixtures/scenario/manual-levels-synthetic.json").status,
      ).toBe(1);
      expect(readFileSync(out, "utf8")).toBe(before);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
