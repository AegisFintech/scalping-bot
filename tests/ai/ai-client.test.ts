import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleClient } from "../../packages/ai-client/src/client.js";
import {
  AiOrchestratorHttpClient,
  aiOrchestratorRequestTimeoutMs,
} from "../../packages/ai-client/src/http-client.js";

const analysisId = "22222222-2222-4222-8222-222222222222";

function validResponse(): Record<string, unknown> {
  const order = {
    trigger_price: "1",
    entry_price: "1",
    stop_loss: "1",
    take_profit: "1",
    risk_reward_ratio: "2",
    expires_at: "2026-01-01T00:05:00.000Z",
    invalidation_price: "1",
  };
  return {
    schema_version: "2.0",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-01-01T00:00:00.000Z",
    valid_until: "2026-01-01T00:05:00.000Z",
    market_regime: "UNCERTAIN",
    waiting_area: {
      lower: "1",
      upper: "2",
      description_code: "IMMEDIATE_DECISION_ZONE",
    },
    buy_stop: order,
    sell_stop: order,
    confidence: {
      overall: 0,
      buy: 0,
      sell: 0,
      original_overall: 0,
      original_buy: 0,
      original_sell: 0,
    },
    setup_tags: [],
    evidence_codes: [],
    risk_flags: ["INSUFFICIENT_EVIDENCE"],
    performance_adjustment: {
      applied: false,
      confidence_delta: 0,
      reason_codes: [],
    },
    data_quality: { warnings: [] },
  };
}

const systemPromptPath = path.resolve("prompts/system-v2.md");
const systemPrompt = readFileSync(systemPromptPath, "utf8").trim();
const promptArtifact = {
  version: "system-v2",
  content: systemPrompt,
  sha256: createHash("sha256").update(systemPrompt).digest("hex"),
};

describe("OpenAI-compatible client", () => {
  it("requests strict structured output and validates locally", async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("expected JSON body");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const text = body.text as { format: { strict: boolean } };
        expect(text.format.strict).toBe(true);
        expect(init?.headers).toMatchObject({ authorization: "Bearer hidden" });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "completed",
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify(validResponse()),
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
        );
      },
    );
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://ai.example.invalid/v1",
      apiKey: "hidden",
      model: "test-model",
      apiStyle: "responses",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath: path.resolve("prompts/system-v2.md"),
      promptVersion: "system-v2",
      fetchImpl: fetchMock,
    });
    const result = await client.analyze({
      analysisId,
      symbol: "XAUUSD",
      payload: { safe: true },
    });
    expect(result.response.buy_stop.entry_price).toBe("1");
    expect(result.promptArtifact.version).toBe("system-v2");
    expect(result.promptArtifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("opens the circuit after a configured invalid response threshold", async () => {
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://ai.example.invalid/v1",
      apiKey: "hidden",
      model: "test-model",
      apiStyle: "responses",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath: path.resolve("prompts/system-v2.md"),
      promptVersion: "system-v2",
      circuitBreakerFailures: 1,
      maxRetries: 0,
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ output_text: "not-json" }), {
            status: 200,
          }),
        ),
      ),
    });
    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("MODEL_JSON_INVALID");
    expect(client.circuitOpen).toBe(true);
    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("AI_CIRCUIT_OPEN");
  });

  it("defaults to one provider attempt so a retry uses a fresh scheduler interval", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://ai.example.invalid/v1",
      apiKey: "hidden",
      model: "test-model",
      apiStyle: "responses",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath: path.resolve("prompts/system-v2.md"),
      promptVersion: "system-v2",
      fetchImpl: fetchMock,
    });
    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("AI_HTTP_ERROR:503");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("AI orchestrator HTTP client", () => {
  it("budgets the complete configured provider retry window", () => {
    expect(
      aiOrchestratorRequestTimeoutMs({
        providerTimeoutMs: 30_000,
        maxRetries: 2,
      }),
    ).toBe(95_000);
    expect(
      aiOrchestratorRequestTimeoutMs({
        providerTimeoutMs: 30_000,
        maxRetries: 0,
        graceMs: 1_000,
      }),
    ).toBe(31_000);
  });

  it.each([
    { providerTimeoutMs: 0, maxRetries: 0 },
    { providerTimeoutMs: 1.5, maxRetries: 0 },
    { providerTimeoutMs: 30_000, maxRetries: -1 },
    { providerTimeoutMs: 30_000, maxRetries: 0.5 },
    { providerTimeoutMs: 1_000_000_000, maxRetries: 2 },
  ])("rejects an unsafe timeout budget: %j", (input) => {
    expect(() => aiOrchestratorRequestTimeoutMs(input)).toThrow(
      "AI_TIMEOUT_BUDGET_INVALID",
    );
  });

  it("normalizes a local orchestrator timeout and opens the circuit", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const client = new AiOrchestratorHttpClient({
      baseUrl: "http://127.0.0.1:8082",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath,
      promptVersion: "system-v2",
      fetchImpl: vi.fn(() => Promise.reject(timeout)),
    });

    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("AI_ORCHESTRATOR_TIMEOUT");
    expect(client.circuitOpen).toBe(true);
  });

  it("accepts a completed locally validated orchestrator response", async () => {
    const rawResponse = JSON.stringify(validResponse());
    const client = new AiOrchestratorHttpClient({
      baseUrl: "http://127.0.0.1:8082",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath,
      promptVersion: "system-v2",
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ rawResponse, promptArtifact }), {
            status: 200,
          }),
        ),
      ),
    });

    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).resolves.toEqual({
      response: validResponse(),
      rawResponse,
      promptArtifact,
    });
    expect(client.circuitOpen).toBe(false);
  });

  it("rejects a prompt artifact whose content does not match its hash", async () => {
    const rawResponse = JSON.stringify(validResponse());
    const client = new AiOrchestratorHttpClient({
      baseUrl: "http://127.0.0.1:8082",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath,
      promptVersion: "system-v2",
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              rawResponse,
              promptArtifact: { ...promptArtifact, sha256: "0".repeat(64) },
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("AI_ORCHESTRATOR_PROMPT_ARTIFACT_INVALID");
  });

  it("rejects a self-consistent prompt artifact that is not the tracked prompt", async () => {
    const rawResponse = JSON.stringify(validResponse());
    const alteredContent = `${systemPrompt}\nUntracked instruction.`;
    const client = new AiOrchestratorHttpClient({
      baseUrl: "http://127.0.0.1:8082",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath,
      promptVersion: "system-v2",
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              rawResponse,
              promptArtifact: {
                version: "system-v2",
                content: alteredContent,
                sha256: createHash("sha256")
                  .update(alteredContent)
                  .digest("hex"),
              },
            }),
            { status: 200 },
          ),
        ),
      ),
    });

    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("AI_ORCHESTRATOR_PROMPT_ARTIFACT_INVALID");
  });

  it("normalizes another local transport failure", async () => {
    const client = new AiOrchestratorHttpClient({
      baseUrl: "http://127.0.0.1:8082",
      schemaPath: path.resolve("schemas/model-response-2.0.json"),
      systemPromptPath,
      promptVersion: "system-v2",
      fetchImpl: vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    });

    await expect(
      client.analyze({ analysisId, symbol: "XAUUSD", payload: {} }),
    ).rejects.toThrow("AI_ORCHESTRATOR_UNAVAILABLE");
    expect(client.circuitOpen).toBe(true);
  });
});
