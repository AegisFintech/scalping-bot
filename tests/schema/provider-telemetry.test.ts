import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { expect, it } from "vitest";
import { providerTelemetrySchema } from "../../packages/ai-client/src/telemetry.js";

it("keeps the JSON and runtime telemetry contracts strict and preserves unknown costs", () => {
  const validate = new Ajv.default({ strict: false }).compile(
    JSON.parse(readFileSync("schemas/provider-telemetry-1.0.json", "utf8")),
  );
  const value = {
    requestedModel: "gpt-6-astra/u64",
    returnedModel: "gpt-6-astra",
    inputProfile: "structured",
    requestBytes: 200,
    responseBytes: 300,
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
    costAmount: null,
    costCurrency: null,
    costSource: "unavailable",
  };
  for (const [candidate, expected] of [
    [value, true],
    [
      {
        ...value,
        requestedModel: "deepseek-v4-pro/u5W",
        returnedModel: "deepseek-v4-pro",
      },
      true,
    ],
    [{ ...value, apiKey: "private" }, false],
    [{ ...value, inputTokens: -1 }, false],
    [{ ...value, costAmount: "0" }, false],
    [{ ...value, returnedModel: "secret?token=value" }, false],
  ] as const) {
    expect(validate(candidate)).toBe(expected);
    expect(providerTelemetrySchema.safeParse(candidate).success).toBe(expected);
  }
});
