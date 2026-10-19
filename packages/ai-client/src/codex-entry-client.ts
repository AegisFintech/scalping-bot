import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AiAnalysisRequest, AiAnalysisResult } from "./client.js";
import { boundedResponseText } from "./telemetry.js";
import {
  bindEntryPrices,
  type EntryPairPlan,
} from "../../scenario-engine/src/entry-plan.js";

export const CODEX_ENTRY_MODEL = "gpt-6.1-sol";
const price = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,10})?$/)
  .max(24);
const receipt = z
  .object({
    version: z.literal("codex-entry-response-1.0"),
    analysisId: z.string().uuid(),
    requestedModel: z.literal(CODEX_ENTRY_MODEL),
    returnedModel: z.null(),
    promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
    capturedAt: z.string().datetime({ offset: true }),
    receivedAt: z.string().datetime({ offset: true }),
    entries: z.object({ buy_stop: price, sell_stop: price }).strict(),
    rawResponse: z.string().max(8192),
    inputTokens: z.null(),
    outputTokens: z.null(),
    costAmount: z.null(),
    executionAuthority: z.literal(false),
  })
  .strict();

/** Opt-in adapter; the production factory remains on its reviewed Grok policy. */
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
      readonly fetchImpl?: typeof fetch;
      readonly beforeDispatch: (symbol: string) => Promise<void>;
      readonly now?: () => number;
    },
  ) {
    if (options.localToken.length < 32)
      throw new Error("CODEX_LOCAL_AUTH_REQUIRED");
    this.#prompt = readFileSync("prompts/entry-pair-v4.md", "utf8").trim();
    this.#sha = createHash("sha256").update(this.#prompt).digest("hex");
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }
  async analyze(
    request: AiAnalysisRequest,
  ): Promise<AiAnalysisResult<EntryPairPlan>> {
    if (this.circuitOpen) throw new Error("AI_CIRCUIT_OPEN");
    if (this.#busy) throw new Error("CODEX_REQUEST_IN_FLIGHT");
    if (
      request.chart !== null ||
      request.symbol !== "XAUUSD" ||
      !z.string().uuid().safeParse(request.analysisId).success
    )
      throw new Error("CODEX_NUMERIC_REQUEST_REQUIRED");
    const body = JSON.stringify({
      version: "codex-entry-request-1.0",
      analysisId: request.analysisId,
      symbol: request.symbol,
      promptVersion: "entry-pair-v4",
      promptSha256: this.#sha,
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
      const value = receipt.parse(JSON.parse(raw));
      const ended = this.#now();
      if (
        value.analysisId !== request.analysisId ||
        value.promptSha256 !== this.#sha ||
        value.capturedAt !== request.payload.captured_at ||
        ended < started ||
        ended - started > 95_000 ||
        Date.parse(value.receivedAt) < started ||
        Date.parse(value.receivedAt) > ended
      )
        throw new Error("CODEX_RECEIPT_MISMATCH_OR_STALE");
      const parsed = bindEntryPrices(value.rawResponse, {
        analysisId: request.analysisId,
        symbol: request.symbol,
        capturedAt: value.capturedAt,
        tickSize: String(request.payload.tick_size),
      });
      const strictEntries = JSON.parse(value.rawResponse) as unknown;
      if (
        JSON.stringify(
          z
            .object({ buy_stop: price, sell_stop: price })
            .strict()
            .parse(strictEntries),
        ) !== JSON.stringify(value.entries)
      )
        throw new Error("CODEX_RECEIPT_ENTRIES_MISMATCH");
      this.#failures = 0;
      return {
        response: parsed,
        rawResponse: value.rawResponse,
        latencyMs: ended - started,
        retryCount: 0,
        model: CODEX_ENTRY_MODEL,
        promptArtifact: {
          version: "entry-pair-v4",
          sha256: this.#sha,
          content: this.#prompt,
        },
        telemetry: {
          requestedModel: CODEX_ENTRY_MODEL,
          returnedModel: null,
          inputProfile: "structured",
          requestBytes: Buffer.byteLength(body),
          responseBytes: Buffer.byteLength(raw),
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
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
