import type { ModelResponse } from "../../contracts/src/index.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { record } from "../../ctrader-client/src/protocol.js";

export interface AiOrchestratorHttpClientOptions {
  readonly baseUrl: string;
  readonly schemaPath: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class AiOrchestratorHttpClient {
  readonly #options: AiOrchestratorHttpClientOptions;
  readonly #validator: ModelResponseValidator;
  #circuitOpen = false;

  constructor(options: AiOrchestratorHttpClientOptions) {
    this.#options = options;
    this.#validator = new ModelResponseValidator(options.schemaPath);
  }

  get circuitOpen(): boolean {
    return this.#circuitOpen;
  }

  async analyze(request: {
    readonly analysisId: string;
    readonly symbol: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly response: ModelResponse;
    readonly rawResponse: string;
  }> {
    const response = await (this.#options.fetchImpl ?? fetch)(
      new URL("/v1/analyze", this.#options.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-analysis-id": request.analysisId,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 35_000),
      },
    );
    if (!response.ok) {
      this.#circuitOpen = response.status === 503;
      throw new Error(`AI_ORCHESTRATOR_HTTP_ERROR:${response.status}`);
    }
    const envelope = record(
      await response.json(),
      "AI_ORCHESTRATOR_RESPONSE_INVALID",
    );
    if (typeof envelope.rawResponse !== "string")
      throw new Error("AI_ORCHESTRATOR_RAW_MISSING");
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
    this.#circuitOpen = false;
    return { response: local.response, rawResponse: envelope.rawResponse };
  }
}
