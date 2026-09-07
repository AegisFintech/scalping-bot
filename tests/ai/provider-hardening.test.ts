import { describe, expect, it } from "vitest";
import { OpenAiCompatibleClient } from "../../packages/ai-client/src/client.js";
import {
  boundedResponseText,
  usageTelemetry,
} from "../../packages/ai-client/src/telemetry.js";
import { resolveRuntimeEnvironment } from "../../packages/config/src/policy.js";

describe("bounded provider and configuration", () => {
  it("keeps exact model identity and explicit stopped authority", () => {
    const env = resolveRuntimeEnvironment({ AI_API_KEY: "fixture-secret" });
    expect(env.AI_MODEL).toBe("gpt-6-astra/u64");
    expect(env.LIVE_TRADING_ENABLED).toBe("false");
    expect(env.BASE_RISK_PERCENT).toBe("1");
    expect(env.MAX_RISK_PERCENT).toBe("1");
    expect(env.MAX_DAILY_LOSS_PERCENT).toBe("5");
    expect(env.MAX_ORDERS_PER_DAY).toBe("100");
    expect(env.AI_API_KEY).toBe("fixture-secret");
    expect(
      resolveRuntimeEnvironment({ CTRADER_API_HOST: "", CTRADER_API_PORT: "" }),
    ).toMatchObject({
      CTRADER_API_HOST: "demo.ctraderapi.com",
      CTRADER_API_PORT: "5036",
    });
    expect(
      resolveRuntimeEnvironment({ CTRADER_CONNECTION_MODE: "live" })
        .CTRADER_API_HOST,
    ).toBe("live.ctraderapi.com");
  });
  it("rejects unsafe legacy overrides without printing their values", () => {
    expect(() =>
      resolveRuntimeEnvironment({
        BASE_RISK_PERCENT: "5",
        AI_API_KEY: "private-key",
      }),
    ).toThrow("CONFIG_POLICY_CONFLICT:BASE_RISK_PERCENT");
    expect(() => resolveRuntimeEnvironment({ AI_MODEL: "other" })).toThrow(
      "AI_MODEL",
    );
  });
  it("rejects ambiguous legacy mode and keeps unknown costs unavailable", () => {
    expect(() => resolveRuntimeEnvironment({ SHADOW_MODE: "false" })).toThrow(
      "CONFIG_POLICY_CONFLICT:SHADOW_MODE",
    );
    expect(() =>
      resolveRuntimeEnvironment({ CTRADER_CONNECTION_MODE: "invalid" }),
    ).toThrow("CONFIG_CONNECTION_MODE_INVALID");
    expect(() =>
      resolveRuntimeEnvironment({
        TRADING_MODE: "demo",
        DATABASE_SSL_MODE: "disable",
      }),
    ).toThrow("CONFIG_BROKER_DATABASE_TLS_REQUIRED");
    expect(resolveRuntimeEnvironment({ AI_API_STYLE: "" }).AI_API_STYLE).toBe(
      "responses",
    );
  });
  it("rejects an oversized streaming response with no content-length", async () => {
    await expect(
      boundedResponseText(new Response("x".repeat(1025)), 1024),
    ).rejects.toThrow("AI_RESPONSE_OVERSIZED");
  });
  it("keeps unknown cost and usage unavailable and rejects invalid usage", () => {
    expect(usageTelemetry({})).toMatchObject({
      inputTokens: null,
      costAmount: null,
      costSource: "unavailable",
    });
    expect(
      usageTelemetry({
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
      }),
    ).toMatchObject({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
    expect(() => usageTelemetry({ usage: { input_tokens: -1 } })).toThrow();
  });
  it("rejects public cleartext and unbounded retry settings at startup", () => {
    const options = {
      baseUrl: "http://example.com/v1",
      apiKey: "fixture",
      model: "gpt-6-astra/u64",
      apiStyle: "responses" as const,
      schemaPath: "schemas/model-response-2.1.json",
      systemPromptPath: "prompts/system-v16.md",
      promptVersion: "system-v16" as const,
    };
    expect(
      () =>
        new OpenAiCompatibleClient({
          ...options,
          baseUrl: "private malformed endpoint",
        }),
    ).toThrow("AI_URL_INVALID");
    expect(() => new OpenAiCompatibleClient(options)).toThrow(
      "AI_HTTPS_REQUIRED",
    );
    expect(
      () =>
        new OpenAiCompatibleClient({
          ...options,
          baseUrl: "https://example.com",
          maxRetries: 100,
        }),
    ).toThrow("AI_CONFIG_BOUNDS_INVALID");
  });
});
