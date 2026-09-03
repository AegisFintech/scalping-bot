import { randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";

import type {
  AccountAdapter,
  AccountState,
  AnalysisChartArtifact,
  AnalyticsConfig,
  AnalyticsRequest,
  AnalyticsResponse,
  ExecutionGateway,
  MarketSnapshot,
  ModelPromptArtifact,
  ModelResponse,
  OcoPlacementResult,
  Timeframe,
  Quote,
  SymbolMetadata,
} from "../../../packages/contracts/src/index.js";
import {
  canonical,
  checkSpread,
  decimal,
  validateCommandFeeBuffer,
  validateSemantics,
  type SpreadDecision,
} from "../../../packages/risk-engine/src/index.js";
import {
  buildModelPayload,
  type ModelPayloadMode,
} from "../../ai-orchestrator/src/payload.js";
import type {
  OcoEvaluation,
  OcoProposalRiskConstraints,
} from "./oco-risk-evaluator.js";
import {
  applyCommissionAwareExitPolicy,
  COMMISSION_AWARE_RISK_REWARD_RATIO,
  deriveCommissionAwareMinimumDistances,
  STOP_LOSS_TO_TAKE_PROFIT_RATIO,
} from "./proposal-transform.js";
import {
  evaluateAnalysisEligibility,
  evaluatePlacementEligibility,
  type SafetyGateInput,
} from "./safety-gates.js";
import {
  AnalysisStateMachine,
  type AnalysisTransition,
} from "./state-machine.js";
import { stableFailureReason } from "./failure-reasons.js";

export interface MarketSnapshotProvider {
  snapshot(
    symbol: string,
    counts: Readonly<Record<Timeframe, number>>,
    depth: number,
  ): Promise<MarketSnapshot>;
}

export interface AnalyticsProvider {
  analyze(request: AnalyticsRequest): Promise<AnalyticsResponse>;
}

export interface ModelProvider {
  readonly circuitOpen: boolean;
  analyze(request: {
    readonly analysisId: string;
    readonly symbol: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly chart: AnalysisChartArtifact;
    readonly timeoutMs: number;
  }): Promise<{
    readonly response: ModelResponse;
    readonly rawResponse: string;
    readonly promptArtifact: ModelPromptArtifact;
    readonly latencyMs?: number;
    readonly retryCount?: number;
  }>;
}

export interface DecisionTrail {
  start(input: {
    readonly analysisId: string;
    readonly mode: string;
    readonly symbol: string;
  }): Promise<void>;
  transition(analysisId: string, transition: AnalysisTransition): Promise<void>;
  market(analysisId: string, snapshot: MarketSnapshot): Promise<void>;
  decisionMarket(
    analysisId: string,
    snapshot: MarketSnapshot,
    refreshPhase?: "PRE_MODEL" | "POST_MODEL" | "PRE_PLACEMENT",
  ): Promise<void>;
  analytics(analysisId: string, response: AnalyticsResponse): Promise<void>;
  model(
    analysisId: string,
    requestPayload: Readonly<Record<string, unknown>>,
    response: ModelResponse,
    rawResponse: string,
    promptArtifact: ModelPromptArtifact,
    timing?: { readonly latencyMs: number; readonly retryCount: number },
  ): Promise<void>;
  validation(
    analysisId: string,
    stage: "SEMANTIC" | "RISK" | "LIVE_GATE",
    accepted: boolean,
    reasons: readonly string[],
    details?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  intent(analysisId: string, evaluation: OcoEvaluation): Promise<void>;
  placement(analysisId: string, result: OcoPlacementResult): Promise<void>;
}

export interface OcoRiskProvider {
  proposalConstraints(input: {
    readonly account: AccountState;
    readonly metadata: SymbolMetadata;
  }): OcoProposalRiskConstraints;
  evaluate(input: {
    readonly response: ModelResponse;
    readonly account: AccountState;
    readonly metadata: SymbolMetadata;
    readonly quote: Quote;
  }): Promise<OcoEvaluation>;
}

export class InMemoryDecisionTrail implements DecisionTrail {
  readonly events: unknown[] = [];

  start(input: {
    readonly analysisId: string;
    readonly mode: string;
    readonly symbol: string;
  }): Promise<void> {
    this.events.push({ type: "start", ...input });
    return Promise.resolve();
  }

  transition(
    analysisId: string,
    transition: AnalysisTransition,
  ): Promise<void> {
    this.events.push({ type: "transition", analysisId, transition });
    return Promise.resolve();
  }

  market(analysisId: string, snapshot: MarketSnapshot): Promise<void> {
    this.events.push({ type: "market", analysisId, snapshot });
    return Promise.resolve();
  }

  decisionMarket(
    analysisId: string,
    snapshot: MarketSnapshot,
    refreshPhase: "PRE_MODEL" | "POST_MODEL" | "PRE_PLACEMENT" = "POST_MODEL",
  ): Promise<void> {
    this.events.push({
      type: "decision_market",
      analysisId,
      snapshot,
      refreshPhase,
    });
    return Promise.resolve();
  }

  analytics(analysisId: string, response: AnalyticsResponse): Promise<void> {
    this.events.push({ type: "analytics", analysisId, response });
    return Promise.resolve();
  }

  model(
    analysisId: string,
    requestPayload: Readonly<Record<string, unknown>>,
    response: ModelResponse,
    rawResponse: string,
    promptArtifact: ModelPromptArtifact,
    timing?: { readonly latencyMs: number; readonly retryCount: number },
  ): Promise<void> {
    this.events.push({
      type: "model",
      analysisId,
      requestPayload,
      response,
      rawResponse,
      promptArtifact,
      timing,
    });
    return Promise.resolve();
  }

  validation(
    analysisId: string,
    stage: "SEMANTIC" | "RISK" | "LIVE_GATE",
    accepted: boolean,
    reasons: readonly string[],
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    this.events.push({
      type: "validation",
      analysisId,
      stage,
      accepted,
      reasons,
      details,
    });
    return Promise.resolve();
  }

  intent(analysisId: string, evaluation: OcoEvaluation): Promise<void> {
    this.events.push({ type: "intent", analysisId, evaluation });
    return Promise.resolve();
  }

  placement(analysisId: string, result: OcoPlacementResult): Promise<void> {
    this.events.push({ type: "placement", analysisId, result });
    return Promise.resolve();
  }
}

export interface CoordinatorOptions {
  readonly symbol: string;
  readonly mode: "paper" | "demo" | "shadow" | "live";
  readonly candleCounts: Readonly<Record<Timeframe, number>>;
  readonly orderBookDepth: number;
  readonly analyticsConfig: AnalyticsConfig;
  readonly modelPayloadMode: ModelPayloadMode;
  readonly promptVersion: "system-v14";
  readonly schemaVersion: "2.1";
  readonly strategyVersion: string;
  readonly minRiskRewardRatio: string;
  readonly minimumExpectedNetToFeesRatio: string;
  readonly minExpirySeconds: number;
  readonly maxExpirySeconds: number;
  readonly preferredExpirySeconds: number;
  readonly maxStopDistanceAtr: string;
  readonly maxEntryDistanceAtr: string;
  readonly entryLatencyBufferAtr: string;
  readonly minStopDistancePoints: string | null;
  readonly maxQuoteAgeMs: number;
  readonly maxMetadataAgeMs: number;
  readonly maxOrderBookAgeMs: number;
  readonly maxSpreadPoints: string | null;
  readonly maxSpreadAtrRatio: string | null;
  readonly maxSpreadPercentile: string | null;
  readonly preModelStabilityCheck?: boolean;
  readonly enforceModelDeadline?: boolean;
  readonly minimumModelBudgetMs: number;
  readonly postModelReserveMs: number;
  readonly spreadContext: (snapshot: MarketSnapshot) => Promise<{
    readonly observedPercentile: string | null;
    readonly sessionAbnormal: boolean;
  }>;
  readonly market: MarketSnapshotProvider;
  readonly analytics: AnalyticsProvider;
  readonly model: ModelProvider;
  readonly account: AccountAdapter;
  readonly risk: OcoRiskProvider;
  readonly gateway: ExecutionGateway;
  readonly trail: DecisionTrail;
  readonly safety: () => Promise<SafetyGateInput>;
  readonly flushExecutionEvents?: () => Promise<void>;
  readonly performance: (
    analytics: AnalyticsResponse,
  ) => Promise<Readonly<Record<string, unknown>>>;
}

export interface CycleResult {
  readonly analysisId: string;
  readonly outcome: "PLACED" | "REJECTED";
  readonly reasonCodes: readonly string[];
  readonly placement: OcoPlacementResult | null;
}

export interface ModelExecutionBounds {
  readonly buyEntryMinimum: string;
  readonly buyEntryMaximum: string;
  readonly sellEntryMinimum: string;
  readonly sellEntryMaximum: string;
  readonly buyPreferredEntryMinimum: string;
  readonly buyPreferredEntryMaximum: string;
  readonly sellPreferredEntryMinimum: string;
  readonly sellPreferredEntryMaximum: string;
  readonly entryLatencyBufferAtr: string;
  readonly minimumStopDistance: string;
  readonly maximumStopDistance: string;
  readonly preferredExpiresAt: string;
}

function floorToTick(value: Decimal, tickSize: Decimal): Decimal {
  return value.div(tickSize).floor().mul(tickSize);
}

function ceilToTick(value: Decimal, tickSize: Decimal): Decimal {
  return value.div(tickSize).ceil().mul(tickSize);
}

export function deriveModelExecutionBounds(input: {
  readonly currentBid: string;
  readonly currentAsk: string;
  readonly tickSize: string;
  readonly minimumStopDistance: string;
  readonly atr: string;
  readonly maxEntryDistanceAtr: string;
  readonly entryLatencyBufferAtr: string;
  readonly maxStopDistanceAtr: string;
  readonly maxAffordableStopDistance: string;
  readonly serverTime: string;
  readonly preferredExpirySeconds: number;
}): ModelExecutionBounds {
  const bid = decimal(input.currentBid);
  const ask = decimal(input.currentAsk);
  const tickSize = decimal(input.tickSize);
  const minimumStopDistance = decimal(input.minimumStopDistance);
  const atr = decimal(input.atr);
  const maximumEntryDistance = atr.mul(decimal(input.maxEntryDistanceAtr));
  const entryLatencyBufferAtr = decimal(input.entryLatencyBufferAtr);
  const entryLatencyBufferDistance = atr.mul(entryLatencyBufferAtr);
  const maximumStopDistance = floorToTick(
    Decimal.min(
      atr.mul(decimal(input.maxStopDistanceAtr)),
      decimal(input.maxAffordableStopDistance),
    ),
    tickSize,
  );
  const buyEntryMinimum = ceilToTick(ask.plus(minimumStopDistance), tickSize);
  const buyEntryMaximum = floorToTick(ask.plus(maximumEntryDistance), tickSize);
  const sellEntryMinimum = ceilToTick(
    bid.minus(maximumEntryDistance),
    tickSize,
  );
  const sellEntryMaximum = floorToTick(
    bid.minus(minimumStopDistance),
    tickSize,
  );
  if (
    buyEntryMinimum.gt(buyEntryMaximum) ||
    sellEntryMinimum.gt(sellEntryMaximum)
  ) {
    throw new Error("MODEL_ENTRY_RANGE_UNSATISFIABLE");
  }
  const preferredMinimumDistance = Decimal.max(
    minimumStopDistance,
    entryLatencyBufferDistance,
  );
  const preferredMaximumDistance = maximumEntryDistance.minus(
    entryLatencyBufferDistance,
  );
  const buyPreferredEntryMinimum = ceilToTick(
    ask.plus(preferredMinimumDistance),
    tickSize,
  );
  const buyPreferredEntryMaximum = floorToTick(
    ask.plus(preferredMaximumDistance),
    tickSize,
  );
  const sellPreferredEntryMinimum = ceilToTick(
    bid.minus(preferredMaximumDistance),
    tickSize,
  );
  const sellPreferredEntryMaximum = floorToTick(
    bid.minus(preferredMinimumDistance),
    tickSize,
  );
  if (
    buyPreferredEntryMinimum.gt(buyPreferredEntryMaximum) ||
    sellPreferredEntryMinimum.gt(sellPreferredEntryMaximum) ||
    buyPreferredEntryMinimum.lt(buyEntryMinimum) ||
    buyPreferredEntryMaximum.gt(buyEntryMaximum) ||
    sellPreferredEntryMinimum.lt(sellEntryMinimum) ||
    sellPreferredEntryMaximum.gt(sellEntryMaximum)
  ) {
    throw new Error("MODEL_PREFERRED_ENTRY_RANGE_UNSATISFIABLE");
  }
  const modelMinimumStopDistance = ceilToTick(minimumStopDistance, tickSize);
  if (maximumStopDistance.lt(modelMinimumStopDistance))
    throw new Error("MODEL_STOP_RANGE_UNSATISFIABLE");
  const serverTime = Date.parse(input.serverTime);
  if (
    !Number.isFinite(serverTime) ||
    serverTime < 0 ||
    !Number.isSafeInteger(input.preferredExpirySeconds) ||
    input.preferredExpirySeconds < 1
  ) {
    throw new Error("MODEL_EXPIRY_BOUND_INVALID");
  }
  const preferredExpiresAt = serverTime + input.preferredExpirySeconds * 1_000;
  if (!Number.isSafeInteger(preferredExpiresAt))
    throw new Error("MODEL_EXPIRY_BOUND_INVALID");
  return {
    buyEntryMinimum: canonical(buyEntryMinimum),
    buyEntryMaximum: canonical(buyEntryMaximum),
    sellEntryMinimum: canonical(sellEntryMinimum),
    sellEntryMaximum: canonical(sellEntryMaximum),
    buyPreferredEntryMinimum: canonical(buyPreferredEntryMinimum),
    buyPreferredEntryMaximum: canonical(buyPreferredEntryMaximum),
    sellPreferredEntryMinimum: canonical(sellPreferredEntryMinimum),
    sellPreferredEntryMaximum: canonical(sellPreferredEntryMaximum),
    entryLatencyBufferAtr: canonical(entryLatencyBufferAtr),
    minimumStopDistance: canonical(modelMinimumStopDistance),
    maximumStopDistance: canonical(maximumStopDistance),
    preferredExpiresAt: new Date(preferredExpiresAt).toISOString(),
  };
}

function m1Atr(response: AnalyticsResponse): string {
  const timeframes = response.features.timeframes;
  if (
    timeframes === null ||
    typeof timeframes !== "object" ||
    Array.isArray(timeframes)
  ) {
    throw new Error("ANALYTICS_M1_ATR_MISSING");
  }
  const m1 = (timeframes as Record<string, unknown>).M1;
  if (m1 === null || typeof m1 !== "object" || Array.isArray(m1))
    throw new Error("ANALYTICS_M1_ATR_MISSING");
  const atr = (m1 as Record<string, unknown>).atr;
  if (typeof atr !== "string") throw new Error("ANALYTICS_M1_ATR_MISSING");
  return atr;
}

function configuredMinimumStopDistance(
  snapshot: MarketSnapshot,
  minimumPoints: string | null,
): Decimal {
  const tickSize = decimal(snapshot.metadata.tickSize);
  return Decimal.max(
    decimal(snapshot.metadata.minStopDistance),
    tickSize,
    minimumPoints === null ? tickSize : tickSize.mul(decimal(minimumPoints)),
  );
}

function executionMetadataFingerprint(metadata: SymbolMetadata): string {
  return JSON.stringify({
    symbolId: metadata.symbolId,
    symbolName: metadata.symbolName,
    digits: metadata.digits,
    pipPosition: metadata.pipPosition,
    pipSize: metadata.pipSize,
    tickSize: metadata.tickSize,
    tickValue: metadata.tickValue,
    baseAsset: metadata.baseAsset,
    quoteAsset: metadata.quoteAsset,
    accountAsset: metadata.accountAsset,
    quoteToAccountConversionRate: metadata.quoteToAccountConversionRate,
    contractSize: metadata.contractSize,
    volumeScale: metadata.volumeScale,
    minVolume: metadata.minVolume,
    maxVolume: metadata.maxVolume,
    volumeStep: metadata.volumeStep,
    minStopDistance: metadata.minStopDistance,
    commission: metadata.commission,
  });
}

function candleContextFingerprint(snapshot: MarketSnapshot): string {
  return JSON.stringify(
    [...snapshot.candles]
      .sort((left, right) => left.timeframe.localeCompare(right.timeframe))
      .map((series) => ({
        timeframe: series.timeframe,
        candles: series.candles,
      })),
  );
}

function marketContextReasons(
  initial: MarketSnapshot,
  refreshed: MarketSnapshot,
  phase: "PRE_MODEL" | "DECISION" | "PLACEMENT",
): readonly string[] {
  const reasons: string[] = [];
  const initialServerTime = Date.parse(initial.serverTime);
  const refreshedServerTime = Date.parse(refreshed.serverTime);
  if (
    executionMetadataFingerprint(initial.metadata) !==
    executionMetadataFingerprint(refreshed.metadata)
  ) {
    reasons.push(`${phase}_SYMBOL_METADATA_CHANGED`);
  }
  if (
    !Number.isFinite(initialServerTime) ||
    !Number.isFinite(refreshedServerTime) ||
    refreshedServerTime < initialServerTime
  ) {
    reasons.push(`${phase}_MARKET_TIME_REGRESSION`);
  }
  if (
    candleContextFingerprint(initial) !== candleContextFingerprint(refreshed)
  ) {
    reasons.push(`${phase}_CANDLE_CONTEXT_CHANGED`);
  }
  return reasons.sort();
}

export function modelCallBudgetMs(input: {
  readonly brokerServerTime: string;
  readonly postModelReserveMs: number;
  readonly minimumModelBudgetMs: number;
}): number {
  const serverTime = Date.parse(input.brokerServerTime);
  if (
    !Number.isFinite(serverTime) ||
    !Number.isSafeInteger(input.postModelReserveMs) ||
    input.postModelReserveMs < 1_000 ||
    input.postModelReserveMs > 30_000 ||
    !Number.isSafeInteger(input.minimumModelBudgetMs) ||
    input.minimumModelBudgetMs < 1_000 ||
    input.minimumModelBudgetMs > 55_000
  ) {
    throw new Error("MODEL_DEADLINE_CONFIG_INVALID");
  }
  const nextM1Boundary = (Math.floor(serverTime / 60_000) + 1) * 60_000;
  const budget = nextM1Boundary - serverTime - input.postModelReserveMs;
  if (budget < input.minimumModelBudgetMs) {
    throw new Error("MODEL_DEADLINE_INSUFFICIENT");
  }
  return budget;
}

function accountExecutionFingerprint(account: AccountState): string {
  return JSON.stringify({
    certain: account.certain,
    equity: account.equity,
    balance: account.balance,
    availableMargin: account.availableMargin,
    relevantPositionCount: account.relevantPositionCount,
    relevantPendingOrderCount: account.relevantPendingOrderCount,
    hasPartialFill: account.hasPartialFill,
    hasCancellationPending: account.hasCancellationPending,
    reasonCodes: [...account.reasonCodes].sort(),
  });
}

export class AnalysisCoordinator {
  readonly #options: CoordinatorOptions;
  #running = false;

  constructor(options: CoordinatorOptions) {
    this.#options = options;
  }

  async runOnce(): Promise<CycleResult> {
    if (this.#running) throw new Error("ANALYSIS_CYCLE_ALREADY_RUNNING");
    this.#running = true;
    const analysisId = randomUUID();
    const machine = new AnalysisStateMachine();
    let started = false;
    const reject = async (reasons: readonly string[]): Promise<CycleResult> => {
      const unique = [...new Set(reasons)].sort();
      if (
        started &&
        !["REJECTED", "ACCEPTED", "EXPIRED"].includes(machine.state)
      ) {
        const event = machine.transition("REJECTED", unique);
        await this.#options.trail.transition(analysisId, event);
      }
      return {
        analysisId,
        outcome: "REJECTED",
        reasonCodes: unique,
        placement: null,
      };
    };
    try {
      const initialSafety = await this.#options.safety();
      const preflight = evaluateAnalysisEligibility({
        ...initialSafety,
        aiCircuitOpen: this.#options.model.circuitOpen,
      });
      if (!preflight.allowed) return await reject(preflight.reasonCodes);
      await this.#options.trail.start({
        analysisId,
        mode: this.#options.mode,
        symbol: this.#options.symbol,
      });
      started = true;

      await this.#recordTransition(analysisId, machine, "COLLECTING");
      const snapshot = await this.#options.market.snapshot(
        this.#options.symbol,
        this.#options.candleCounts,
        this.#options.orderBookDepth,
      );
      await this.#options.trail.market(analysisId, snapshot);
      const requestId = randomUUID();
      const analyticsRequest: AnalyticsRequest = {
        schemaVersion: "1.0",
        requestId,
        analysisId,
        symbol: this.#options.symbol,
        analysisTime: snapshot.serverTime,
        serverTime: snapshot.serverTime,
        candles: snapshot.candles,
        orderBook: snapshot.orderBook,
        config: this.#options.analyticsConfig,
      };
      const analytics = await this.#options.analytics.analyze(analyticsRequest);
      await this.#options.trail.analytics(analysisId, analytics);
      if (!analytics.acceptable)
        return await reject(analytics.rejectionReasons);
      if (analytics.chart === null)
        return await reject(["ANALYTICS_CHART_MISSING"]);
      const atr = m1Atr(analytics);
      const spreadContext = await this.#options.spreadContext(snapshot);
      const spread: SpreadDecision = checkSpread({
        bid: snapshot.quote.bid,
        ask: snapshot.quote.ask,
        tickSize: snapshot.metadata.tickSize,
        atr,
        maxPoints: this.#options.maxSpreadPoints,
        maxAtrRatio: this.#options.maxSpreadAtrRatio,
        observedPercentile: spreadContext.observedPercentile,
        maxPercentile: this.#options.maxSpreadPercentile,
        sessionAbnormal: spreadContext.sessionAbnormal,
        liveMode: this.#options.mode === "live",
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        spread.approved,
        spread.reasonCodes,
      );
      if (!spread.approved) return await reject(spread.reasonCodes);

      const minimumStopDistance = configuredMinimumStopDistance(
        snapshot,
        this.#options.minStopDistancePoints,
      );
      const proposalAccount = await this.#options.account.reconcile(
        snapshot.metadata.symbolId,
      );
      const proposalRiskConstraints = this.#options.risk.proposalConstraints({
        account: proposalAccount,
        metadata: snapshot.metadata,
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        proposalRiskConstraints.approved,
        proposalRiskConstraints.reasonCodes,
        {
          validation_scope: "MODEL_RISK_CONSTRAINTS",
          max_affordable_stop_distance: proposalRiskConstraints.maxStopDistance,
        },
      );
      if (
        !proposalRiskConstraints.approved ||
        proposalRiskConstraints.maxStopDistance === null
      ) {
        return await reject(proposalRiskConstraints.reasonCodes);
      }
      const minimumProposalRiskRewardRatio = this.#options.minRiskRewardRatio;
      if (
        minimumStopDistance.gt(
          Decimal.min(
            decimal(atr).mul(decimal(this.#options.maxStopDistanceAtr)),
            decimal(proposalRiskConstraints.maxStopDistance),
          ),
        )
      ) {
        const reasons = ["MODEL_PROPOSAL_CONSTRAINTS_UNSATISFIABLE"];
        await this.#options.trail.validation(
          analysisId,
          "RISK",
          false,
          reasons,
        );
        return await reject(reasons);
      }

      let preModelSnapshot = snapshot;
      if (this.#options.preModelStabilityCheck === true) {
        try {
          preModelSnapshot = await this.#options.market.snapshot(
            this.#options.symbol,
            this.#options.candleCounts,
            this.#options.orderBookDepth,
          );
        } catch {
          return await reject(["PRE_MODEL_MARKET_REFRESH_FAILED"]);
        }
        const preModelContextReasons = marketContextReasons(
          snapshot,
          preModelSnapshot,
          "PRE_MODEL",
        );
        if (preModelContextReasons.length > 0) {
          await this.#options.trail.validation(
            analysisId,
            "RISK",
            false,
            preModelContextReasons,
            { validation_scope: "PRE_MODEL_MARKET_CONTEXT" },
          );
          return await reject(preModelContextReasons);
        }
        await this.#options.trail.decisionMarket(
          analysisId,
          preModelSnapshot,
          "PRE_MODEL",
        );
        const preModelSpreadContext =
          await this.#options.spreadContext(preModelSnapshot);
        const preModelSpread = checkSpread({
          bid: preModelSnapshot.quote.bid,
          ask: preModelSnapshot.quote.ask,
          tickSize: preModelSnapshot.metadata.tickSize,
          atr,
          maxPoints: this.#options.maxSpreadPoints,
          maxAtrRatio: this.#options.maxSpreadAtrRatio,
          observedPercentile: preModelSpreadContext.observedPercentile,
          maxPercentile: this.#options.maxSpreadPercentile,
          sessionAbnormal: preModelSpreadContext.sessionAbnormal,
          liveMode: this.#options.mode === "live",
        });
        await this.#options.trail.validation(
          analysisId,
          "RISK",
          preModelSpread.approved,
          preModelSpread.reasonCodes,
          { validation_scope: "PRE_MODEL_SPREAD_STABILITY" },
        );
        if (!preModelSpread.approved)
          return await reject(preModelSpread.reasonCodes);
      }
      let modelTimeoutMs = 30_000;
      if (this.#options.enforceModelDeadline === true) {
        try {
          modelTimeoutMs = modelCallBudgetMs({
            brokerServerTime: preModelSnapshot.serverTime,
            postModelReserveMs: this.#options.postModelReserveMs,
            minimumModelBudgetMs: this.#options.minimumModelBudgetMs,
          });
        } catch (error) {
          return await reject([
            error instanceof Error ? error.message : "MODEL_DEADLINE_INVALID",
          ]);
        }
      }

      await this.#recordTransition(analysisId, machine, "FEATURED");
      const performance = await this.#options.performance(analytics);
      let modelExecutionBounds: ModelExecutionBounds;
      try {
        modelExecutionBounds = deriveModelExecutionBounds({
          currentBid: preModelSnapshot.quote.bid,
          currentAsk: preModelSnapshot.quote.ask,
          tickSize: preModelSnapshot.metadata.tickSize,
          minimumStopDistance: canonical(minimumStopDistance),
          atr,
          maxEntryDistanceAtr: this.#options.maxEntryDistanceAtr,
          entryLatencyBufferAtr: this.#options.entryLatencyBufferAtr,
          maxStopDistanceAtr: this.#options.maxStopDistanceAtr,
          maxAffordableStopDistance: proposalRiskConstraints.maxStopDistance,
          serverTime: preModelSnapshot.serverTime,
          preferredExpirySeconds: this.#options.preferredExpirySeconds,
        });
      } catch (error) {
        return await reject([
          error instanceof Error
            ? error.message
            : "MODEL_EXECUTION_BOUNDS_INVALID",
        ]);
      }
      const commissionMinimumDistances = deriveCommissionAwareMinimumDistances({
        buyEntryPrice: modelExecutionBounds.buyEntryMaximum,
        sellEntryPrice: modelExecutionBounds.sellEntryMaximum,
        minimumStopDistance: canonical(minimumStopDistance),
        maximumStopDistance: modelExecutionBounds.maximumStopDistance,
        minimumExpectedNetToFeesRatio:
          this.#options.minimumExpectedNetToFeesRatio,
        metadata: preModelSnapshot.metadata,
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        commissionMinimumDistances.accepted,
        commissionMinimumDistances.reasonCodes,
        {
          validation_scope: "MODEL_FEE_BUFFER_CONSTRAINTS",
          minimum_fee_buffered_take_profit_distance:
            commissionMinimumDistances.takeProfitDistance,
          minimum_expected_net_to_fees_ratio:
            this.#options.minimumExpectedNetToFeesRatio,
          minimum_exit_policy_stop_distance:
            commissionMinimumDistances.stopLossDistance,
          commission_basis: {
            volume: preModelSnapshot.metadata.minVolume,
            buy: commissionMinimumDistances.buy,
            sell: commissionMinimumDistances.sell,
          },
        },
      );
      if (
        !commissionMinimumDistances.accepted ||
        commissionMinimumDistances.takeProfitDistance === null ||
        commissionMinimumDistances.stopLossDistance === null
      ) {
        return await reject(commissionMinimumDistances.reasonCodes);
      }
      const modelMinimumStopDistance = Decimal.max(
        decimal(modelExecutionBounds.minimumStopDistance),
        decimal(commissionMinimumDistances.stopLossDistance),
      );
      if (
        modelMinimumStopDistance.gt(
          decimal(modelExecutionBounds.maximumStopDistance),
        )
      ) {
        return await reject(["MODEL_FEE_BUFFER_STOP_RANGE_UNSATISFIABLE"]);
      }
      modelExecutionBounds = {
        ...modelExecutionBounds,
        minimumStopDistance: canonical(modelMinimumStopDistance),
      };
      const payload = buildModelPayload({
        mode: this.#options.modelPayloadMode,
        analysisId,
        symbol: this.#options.symbol,
        analysisTime: preModelSnapshot.serverTime,
        serverTime: preModelSnapshot.serverTime,
        analyticsFeatures: analytics.features,
        performanceContext: performance,
        promptVersion: this.#options.promptVersion,
        schemaVersion: this.#options.schemaVersion,
        strategyVersion: this.#options.strategyVersion,
        chart: analytics.chart,
        executionConstraints: {
          currentBid: preModelSnapshot.quote.bid,
          currentAsk: preModelSnapshot.quote.ask,
          tickSize: preModelSnapshot.metadata.tickSize,
          digits: preModelSnapshot.metadata.digits,
          brokerMinStopDistance: preModelSnapshot.metadata.minStopDistance,
          configuredMinStopDistance: canonical(minimumStopDistance),
          minRiskRewardRatio: minimumProposalRiskRewardRatio,
          effectiveMinRiskRewardRatio: this.#options.minRiskRewardRatio,
          pipSize: preModelSnapshot.metadata.pipSize,
          minimumFeeBufferedTakeProfitDistance:
            commissionMinimumDistances.takeProfitDistance,
          minimumExpectedNetToFeesRatio:
            this.#options.minimumExpectedNetToFeesRatio,
          stopLossToTakeProfitRatio: STOP_LOSS_TO_TAKE_PROFIT_RATIO,
          effectiveRiskRewardRatio: COMMISSION_AWARE_RISK_REWARD_RATIO,
          maxAffordableStopDistance: proposalRiskConstraints.maxStopDistance,
          maxStopDistanceAtr: this.#options.maxStopDistanceAtr,
          maxEntryDistanceAtr: this.#options.maxEntryDistanceAtr,
          ...modelExecutionBounds,
          orderExpiryMinSeconds: this.#options.minExpirySeconds,
          orderExpiryMaxSeconds: this.#options.maxExpirySeconds,
          preferredOrderExpirySeconds: this.#options.preferredExpirySeconds,
        },
      });
      await this.#recordTransition(analysisId, machine, "MODEL_PENDING");
      const model = await this.#options.model.analyze({
        analysisId,
        symbol: this.#options.symbol,
        payload,
        chart: analytics.chart,
        timeoutMs: modelTimeoutMs,
      });
      if (model.promptArtifact.version !== this.#options.promptVersion) {
        return await reject(["MODEL_PROMPT_VERSION_MISMATCH"]);
      }
      await this.#options.trail.model(
        analysisId,
        payload,
        model.response,
        model.rawResponse,
        model.promptArtifact,
        {
          latencyMs: model.latencyMs ?? 0,
          retryCount: model.retryCount ?? 0,
        },
      );
      await this.#recordTransition(analysisId, machine, "VALIDATING");

      let decisionSnapshot: MarketSnapshot;
      try {
        decisionSnapshot = await this.#options.market.snapshot(
          this.#options.symbol,
          this.#options.candleCounts,
          this.#options.orderBookDepth,
        );
      } catch {
        return await reject(["DECISION_MARKET_REFRESH_FAILED"]);
      }
      const decisionContextReasons = marketContextReasons(
        snapshot,
        decisionSnapshot,
        "DECISION",
      );
      if (decisionContextReasons.length > 0) {
        await this.#options.trail.validation(
          analysisId,
          "RISK",
          false,
          decisionContextReasons,
        );
        return await reject(decisionContextReasons);
      }
      await this.#options.trail.decisionMarket(
        analysisId,
        decisionSnapshot,
        "POST_MODEL",
      );

      const decisionSpreadContext =
        await this.#options.spreadContext(decisionSnapshot);
      const decisionSpread = checkSpread({
        bid: decisionSnapshot.quote.bid,
        ask: decisionSnapshot.quote.ask,
        tickSize: decisionSnapshot.metadata.tickSize,
        atr,
        maxPoints: this.#options.maxSpreadPoints,
        maxAtrRatio: this.#options.maxSpreadAtrRatio,
        observedPercentile: decisionSpreadContext.observedPercentile,
        maxPercentile: this.#options.maxSpreadPercentile,
        sessionAbnormal: decisionSpreadContext.sessionAbnormal,
        liveMode: this.#options.mode === "live",
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        decisionSpread.approved,
        decisionSpread.reasonCodes,
      );
      if (!decisionSpread.approved)
        return await reject(decisionSpread.reasonCodes);

      const account = await this.#options.account.reconcile(
        decisionSnapshot.metadata.symbolId,
      );
      const currentRiskConstraints = this.#options.risk.proposalConstraints({
        account,
        metadata: decisionSnapshot.metadata,
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        currentRiskConstraints.approved,
        currentRiskConstraints.reasonCodes,
        {
          validation_scope: "POST_MODEL_RISK_CONSTRAINTS",
          max_affordable_stop_distance: currentRiskConstraints.maxStopDistance,
        },
      );
      if (
        !currentRiskConstraints.approved ||
        currentRiskConstraints.maxStopDistance === null
      ) {
        return await reject(currentRiskConstraints.reasonCodes);
      }

      const now = new Date();
      const semanticContext = {
        analysisId,
        symbol: this.#options.symbol,
        now,
        expiryReferenceTime: new Date(preModelSnapshot.serverTime),
        quote: decisionSnapshot.quote,
        metadata: decisionSnapshot.metadata,
        atr,
        minExpirySeconds: this.#options.minExpirySeconds,
        maxExpirySeconds: this.#options.maxExpirySeconds,
        maxStopDistanceAtr: this.#options.maxStopDistanceAtr,
        maxEntryDistanceAtr: this.#options.maxEntryDistanceAtr,
        maxAffordableStopDistance: currentRiskConstraints.maxStopDistance,
        minStopDistancePoints: this.#options.minStopDistancePoints,
        maxQuoteAgeMs: this.#options.maxQuoteAgeMs,
        maxMetadataAgeMs: this.#options.maxMetadataAgeMs,
        ...((): {
          expectedPerformanceAdjustment?: {
            applied: boolean;
            confidenceDelta: number;
            reasonCodes: string[];
          };
        } => {
          const value = performance.performance_adjustment;
          if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value)
          )
            return {};
          const adjustment = value as Record<string, unknown>;
          if (
            typeof adjustment.applied !== "boolean" ||
            typeof adjustment.confidence_delta !== "number" ||
            !Array.isArray(adjustment.reason_codes) ||
            !adjustment.reason_codes.every(
              (reason) => typeof reason === "string",
            )
          ) {
            throw new Error("PERFORMANCE_ADJUSTMENT_CONTEXT_INVALID");
          }
          return {
            expectedPerformanceAdjustment: {
              applied: adjustment.applied,
              confidenceDelta: adjustment.confidence_delta,
              reasonCodes: adjustment.reason_codes,
            },
          };
        })(),
      };
      const proposalSemantic = validateSemantics(model.response, {
        ...semanticContext,
        minRiskRewardRatio: minimumProposalRiskRewardRatio,
        takeProfitDistanceDivisor: "1",
      });
      await this.#options.trail.validation(
        analysisId,
        "SEMANTIC",
        proposalSemantic.accepted,
        proposalSemantic.reasonCodes,
        {
          validation_scope: "AI_PROPOSAL",
          required_min_risk_reward_ratio: minimumProposalRiskRewardRatio,
          exit_policy: "FEE_BUFFERED_TP_WITH_DOUBLE_SL",
        },
      );
      if (!proposalSemantic.accepted)
        return await reject(proposalSemantic.reasonCodes);

      const maximumEffectiveStopDistance = canonical(
        Decimal.min(
          decimal(atr).mul(decimal(this.#options.maxStopDistanceAtr)),
          decimal(currentRiskConstraints.maxStopDistance),
        ),
      );
      const transformed = applyCommissionAwareExitPolicy(
        model.response,
        decisionSnapshot.metadata,
        canonical(minimumStopDistance),
        maximumEffectiveStopDistance,
        this.#options.minimumExpectedNetToFeesRatio,
      );
      await this.#options.trail.validation(
        analysisId,
        "SEMANTIC",
        transformed.accepted,
        transformed.reasonCodes,
        {
          validation_scope: "TAKE_PROFIT_TRANSFORM",
          proposal_transform: transformed.details,
        },
      );
      if (!transformed.accepted || transformed.response === null)
        return await reject(transformed.reasonCodes);

      const effectiveSemantic = validateSemantics(transformed.response, {
        ...semanticContext,
        minRiskRewardRatio: this.#options.minRiskRewardRatio,
        takeProfitDistanceDivisor: "1",
        primaryTargetMode: "CONTAINS_EFFECTIVE",
      });
      await this.#options.trail.validation(
        analysisId,
        "SEMANTIC",
        effectiveSemantic.accepted,
        effectiveSemantic.reasonCodes,
        {
          validation_scope: "EFFECTIVE_BROKER_PROPOSAL",
          required_min_risk_reward_ratio: this.#options.minRiskRewardRatio,
          proposal_transform: transformed.details,
        },
      );
      if (!effectiveSemantic.accepted)
        return await reject(effectiveSemantic.reasonCodes);

      const risk = await this.#options.risk.evaluate({
        response: transformed.response,
        account,
        metadata: decisionSnapshot.metadata,
        quote: decisionSnapshot.quote,
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        risk.approved,
        risk.reasonCodes,
      );
      if (!risk.approved || risk.commands === null)
        return await reject(risk.reasonCodes);

      const commissionCoverage = validateCommandFeeBuffer(
        risk.commands,
        decisionSnapshot.metadata,
        this.#options.minimumExpectedNetToFeesRatio,
      );
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        commissionCoverage.approved,
        commissionCoverage.reasonCodes,
        {
          validation_scope: "ACTUAL_VOLUME_FEE_BUFFER",
          minimum_expected_net_to_fees_ratio:
            this.#options.minimumExpectedNetToFeesRatio,
          fee_buffer_evidence: commissionCoverage.evidence,
        },
      );
      if (!commissionCoverage.approved)
        return await reject(commissionCoverage.reasonCodes);

      const placementAccount = await this.#options.account.reconcile(
        decisionSnapshot.metadata.symbolId,
      );
      const placementRiskConstraints = this.#options.risk.proposalConstraints({
        account: placementAccount,
        metadata: decisionSnapshot.metadata,
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        placementRiskConstraints.approved,
        placementRiskConstraints.reasonCodes,
        {
          validation_scope: "PRE_PLACEMENT_RISK_CONSTRAINTS",
          max_affordable_stop_distance:
            placementRiskConstraints.maxStopDistance,
        },
      );
      if (
        !placementRiskConstraints.approved ||
        placementRiskConstraints.maxStopDistance === null
      ) {
        return await reject(placementRiskConstraints.reasonCodes);
      }
      if (
        accountExecutionFingerprint(account) !==
        accountExecutionFingerprint(placementAccount)
      ) {
        const reasons = ["PLACEMENT_ACCOUNT_STATE_CHANGED"];
        await this.#options.trail.validation(
          analysisId,
          "RISK",
          false,
          reasons,
          { validation_scope: "PRE_PLACEMENT_ACCOUNT_RECONCILIATION" },
        );
        return await reject(reasons);
      }

      let placementSnapshot: MarketSnapshot;
      try {
        placementSnapshot = await this.#options.market.snapshot(
          this.#options.symbol,
          this.#options.candleCounts,
          this.#options.orderBookDepth,
        );
      } catch {
        const reasons = ["PLACEMENT_MARKET_REFRESH_FAILED"];
        await this.#options.trail.validation(
          analysisId,
          "RISK",
          false,
          reasons,
          { validation_scope: "PRE_PLACEMENT_MARKET_REFRESH" },
        );
        return await reject(reasons);
      }
      const placementContextReasons = marketContextReasons(
        decisionSnapshot,
        placementSnapshot,
        "PLACEMENT",
      );
      if (placementContextReasons.length > 0) {
        await this.#options.trail.validation(
          analysisId,
          "RISK",
          false,
          placementContextReasons,
          { validation_scope: "PRE_PLACEMENT_MARKET_CONTEXT" },
        );
        return await reject(placementContextReasons);
      }
      await this.#options.trail.decisionMarket(
        analysisId,
        placementSnapshot,
        "PRE_PLACEMENT",
      );

      const placementSpreadContext =
        await this.#options.spreadContext(placementSnapshot);
      const placementSpread = checkSpread({
        bid: placementSnapshot.quote.bid,
        ask: placementSnapshot.quote.ask,
        tickSize: placementSnapshot.metadata.tickSize,
        atr,
        maxPoints: this.#options.maxSpreadPoints,
        maxAtrRatio: this.#options.maxSpreadAtrRatio,
        observedPercentile: placementSpreadContext.observedPercentile,
        maxPercentile: this.#options.maxSpreadPercentile,
        sessionAbnormal: placementSpreadContext.sessionAbnormal,
        liveMode: this.#options.mode === "live",
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        placementSpread.approved,
        placementSpread.reasonCodes,
        { validation_scope: "PRE_PLACEMENT_SPREAD" },
      );
      if (!placementSpread.approved)
        return await reject(placementSpread.reasonCodes);

      const placementSemanticContext = {
        ...semanticContext,
        now: new Date(),
        quote: placementSnapshot.quote,
        metadata: placementSnapshot.metadata,
        maxAffordableStopDistance: placementRiskConstraints.maxStopDistance,
      };
      const placementProposalSemantic = validateSemantics(model.response, {
        ...placementSemanticContext,
        minRiskRewardRatio: minimumProposalRiskRewardRatio,
        takeProfitDistanceDivisor: "1",
      });
      await this.#options.trail.validation(
        analysisId,
        "SEMANTIC",
        placementProposalSemantic.accepted,
        placementProposalSemantic.reasonCodes,
        {
          validation_scope: "PRE_PLACEMENT_AI_PROPOSAL",
          required_min_risk_reward_ratio: minimumProposalRiskRewardRatio,
          exit_policy: "FEE_BUFFERED_TP_WITH_DOUBLE_SL",
        },
      );
      if (!placementProposalSemantic.accepted)
        return await reject(placementProposalSemantic.reasonCodes);

      const placementEffectiveSemantic = validateSemantics(
        transformed.response,
        {
          ...placementSemanticContext,
          minRiskRewardRatio: this.#options.minRiskRewardRatio,
          takeProfitDistanceDivisor: "1",
          primaryTargetMode: "CONTAINS_EFFECTIVE",
        },
      );
      await this.#options.trail.validation(
        analysisId,
        "SEMANTIC",
        placementEffectiveSemantic.accepted,
        placementEffectiveSemantic.reasonCodes,
        {
          validation_scope: "PRE_PLACEMENT_EFFECTIVE_PROPOSAL",
          required_min_risk_reward_ratio: this.#options.minRiskRewardRatio,
          proposal_transform: transformed.details,
        },
      );
      if (!placementEffectiveSemantic.accepted)
        return await reject(placementEffectiveSemantic.reasonCodes);

      const currentSafety = await this.#options.safety();
      const quoteAge =
        Date.now() - Date.parse(placementSnapshot.quote.sourceTime);
      const bookAge =
        Date.now() - Date.parse(placementSnapshot.orderBook.sourceTime);
      const placementGate = evaluatePlacementEligibility({
        ...currentSafety,
        aiCircuitOpen: this.#options.model.circuitOpen,
        relevantPositionCount: placementAccount.relevantPositionCount,
        relevantPendingOrderCount: placementAccount.relevantPendingOrderCount,
        partialFillPresent: placementAccount.hasPartialFill,
        cancellationPending: placementAccount.hasCancellationPending,
        previousAnalysisExpired: true,
        accountReconciled: true,
        reconciliationCertain: placementAccount.certain,
        marketDataFresh:
          quoteAge >= 0 && quoteAge <= this.#options.maxQuoteAgeMs,
        orderBookFresh:
          bookAge >= 0 && bookAge <= this.#options.maxOrderBookAgeMs,
        candlesSynchronized: true,
        symbolMetadataValid: true,
        aiResponseValid: true,
        deterministicRiskApproved: true,
        spreadSafe: true,
      });
      await this.#options.trail.validation(
        analysisId,
        this.#options.mode === "live" ? "LIVE_GATE" : "RISK",
        placementGate.allowed,
        placementGate.reasonCodes,
      );
      if (!placementGate.allowed)
        return await reject(placementGate.reasonCodes);

      await this.#options.trail.intent(analysisId, risk);
      const placement = await this.#options.gateway.placeOco(risk.commands);
      await this.#options.trail.placement(analysisId, placement);
      await this.#options.flushExecutionEvents?.();
      await this.#recordTransition(analysisId, machine, "ACCEPTED");
      return { analysisId, outcome: "PLACED", reasonCodes: [], placement };
    } catch (error) {
      return await reject([
        stableFailureReason(error, "ANALYSIS_CYCLE_FAILED"),
      ]);
    } finally {
      this.#running = false;
    }
  }

  async #recordTransition(
    analysisId: string,
    machine: AnalysisStateMachine,
    state:
      "COLLECTING" | "FEATURED" | "MODEL_PENDING" | "VALIDATING" | "ACCEPTED",
  ): Promise<void> {
    await this.#options.trail.transition(analysisId, machine.transition(state));
  }
}
