import {
  trialPrompt,
  trialProfile,
} from "../../strategy-candidates/src/demo-trial.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AiAnalysisRequest, AiAnalysisResult } from "./client.js";
import { boundedResponseText } from "./telemetry.js";
import { type EntryDecisionPlan } from "../../scenario-engine/src/entry-decision.js";

import {
  scalpDecisionSchema,
  bindScalpDecision,
} from "../../scenario-engine/src/scalp-entry.js";
import {
  CODEX_ENTRY_MODEL,
  CODEX_STRATEGY_VERSION,
} from "../../config/src/policy.js";
export { CODEX_ENTRY_MODEL };
import { TREND_RETEST_VERSION } from "../../config/src/trend-retest-policy.js";
const receipt = z
  .object({
    version: z.literal("codex-entry-response-1.6"),
    analysisId: z.string().uuid(),
    requestedModel: z.literal(CODEX_ENTRY_MODEL),
    returnedModel: z.null(),
    promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
    capturedAt: z.string().datetime({ offset: true }),
    receivedAt: z.string().datetime({ offset: true }),
    entries: scalpDecisionSchema,
    memory: z
      .object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        threadId: z.string().min(1).max(128),
        turnId: z.string().min(1).max(128),
        compacted: z.boolean(),
      })
      .strict(),
    rawResponse: z.string().max(8192),
    inputTokens: z.null(),
    outputTokens: z.null(),
    costAmount: z.null(),
    executionAuthority: z.literal(false),
  })
  .strict();

const apiReceipt = receipt
  .omit({ memory: true })
  .extend({
    version: z.literal("codex-entry-response-1.7"),
    provider: z.literal("openai-api"),
    returnedModel: z.literal(CODEX_ENTRY_MODEL),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    providerRequestId: z.string().min(1).max(128),
    contextPolicy: z.literal("fresh-input-v1"),
  })
  .strict();

const fallbackReceipt = receipt
  .extend({
    version: z.literal("codex-entry-response-1.8"),
    provider: z.literal("codex-subscription"),
    fallbackReason: z.enum(["API_DAILY_LIMIT", "API_CREDIT_EXHAUSTED"]),
  })
  .strict();

const trialReceipt = receipt.extend({
  version: z.literal("codex-entry-response-1.9"),
});
const trialApiReceipt = apiReceipt.extend({
  version: z.literal("codex-entry-response-1.10"),
});
const trialFallbackReceipt = fallbackReceipt.extend({
  version: z.literal("codex-entry-response-1.11"),
});

const trendReceipt = receipt.extend({
  version: z.literal("codex-entry-response-1.12"),
});
const trendApiReceipt = apiReceipt.extend({
  version: z.literal("codex-entry-response-1.13"),
});
const trendFallbackReceipt = fallbackReceipt.extend({
  version: z.literal("codex-entry-response-1.14"),
});

/** Explicitly selected proposal transport; never owns broker execution authority. */
export class CodexEntryClient {
  readonly #prompt: string;
  readonly #sha: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #busy = false;
  #failures = 0;
  #openUntil = 0;
  get circuitOpen(): boolean {
    return this.#now() < this.#openUntil;
  }
  constructor(
    private readonly options: {
      readonly localToken: string;
      readonly trialProtocol?: boolean;
      readonly provider?: "subscription" | "openai-api";
      readonly fetchImpl?: typeof fetch;
      readonly beforeDispatch: (symbol: string) => Promise<void>;
      readonly now?: () => number;
    },
  ) {
    if (options.localToken.length < 32)
      throw new Error("CODEX_LOCAL_AUTH_REQUIRED");
    this.#prompt = readFileSync("prompts/entry-scalp-v2.md", "utf8").trim();
    this.#sha = createHash("sha256").update(this.#prompt).digest("hex");
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }
  async analyze(
    request: AiAnalysisRequest,
  ): Promise<AiAnalysisResult<EntryDecisionPlan>> {
    if (this.circuitOpen) throw new Error("AI_CIRCUIT_OPEN");
    if (this.#busy) throw new Error("CODEX_REQUEST_IN_FLIGHT");
    if (
      request.chart !== null ||
      request.symbol !== "XAUUSD" ||
      !z.string().uuid().safeParse(request.analysisId).success
    )
      throw new Error("CODEX_NUMERIC_REQUEST_REQUIRED");
    const experiment = request.experiment;
    if (
      this.options.trialProtocol === true
        ? experiment === undefined
        : experiment !== undefined
    )
      throw new Error("AI_DEMO_PROTOCOL_MISMATCH");
    if (
      experiment !== undefined &&
      trialProfile(experiment).proposalSource !== "CODEX"
    )
      throw new Error("AI_DEMO_CODEX_SOURCE_REQUIRED");
    const artifact =
      experiment === undefined
        ? {
            version: "entry-scalp-v2" as const,
            content: this.#prompt,
            sha256: this.#sha,
          }
        : trialPrompt(experiment);
    const trend = experiment?.strategyVersion === TREND_RETEST_VERSION;
    const body = JSON.stringify({
      version: trend
        ? this.options.provider === "openai-api"
          ? "codex-entry-request-1.19"
          : "codex-entry-request-1.18"
        : experiment !== undefined
          ? this.options.provider === "openai-api"
            ? "codex-entry-request-1.17"
            : "codex-entry-request-1.16"
          : this.options.provider === "openai-api"
            ? "codex-entry-request-1.15"
            : "codex-entry-request-1.14",
      ...(this.options.provider === "openai-api"
        ? { provider: "openai-api" }
        : {}),
      analysisId: request.analysisId,
      symbol: request.symbol,
      promptVersion: artifact.version,
      promptSha256: artifact.sha256,
      ...(experiment === undefined ? {} : { experiment }),
      payload: request.payload,
    });
    if (Buffer.byteLength(body) > 128_000)
      throw new Error("CODEX_INPUT_OVERSIZED");
    this.#busy = true;
    const started = this.#now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 95_000);
    let dispatched = false;
    try {
      await this.options.beforeDispatch(request.symbol);
      dispatched = true;
      const response = await this.#fetch(
        "http://127.0.0.1:8084/v1/entry-proposals",
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.options.localToken}`,
          },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("CODEX_UNAVAILABLE_OR_UNKNOWN");
      const raw = await boundedResponseText(response, 16_384);
      const value = trend
        ? this.options.provider === "openai-api"
          ? z
              .union([trendApiReceipt, trendFallbackReceipt])
              .parse(JSON.parse(raw))
          : trendReceipt.parse(JSON.parse(raw))
        : experiment !== undefined
          ? this.options.provider === "openai-api"
            ? z
                .union([trialApiReceipt, trialFallbackReceipt])
                .parse(JSON.parse(raw))
            : trialReceipt.parse(JSON.parse(raw))
          : this.options.provider === "openai-api"
            ? z.union([apiReceipt, fallbackReceipt]).parse(JSON.parse(raw))
            : receipt.parse(JSON.parse(raw));
      const ended = this.#now();
      if (
        value.analysisId !== request.analysisId ||
        value.promptSha256 !== artifact.sha256 ||
        value.capturedAt !== request.payload.captured_at ||
        ("memory" in value &&
          value.memory.day !== value.capturedAt.slice(0, 10)) ||
        ended < started ||
        ended - started > 95_000 ||
        Date.parse(value.receivedAt) < started ||
        Date.parse(value.receivedAt) > ended
      )
        throw new Error("CODEX_RECEIPT_MISMATCH_OR_STALE");
      const candles = request.payload.candles as {
        timeframe: string;
        rows: unknown[][];
      }[];
      const observed = candles
        .find((s) => s.timeframe === "M1")
        ?.rows.at(-1)?.[1];
      if (typeof observed !== "string") throw new Error("CODEX_M1_REQUIRED");
      const parsed = bindScalpDecision(
        value.rawResponse,
        {
          observedM1End: observed,
          analysisId: request.analysisId,
          symbol: request.symbol,
          capturedAt: value.capturedAt,
          tickSize: String(request.payload.tick_size),
        },
        experiment === undefined
          ? CODEX_STRATEGY_VERSION
          : experiment.strategyVersion,
      );
      const strictEntries = JSON.parse(value.rawResponse) as unknown;
      if (
        JSON.stringify(scalpDecisionSchema.parse(strictEntries)) !==
        JSON.stringify(value.entries)
      )
        throw new Error("CODEX_RECEIPT_ENTRIES_MISMATCH");
      this.#failures = 0;
      return {
        response: parsed,
        rawResponse: value.rawResponse,
        latencyMs: ended - started,
        retryCount: 0,
        model: CODEX_ENTRY_MODEL,
        promptArtifact: artifact,
        telemetry: {
          requestedModel: CODEX_ENTRY_MODEL,
          returnedModel: value.returnedModel,
          inputProfile: "structured",
          requestBytes: Buffer.byteLength(body),
          responseBytes: Buffer.byteLength(raw),
          inputTokens: value.inputTokens,
          outputTokens: value.outputTokens,
          totalTokens:
            value.inputTokens === null || value.outputTokens === null
              ? null
              : value.inputTokens + value.outputTokens,
          costAmount: null,
          costCurrency: null,
          costSource: "unavailable",
        },
      };
    } catch {
      if (dispatched && ++this.#failures >= 3)
        this.#openUntil = this.#now() + 300_000;
      throw new Error("CODEX_FAILED_OR_UNKNOWN");
    } finally {
      clearTimeout(timer);
      this.#busy = false;
    }
  }
}
