import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { OpenAiCompatibleClient } from "../../packages/ai-client/src/client.js";

const analysisId = "22222222-2222-4222-8222-222222222222";

function validResponse(): Record<string, unknown> {
  const order = {
    enabled: false,
    trigger_price: "1",
    entry_price: "1",
    stop_loss: "1",
    take_profit: "1",
    risk_reward_ratio: "2",
    expires_at: "2026-01-01T00:05:00.000Z",
    invalidation_price: "1",
  };
  return {
    schema_version: "1.0",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-01-01T00:00:00.000Z",
    valid_until: "2026-01-01T00:05:00.000Z",
    decision: "NO_TRADE",
    market_regime: "UNCERTAIN",
    waiting_area: { lower: "1", upper: "2", description_code: "NO_VALID_ZONE" },
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
    data_quality: { acceptable: true, warnings: [] },
  };
}

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
      schemaPath: path.resolve("schemas/model-response-1.0.json"),
      systemPromptPath: path.resolve("prompts/system-v1.md"),
      fetchImpl: fetchMock,
    });
    const result = await client.analyze({
      analysisId,
      symbol: "XAUUSD",
      payload: { safe: true },
    });
    expect(result.response.decision).toBe("NO_TRADE");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("opens the circuit after a configured invalid response threshold", async () => {
    const client = new OpenAiCompatibleClient({
      baseUrl: "https://ai.example.invalid/v1",
      apiKey: "hidden",
      model: "test-model",
      apiStyle: "responses",
      schemaPath: path.resolve("schemas/model-response-1.0.json"),
      systemPromptPath: path.resolve("prompts/system-v1.md"),
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
});
