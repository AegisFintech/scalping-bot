import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  parseEntryPrices,
  bindEntryPrices,
  validateEntryPlan,
} from "../../packages/scenario-engine/src/entry-plan.js";
import { validateScenarioMarket } from "../../packages/scenario-engine/src/planner.js";
import { ENTRY_PAIR_PROMPT } from "../../packages/scenario-engine/src/entry-planner.js";
import { EntryPairHttpPlanner } from "../../packages/scenario-engine/src/entry-http-planner.js";
import { scenarioOco } from "../../packages/scenario-engine/src/oco.js";
import {
  createAiServer,
  createProductionAiOptions,
} from "../../apps/ai-orchestrator/src/index.js";
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
  it("uses directional continuation guidance with strict WAIT", () => {
    const prompt = readFileSync(ENTRY_PAIR_PROMPT.path, "utf8");
    expect(ENTRY_PAIR_PROMPT.version).toBe("entry-quick-oco-v1");
    expect(prompt.replace(/\s+/g, " ")).toContain("Use completed M1 first");
    expect(prompt.replace(/\s+/g, " ")).toContain(
      "not an anticipated reversal",
    );
    expect(prompt.replace(/\s+/g, " ")).toContain("broker session gap");
    expect(prompt.replace(/\s+/g, " ")).toContain('"decision":"WAIT"');
  });

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
  it("serves Codex through the production factory with unknown returned identity and immutable prompt", async () => {
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
          candles: Array.from(
            { length: { M1: 720, M5: 576, M15: 480 }[frame] },
            (_, index) => {
              const remaining = { M1: 720, M5: 576, M15: 480 }[frame] - index;
              return {
                startTime: new Date(now - period * remaining).toISOString(),
                endTime: new Date(now - period * (remaining - 1)).toISOString(),
                open: "4405",
                high: "4406",
                low: "4404",
                close: "4405",
                volume: null,
                complete: true,
                qualityFlags: [],
              };
            },
          ),
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
      technicalContext: {
        evidence: { fixture: true },
        inputSha256: "a".repeat(64),
        marketCapturedAt: at,
      },
    };
    const rawResponse =
      '{"decision":"BUY","reason":"Box","upper_breakout":"4410","lower_breakout":"4400"}';
    const promptText = readFileSync(ENTRY_PAIR_PROMPT.path, "utf8").trim();
    const receipt = {
      version: "codex-entry-response-1.2",
      analysisId: input.analysisId,
      requestedModel: "gpt-6.1-sol",
      returnedModel: null,
      promptSha256: createHash("sha256").update(promptText).digest("hex"),
      capturedAt: at,
      receivedAt: at,
      entries: {
        decision: "BUY",
        reason: "Box",
        upper_breakout: "4410",
        lower_breakout: "4400",
      },
      memory: {
        day: at.slice(0, 10),
        threadId: "thread1",
        turnId: "turn1",
        compacted: false,
      },
      rawResponse,
      inputTokens: null,
      outputTokens: null,
      costAmount: null,
      executionAuthority: false,
    };
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(receipt)),
    );
    const beforeDispatch = vi.fn(async () => {});
    const server = createAiServer(
      createProductionAiOptions(
        {
          AI_MODEL: "gpt-6.1-sol",
          AI_PROVIDER: "codex-subscription",
          CODEX_ENTRY_LOCAL_TOKEN: "x".repeat(32),
        },
        beforeDispatch,
        fetchImpl,
      ),
    );
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
      const result = await http.generate({
        ...input,
        chart: null,
        schemaVersion: "2.0",
      });
      const providerBodyValue = fetchImpl.mock.calls[0]?.[1]?.body;
      if (typeof providerBodyValue !== "string")
        throw new Error("fixture-provider-body");
      const providerBody = JSON.parse(providerBodyValue) as Record<
        string,
        unknown
      >;
      expect(providerBody.version).toBe("codex-entry-request-1.7");
      expect(providerBody.payload).toMatchObject({ market_captured_at: at });
      const compact = (
        providerBody.payload as { candles: { rows: unknown[] }[] }
      ).candles;
      expect(compact.map((s) => s.rows.length)).toEqual([12, 12, 12]);
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        "http://127.0.0.1:8084/v1/entry-proposals",
      );
      expect(beforeDispatch).toHaveBeenCalledOnce();
      expect(result.response).toMatchObject({
        schema_version: "entry-modes-1.0",
        entry_side: "BUY",
        buy_stop: "4410",
        sell_stop: "4400",
        analysis_id: input.analysisId,
      });
      expect(result.telemetry.returnedModel).toBeNull();
      expect(result.telemetry.costAmount).toBeNull();
      expect(result.rawResponse).toBe(rawResponse);
      const numeric = await http.generate({
        ...input,
        chart: null,
        schemaVersion: "2.0",
      });
      expect(numeric.response).toMatchObject({
        entry_side: "BUY",
        buy_stop: "4410",
        sell_stop: "4400",
      });
      const prompt = readFileSync(ENTRY_PAIR_PROMPT.path, "utf8").trim();
      expect(numeric.promptArtifact).toEqual({
        version: "entry-quick-oco-v1",
        content: prompt,
        sha256: createHash("sha256").update(prompt).digest("hex"),
      });
      const requestBody = fetchImpl.mock.calls.at(-1)?.[1]?.body;
      if (typeof requestBody !== "string") throw new Error("fixture-body");
      const request = JSON.parse(requestBody) as { promptSha256: string };
      expect(request.promptSha256).toBe(receipt.promptSha256);
      for (const url of ["/v1/scenario", "/v1/analyze"]) {
        const disabled = await server.inject({
          method: "POST",
          url,
          payload: {},
        });
        expect(disabled.statusCode).toBe(503);
      }
      for (const mismatch of [
        { version: "entry-pair-v1" },
        { content: "unreviewed prompt" },
        { sha256: "0".repeat(64) },
      ]) {
        const mismatched = new EntryPairHttpPlanner(
          "http://127.0.0.1:8082",
          () =>
            Promise.resolve(
              Response.json({
                ...numeric,
                promptArtifact: { ...numeric.promptArtifact, ...mismatch },
              }),
            ),
        );
        await expect(
          mismatched.generate({ ...input, chart: null, schemaVersion: "2.0" }),
        ).rejects.toThrow("SCENARIO_PROMPT_MISMATCH");
      }
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
        Response.json({ ...receipt, requestedModel: "grok-4.5" }),
      );
      await expect(
        http.generate({ ...input, chart: null, schemaVersion: "2.0" }),
      ).rejects.toThrow("AI_ANALYSIS_FAILED");
      // Only the explicitly required-context path admits the expanded recipe.
      expect(() =>
        validateScenarioMarket({ ...input, chart: null }, () => now, false),
      ).toThrow("SCENARIO_TIMEFRAMES_INVALID");
      const oversized = await server.inject({
        method: "POST",
        url: "/v2/entry-pair",
        payload: {
          ...input,
          chart: null,
          schemaVersion: "2.0",
          candles: input.candles.map((series) => ({
            ...series,
            candles: [series.candles[0], ...series.candles],
          })),
        },
      });
      expect(oversized.statusCode).toBe(503);
      expect(oversized.json()).toMatchObject({
        reason: "SCENARIO_TIMEFRAMES_INVALID",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      await server.close();
      vi.useRealTimers();
    }
  });
});
