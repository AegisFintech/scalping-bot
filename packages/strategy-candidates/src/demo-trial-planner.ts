import { validateScenarioMarket } from "../../scenario-engine/src/planner.js";
import { TECHNICAL_HISTORY_COUNTS } from "../../market-data-client/src/candidate-history.js";
import type { EntryPairHttpPlanner } from "../../scenario-engine/src/entry-http-planner.js";
import {
  FIXED_DEFAULTS,
  DEMO_TRIAL_STRATEGY_VERSION,
} from "../../config/src/policy.js";
import type { EntryPlannerInput } from "../../scenario-engine/src/entry-planner.js";
import { bindScalpDecision } from "../../scenario-engine/src/scalp-entry.js";
import { trialGeometry, trialProfile, trialPrompt } from "./demo-trial.js";

/** Explicit registered source selection; Codex WAIT/failure never falls back locally. */
export class DemoTrialPlanner {
  constructor(
    private readonly codex: {
      generate(
        input: EntryPlannerInput,
      ): ReturnType<EntryPairHttpPlanner["generate"]>;
    },
    private readonly now = Date.now,
  ) {}
  async generate(input: EntryPlannerInput) {
    if (input.schemaVersion !== "3.0" || !input.technicalContext)
      throw new Error("SCENARIO_DEMO_INPUT_CONTRACT_INVALID");
    validateScenarioMarket(input, this.now, false, TECHNICAL_HISTORY_COUNTS);
    const binding = input.experiment;
    if (!binding) throw new Error("SCENARIO_DEMO_BINDING_REQUIRED");
    if (trialProfile(binding).proposalSource === "CODEX") {
      const result = await this.codex.generate(input);
      if (result.model !== FIXED_DEFAULTS.AI_MODEL)
        throw new Error("SCENARIO_PROVIDER_IDENTITY_MISMATCH");
      return result;
    }
    const raw = trialGeometry(input, binding);
    return {
      response: bindScalpDecision(
        JSON.stringify(raw),
        {
          ...input,
          observedM1End: input.candles
            .find((f) => f.timeframe === "M1")!
            .candles.at(-1)!.endTime,
        },
        DEMO_TRIAL_STRATEGY_VERSION,
      ),
      latencyMs: 0,
      retryCount: 0,
      telemetry: {
        requestedModel: "local-range-v1",
        returnedModel: null,
        inputProfile: "structured" as const,
        requestBytes: Buffer.byteLength(JSON.stringify(input)),
        responseBytes: Buffer.byteLength(JSON.stringify(raw)),
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costAmount: null,
        costCurrency: null,
        costSource: "unavailable" as const,
      },
      rawResponse: JSON.stringify(raw),
      model: "local-range-v1",
      promptArtifact: trialPrompt(binding),
    };
  }
}
