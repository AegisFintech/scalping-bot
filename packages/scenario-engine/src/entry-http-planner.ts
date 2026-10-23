import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bindModeDecision } from "./mode-entry.js";
import { bindDirectionalDecision } from "./directional-entry.js";
import { FIXED_DEFAULTS } from "../../config/src/policy.js";
import {
  boundedResponseText,
  ProviderFailure,
  providerTelemetrySchema,
} from "../../ai-client/src/telemetry.js";
import type { AiAnalysisResult } from "../../ai-client/src/client.js";
import {
  bindEntryDecision,
  validateEntryDecision,
  type EntryDecisionPlan,
} from "./entry-decision.js";
import { ENTRY_PAIR_PROMPT, type EntryPlannerInput } from "./entry-planner.js";
import { SCENARIO_REQUEST_POLICY } from "./request-policy.js";

export class EntryPairHttpPlanner {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl = fetch,
  ) {}
  async generate(
    input: EntryPlannerInput,
  ): Promise<AiAnalysisResult<EntryDecisionPlan>> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        new URL(
          input.chart === null ? "/v2/entry-pair" : "/v1/entry-pair",
          this.baseUrl,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...input,
            ...(input.chart === null ? { schemaVersion: "2.0" } : {}),
          }),
          signal: AbortSignal.timeout(
            SCENARIO_REQUEST_POLICY.providerTimeoutMs +
              SCENARIO_REQUEST_POLICY.transportGraceMs,
          ),
        },
      );
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
          typeof envelope.rawResponse === "string"
            ? envelope.rawResponse
            : undefined,
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
    const content = readFileSync(ENTRY_PAIR_PROMPT.path, "utf8").trim();
    const expected = {
      version: ENTRY_PAIR_PROMPT.version,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    const artifact = envelope.promptArtifact as typeof expected | undefined;
    if (
      artifact?.version !== expected.version ||
      artifact.content !== content ||
      artifact.sha256 !== expected.sha256
    )
      throw new Error("SCENARIO_PROMPT_MISMATCH");
    const telemetry = providerTelemetrySchema.parse(envelope.telemetry);
    if (
      envelope.model !== FIXED_DEFAULTS.AI_MODEL ||
      telemetry.requestedModel !== FIXED_DEFAULTS.AI_MODEL ||
      telemetry.inputProfile !== "structured"
    )
      throw new Error("SCENARIO_PROVIDER_IDENTITY_MISMATCH");
    const observedM1End = input.candles
      .find((s) => s.timeframe === "M1")
      ?.candles.at(-1)?.endTime;
    if (observedM1End === undefined) throw new Error("SCENARIO_M1_REQUIRED");
    const plan = (
      ENTRY_PAIR_PROMPT.version === "entry-modes-v1"
        ? bindModeDecision
        : ENTRY_PAIR_PROMPT.version === "entry-direction-v1"
          ? bindDirectionalDecision
          : bindEntryDecision
    )(envelope.rawResponse, {
      ...input,
      observedM1End,
    });
    validateEntryDecision(JSON.stringify(plan), {
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
