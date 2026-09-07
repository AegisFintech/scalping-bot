import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  AnalysisChartArtifact,
  ModelPromptArtifact,
  ModelResponse,
} from "../../contracts/src/index.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { record, recordsField } from "../../ctrader-client/src/protocol.js";
import {
  boundedResponseText,
  ProviderFailure,
  providerTelemetrySchema,
  usageTelemetry,
  type ProviderTelemetry,
} from "./telemetry.js";

export type AiApiStyle = "responses" | "chat_completions";
export type AiReasoningEffort = "low" | "medium" | "high";

export interface AiClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiStyle: AiApiStyle;
  readonly schemaPath: string;
  readonly systemPromptPath: string;
  readonly promptVersion: ModelPromptArtifact["version"];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly reasoningEffort?: AiReasoningEffort;
  readonly circuitBreakerFailures?: number;
  readonly circuitBreakerResetMs?: number;
  readonly maxRequestBytes?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly inputProfile?: "chart" | "structured";
  readonly outputSchemaName?: string;
}

export interface AiAnalysisRequest {
  readonly analysisId: string;
  readonly symbol: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly chart: AnalysisChartArtifact;
  readonly timeoutMs?: number;
}

export interface AiAnalysisResult<T = ModelResponse> {
  readonly response: T;
  readonly rawResponse: string;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly model: string;
  readonly promptArtifact: ModelPromptArtifact;
  readonly telemetry: ProviderTelemetry;
}

function endpoint(baseUrl: string, style: AiApiStyle): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("AI_URL_INVALID");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("AI_URL_CREDENTIALS_FORBIDDEN");
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
  )
    throw new Error("AI_HTTPS_REQUIRED");
  const suffix = style === "responses" ? "/responses" : "/chat/completions";
  if (!parsed.pathname.endsWith(suffix))
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}${suffix}`;
  return parsed.toString();
}

function extractResponses(payload: Record<string, unknown>): string {
  if (payload.status !== undefined && payload.status !== "completed")
    throw new Error("AI_RESPONSE_INCOMPLETE");
  const texts = new Set<string>();
  if (typeof payload.output_text === "string") texts.add(payload.output_text);
  for (const output of recordsField(payload, "output")) {
    for (const content of recordsField(output, "content")) {
      if (content.type === "refusal") throw new Error("AI_RESPONSE_REFUSAL");
      if (content.type === "output_text" && typeof content.text === "string")
        texts.add(content.text);
    }
  }
  if (texts.size > 1) throw new Error("AI_RESPONSE_TEXT_AMBIGUOUS");
  const text = [...texts][0];
  if (text === undefined) throw new Error("AI_RESPONSE_TEXT_MISSING");
  return text;
}

function extractChat(payload: Record<string, unknown>): string {
  const choices = recordsField(payload, "choices");
  if (choices.length !== 1) throw new Error("AI_CHAT_CHOICE_AMBIGUOUS");
  const choice = choices[0];
  if (choice === undefined) throw new Error("AI_CHAT_CHOICE_MISSING");
  if (choice.finish_reason !== undefined && choice.finish_reason !== "stop")
    throw new Error("AI_RESPONSE_INCOMPLETE");
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

function chartDataUrl(chart: AnalysisChartArtifact): string {
  const bytes = Buffer.from(chart.dataBase64, "base64");
  if (
    chart.mimeType !== "image/png" ||
    chart.rendererVersion !== "completed-candles-ema-atr-v1" ||
    chart.completedCandlesOnly !== true ||
    chart.width !== 1600 ||
    chart.height !== 1200 ||
    bytes.length < 33 ||
    bytes.length > 1_048_576 ||
    bytes.toString("base64") !== chart.dataBase64 ||
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
    bytes.readUInt32BE(16) !== chart.width ||
    bytes.readUInt32BE(20) !== chart.height ||
    createHash("sha256").update(bytes).digest("hex") !== chart.sha256
  ) {
    throw new Error("AI_CHART_INVALID");
  }
  return `data:image/png;base64,${chart.dataBase64}`;
}

export class OpenAiCompatibleClient<
  T extends { readonly analysis_id: string; readonly symbol: string } =
    ModelResponse,
> {
  readonly #options: AiClientOptions;
  readonly #schema: Record<string, unknown>;
  readonly #systemPrompt: string;
  readonly #promptArtifact: ModelPromptArtifact;
  readonly #validator: ModelResponseValidator<T>;
  #failureCount = 0;
  #openUntil = 0;
  #inFlight = false;

  constructor(options: AiClientOptions) {
    this.#options = options;
    if (!options.apiKey) throw new Error("AI_API_KEY_REQUIRED");
    if (!options.model) throw new Error("AI_MODEL_REQUIRED");
    if (
      options.outputSchemaName !== undefined &&
      !/^[a-zA-Z0-9_-]{1,64}$/.test(options.outputSchemaName)
    )
      throw new Error("AI_SCHEMA_NAME_INVALID");
    endpoint(options.baseUrl, options.apiStyle);
    for (const [value, min, max] of [
      [options.timeoutMs ?? 30_000, 1_000, 120_000],
      [options.maxRetries ?? 0, 0, 2],
      [options.maxOutputTokens ?? 3_000, 128, 16_384],
      [options.maxRequestBytes ?? 5_600_000, 1, 5_600_000],
      [options.circuitBreakerFailures ?? 3, 1, 10],
      [options.circuitBreakerResetMs ?? 300_000, 1_000, 900_000],
    ]) {
      if (
        value === undefined ||
        min === undefined ||
        max === undefined ||
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max
      )
        throw new Error("AI_CONFIG_BOUNDS_INVALID");
    }
    this.#schema = record(
      JSON.parse(readFileSync(options.schemaPath, "utf8")),
      "AI_SCHEMA_INVALID",
    );
    this.#systemPrompt = readFileSync(options.systemPromptPath, "utf8").trim();
    if (
      Buffer.byteLength(this.#systemPrompt, "utf8") < 1 ||
      Buffer.byteLength(this.#systemPrompt, "utf8") > 65_536
    ) {
      throw new Error("AI_SYSTEM_PROMPT_SIZE_INVALID");
    }
    this.#promptArtifact = {
      version: options.promptVersion,
      content: this.#systemPrompt,
      sha256: createHash("sha256").update(this.#systemPrompt).digest("hex"),
    };
    this.#validator = new ModelResponseValidator<T>(options.schemaPath);
  }

  get circuitOpen(): boolean {
    return this.#openUntil > (this.#options.now ?? Date.now)();
  }

  async analyze(request: AiAnalysisRequest): Promise<AiAnalysisResult<T>> {
    if (this.#inFlight) throw new Error("AI_REQUEST_ALREADY_IN_FLIGHT");
    this.#inFlight = true;
    try {
      return await this.#analyze(request);
    } finally {
      this.#inFlight = false;
    }
  }

  async #analyze(request: AiAnalysisRequest): Promise<AiAnalysisResult<T>> {
    const now = this.#options.now ?? Date.now;
    if (this.#openUntil > now()) throw new Error("AI_CIRCUIT_OPEN");
    const payloadText = JSON.stringify(request.payload);
    if (
      Buffer.byteLength(payloadText) >
      (this.#options.maxRequestBytes ?? 4_000_000)
    ) {
      throw new Error("AI_REQUEST_OVERSIZED");
    }
    const body = this.#requestBody(
      payloadText,
      this.#options.inputProfile === "structured"
        ? null
        : chartDataUrl(request.chart),
    );
    if (
      Buffer.byteLength(JSON.stringify(body), "utf8") >
      (this.#options.maxRequestBytes ?? 5_600_000)
    ) {
      throw new Error("AI_REQUEST_OVERSIZED");
    }
    const maxRetries = this.#options.maxRetries ?? 0;
    const configuredTimeoutMs = this.#options.timeoutMs ?? 30_000;
    const requestTimeoutMs = request.timeoutMs ?? configuredTimeoutMs;
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1_000 ||
      requestTimeoutMs > configuredTimeoutMs
    ) {
      throw new Error("AI_REQUEST_DEADLINE_INVALID");
    }
    const started = now();
    let lastError: Error = new Error("AI_REQUEST_FAILED");
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let attemptTelemetry: ProviderTelemetry | undefined;
      try {
        const remainingTimeoutMs = requestTimeoutMs - (now() - started);
        if (remainingTimeoutMs < 1_000) {
          throw new Error("AI_REQUEST_DEADLINE_EXHAUSTED");
        }
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
            signal: AbortSignal.timeout(remainingTimeoutMs),
            redirect: "error",
          },
        );
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          lastError = new Error(`AI_HTTP_ERROR:${response.status}`);
          if (attempt < maxRetries && retryableStatus(response.status))
            continue;
          throw lastError;
        }
        const responseText = await boundedResponseText(response);
        const envelope = record(
          JSON.parse(responseText),
          "AI_RESPONSE_ENVELOPE_INVALID",
        );
        const returnedModel = envelope.model ?? null;
        if (
          returnedModel !== null &&
          returnedModel !== this.#options.model &&
          !(
            this.#options.model === "gpt-6-astra/u64" &&
            returnedModel === "gpt-6-astra"
          )
        )
          throw new Error("AI_RETURNED_MODEL_MISMATCH");
        const telemetry = providerTelemetrySchema.parse({
          requestedModel: this.#options.model,
          returnedModel,
          inputProfile: this.#options.inputProfile ?? "chart",
          requestBytes: Buffer.byteLength(JSON.stringify(body)),
          responseBytes: Buffer.byteLength(responseText),
          ...usageTelemetry(envelope),
        });
        attemptTelemetry = telemetry;
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
          promptArtifact: this.#promptArtifact,
          telemetry,
        };
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error("AI_REQUEST_FAILED");
        lastError =
          attemptTelemetry === undefined
            ? failure
            : new ProviderFailure(failure.message, attemptTelemetry);
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

  #requestBody(
    payloadText: string,
    imageUrl: string | null,
  ): Record<string, unknown> {
    const maxOutputTokens = this.#options.maxOutputTokens ?? 3_000;
    const temperature = this.#options.temperature;
    if (this.#options.apiStyle === "responses") {
      return {
        model: this.#options.model,
        ...(this.#options.reasoningEffort === undefined
          ? {}
          : { reasoning: { effort: this.#options.reasoningEffort } }),
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: this.#systemPrompt }],
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: payloadText },
              ...(imageUrl === null
                ? []
                : [
                    {
                      type: "input_image",
                      image_url: imageUrl,
                      detail: "high",
                    },
                  ]),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: this.#options.outputSchemaName ?? "market_analysis_2_1",
            strict: true,
            schema: this.#schema,
          },
        },
        max_output_tokens: maxOutputTokens,
        ...(temperature === undefined ? {} : { temperature }),
        store: false,
      };
    }
    return {
      model: this.#options.model,
      ...(this.#options.reasoningEffort === undefined
        ? {}
        : { reasoning_effort: this.#options.reasoningEffort }),
      messages: [
        { role: "system", content: this.#systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: payloadText },
            ...(imageUrl === null
              ? []
              : [
                  {
                    type: "image_url",
                    image_url: { url: imageUrl, detail: "high" },
                  },
                ]),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: this.#options.outputSchemaName ?? "market_analysis_2_1",
          strict: true,
          schema: this.#schema,
        },
      },
      max_completion_tokens: maxOutputTokens,
      ...(temperature === undefined ? {} : { temperature }),
      store: false,
    };
  }

  #recordFailure(now: number): void {
    this.#failureCount += 1;
    if (this.#failureCount >= (this.#options.circuitBreakerFailures ?? 3)) {
      this.#openUntil = now + (this.#options.circuitBreakerResetMs ?? 300_000);
    }
  }
}
