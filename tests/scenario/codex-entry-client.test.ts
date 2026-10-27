import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CodexEntryClient } from "../../packages/ai-client/src/codex-entry-client.js";
const now = Date.parse("2026-10-19T12:00:00Z");
const at = new Date(now).toISOString();
const prompt = readFileSync("prompts/entry-quick-oco-v4.md", "utf8").trim();
function fixtureClient() {
  const request = {
    analysisId: randomUUID(),
    symbol: "XAUUSD",
    chart: null,
    payload: {
      captured_at: at,
      tick_size: "0.01",
      candles: [{ timeframe: "M1", rows: [[at, at]] }],
    },
  };
  const value = {
    version: "codex-entry-response-1.2",
    analysisId: request.analysisId,
    requestedModel: "gpt-6.1-sol",
    returnedModel: null,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    capturedAt: at,
    receivedAt: at,
    entries: {
      decision: "BUY",
      reason: "Box",
      upper_breakout: "4002",
      lower_breakout: "3999",
    },
    memory: {
      day: "2026-10-19",
      threadId: "thread1",
      turnId: "turn1",
      compacted: false,
    },
    rawResponse:
      '{"decision":"BUY","reason":"Box","upper_breakout":"4002","lower_breakout":"3999"}',
    inputTokens: null,
    outputTokens: null,
    costAmount: null,
    executionAuthority: false,
  };
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(value)),
  );
  const gate = vi.fn(() => Promise.resolve());
  const client = new CodexEntryClient({
    localToken: "x".repeat(32),
    fetchImpl,
    beforeDispatch: gate,
    now: () => now,
  });
  return { request, value, fetchImpl, gate, client };
}
describe("isolated Codex transport", () => {
  it("records requested identity and unknown cost without retries or fallback", async () => {
    const s = fixtureClient();
    const result = await s.client.analyze(s.request);
    expect(result.telemetry).toMatchObject({
      requestedModel: "gpt-6.1-sol",
      returnedModel: null,
      costAmount: null,
    });
    const rawBody = s.fetchImpl.mock.calls[0]?.[1]?.body;
    if (typeof rawBody !== "string") throw new Error("EXPECTED_JSON_REQUEST");
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    expect(body).toMatchObject({
      version: "codex-entry-request-1.10",
      promptVersion: "entry-quick-oco-v4",
      promptSha256: s.value.promptSha256,
    });
    expect(result.promptArtifact?.version).toBe("entry-quick-oco-v4");
    expect(result.retryCount).toBe(0);
    expect(s.gate).toHaveBeenCalledOnce();
    expect(s.fetchImpl).toHaveBeenCalledOnce();
    expect(s.gate.mock.invocationCallOrder[0]).toBeLessThan(
      s.fetchImpl.mock.invocationCallOrder[0]!,
    );
  });
  it("does not dispatch after session denial", async () => {
    const s = fixtureClient();
    s.gate.mockRejectedValueOnce(new Error("closed"));
    await expect(s.client.analyze(s.request)).rejects.toThrow();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["identity", "prompt", "model", "stale", "entries", "authority"])(
    "rejects invalid receipt: %s",
    async (fault) => {
      const s = fixtureClient();
      const bad: Record<string, unknown> = { ...s.value };
      if (fault === "identity") bad.analysisId = randomUUID();
      if (fault === "prompt") bad.promptSha256 = "0".repeat(64);
      if (fault === "model") bad.requestedModel = "other";
      if (fault === "stale") bad.receivedAt = new Date(now - 1).toISOString();
      if (fault === "entries")
        bad.entries = { buy_stop: "4003", lower_breakout: "3999" };
      if (fault === "authority") bad.executionAuthority = true;
      s.fetchImpl.mockResolvedValueOnce(Response.json(bad));
      await expect(s.client.analyze(s.request)).rejects.toThrow(
        "CODEX_FAILED_OR_UNKNOWN",
      );
      expect(s.fetchImpl).toHaveBeenCalledOnce();
    },
  );
  it("does not retry usage-limit failures", async () => {
    const s = fixtureClient();
    s.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(s.client.analyze(s.request)).rejects.toThrow(
      "CODEX_FAILED_OR_UNKNOWN",
    );
    expect(s.fetchImpl).toHaveBeenCalledOnce();
  });
  it("session denials do not open the provider circuit", async () => {
    const s = fixtureClient();
    s.gate.mockRejectedValue(new Error("closed"));
    for (let i = 0; i < 3; i++)
      await expect(s.client.analyze(s.request)).rejects.toThrow();
    expect(s.client.circuitOpen).toBe(false);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it("opens the local circuit only after dispatched failures", async () => {
    const s = fixtureClient();
    s.fetchImpl.mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 429 })),
    );
    for (let i = 0; i < 3; i++)
      await expect(
        s.client.analyze({ ...s.request, analysisId: randomUUID() }),
      ).rejects.toThrow("CODEX_FAILED_OR_UNKNOWN");
    await expect(
      s.client.analyze({ ...s.request, analysisId: randomUUID() }),
    ).rejects.toThrow("AI_CIRCUIT_OPEN");
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("production provider selection", () => {
  it("requires the reviewed pin and independent local authentication", async () => {
    const { createProductionAiOptions } =
      await import("../../apps/ai-orchestrator/src/index.js");
    const gate = async () => {};
    expect(() =>
      createProductionAiOptions(
        { AI_MODEL: "grok-4.5", AI_PROVIDER: "codex-subscription" },
        gate,
      ),
    ).toThrow("AI_PROVIDER_POLICY_MISMATCH");
    expect(() =>
      createProductionAiOptions(
        {
          AI_MODEL: "gpt-6.1-sol",
          AI_PROVIDER: "codex-subscription",
          AI_API_KEY: "legacy-secret",
        },
        gate,
      ),
    ).toThrow("CODEX_LOCAL_AUTH_REQUIRED");
  });
});

it("validates the actual TypeScript 5% payload against the Python worker before a simulated receipt", async () => {
  const fixture = spawnSync(
    ".venv/bin/python",
    [
      "-c",
      `import json
from tests.python.test_codex_memory import current_request
v=current_request().model_dump()
v['payload']['execution_context']['shared_setup_risk_percent']='5'
print(json.dumps(v))`,
    ],
    { encoding: "utf8" },
  );
  expect(fixture.status).toBe(0);
  const body = JSON.parse(fixture.stdout) as {
    analysisId: string;
    payload: Record<string, unknown>;
  };
  const s = fixtureClient();
  Object.assign(s.value, {
    analysisId: body.analysisId,
    capturedAt: body.payload.captured_at,
  });
  s.fetchImpl.mockImplementation((_url, init) => {
    if (typeof init?.body !== "string")
      throw new Error("EXPECTED_JSON_REQUEST");
    const checked = spawnSync(
      ".venv/bin/python",
      [
        "-c",
        `import sys
from python.codex_entry.service import RequestV110
v=RequestV110.model_validate_json(sys.stdin.read())
assert v.payload.execution_context.shared_setup_risk_percent=='5'`,
      ],
      { input: init.body, encoding: "utf8" },
    );
    expect(checked.status, checked.stderr).toBe(0);
    return Promise.resolve(Response.json(s.value));
  });
  const result = await s.client.analyze({
    analysisId: body.analysisId,
    symbol: "XAUUSD",
    chart: null,
    payload: body.payload,
  });
  expect(result.promptArtifact?.version).toBe("entry-quick-oco-v4");
  expect(s.fetchImpl).toHaveBeenCalledOnce();
});
