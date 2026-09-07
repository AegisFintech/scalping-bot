import type {
  AnalysisChartArtifact,
  CandleSeries,
} from "../../contracts/src/index.js";
import { ProviderFailure } from "../../ai-client/src/telemetry.js";
import {
  OpenAiCompatibleClient,
  type AiAnalysisResult,
} from "../../ai-client/src/client.js";
import {
  SCENARIO_POLICY,
  time,
  validateCandle,
  validatePlan,
  type ScenarioPlan,
} from "./plan.js";

/** Inference is a separate promise; the simulation/exits never await it. No broker authority. */
export class ScenarioPlanner {
  readonly client: OpenAiCompatibleClient<ScenarioPlan>;
  constructor(options: {
    baseUrl: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
    executionContext?: boolean;
  }) {
    this.client = new OpenAiCompatibleClient<ScenarioPlan>({
      ...options,
      model: "gpt-6-astra/u64",
      apiStyle: "responses",
      schemaPath: "schemas/scenario-plan-1.0.json",
      outputSchemaName: "chart_scenario_1_0",
      systemPromptPath: options.executionContext
        ? "prompts/scenario-v2.md"
        : "prompts/scenario-v1.md",
      promptVersion: options.executionContext ? "scenario-v2" : "scenario-v1",
      inputProfile: "chart",
      timeoutMs: 45_000,
      maxRetries: 0,
      maxOutputTokens: 1500,
      circuitBreakerFailures: 3,
      circuitBreakerResetMs: 300_000,
    });
    this.now = options.now ?? Date.now;
  }
  private readonly now: () => number;
  async generate(input: {
    analysisId: string;
    symbol: string;
    capturedAt: string;
    tickSize: string;
    candles: readonly CandleSeries[];
    chart: AnalysisChartArtifact;
  }): Promise<AiAnalysisResult<ScenarioPlan>> {
    const capture = time(input.capturedAt);
    if (this.now() < capture || this.now() - capture > 3000)
      throw new Error("SCENARIO_INPUT_STALE");
    if (input.candles.length !== 3)
      throw new Error("SCENARIO_TIMEFRAMES_INVALID");
    for (const [frame, period] of [
      ["M1", 60_000],
      ["M5", 300_000],
      ["M15", 900_000],
    ] as const) {
      const series = input.candles.filter((s) => s.timeframe === frame);
      if (
        series.length !== 1 ||
        !series[0]?.candles.length ||
        series[0].candles.length > 600
      )
        throw new Error("SCENARIO_TIMEFRAMES_INVALID");
      let previous: number | null = null;
      for (const bar of series[0].candles) {
        validateCandle(bar, capture, period, true);
        const gap = previous === null ? 0 : time(bar.startTime) - previous;
        const marked = bar.qualityFlags.includes("BROKER_SESSION_GAP_BEFORE");
        if (
          (gap === 0 && marked) ||
          gap < 0 ||
          (gap > 0 && (!marked || gap % period !== 0 || gap > 14 * 86_400_000))
        )
          throw new Error("SCENARIO_CANDLE_GAP");
        previous = time(bar.endTime);
      }
      if (
        previous !== Math.floor(capture / period) * period ||
        !Number.isSafeInteger(input.chart.candleCounts[frame]) ||
        input.chart.candleCounts[frame] < 1 ||
        input.chart.candleCounts[frame] >
          Math.min(80, series[0].candles.length) ||
        time(input.chart.latestEndTimes[frame]) !== previous
      )
        throw new Error("SCENARIO_CHART_CONTEXT_MISMATCH");
    }
    const result = await this.client
      .analyze({
        analysisId: input.analysisId,
        symbol: input.symbol,
        chart: input.chart,
        payload: {
          analysis_id: input.analysisId,
          symbol: input.symbol,
          captured_at: input.capturedAt,
          valid_until: new Date(
            capture + SCENARIO_POLICY.planLifetimeMs,
          ).toISOString(),
          tick_size: input.tickSize,
          candles: input.candles.map((s) => ({
            ...s,
            candles: s.candles.slice(-input.chart.candleCounts[s.timeframe]),
          })),
        },
      })
      .catch((error: unknown) => {
        if (error instanceof ProviderFailure) throw error;
        const reason =
          error instanceof Error &&
          /^(AI|SCENARIO)_[A-Z0-9_:]{1,120}$/.test(error.message)
            ? error.message
            : error instanceof Error &&
                ["TimeoutError", "AbortError"].includes(error.name)
              ? "AI_PROVIDER_TIMEOUT"
              : "SCENARIO_PROVIDER_UNAVAILABLE";
        throw new Error(reason);
      });
    try {
      validatePlan(result.rawResponse, {
        ...input,
        availableAt: new Date(this.now()).toISOString(),
      });
    } catch (error) {
      if (result.telemetry !== undefined)
        throw new ProviderFailure(
          error instanceof Error ? error.message : "SCENARIO_VALIDATION_FAILED",
          result.telemetry,
        );
      throw error;
    }
    return result;
  }
}
