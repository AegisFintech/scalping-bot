import {
  validateEntryDecision,
  type EntryDecisionPlan,
} from "./entry-decision.js";
import { TECHNICAL_HISTORY_COUNTS } from "../../market-data-client/src/candidate-history.js";
import type { Quote } from "../../contracts/src/index.js";
import { HISTORICAL_API_MODEL } from "../../config/src/policy.js";
import {
  OpenAiCompatibleClient,
  type AiAnalysisResult,
} from "../../ai-client/src/client.js";
import { bindEntryPrices } from "./entry-plan.js";
import { validateScenarioMarket, type ScenarioInput } from "./planner.js";
import { SCENARIO_REQUEST_POLICY } from "./request-policy.js";
import { entryPriceBounds } from "./entry-prices.js";

/** One provider prompt identity for dispatch, HTTP verification and durable evidence. */
export const ENTRY_PAIR_PROMPT = Object.freeze({
  version: "entry-quick-oco-v1" as const,
  path: "prompts/entry-quick-oco-v1.md",
});

const ENTRY_PAIR_REQUEST_POLICY = Object.freeze({
  candleLimits: Object.freeze({ M1: 120, M5: 144, M15: 288 }),
  maxOutputTokens: 1024,
  reasoningEffort: "low" as const,
});

export type EntryPlannerInput = Omit<ScenarioInput, "chart"> & {
  readonly chart: ScenarioInput["chart"] | null;
  readonly schemaVersion?: "2.0";
  readonly quote?: Quote;
  readonly minimumStopDistance?: string;
  readonly technicalContext?: {
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly inputSha256: string;
    readonly marketCapturedAt?: string;
    readonly executionContext?: Readonly<Record<string, unknown>>;
  };
};

/** Shared byte-for-byte input construction for pre-dispatch journal and provider. */
export function entryProviderPayload(
  input: EntryPlannerInput,
): Readonly<Record<string, unknown>> {
  if (input.quote === undefined || input.minimumStopDistance === undefined)
    throw new Error("SCENARIO_ENTRY_QUOTE_MISSING");
  const boundaries = entryPriceBounds(
    input.quote,
    input.tickSize,
    input.minimumStopDistance,
  );
  return {
    captured_at: input.capturedAt,
    tick_size: input.tickSize,
    quote: input.quote,
    minimum_entry_distance: boundaries.minimum_entry_distance,
    entry_boundaries: boundaries,
    ...(input.technicalContext === undefined
      ? {}
      : {
          technical_context: input.technicalContext.evidence,
          context_input_sha256: input.technicalContext.inputSha256,
          market_captured_at: input.technicalContext.marketCapturedAt,
          execution_context: input.technicalContext.executionContext,
        }),
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
        .slice(
          -(input.technicalContext === undefined
            ? ENTRY_PAIR_REQUEST_POLICY.candleLimits[s.timeframe]
            : 12),
        )
        .map((b, index) => [
          b.startTime,
          b.endTime,
          b.open,
          b.high,
          b.low,
          b.close,
          b.volume,
          b.complete,
          index === 0
            ? b.qualityFlags.filter((f) => f !== "BROKER_SESSION_GAP_BEFORE")
            : b.qualityFlags,
        ]),
    })),
  };
}

export class EntryPairPlanner {
  readonly client: Pick<
    OpenAiCompatibleClient<EntryDecisionPlan>,
    "analyze" | "circuitOpen"
  >;
  private readonly now: () => number;
  private readonly requireTechnicalContext: boolean;
  constructor(options: {
    client?: Pick<
      OpenAiCompatibleClient<EntryDecisionPlan>,
      "analyze" | "circuitOpen"
    >;
    baseUrl: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    beforeDispatch?: (symbol: string) => Promise<void>;
    now?: () => number;
    requireTechnicalContext?: boolean;
  }) {
    this.now = options.now ?? Date.now;
    this.requireTechnicalContext = options.requireTechnicalContext ?? false;
    this.client =
      options.client ??
      new OpenAiCompatibleClient<EntryDecisionPlan>({
        ...options,
        model: HISTORICAL_API_MODEL,
        // EPRToken's Grok route supports the OpenAI-compatible chat contract;
        // its Responses route rejects the structured reasoning field below.
        apiStyle: "chat_completions",
        schemaPath: "schemas/entry-pair-provider-1.0.json",
        outputSchemaName: "stop_entries_1_0",
        systemPromptPath: ENTRY_PAIR_PROMPT.path,
        promptVersion: ENTRY_PAIR_PROMPT.version,
        inputProfile: "structured",
        timeoutMs: SCENARIO_REQUEST_POLICY.providerTimeoutMs,
        maxRetries: 0,
        maxOutputTokens: ENTRY_PAIR_REQUEST_POLICY.maxOutputTokens,
        // Grok rejects `none`; low keeps the mandatory reasoning bounded.
        reasoningEffort: ENTRY_PAIR_REQUEST_POLICY.reasoningEffort,
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
  ): Promise<AiAnalysisResult<EntryDecisionPlan>> {
    if (this.requireTechnicalContext && input.technicalContext === undefined)
      throw new Error("SCENARIO_TECHNICAL_CONTEXT_REQUIRED");
    if (input.chart === null && input.schemaVersion !== "2.0")
      throw new Error("SCENARIO_NUMERIC_CONTRACT_REQUIRED");
    validateScenarioMarket(
      input,
      this.now,
      input.schemaVersion !== "2.0",
      this.requireTechnicalContext ? TECHNICAL_HISTORY_COUNTS : undefined,
    );
    if (input.quote === undefined || input.minimumStopDistance === undefined)
      throw new Error("SCENARIO_ENTRY_QUOTE_MISSING");
    const result = await this.client.analyze({
      analysisId: input.analysisId,
      symbol: input.symbol,
      chart: input.chart,
      payload: entryProviderPayload(input),
    });
    validateEntryDecision(JSON.stringify(result.response), {
      ...input,
      availableAt: new Date(this.now()).toISOString(),
    });
    return result;
  }
}
