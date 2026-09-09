import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ScenarioHttpPlanner } from "../../packages/scenario-engine/src/http-planner.js";
import { usageTelemetry } from "../../packages/ai-client/src/telemetry.js";
import type { ReplayInput } from "../../packages/scenario-engine/src/replay.js";
import { analysisChart } from "../helpers/analysis-chart.js";

const plan = (
  JSON.parse(
    readFileSync(
      "tests/fixtures/scenario/manual-levels-synthetic.json",
      "utf8",
    ),
  ) as ReplayInput
).plan;
const input = {
  analysisId: plan.analysis_id,
  symbol: plan.symbol,
  capturedAt: plan.captured_at,
  tickSize: "0.01",
  candles: [],
  chart: analysisChart(),
};
const usage = {
  requestedModel: "deepseek-v4-pro/u5W",
  returnedModel: "deepseek-v4-pro" as string | null,
  inputProfile: "structured",
  requestBytes: 100,
  responseBytes: 100,
  ...usageTelemetry({}),
};
function envelope() {
  const content = readFileSync("prompts/scenario-v3.md", "utf8").trim();
  return {
    model: "deepseek-v4-pro/u5W",
    rawResponse: JSON.stringify(plan),
    latencyMs: 40000,
    retryCount: 0,
    telemetry: { ...usage },
    promptArtifact: {
      version: "scenario-v3",
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  };
}
afterEach(() => vi.useRealTimers());
it("checks the exact requested model, contract and raw response independently", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T00:00:40Z"));
  const fetcher = vi.fn().mockResolvedValue(Response.json(envelope()));
  const result = await new ScenarioHttpPlanner(
    "http://127.0.0.1:8082",
    fetcher,
  ).generate(input);
  expect(result.response).toEqual(plan);
  expect(result.telemetry.returnedModel).toBe("deepseek-v4-pro");
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    "http://127.0.0.1:8082/v1/scenario",
  );
});
it.each([
  "identity",
  "returned_identity",
  "envelope_identity",
  "previous_model",
  "previous_astra",
  "profile",
  "missing_returned_identity",
  "prompt",
  "latency",
  "schema",
  "expiry",
])("fails closed for invalid %s", async (kind) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T00:00:40Z"));
  const e = envelope();
  if (kind === "identity")
    e.telemetry = { ...usage, requestedModel: "wrong-model" };
  if (kind === "returned_identity")
    e.telemetry = { ...usage, returnedModel: "wrong-model" };
  if (kind === "envelope_identity") e.model = "wrong-model";
  if (kind === "profile") e.telemetry = { ...usage, inputProfile: "chart" };
  if (kind === "missing_returned_identity")
    Object.assign(e.telemetry, { returnedModel: null });
  if (kind === "previous_astra") {
    e.model = "gpt-6-astra/u64";
    e.telemetry = {
      ...usage,
      requestedModel: "gpt-6-astra/u64",
      returnedModel: "gpt-6-astra",
    };
  }
  if (kind === "previous_model") {
    e.model = "gpt-5.6-sol/u40";
    e.telemetry = {
      ...usage,
      requestedModel: "gpt-5.6-sol/u40",
      returnedModel: "gpt-5.6-sol",
    };
  }
  if (kind === "prompt") e.promptArtifact.content = "different";
  if (kind === "latency") e.latencyMs = 90001;
  if (kind === "schema")
    e.rawResponse = JSON.stringify({ ...plan, volume: "100" });
  if (kind === "expiry")
    e.rawResponse = JSON.stringify({
      ...plan,
      valid_until: "2026-09-07T00:10:00Z",
    });
  await expect(
    new ScenarioHttpPlanner(
      "http://127.0.0.1",
      vi.fn().mockResolvedValue(Response.json(e)),
    ).generate(input),
  ).rejects.toThrow();
});
it("retains bounded usage for a rejected provider response without private diagnostics", async () => {
  const response = Response.json(
    { reason: "AI_PROVIDER_TIMEOUT", telemetry: usage, private: "ignored" },
    { status: 503 },
  );
  await expect(
    new ScenarioHttpPlanner(
      "http://127.0.0.1",
      vi.fn().mockResolvedValue(response),
    ).generate(input),
  ).rejects.toMatchObject({ message: "AI_PROVIDER_TIMEOUT", telemetry: usage });
});
it("redacts network errors", async () => {
  await expect(
    new ScenarioHttpPlanner(
      "http://127.0.0.1",
      vi.fn().mockRejectedValue(new Error("private URL")),
    ).generate(input),
  ).rejects.toThrow("SCENARIO_ORCHESTRATOR_UNAVAILABLE");
});
it("accepts a bounded 75-second response while retaining original plan expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T00:01:15Z"));
  const e = { ...envelope(), latencyMs: 75_000 };
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const result = await new ScenarioHttpPlanner(
    "http://127.0.0.1",
    vi.fn().mockResolvedValue(Response.json(e)),
  ).generate(input);
  expect(timeout).toHaveBeenCalledWith(95_000);
  expect(result.response.valid_until).toBe(plan.valid_until);
  timeout.mockRestore();
});
it("rejects an expired map even if its reported provider latency is within the bound", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T00:05:00Z"));
  await expect(
    new ScenarioHttpPlanner(
      "http://127.0.0.1",
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...envelope(), latencyMs: 75_000 })),
    ).generate(input),
  ).rejects.toThrow("SCENARIO_IDENTITY_OR_VALIDITY_INVALID");
});
