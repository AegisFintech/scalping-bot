import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  TechnicalContextRequest,
  TechnicalContextRequestV11,
  TechnicalContextRequestV12,
  TechnicalContextResponse,
  TechnicalContextResponseV11,
} from "../../contracts/src/technical-context.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { boundedResponseText } from "../../ai-client/src/telemetry.js";

const input = new ModelResponseValidator<TechnicalContextRequest>(
  "schemas/technical-context-request-1.0.json",
);
const inputV11 = new ModelResponseValidator<TechnicalContextRequestV11>(
  "schemas/technical-context-request-1.1.json",
);
const inputV12 = new ModelResponseValidator<TechnicalContextRequestV12>(
  "schemas/technical-context-request-1.2.json",
);
const output = new ModelResponseValidator<TechnicalContextResponse>(
  "schemas/technical-context-response-1.0.json",
);
const outputV11 = new ModelResponseValidator<TechnicalContextResponseV11>(
  "schemas/technical-context-response-1.1.json",
);

/** Read-only candidate preparation. Never calls Codex or execution APIs. */
export class TechnicalContextHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("TECHNICAL_CONTEXT_LOOPBACK_REQUIRED");
  }
  prepare(
    request: TechnicalContextRequest | TechnicalContextRequestV11,
  ): Promise<TechnicalContextResponse>;
  prepare(
    request: TechnicalContextRequestV12,
  ): Promise<TechnicalContextResponseV11>;
  async prepare(
    request:
      | TechnicalContextRequest
      | TechnicalContextRequestV11
      | TechnicalContextRequestV12,
  ): Promise<TechnicalContextResponse | TechnicalContextResponseV11> {
    const raw = JSON.stringify(request);
    const levels = request.schemaVersion === "technical-context-request-1.2";
    const localClock =
      levels || request.schemaVersion === "technical-context-request-1.1";
    const validator = levels ? inputV12 : localClock ? inputV11 : input;
    if (!validator.parse(raw).accepted)
      throw new Error("TECHNICAL_CONTEXT_INPUT_INVALID");
    const path = levels ? "/v3" : localClock ? "/v2" : "/v1";
    const response = await this.fetchImpl(
      new URL(`${path}/technical-context`, this.baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("TECHNICAL_CONTEXT_HTTP_UNAVAILABLE");
    const text = await boundedResponseText(response, 128_000);
    const parsed = (levels ? outputV11 : output).parse(text);
    const value = parsed.response;
    if (!parsed.accepted || value === null)
      throw new Error("TECHNICAL_CONTEXT_RESPONSE_INVALID");
    if (
      levels &&
      (value.schemaVersion !== "technical-context-response-1.1" ||
        (value.evidence !== null &&
          value.evidence.definitions_version !== "causal-smc-1.1"))
    )
      throw new Error("TECHNICAL_CONTEXT_RESPONSE_INVALID");
    if (
      value.requestId !== request.request.requestId ||
      value.analysisId !== request.request.analysisId ||
      Date.parse(value.capturedAt) !== Date.parse(request.request.analysisTime)
    )
      throw new Error("TECHNICAL_CONTEXT_IDENTITY_MISMATCH");
    if (
      value.acceptable !== (value.reasons.length === 0) ||
      value.acceptable !==
        (value.evidence !== null && value.codexPayload !== null) ||
      (!value.acceptable &&
        (value.evidence !== null || value.codexPayload !== null))
    )
      throw new Error("TECHNICAL_CONTEXT_EVIDENCE_MISMATCH");
    const candidate = levels
      ? "entry-context-candidate-1.1"
      : "entry-context-candidate-1.0";
    if (
      value.codexPayload !== null &&
      (value.codexPayload.version !== candidate ||
        value.codexPayload.prompt_sha256 !==
          createHash("sha256")
            .update(readFileSync("prompts/research/entry-context-v1.md"))
            .digest("hex") ||
        value.codexPayload.execution_authority !== false ||
        value.codexPayload.input_sha256 !== value.inputSha256 ||
        JSON.stringify(value.codexPayload.technical_context) !==
          JSON.stringify(value.evidence))
    )
      throw new Error("TECHNICAL_CONTEXT_PROVENANCE_MISMATCH");
    return value;
  }
}
