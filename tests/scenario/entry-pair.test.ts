import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  parseEntryPrices,
  bindEntryPrices,
  validateEntryPlan,
} from "../../packages/scenario-engine/src/entry-plan.js";
import { EntryPairPlanner } from "../../packages/scenario-engine/src/entry-planner.js";
import { EntryPairHttpPlanner } from "../../packages/scenario-engine/src/entry-http-planner.js";
import { scenarioOco } from "../../packages/scenario-engine/src/oco.js";
import { createAiServer } from "../../apps/ai-orchestrator/src/index.js";
import { OpenAiCompatibleClient } from "../../packages/ai-client/src/client.js";
import type { ReplayInput } from "../../packages/scenario-engine/src/replay.js";
import type { CandleSeries } from "../../packages/contracts/src/index.js";
import { analysisChart } from "../helpers/analysis-chart.js";
import { checkSpread } from "../../packages/risk-engine/src/spread.js";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/scenario/manual-levels-synthetic.json", "utf8"),
) as ReplayInput;
const context = {
  analysisId: fixture.plan.analysis_id,
  symbol: "XAUUSD",
  capturedAt: fixture.plan.captured_at,
  tickSize: "0.01",
};
const base = Date.parse(context.capturedAt);
describe("direct entries (synthetic, no broker authority)", () => {
  it("removes all spread strategy gates even without ATR, while rejecting crossed quotes", () => {
    const input = {
      skipStrategyLimits: true,
      bid: "4400",
      ask: "4401",
      tickSize: "0.01",
      atr: "0",
      maxPoints: "1",
      maxAtrRatio: "0.01",
      observedPercentile: null,
      maxPercentile: "1",
      sessionAbnormal: true,
      liveMode: false,
    };
    expect(checkSpread(input)).toMatchObject({
      approved: true,
      spreadAtrRatio: null,
    });
    expect(checkSpread({ ...input, bid: "4402" })).toMatchObject({
      approved: false,
      reasonCodes: ["SPREAD_CROSSED"],
    });
  });
  it.each([
    '{"buy_stop":"4410.10","sell_stop":"4400.20"}',
    'Here are entries:\n```json\n{"buy_stop":4410.1,"sell_stop":4400.2,"explanation":"ignored","schema_version":"irrelevant"}\n```',
    '{"buy_stop":{"entry_price":"4410.10","stop_loss":"ignored"},"sell_stop":{"price":"4400.20"}}',
  ])("reads prices without requiring scenario metadata: %s", (raw) => {
    expect(parseEntryPrices(raw)).toEqual({
      buy_stop: "4410.1",
      sell_stop: "4400.2",
    });
    expect(bindEntryPrices(raw, context)).toMatchObject({
      analysis_id: context.analysisId,
      schema_version: "entry-pair-1.0",
      valid_until: new Date(base + 300_000).toISOString(),
    });
  });
  it.each([
    '{"buy_stop":"1"}',
    '{"buy_stop":"1","sell_stop":null}',
    '{"buy_stop":"1","buy_stop":"2","sell_stop":"3"}',
    '{"buy_stop":"NaN","sell_stop":"3"}',
    '{"buy_stop":"0","sell_stop":"3"}',
    '{"buy_stop":"1","sell_stop":"3"} {"buy_stop":"2","sell_stop":"4"}',
    '{"buy_stop":"1","sell_stop":"3"',
  ])("rejects unreadable/ambiguous prices: %s", (raw) =>
    expect(() => parseEntryPrices(raw)).toThrow(/AI_ENTRY_/),
  );
  it("retains executable precision and local expiry without trusting returned metadata", () => {
    expect(() =>
      bindEntryPrices('{"buy_stop":"4410.101","sell_stop":"4400"}', context),
    ).toThrow("AI_ENTRY_PRICE_NOT_ON_TICK");
    const p = bindEntryPrices(
      '{"buy_stop":"4410.10","sell_stop":"4400.20","analysis_id":"ignored"}',
      context,
    );
    expect(() =>
      validateEntryPlan(
        JSON.stringify({
          ...p,
          valid_until: new Date(base + 600_000).toISOString(),
        }),
        { ...context, availableAt: new Date(base + 1000).toISOString() },
      ),
    ).toThrow("SCENARIO_ENTRY_CONTEXT_INVALID");
  });
  it("constructs far entries without ATR/corridor or model target requirements and retains local exits", () => {
    const p = bindEntryPrices(
      '{"buy_stop":"4420","sell_stop":"4390"}',
      context,
    );
    const response = scenarioOco(
      p,
      {
        analysis_id: p.analysis_id,
        server_time: new Date(base + 10_000).toISOString(),
        performance: {},
        execution_constraints: {
          tick_size: "0.01",
          current_bid: "4404.95",
          current_ask: "4405.05",
          buy_entry_maximum: "4406",
          sell_entry_minimum: "4404",
          minimum_fee_buffered_take_profit_distance: "0.53",
          minimum_stop_distance: "0.01",
          maximum_stop_distance: "20",
          preferred_expires_at: new Date(base + 190_000).toISOString(),
          order_expiry_min_seconds: 60,
          order_expiry_max_seconds: 180,
        },
      },
      fixture.metadata,
    );
    expect(response.buy_stop.entry_price).toBe("4420");
    expect(response.sell_stop.entry_price).toBe("4390");
    expect(response.buy_stop.risk_reward_ratio).toBe("0.5");
    expect(response.setup_tags).toEqual(["DIRECT_ENTRY_PAIR_OCO"]);
  });
  it("serves the actual entry HTTP route, binds local provenance and preserves readable returned identities", async () => {
    const at = new Date(
      Math.floor(Date.now() / 900_000) * 900_000,
    ).toISOString();
    const now = Date.parse(at);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    const chart = analysisChart();
    const candles: CandleSeries[] = (["M1", "M5", "M15"] as const).map(
      (frame) => {
        const period = { M1: 60_000, M5: 300_000, M15: 900_000 }[frame];
        return {
          timeframe: frame,
          candles: [
            {
              startTime: new Date(now - period).toISOString(),
              endTime: at,
              open: "4405",
              high: "4406",
              low: "4404",
              close: "4405",
              volume: null,
              complete: true,
              qualityFlags: [],
            },
          ],
        };
      },
    );
    const input = {
      ...context,
      capturedAt: at,
      candles,
      chart: {
        ...chart,
        candleCounts: { M1: 1, M5: 1, M15: 1 },
        latestEndTimes: { M1: at, M5: at, M15: at },
      },
      quote: { bid: "4404.95", ask: "4405.15", sourceTime: at, receivedAt: at },
      minimumStopDistance: "0.01",
    };
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          model: "provider-normalized-identity",
          output_text: '{"buy_stop":4410,"sell_stop":4400,"other":"ignored"}',
        }),
      ),
    );
    const planner = new EntryPairPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => now,
    });
    const legacy = new OpenAiCompatibleClient({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      model: "fixture",
      apiStyle: "responses",
      schemaPath: "schemas/model-response-2.1.json",
      systemPromptPath: "prompts/system-v16.md",
      promptVersion: "system-v16",
    });
    const server = createAiServer({
      client: legacy,
      entryPairPlanner: planner,
    });
    try {
      const http = new EntryPairHttpPlanner(
        "http://127.0.0.1:8082",
        async (url, init) => {
          if (typeof init?.body !== "string") throw new Error("fixture-body");
          const result = await server.inject({
            method: "POST",
            url: new URL(url instanceof Request ? url.url : url).pathname,
            payload: JSON.parse(init.body) as object,
          });
          return new Response(result.body, {
            status: result.statusCode,
            headers: { "content-type": "application/json" },
          });
        },
      );
      const result = await http.generate(input);
      expect(result.response).toMatchObject({
        buy_stop: "4410",
        sell_stop: "4400",
        analysis_id: input.analysisId,
      });
      expect(result.telemetry.returnedModel).toBe(
        "provider-normalized-identity",
      );
      expect(result.rawResponse).toContain('"other"');
      const numeric = await http.generate({
        ...input,
        chart: null,
        schemaVersion: "2.0",
      });
      expect(numeric.response).toMatchObject({
        buy_stop: "4410",
        sell_stop: "4400",
      });
      const missingVersion = await server.inject({
        method: "POST",
        url: "/v2/entry-pair",
        payload: { ...input, chart: null },
      });
      expect(missingVersion.statusCode).toBe(400);
      const legacyWithoutImage = await server.inject({
        method: "POST",
        url: "/v1/entry-pair",
        payload: { ...input, chart: null, schemaVersion: "2.0" },
      });
      expect(legacyWithoutImage.statusCode).toBe(400);
      fetchImpl.mockResolvedValueOnce(
        Response.json({
          model: "deepseek-v4-pro",
          output_text: '{"buy_stop":"4410"}',
        }),
      );
      await expect(
        http.generate({ ...input, chart: null, schemaVersion: "2.0" }),
      ).rejects.toMatchObject({
        message: "AI_ENTRY_PRICE_MISSING",
        rawResponse: '{"buy_stop":"4410"}',
      });
    } finally {
      await server.close();
      vi.useRealTimers();
    }
  });
});
