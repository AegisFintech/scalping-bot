import { ProviderFailure } from "../../../packages/ai-client/src/telemetry.js";
import { ScenarioPlanner } from "../../../packages/scenario-engine/src/planner.js";
import "dotenv/config";
import { resolveRuntimeEnvironment } from "../../../packages/config/src/policy.js";

import path from "node:path";
import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import {
  OpenAiCompatibleClient,
  type AiReasoningEffort,
} from "../../../packages/ai-client/src/client.js";
import type { AnalysisChartArtifact } from "../../../packages/contracts/src/index.js";

export interface AiServerOptions {
  readonly client: OpenAiCompatibleClient;
  readonly scenarioPlanner?: ScenarioPlanner;
}

export function normalizeAiAnalysisError(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "AI_PROVIDER_TIMEOUT";
  }
  if (error instanceof TypeError) return "AI_PROVIDER_UNAVAILABLE";
  if (
    error instanceof Error &&
    error.message.length <= 128 &&
    /^AI_[A-Z0-9_]+(?::[A-Z0-9_.-]+)?$/.test(error.message)
  ) {
    return error.message;
  }
  return "AI_ANALYSIS_FAILED";
}

export function aiReasoningEffort(
  value: string | undefined,
): AiReasoningEffort | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("AI_REASONING_EFFORT_INVALID");
}

export function createAiServer(options: AiServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 5_600_000 });
  app.post<{ Body: Parameters<ScenarioPlanner["generate"]>[0] }>(
    "/v1/scenario",
    async (request, reply) => {
      if (options.scenarioPlanner === undefined)
        return reply.code(503).send({ reason: "SCENARIO_NOT_CONFIGURED" });
      try {
        return reply.send(await options.scenarioPlanner.generate(request.body));
      } catch (error) {
        return reply.code(503).send({
          reason:
            error instanceof Error &&
            /^(AI|SCENARIO)_[A-Z0-9_:]{1,120}$/.test(error.message)
              ? error.message
              : normalizeAiAnalysisError(error),
          ...(error instanceof ProviderFailure
            ? { telemetry: error.telemetry }
            : {}),
        });
      }
    },
  );
  app.get("/health/live", () => ({ status: "alive" }));
  app.get("/health/ready", (_request, reply) => {
    if (options.client.circuitOpen)
      return reply
        .code(503)
        .send({ status: "not_ready", reason: "AI_CIRCUIT_OPEN" });
    return reply.send({ status: "ready" });
  });
  app.post<{
    Body: {
      analysisId: string;
      symbol: string;
      payload: Record<string, unknown>;
      chart: AnalysisChartArtifact;
      timeoutMs?: number;
    };
  }>("/v1/analyze", async (request, reply) => {
    try {
      const result = await options.client.analyze(request.body);
      return reply.send(result);
    } catch (error) {
      return reply.code(503).send({
        error: "AI_ANALYSIS_UNAVAILABLE",
        reason: normalizeAiAnalysisError(error),
        ...(error instanceof ProviderFailure
          ? { telemetry: error.telemetry }
          : {}),
      });
    }
  });
  return app;
}

async function main(): Promise<void> {
  const environment = resolveRuntimeEnvironment(process.env);
  const reasoningEffort = aiReasoningEffort(environment.AI_REASONING_EFFORT);
  const client = new OpenAiCompatibleClient({
    baseUrl: environment.AI_BASE_URL ?? "",
    apiKey: environment.AI_API_KEY ?? "",
    model: environment.AI_MODEL ?? "",
    inputProfile:
      environment.MODEL_INPUT_PROFILE === "structured" ? "structured" : "chart",
    apiStyle:
      environment.AI_API_STYLE === "chat_completions"
        ? "chat_completions"
        : "responses",
    schemaPath: path.resolve("schemas/model-response-2.1.json"),
    systemPromptPath: path.resolve("prompts/system-v16.md"),
    promptVersion: "system-v16",
    timeoutMs: Number(environment.AI_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(environment.AI_MAX_RETRIES ?? 0),
    maxOutputTokens: Number(environment.AI_MAX_OUTPUT_TOKENS ?? 3_000),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    circuitBreakerFailures: Number(
      environment.AI_CIRCUIT_BREAKER_FAILURES ?? 3,
    ),
    circuitBreakerResetMs:
      Number(environment.AI_CIRCUIT_BREAKER_RESET_SECONDS ?? 300) * 1_000,
  });
  const scenarioPlanner = new ScenarioPlanner({
    baseUrl: environment.AI_BASE_URL ?? "",
    apiKey: environment.AI_API_KEY ?? "",
    executionContext: true,
  });
  const app = createAiServer({ client, scenarioPlanner });
  await app.listen({
    host: environment.HOST ?? "127.0.0.1",
    port: Number(environment.AI_ORCHESTRATOR_PORT ?? 8082),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
