import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import type { CandleSeries } from "../../packages/contracts/src/index.js";
import type { EntryPlannerInput } from "../../packages/scenario-engine/src/entry-planner.js";
import {
  catalogueSha256,
  profiles,
  profileSha256,
  trialBindingSchema,
  trialGeometry,
  trialPrompt,
  type TrialBinding,
} from "../../packages/strategy-candidates/src/demo-trial.js";
export function binding(id = "ENTRY_RANGE_3"): TrialBinding {
  const p = profiles.find((p) => p.id === id)!;
  return {
    trialId: "00000000-0000-4000-8000-000000000519",
    profileId: p.id,
    profileSha256: profileSha256(p),
    catalogueSha256,
    strategyVersion: "0.10.0-demo-trials.1-codex.1",
    sourceSha256: "b".repeat(64),
    registeredAt: "2026-11-03T00:04:59.000Z",
    startsAt: "2026-11-03T00:05:00.000Z",
  };
}
export function marketInput(): EntryPlannerInput {
  const end = Date.parse("2026-11-03T00:05:00.000Z");
  const candles: CandleSeries[] = (["M1", "M5", "M15"] as const).map(
    (timeframe) => {
      const seconds = timeframe === "M1" ? 60 : timeframe === "M5" ? 300 : 900;
      const frameEnd = Math.floor(end / (seconds * 1000)) * seconds * 1000;
      return {
        timeframe,
        candles: Array.from({ length: 5 }, (_, i) => ({
          startTime: new Date(
            frameEnd - (5 - i) * seconds * 1000,
          ).toISOString(),
          endTime: new Date(frameEnd - (4 - i) * seconds * 1000).toISOString(),
          open: "4000",
          high: "4001",
          low: "3999.5",
          close: String(4000 + i / 10),
          volume: "1",
          complete: true,
          qualityFlags: [],
        })),
      };
    },
  );
  return {
    analysisId: "00000000-0000-4000-8000-000000000518",
    symbol: "XAUUSD",
    capturedAt: "2026-11-03T00:05:01.000Z",
    tickSize: "0.01",
    pipSize: "0.01",
    maximumStopDistance: "7",
    minimumProtectionDistance: "0.01",
    minimumStopDistance: "0.01",
    quote: {
      bid: "4000",
      ask: "4000.2",
      sourceTime: "2026-11-03T00:05:01.000Z",
      receivedAt: "2026-11-03T00:05:01.000Z",
    },
    candles,
    chart: null,
    schemaVersion: "2.0",
    technicalContext: {
      evidence: { fixture: true },
      inputSha256: "a".repeat(64),
    },
  };
}
it("computes original trend breakout and fixed registered exits without a provider", () => {
  const decision = trialGeometry(marketInput(), binding());
  expect(decision).toMatchObject({
    decision: "BUY",
    entry_price: "4001.01",
    stop_loss: "3999.5",
    take_profit: "4002.01",
    pending_seconds: 180,
  });
});
it("waits on crossed original levels and rejects a hidden alternate source", () => {
  const i = marketInput();
  expect(
    trialGeometry({ ...i, quote: { ...i.quote!, ask: "4002" } }, binding())
      .decision,
  ).toBe("WAIT");
  expect(() =>
    trialGeometry(i, binding(), {
      decision: "WAIT",
      reason: "provider",
      entry_price: null,
      take_profit: null,
      stop_loss: null,
      pending_seconds: null,
    }),
  ).toThrow("LOCAL_SOURCE_CONFLICT");
});
it("preserves actual Codex WAIT and rejects contradictory profile geometry", () => {
  const i = marketInput(),
    b = binding("ENTRY_CODEX");
  const wait = {
    decision: "WAIT",
    reason: "No credible entry",
    entry_price: null,
    take_profit: null,
    stop_loss: null,
    pending_seconds: null,
  };
  expect(trialGeometry(i, b, wait)).toEqual(wait);
  const local = trialGeometry(i, binding());
  expect(trialGeometry(i, b, local).decision).toBe("BUY");
  expect(() =>
    trialGeometry(i, b, { ...local, take_profit: "4001.41" }),
  ).toThrow("GEOMETRY_MISMATCH");
  expect(() => trialGeometry(i, b, { ...local, decision: "SELL" })).toThrow(
    "TREND_DIRECTION_INVALID",
  );
});
it("rejects unbound, unknown and not-yet-started trial data", () => {
  expect(() =>
    trialBindingSchema.parse({ ...binding(), profileSha256: "a".repeat(64) }),
  ).toThrow();
  expect(() =>
    trialGeometry(
      { ...marketInput(), capturedAt: "2026-11-03T00:04:00.000Z" },
      binding(),
    ),
  ).toThrow("NOT_STARTED");
});
it("matches Python binding digests and exact dynamic prompt bytes", () => {
  const b = binding("ENTRY_CODEX"),
    artifact = trialPrompt(b);
  const result = spawnSync(
    ".venv/bin/python",
    [
      "-c",
      "import json,sys,hashlib; from pathlib import Path; from python.codex_entry.trial_protocol import TrialBinding,prompt; b=TrialBinding.model_validate_json(sys.stdin.buffer.read()); print(hashlib.sha256(prompt(Path('prompts/entry-scalp-v3.md').read_text(),b).encode()).hexdigest())",
    ],
    { input: JSON.stringify(b), encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(artifact.sha256);
  expect(artifact.content).toContain('"targetDistance":"1"');
});

import { DemoTrialPlanner } from "../../packages/strategy-candidates/src/demo-trial-planner.js";
import {
  trialSlot,
  trialOpenCredit,
} from "../../apps/execution-service/src/demo-trials.js";
it("selects an explicit local source without ever dispatching a provider", async () => {
  const p = new DemoTrialPlanner(
    {
      generate: () => {
        throw new Error("provider must not run");
      },
    },
    () => Date.parse(marketInput().capturedAt),
  );
  const x = await p.generate({
    ...marketInput(),
    schemaVersion: "3.0",
    experiment: binding(),
  });
  expect(x.model).toBe("local-range-v1");
  expect(x.response.schema_version).toBe("entry-scalp-1.0");
  expect(x.telemetry.totalTokens).toBeNull();
  await expect(
    p.generate({
      ...marketInput(),
      schemaVersion: "3.0",
      experiment: binding("ENTRY_CODEX"),
    }),
  ).rejects.toThrow("provider must not run");
});
it("rotates only predeclared batch members and censors downtime", () => {
  expect(Array.from({ length: 3 }, (_, i) => trialSlot(0, i))).toEqual([
    "ENTRY_RANGE_3",
    "ENTRY_RANGE_5",
    "ENTRY_CODEX",
  ]);
  expect(Array.from({ length: 3 }, (_, i) => trialSlot(1, i))).toEqual([
    "ENTRY_CODEX",
    "ENTRY_RANGE_3",
    "ENTRY_RANGE_5",
  ]);
  expect(trialSlot(0, 11)).toBe("RANGE_010");
  expect(trialSlot(0, 12)).toBe("ENTRY_RANGE_5");
  for (let cycle = 0; cycle < 6; cycle++) {
    const sequence = Array.from({ length: 26 }, (_, i) =>
      trialSlot(cycle + Math.floor(i / 13), i % 13),
    );
    expect(sequence.every((p, i) => i === 0 || p !== sequence[i - 1])).toBe(
      true,
    );
  }
  expect(() => trialSlot(0, 13)).toThrow();
  expect(trialOpenCredit(0, 15000, 1000, true)).toBe(14000);
  expect(trialOpenCredit(0, 31000, 1000, true)).toBe(0);
  expect(trialOpenCredit(1000, 500, 0, true)).toBe(0);
  expect(trialOpenCredit(0, 15000, 0, false)).toBe(0);
});

import { CodexEntryClient } from "../../packages/ai-client/src/codex-entry-client.js";
import { EntryPairPlanner } from "../../packages/scenario-engine/src/entry-planner.js";
import { createAiServer } from "../../apps/ai-orchestrator/src/index.js";
it("routes the exact registered prompt over the new API contract and closes legacy routes", async () => {
  const input = {
      ...marketInput(),
      experiment: binding("ENTRY_CODEX"),
      schemaVersion: "3.0" as const,
    },
    artifact = trialPrompt(input.experiment),
    raw = trialGeometry(
      input,
      input.experiment,
      trialGeometry(input, binding()),
    );
  const clock = () => Date.parse(input.capturedAt) + 20;
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
      expect(request.version).toBe("codex-entry-request-1.17");
      expect(request.promptSha256).toBe(artifact.sha256);
      expect(request.experiment).toEqual(input.experiment);
      return Promise.resolve(
        Response.json({
          version: "codex-entry-response-1.10",
          provider: "openai-api",
          analysisId: input.analysisId,
          requestedModel: "gpt-6.1-sol",
          returnedModel: "gpt-6.1-sol",
          promptSha256: artifact.sha256,
          capturedAt: input.capturedAt,
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
    const result = await app.inject({
      method: "POST",
      url: "/v3/entry-pair",
      payload: input,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(dispatched).toBe(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v2/entry-pair",
          payload: { ...input, schemaVersion: "2.0" },
        })
      ).statusCode,
    ).toBe(503);
    expect(dispatched).toBe(1);
  } finally {
    await app.close();
  }
});
