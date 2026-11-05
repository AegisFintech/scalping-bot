import { expect, it } from "vitest";
import type { CandleSeries } from "../../packages/contracts/src/index.js";
import type { EntryPlannerInput } from "../../packages/scenario-engine/src/entry-planner.js";
import { trendRetestGeometry } from "../../packages/strategy-candidates/src/trend-retest.js";
function input(): EntryPlannerInput {
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
it("keeps trend direction for retest LIMIT and original range before confirmation", () => {
  const i = input();
  expect(trendRetestGeometry(i, "RETEST_LIMIT")).toMatchObject({
    decision: "BUY",
    executionOrderType: "LIMIT",
    entryPrice: "4001",
    stopLoss: "4000",
    takeProfit: "4005",
    originalBoundary: "4001",
    pendingSeconds: 60,
  });
  expect(trendRetestGeometry(i, "CONFIRMED_BREAKOUT")).toMatchObject({
    decision: "BUY",
    executionOrderType: "STOP_LIMIT",
    entryPrice: "4001.31",
  });
  const sell = structuredClone(i);
  for (const f of sell.candles)
    for (const b of f.candles)
      Object.assign(b, {
        open: (8000 - Number(b.open)).toFixed(2),
        high: (8000 - Number(b.low)).toFixed(2),
        low: (8000 - Number(b.high)).toFixed(2),
        close: (8000 - Number(b.close)).toFixed(2),
      });
  Object.assign(sell.quote!, { bid: "3998.72", ask: "3998.75" });
  expect(trendRetestGeometry(sell, "RETEST_LIMIT")).toMatchObject({
    decision: "SELL",
    executionOrderType: "LIMIT",
    entryPrice: "3999",
    stopLoss: "4000",
    takeProfit: "3995",
  });
});
it("rejects wick-only and forming confirmation rather than manufacturing a retest", () => {
  const i = input();
  Object.assign(i.candles[0]!.candles.at(-1)!, { close: "4000.8" });
  expect(trendRetestGeometry(i, "BREAKOUT").decision).toBe("BUY");
  expect(trendRetestGeometry(i, "RETEST_LIMIT")).toMatchObject({
    decision: "WAIT",
    reason: "TREND_COMPLETED_BREAKOUT_NOT_CONFIRMED",
  });
  Object.assign(i.candles[0]!.candles.at(-1)!, { complete: false });
  expect(trendRetestGeometry(i, "CONFIRMED_BREAKOUT").decision).toBe("WAIT");
});
it("does not skip nearer structural resistance to obtain an attractive ratio", () => {
  const i = input();
  Object.assign(i.candles[1]!.candles[7]!, { high: "4001.5" });
  expect(trendRetestGeometry(i, "RETEST_LIMIT")).toMatchObject({
    decision: "WAIT",
    reason: "TREND_STRUCTURAL_ROOM_BELOW_RISK",
  });
});
it("waits for invalid, stale, crossed or missing evidence without changing prices", () => {
  const i = input();
  const before = JSON.stringify(i);
  expect(trendRetestGeometry(i, "RETEST_LIMIT").decision).toBe("BUY");
  expect(JSON.stringify(i)).toBe(before);
  const stale = structuredClone(i);
  Object.assign(stale.quote!, { sourceTime: "2026-11-05T02:59:00Z" });
  expect(trendRetestGeometry(stale, "RETEST_LIMIT").decision).toBe("WAIT");
  const crossed = structuredClone(i);
  Object.assign(crossed.quote!, { bid: "4000.8", ask: "4000.9" });
  expect(trendRetestGeometry(crossed, "RETEST_LIMIT")).toMatchObject({
    decision: "WAIT",
    reason: "TREND_ORIGINAL_ENTRY_NOT_EXECUTABLE",
  });
  const gap = structuredClone(i);
  Object.assign(gap.candles[1]!.candles[3]!, { qualityFlags: ["MISSING"] });
  expect(trendRetestGeometry(gap, "RETEST_LIMIT").decision).toBe("WAIT");
  const noRoom = structuredClone(i);
  for (const f of noRoom.candles.slice(1))
    for (const b of f.candles) Object.assign(b, { high: "4001" });
  expect(trendRetestGeometry(noRoom, "RETEST_LIMIT")).toMatchObject({
    decision: "WAIT",
    reason: "TREND_STRUCTURAL_TARGET_UNAVAILABLE",
  });
});

import {
  trialGeometry,
  trialPrompt,
} from "../../packages/strategy-candidates/src/demo-trial.js";
import {
  trendProfiles,
  trendProfileSha256,
  trendCatalogueSha256,
  TREND_RETEST_VERSION,
  type TrendBinding,
} from "../../packages/strategy-candidates/src/trend-retest-profile.js";
function binding(): TrendBinding {
  const p = trendProfiles[2]!;
  return {
    trialId: "00000000-0000-4000-8000-000000000536",
    profileId: p.id,
    profileSha256: trendProfileSha256(p),
    catalogueSha256: trendCatalogueSha256,
    strategyVersion: TREND_RETEST_VERSION,
    sourceSha256: "b".repeat(64),
    registeredAt: "2026-11-05T02:59:58Z",
    startsAt: "2026-11-05T02:59:59Z",
  };
}
it("keeps Codex WAIT authoritative and verifies exact geometry without local fallback", () => {
  const i = input(),
    b = binding();
  const wait = {
    decision: "WAIT",
    reason: "No trade",
    entry_price: null,
    stop_loss: null,
    take_profit: null,
    pending_seconds: null,
  };
  expect(trialGeometry(i, b, wait)).toEqual(wait);
  expect(() => trialGeometry(i, b)).toThrow("CODEX_PROPOSAL_REQUIRED");
  const proposal = {
    decision: "BUY",
    reason: "Retest",
    entry_price: "4001.00",
    stop_loss: "4000",
    take_profit: "4005",
    pending_seconds: 60,
  };
  expect(trialGeometry(i, b, proposal)).toEqual(proposal);
  expect(() =>
    trialGeometry(i, b, { ...proposal, entry_price: "4001.01" }),
  ).toThrow("GEOMETRY_MISMATCH");
  expect(() =>
    trialGeometry(i, b, { ...proposal, pending_seconds: 180 }),
  ).toThrow("GEOMETRY_MISMATCH");
  expect(trialPrompt(b).version).toBe("entry-scalp-v4");
});

import { CodexEntryClient } from "../../packages/ai-client/src/codex-entry-client.js";
import { EntryPairPlanner } from "../../packages/scenario-engine/src/entry-planner.js";
import { EntryPairHttpPlanner } from "../../packages/scenario-engine/src/entry-http-planner.js";
import { createAiServer } from "../../apps/ai-orchestrator/src/index.js";
it("routes the exact registered prompt over the new API contract and closes legacy routes", async () => {
  const market = {
      ...input(),
      technicalContext: {
        evidence: { fixture: true },
        inputSha256: "a".repeat(64),
      },
      experiment: binding(),
      schemaVersion: "3.0" as const,
    },
    artifact = trialPrompt(market.experiment),
    raw = trialGeometry(market, market.experiment, {
      decision: "BUY",
      reason: "Retest",
      entry_price: "4001",
      stop_loss: "4000",
      take_profit: "4005",
      pending_seconds: 60,
    });
  const clock = () => Date.parse(market.capturedAt) + 20;
  let dispatched = 0;
  const client = new CodexEntryClient({
    trialProtocol: true,
    provider: "openai-api",
    localToken: "x".repeat(64),
    now: clock,
    beforeDispatch: () => Promise.resolve(),
    fetchImpl: (_url, init) => {
      dispatched++;
      if (typeof init?.body !== "string")
        throw new Error("fixture body required");
      const request = JSON.parse(init.body) as Record<string, unknown>;
      expect(request.version).toBe("codex-entry-request-1.19");
      expect(request.promptSha256).toBe(artifact.sha256);
      expect(request.experiment).toEqual(market.experiment);
      return Promise.resolve(
        Response.json({
          version: "codex-entry-response-1.13",
          provider: "openai-api",
          analysisId: market.analysisId,
          requestedModel: "gpt-6.1-sol",
          returnedModel: "gpt-6.1-sol",
          promptSha256: artifact.sha256,
          capturedAt: market.capturedAt,
          receivedAt: new Date(clock()).toISOString(),
          entries: raw,
          rawResponse: JSON.stringify(raw),
          inputTokens: 10,
          outputTokens: 2,
          costAmount: null,
          providerRequestId: "fixture",
          contextPolicy: "fresh-input-v1",
          executionAuthority: false,
        }),
      );
    },
  });
  const app = createAiServer({
    trialEntryPlanner: new EntryPairPlanner({
      client,
      now: clock,
      requireTechnicalContext: true,
    }),
  });
  try {
    const executor = new EntryPairHttpPlanner(
      "http://fixture",
      async (url, init) => {
        if (!(url instanceof URL) || typeof init?.body !== "string")
          throw new Error("fixture transport required");
        const reply = await app.inject({
          method: "POST",
          url: url.pathname,
          headers: { "content-type": "application/json" },
          payload: init.body,
        });
        return new Response(reply.body, {
          status: reply.statusCode,
          headers: { "content-type": "application/json" },
        });
      },
      clock,
    );
    const result = await executor.generate(market);
    expect(result.response).toMatchObject({
      schema_version: "entry-scalp-1.0",
      entry_side: "BUY",
    });
    expect(dispatched).toBe(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v2/entry-pair",
          payload: { ...market, schemaVersion: "2.0" },
        })
      ).statusCode,
    ).toBe(503);
    expect(dispatched).toBe(1);
  } finally {
    await app.close();
  }
});
