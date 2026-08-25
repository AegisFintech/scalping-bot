import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { OpenAiCompatibleClient } from "../../../packages/ai-client/src/client.js";

export interface AiServerOptions {
  readonly client: OpenAiCompatibleClient;
}

export function createAiServer(options: AiServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 4_100_000 });
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
    };
  }>("/v1/analyze", async (request, reply) => {
    try {
      const result = await options.client.analyze(request.body);
      return reply.send(result);
    } catch (error) {
      return reply.code(503).send({
        error: "AI_ANALYSIS_UNAVAILABLE",
        reason: error instanceof Error ? error.message : "AI_ANALYSIS_FAILED",
      });
    }
  });
  return app;
}

async function main(): Promise<void> {
  const client = new OpenAiCompatibleClient({
    baseUrl: process.env.AI_BASE_URL ?? "",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "",
    apiStyle:
      process.env.AI_API_STYLE === "chat_completions"
        ? "chat_completions"
        : "responses",
    schemaPath: path.resolve("schemas/model-response-2.0.json"),
    systemPromptPath: path.resolve("prompts/system-v4.md"),
    promptVersion: "system-v4",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(process.env.AI_MAX_RETRIES ?? 0),
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 3_000),
    circuitBreakerFailures: Number(
      process.env.AI_CIRCUIT_BREAKER_FAILURES ?? 3,
    ),
    circuitBreakerResetMs:
      Number(process.env.AI_CIRCUIT_BREAKER_RESET_SECONDS ?? 300) * 1_000,
  });
  const app = createAiServer({ client });
  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.AI_ORCHESTRATOR_PORT ?? 8082),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
