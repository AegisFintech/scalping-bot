import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  TechnicalContextRequest,
  TechnicalContextResponse,
} from "../../contracts/src/technical-context.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import { boundedResponseText } from "../../ai-client/src/telemetry.js";

const input = new ModelResponseValidator<TechnicalContextRequest>(
  "schemas/technical-context-request-1.0.json",
);
const output = new ModelResponseValidator<TechnicalContextResponse>(
  "schemas/technical-context-response-1.0.json",
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
  async prepare(
    request: TechnicalContextRequest,
  ): Promise<TechnicalContextResponse> {
    const raw = JSON.stringify(request);
    if (!input.parse(raw).accepted)
      throw new Error("TECHNICAL_CONTEXT_INPUT_INVALID");
    const response = await this.fetchImpl(
      new URL("/v1/technical-context", this.baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("TECHNICAL_CONTEXT_HTTP_UNAVAILABLE");
    const parsed = output.parse(await boundedResponseText(response, 128_000));
    const value = parsed.response;
    if (!parsed.accepted || value === null)
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
    if (
      value.codexPayload !== null &&
      (value.codexPayload.version !== "entry-context-candidate-1.0" ||
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
