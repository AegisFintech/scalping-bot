import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CodexEntryClient } from "../../packages/ai-client/src/codex-entry-client.js";
const now = Date.parse("2026-10-19T12:00:00Z");
const at = new Date(now).toISOString();
const prompt = readFileSync("prompts/entry-pair-v4.md", "utf8").trim();
function fixture() {
  const request = {
    analysisId: randomUUID(),
    symbol: "XAUUSD",
    chart: null,
    payload: { captured_at: at, tick_size: "0.01" },
  };
  const value = {
    version: "codex-entry-response-1.0",
    analysisId: request.analysisId,
    requestedModel: "gpt-6.1-sol",
    returnedModel: null,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    capturedAt: at,
    receivedAt: at,
    entries: { buy_stop: "4002", sell_stop: "3999" },
    rawResponse: '{"buy_stop":"4002","sell_stop":"3999"}',
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
    const s = fixture();
    const result = await s.client.analyze(s.request);
    expect(result.telemetry).toMatchObject({
      requestedModel: "gpt-6.1-sol",
      returnedModel: null,
      costAmount: null,
    });
    expect(result.retryCount).toBe(0);
    expect(s.gate).toHaveBeenCalledOnce();
    expect(s.fetchImpl).toHaveBeenCalledOnce();
    expect(s.gate.mock.invocationCallOrder[0]).toBeLessThan(
      s.fetchImpl.mock.invocationCallOrder[0]!,
    );
  });
  it("does not dispatch after session denial", async () => {
    const s = fixture();
    s.gate.mockRejectedValueOnce(new Error("closed"));
    await expect(s.client.analyze(s.request)).rejects.toThrow();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["identity", "prompt", "model", "stale", "entries", "authority"])(
    "rejects invalid receipt: %s",
    async (fault) => {
      const s = fixture();
      const bad: Record<string, unknown> = { ...s.value };
      if (fault === "identity") bad.analysisId = randomUUID();
      if (fault === "prompt") bad.promptSha256 = "0".repeat(64);
      if (fault === "model") bad.requestedModel = "other";
      if (fault === "stale") bad.receivedAt = new Date(now - 1).toISOString();
      if (fault === "entries")
        bad.entries = { buy_stop: "4003", sell_stop: "3999" };
      if (fault === "authority") bad.executionAuthority = true;
      s.fetchImpl.mockResolvedValueOnce(Response.json(bad));
      await expect(s.client.analyze(s.request)).rejects.toThrow(
        "CODEX_FAILED_OR_UNKNOWN",
      );
      expect(s.fetchImpl).toHaveBeenCalledOnce();
    },
  );
  it("does not retry usage-limit failures", async () => {
    const s = fixture();
    s.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(s.client.analyze(s.request)).rejects.toThrow(
      "CODEX_FAILED_OR_UNKNOWN",
    );
    expect(s.fetchImpl).toHaveBeenCalledOnce();
  });
  it("session denials do not open the provider circuit", async () => {
    const s = fixture();
    s.gate.mockRejectedValue(new Error("closed"));
    for (let i = 0; i < 3; i++)
      await expect(s.client.analyze(s.request)).rejects.toThrow();
    expect(s.client.circuitOpen).toBe(false);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it("opens the local circuit only after dispatched failures", async () => {
    const s = fixture();
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
