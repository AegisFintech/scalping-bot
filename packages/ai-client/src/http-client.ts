import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  AnalysisChartArtifact,
  ModelPromptArtifact,
  ModelResponse,
} from "../../contracts/src/index.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { record } from "../../ctrader-client/src/protocol.js";

export interface AiOrchestratorHttpClientOptions {
  readonly baseUrl: string;
  readonly schemaPath: string;
  readonly systemPromptPath: string;
  readonly promptVersion: ModelPromptArtifact["version"];
  readonly timeoutMs?: number;
  readonly circuitResetMs?: number;
  readonly circuitBreakerFailures?: number;
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function orchestratorFailureReason(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const reason = (value as { readonly reason?: unknown }).reason;
  return typeof reason === "string" &&
    reason.length <= 128 &&
    /^AI_[A-Z0-9_]+(?::[A-Z0-9_.-]+)?$/.test(reason)
    ? reason
    : null;
}

export function aiOrchestratorRequestTimeoutMs(input: {
  readonly providerTimeoutMs: number;
  readonly maxRetries: number;
  readonly graceMs?: number;
}): number {
  const graceMs = input.graceMs ?? 5_000;
  if (
    !Number.isSafeInteger(input.providerTimeoutMs) ||
    input.providerTimeoutMs < 1 ||
    !Number.isSafeInteger(input.maxRetries) ||
    input.maxRetries < 0 ||
    !Number.isSafeInteger(graceMs) ||
    graceMs < 0
  ) {
    throw new Error("AI_TIMEOUT_BUDGET_INVALID");
  }
  const timeoutMs = input.providerTimeoutMs * (input.maxRetries + 1) + graceMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error("AI_TIMEOUT_BUDGET_INVALID");
  }
  return timeoutMs;
}

export function aiOrchestratorCircuitResetMs(resetSeconds: number): number {
  const resetMs = resetSeconds * 1_000;
  if (
    !Number.isSafeInteger(resetSeconds) ||
    resetSeconds < 1 ||
    !Number.isSafeInteger(resetMs) ||
    resetMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error("AI_CIRCUIT_RESET_INVALID");
  }
  return resetMs;
}

export class AiOrchestratorHttpClient {
  readonly #options: AiOrchestratorHttpClientOptions;
  readonly #validator: ModelResponseValidator;
  readonly #expectedPromptArtifact: ModelPromptArtifact;
  #transientFailureCount = 0;
  #openUntil = 0;

  constructor(options: AiOrchestratorHttpClientOptions) {
    const resetMs = options.circuitResetMs ?? 300_000;
    if (
      !Number.isSafeInteger(resetMs) ||
      resetMs < 1 ||
      resetMs > MAX_TIMER_DELAY_MS
    ) {
      throw new Error("AI_CIRCUIT_RESET_INVALID");
    }
    const failureThreshold = options.circuitBreakerFailures ?? 1;
    if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1) {
      throw new Error("AI_CIRCUIT_FAILURE_THRESHOLD_INVALID");
    }
    this.#options = options;
    this.#validator = new ModelResponseValidator(options.schemaPath);
    const content = readFileSync(options.systemPromptPath, "utf8").trim();
    if (
      Buffer.byteLength(content, "utf8") < 1 ||
      Buffer.byteLength(content, "utf8") > 65_536
    ) {
      throw new Error("AI_SYSTEM_PROMPT_SIZE_INVALID");
    }
    this.#expectedPromptArtifact = {
      version: options.promptVersion,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  get circuitOpen(): boolean {
    return this.#openUntil > (this.#options.now ?? Date.now)();
  }

  get circuitOpenUntil(): string | null {
    return this.circuitOpen ? new Date(this.#openUntil).toISOString() : null;
  }

  #openCircuit(): void {
    this.#openUntil =
      (this.#options.now ?? Date.now)() +
      (this.#options.circuitResetMs ?? 300_000);
  }

  #recordTransientFailure(): void {
    this.#transientFailureCount += 1;
    if (
      this.#transientFailureCount >= (this.#options.circuitBreakerFailures ?? 1)
    ) {
      this.#openCircuit();
    }
  }

  async analyze(request: {
    readonly analysisId: string;
    readonly symbol: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly chart: AnalysisChartArtifact;
    readonly timeoutMs?: number;
  }): Promise<{
    readonly response: ModelResponse;
    readonly rawResponse: string;
    readonly promptArtifact: ModelPromptArtifact;
  }> {
    if (this.circuitOpen) throw new Error("AI_ORCHESTRATOR_CIRCUIT_OPEN");
    const configuredTimeoutMs = this.#options.timeoutMs ?? 35_000;
    const requestTimeoutMs = request.timeoutMs ?? configuredTimeoutMs;
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 2_000 ||
      requestTimeoutMs > configuredTimeoutMs
    ) {
      throw new Error("AI_ORCHESTRATOR_DEADLINE_INVALID");
    }
    const providerTimeoutMs = requestTimeoutMs - 1_000;
    let response: Response;
    try {
      response = await (this.#options.fetchImpl ?? fetch)(
        new URL("/v1/analyze", this.#options.baseUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-analysis-id": request.analysisId,
          },
          body: JSON.stringify({ ...request, timeoutMs: providerTimeoutMs }),
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      );
    } catch (error) {
      this.#recordTransientFailure();
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new Error("AI_ORCHESTRATOR_TIMEOUT", { cause: error });
      }
      throw new Error("AI_ORCHESTRATOR_UNAVAILABLE", { cause: error });
    }
    if (!response.ok) {
      if (response.status === 503) this.#recordTransientFailure();
      let reason: string | null = null;
      try {
        reason = orchestratorFailureReason(await response.json());
      } catch {
        // Non-JSON and malformed upstream failures retain the bounded HTTP code.
      }
      throw new Error(
        reason ?? `AI_ORCHESTRATOR_HTTP_ERROR:${response.status}`,
      );
    }
    const envelope = record(
      await response.json(),
      "AI_ORCHESTRATOR_RESPONSE_INVALID",
    );
    if (typeof envelope.rawResponse !== "string")
      throw new Error("AI_ORCHESTRATOR_RAW_MISSING");
    const artifact = record(
      envelope.promptArtifact,
      "AI_ORCHESTRATOR_PROMPT_ARTIFACT_MISSING",
    );
    if (
      artifact.version !== this.#expectedPromptArtifact.version ||
      typeof artifact.content !== "string" ||
      Buffer.byteLength(artifact.content, "utf8") < 1 ||
      Buffer.byteLength(artifact.content, "utf8") > 65_536 ||
      typeof artifact.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256) ||
      createHash("sha256").update(artifact.content).digest("hex") !==
        artifact.sha256 ||
      artifact.content !== this.#expectedPromptArtifact.content ||
      artifact.sha256 !== this.#expectedPromptArtifact.sha256
    ) {
      throw new Error("AI_ORCHESTRATOR_PROMPT_ARTIFACT_INVALID");
    }
    const local = this.#validator.parse(envelope.rawResponse);
    if (!local.accepted || local.response === null) {
      throw new Error(
        local.reasonCodes[0] ?? "AI_ORCHESTRATOR_RESPONSE_INVALID",
      );
    }
    if (
      local.response.analysis_id !== request.analysisId ||
      local.response.symbol !== request.symbol
    ) {
      throw new Error("AI_ORCHESTRATOR_IDENTITY_MISMATCH");
    }
    this.#transientFailureCount = 0;
    this.#openUntil = 0;
    return {
      response: local.response,
      rawResponse: envelope.rawResponse,
      promptArtifact: {
        version: this.#expectedPromptArtifact.version,
        content: artifact.content,
        sha256: artifact.sha256,
      },
    };
  }
}
