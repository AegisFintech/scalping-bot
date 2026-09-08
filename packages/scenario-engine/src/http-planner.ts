import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FIXED_DEFAULTS } from "../../config/src/policy.js";
import { returnedModelMatches } from "../../ai-client/src/model-identity.js";
import {
  boundedResponseText,
  ProviderFailure,
  providerTelemetrySchema,
} from "../../ai-client/src/telemetry.js";
import type { AiAnalysisResult } from "../../ai-client/src/client.js";
import { validatePlan, type ScenarioPlan } from "./plan.js";
import type { ScenarioPlanner } from "./planner.js";
import { SCENARIO_REQUEST_POLICY } from "./request-policy.js";

export class ScenarioHttpPlanner {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl = fetch,
  ) {}
  async generate(
    input: Parameters<ScenarioPlanner["generate"]>[0],
  ): Promise<AiAnalysisResult<ScenarioPlan>> {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL("/v1/scenario", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(
          SCENARIO_REQUEST_POLICY.providerTimeoutMs +
            SCENARIO_REQUEST_POLICY.transportGraceMs,
        ),
      });
    } catch {
      throw new Error("SCENARIO_ORCHESTRATOR_UNAVAILABLE");
    }
    const envelope = JSON.parse(await boundedResponseText(response)) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const reason =
        typeof envelope.reason === "string" &&
        /^(AI|SCENARIO)_[A-Z0-9_:]{1,120}$/.test(envelope.reason)
          ? envelope.reason
          : "SCENARIO_ORCHESTRATOR_FAILED";
      if (envelope.telemetry !== undefined)
        throw new ProviderFailure(
          reason,
          providerTelemetrySchema.parse(envelope.telemetry),
        );
      throw new Error(reason);
    }
    if (
      typeof envelope.rawResponse !== "string" ||
      typeof envelope.latencyMs !== "number" ||
      !Number.isSafeInteger(envelope.latencyMs) ||
      envelope.latencyMs < 0 ||
      envelope.latencyMs > SCENARIO_REQUEST_POLICY.providerTimeoutMs ||
      envelope.retryCount !== 0
    )
      throw new Error("SCENARIO_ORCHESTRATOR_ENVELOPE_INVALID");
    const content = readFileSync("prompts/scenario-v2.md", "utf8").trim();
    const expected = {
      version: "scenario-v2" as const,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    const artifact = envelope.promptArtifact as typeof expected | undefined;
    if (
      artifact?.version !== expected.version ||
      artifact.content !== expected.content ||
      artifact.sha256 !== expected.sha256
    )
      throw new Error("SCENARIO_PROMPT_MISMATCH");
    const telemetry = providerTelemetrySchema.parse(envelope.telemetry);
    if (
      envelope.model !== FIXED_DEFAULTS.AI_MODEL ||
      telemetry.requestedModel !== FIXED_DEFAULTS.AI_MODEL ||
      !returnedModelMatches(FIXED_DEFAULTS.AI_MODEL, telemetry.returnedModel)
    )
      throw new Error("SCENARIO_PROVIDER_IDENTITY_MISMATCH");
    const plan = validatePlan(envelope.rawResponse, {
      ...input,
      availableAt: new Date().toISOString(),
    });
    return {
      model: FIXED_DEFAULTS.AI_MODEL,
      response: plan,
      rawResponse: envelope.rawResponse,
      promptArtifact: expected,
      latencyMs: envelope.latencyMs,
      retryCount: 0,
      telemetry,
    };
  }
}
