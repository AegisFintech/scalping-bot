import { readFileSync } from "node:fs";

import type { ModelResponse } from "../../contracts/src/index.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { record, recordsField } from "../../ctrader-client/src/protocol.js";

export type AiApiStyle = "responses" | "chat_completions";

export interface AiClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiStyle: AiApiStyle;
  readonly schemaPath: string;
  readonly systemPromptPath: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly circuitBreakerFailures?: number;
  readonly circuitBreakerResetMs?: number;
  readonly maxRequestBytes?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface AiAnalysisRequest {
  readonly analysisId: string;
  readonly symbol: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AiAnalysisResult {
  readonly response: ModelResponse;
  readonly rawResponse: string;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly model: string;
}

function endpoint(baseUrl: string, style: AiApiStyle): string {
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password)
    throw new Error("AI_URL_CREDENTIALS_FORBIDDEN");
  const suffix = style === "responses" ? "/responses" : "/chat/completions";
  if (!parsed.pathname.endsWith(suffix))
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}${suffix}`;
  return parsed.toString();
}

function extractResponses(payload: Record<string, unknown>): string {
  if (payload.status === "incomplete")
    throw new Error("AI_RESPONSE_INCOMPLETE");
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const output of recordsField(payload, "output")) {
    for (const content of recordsField(output, "content")) {
      if (content.type === "refusal") throw new Error("AI_RESPONSE_REFUSAL");
      if (content.type === "output_text" && typeof content.text === "string")
        return content.text;
    }
  }
  throw new Error("AI_RESPONSE_TEXT_MISSING");
}

function extractChat(payload: Record<string, unknown>): string {
  const choice = recordsField(payload, "choices")[0];
  if (choice === undefined) throw new Error("AI_CHAT_CHOICE_MISSING");
  const message = record(choice.message, "AI_CHAT_MESSAGE_MISSING");
  if (typeof message.refusal === "string" && message.refusal.length > 0)
    throw new Error("AI_RESPONSE_REFUSAL");
  if (typeof message.content !== "string")
    throw new Error("AI_RESPONSE_TEXT_MISSING");
  return message.content;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export class OpenAiCompatibleClient {
  readonly #options: AiClientOptions;
  readonly #schema: Record<string, unknown>;
  readonly #systemPrompt: string;
  readonly #validator: ModelResponseValidator;
  #failureCount = 0;
  #openUntil = 0;

  constructor(options: AiClientOptions) {
    this.#options = options;
    if (!options.apiKey) throw new Error("AI_API_KEY_REQUIRED");
    if (!options.model) throw new Error("AI_MODEL_REQUIRED");
    this.#schema = record(
      JSON.parse(readFileSync(options.schemaPath, "utf8")),
      "AI_SCHEMA_INVALID",
    );
    this.#systemPrompt = readFileSync(options.systemPromptPath, "utf8").trim();
    this.#validator = new ModelResponseValidator(options.schemaPath);
  }

  get circuitOpen(): boolean {
    return this.#openUntil > (this.#options.now ?? Date.now)();
  }

  async analyze(request: AiAnalysisRequest): Promise<AiAnalysisResult> {
    const now = this.#options.now ?? Date.now;
    if (this.#openUntil > now()) throw new Error("AI_CIRCUIT_OPEN");
    const payloadText = JSON.stringify(request.payload);
    if (
      Buffer.byteLength(payloadText) >
      (this.#options.maxRequestBytes ?? 4_000_000)
    ) {
      throw new Error("AI_REQUEST_OVERSIZED");
    }
    const body = this.#requestBody(payloadText);
    const maxRetries = this.#options.maxRetries ?? 2;
    const started = now();
    let lastError: Error = new Error("AI_REQUEST_FAILED");
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await (this.#options.fetchImpl ?? fetch)(
          endpoint(this.#options.baseUrl, this.#options.apiStyle),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.#options.apiKey}`,
              "content-type": "application/json",
              "x-analysis-id": request.analysisId,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.#options.timeoutMs ?? 30_000),
          },
        );
        if (!response.ok) {
          lastError = new Error(`AI_HTTP_ERROR:${response.status}`);
          if (attempt < maxRetries && retryableStatus(response.status))
            continue;
          throw lastError;
        }
        const envelope = record(
          await response.json(),
          "AI_RESPONSE_ENVELOPE_INVALID",
        );
        const raw =
          this.#options.apiStyle === "responses"
            ? extractResponses(envelope)
            : extractChat(envelope);
        const validated = this.#validator.parse(raw);
        if (!validated.accepted || validated.response === null) {
          throw new Error(validated.reasonCodes[0] ?? "AI_RESPONSE_INVALID");
        }
        if (
          validated.response.analysis_id !== request.analysisId ||
          validated.response.symbol !== request.symbol
        ) {
          throw new Error("AI_RESPONSE_REQUEST_IDENTITY_MISMATCH");
        }
        this.#failureCount = 0;
        this.#openUntil = 0;
        return {
          response: validated.response,
          rawResponse: raw,
          latencyMs: now() - started,
          retryCount: attempt,
          model: this.#options.model,
        };
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("AI_REQUEST_FAILED");
        if (
          attempt < maxRetries &&
          (lastError.name === "TimeoutError" || lastError.name === "TypeError")
        )
          continue;
        break;
      }
    }
    this.#recordFailure(now());
    throw lastError;
  }

  #requestBody(payloadText: string): Record<string, unknown> {
    const maxOutputTokens = this.#options.maxOutputTokens ?? 3_000;
    const temperature = this.#options.temperature ?? 0;
    if (this.#options.apiStyle === "responses") {
      return {
        model: this.#options.model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: this.#systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: payloadText }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "market_analysis_1_0",
            strict: true,
            schema: this.#schema,
          },
        },
        max_output_tokens: maxOutputTokens,
        temperature,
      };
    }
    return {
      model: this.#options.model,
      messages: [
        { role: "system", content: this.#systemPrompt },
        { role: "user", content: payloadText },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "market_analysis_1_0",
          strict: true,
          schema: this.#schema,
        },
      },
      max_tokens: maxOutputTokens,
      temperature,
    };
  }

  #recordFailure(now: number): void {
    this.#failureCount += 1;
    if (this.#failureCount >= (this.#options.circuitBreakerFailures ?? 3)) {
      this.#openUntil = now + (this.#options.circuitBreakerResetMs ?? 300_000);
    }
  }
}
