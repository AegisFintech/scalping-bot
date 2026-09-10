import type { Quote } from "../../contracts/src/index.js";
import { FIXED_DEFAULTS } from "../../config/src/policy.js";
import {
  OpenAiCompatibleClient,
  type AiAnalysisResult,
} from "../../ai-client/src/client.js";
import {
  bindEntryPrices,
  validateEntryPlan,
  type EntryPairPlan,
} from "./entry-plan.js";
import { validateScenarioMarket, type ScenarioInput } from "./planner.js";
import { SCENARIO_REQUEST_POLICY } from "./request-policy.js";

export type EntryPlannerInput = Omit<ScenarioInput, "chart"> & {
  readonly chart: ScenarioInput["chart"] | null;
  readonly schemaVersion?: "2.0";
  readonly quote?: Quote;
  readonly minimumStopDistance?: string;
};

/** Shared byte-for-byte input construction for pre-dispatch journal and provider. */
export function entryProviderPayload(
  input: EntryPlannerInput,
): Readonly<Record<string, unknown>> {
  if (input.quote === undefined || input.minimumStopDistance === undefined)
    throw new Error("SCENARIO_ENTRY_QUOTE_MISSING");
  return {
    captured_at: input.capturedAt,
    tick_size: input.tickSize,
    quote: input.quote,
    minimum_entry_distance: input.minimumStopDistance,
    candles: input.candles.map((s) => ({
      timeframe: s.timeframe,
      columns: [
        "startTime",
        "endTime",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "complete",
        "qualityFlags",
      ],
      rows: s.candles
        .slice(-SCENARIO_REQUEST_POLICY.candleLimits[s.timeframe])
        .map((b) => [
          b.startTime,
          b.endTime,
          b.open,
          b.high,
          b.low,
          b.close,
          b.volume,
          b.complete,
          b.qualityFlags,
        ]),
    })),
  };
}

export class EntryPairPlanner {
  readonly client: OpenAiCompatibleClient<EntryPairPlan>;
  private readonly now: () => number;
  constructor(options: {
    baseUrl: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
    this.client = new OpenAiCompatibleClient<EntryPairPlan>({
      ...options,
      model: FIXED_DEFAULTS.AI_MODEL,
      apiStyle: "responses",
      schemaPath: "schemas/entry-pair-provider-1.0.json",
      outputSchemaName: "stop_entries_1_0",
      systemPromptPath: "prompts/entry-pair-v1.md",
      promptVersion: "entry-pair-v1",
      inputProfile: "structured",
      timeoutMs: SCENARIO_REQUEST_POLICY.providerTimeoutMs,
      maxRetries: 0,
      maxOutputTokens: SCENARIO_REQUEST_POLICY.maxOutputTokens,
      reasoningEffort: SCENARIO_REQUEST_POLICY.reasoningEffort,
      // The operator accepts readable entries; requested/returned identities remain recorded.
      requireReturnedModelMatch: false,
      parseResponse: (raw, request) =>
        bindEntryPrices(raw, {
          analysisId: request.analysisId,
          symbol: request.symbol,
          capturedAt: String(request.payload.captured_at),
          tickSize: String(request.payload.tick_size),
        }),
    });
  }
  async generate(
    input: EntryPlannerInput,
  ): Promise<AiAnalysisResult<EntryPairPlan>> {
    if (input.chart === null && input.schemaVersion !== "2.0")
      throw new Error("SCENARIO_NUMERIC_CONTRACT_REQUIRED");
    validateScenarioMarket(input, this.now, input.schemaVersion !== "2.0");
    if (input.quote === undefined || input.minimumStopDistance === undefined)
      throw new Error("SCENARIO_ENTRY_QUOTE_MISSING");
    const result = await this.client.analyze({
      analysisId: input.analysisId,
      symbol: input.symbol,
      chart: input.chart,
      payload: entryProviderPayload(input),
    });
    validateEntryPlan(JSON.stringify(result.response), {
      ...input,
      availableAt: new Date(this.now()).toISOString(),
    });
    return result;
  }
}
