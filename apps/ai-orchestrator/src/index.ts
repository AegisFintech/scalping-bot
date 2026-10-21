import { CodexEntryClient } from "../../../packages/ai-client/src/codex-entry-client.js";
import { FIXED_DEFAULTS } from "../../../packages/config/src/policy.js";
import { ProviderFailure } from "../../../packages/ai-client/src/telemetry.js";
import type { ScenarioPlanner } from "../../../packages/scenario-engine/src/planner.js";
import { EntryPairPlanner } from "../../../packages/scenario-engine/src/entry-planner.js";
import { MarketDataHttpClient } from "../../../packages/market-data-client/src/client.js";
import { BrokerSessionGate } from "../../../packages/market-data-client/src/session-gate.js";
import "dotenv/config";
import { resolveRuntimeEnvironment } from "../../../packages/config/src/policy.js";

import { pathToFileURL } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import type {
  OpenAiCompatibleClient,
  AiReasoningEffort,
} from "../../../packages/ai-client/src/client.js";
import type { AnalysisChartArtifact } from "../../../packages/contracts/src/index.js";

export interface AiServerOptions {
  readonly client?: OpenAiCompatibleClient;
  readonly scenarioPlanner?: ScenarioPlanner;
  readonly entryPairPlanner?: EntryPairPlanner;
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
  for (const version of ["v1", "v2"] as const)
    app.post<{ Body: Parameters<EntryPairPlanner["generate"]>[0] }>(
      `/${version}/entry-pair`,
      async (request, reply) => {
        if (options.entryPairPlanner === undefined)
          return reply.code(503).send({ reason: "SCENARIO_NOT_CONFIGURED" });
        try {
          if (
            version === "v1" &&
            (request.body.chart == null ||
              request.body.schemaVersion !== undefined)
          )
            return reply.code(400).send({ reason: "SCENARIO_CHART_MISSING" });
          if (
            version === "v2" &&
            (request.body.chart !== null ||
              request.body.schemaVersion !== "2.0")
          )
            return reply
              .code(400)
              .send({ reason: "SCENARIO_NUMERIC_CONTRACT_REQUIRED" });
          return reply.send(
            await options.entryPairPlanner.generate(request.body),
          );
        } catch (error) {
          return reply.code(503).send({
            reason:
              error instanceof Error &&
              /^(AI|SCENARIO)_[A-Z0-9_:]{1,120}$/.test(error.message)
                ? error.message
                : normalizeAiAnalysisError(error),
            ...(error instanceof ProviderFailure
              ? {
                  telemetry: error.telemetry,
                  ...(version === "v2" && error.rawResponse !== undefined
                    ? { rawResponse: error.rawResponse }
                    : {}),
                }
              : {}),
          });
        }
      },
    );
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
    if (
      options.client?.circuitOpen ||
      options.scenarioPlanner?.client.circuitOpen ||
      options.entryPairPlanner?.client.circuitOpen
    )
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
      if (options.client === undefined)
        return reply.code(503).send({ reason: "AI_LEGACY_ROUTE_DISABLED" });
      if (request.body.chart == null) throw new Error("AI_CHART_MISSING");
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

/** Production has exactly one provider; legacy endpoints cannot dispatch API calls. */
export function createProductionAiOptions(
  environment: NodeJS.ProcessEnv,
  beforeDispatch: (symbol: string) => Promise<void>,
  fetchImpl?: typeof fetch,
): AiServerOptions {
  if (
    environment.AI_MODEL !== FIXED_DEFAULTS.AI_MODEL ||
    environment.AI_PROVIDER !== FIXED_DEFAULTS.AI_PROVIDER
  )
    throw new Error("AI_PROVIDER_POLICY_MISMATCH");
  const client = new CodexEntryClient({
    localToken: environment.CODEX_ENTRY_LOCAL_TOKEN ?? "",
    beforeDispatch,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  return {
    entryPairPlanner: new EntryPairPlanner({
      client,
      baseUrl: "",
      apiKey: "",
      requireTechnicalContext: true,
    }),
  };
}

async function main(): Promise<void> {
  const environment = resolveRuntimeEnvironment(process.env);
  const sessionClient = new MarketDataHttpClient({
    baseUrl:
      environment.MARKET_DATA_BASE_URL ??
      `http://127.0.0.1:${environment.MARKET_DATA_PORT ?? "8081"}`,
    timeoutMs: 5_000,
    maxRetries: 0,
  });
  const sessionGate = new BrokerSessionGate(
    environment.TRADING_SYMBOL ?? "",
    (symbol) => sessionClient.session(symbol),
  );
  const beforeDispatch = async (symbol: string): Promise<void> => {
    if (symbol !== environment.TRADING_SYMBOL)
      throw new Error("AI_MARKET_SESSION_UNAVAILABLE");
    try {
      await sessionGate.requireOpen();
    } catch {
      throw new Error(
        sessionGate.status.state === "CLOSED"
          ? "AI_MARKET_SESSION_CLOSED"
          : "AI_MARKET_SESSION_UNAVAILABLE",
      );
    }
  };
  const app = createAiServer(
    createProductionAiOptions(environment, beforeDispatch),
  );
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
