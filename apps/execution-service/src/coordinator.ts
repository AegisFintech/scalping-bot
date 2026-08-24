import { randomUUID } from "node:crypto";

import type {
  AccountAdapter,
  AccountState,
  AnalyticsConfig,
  AnalyticsRequest,
  AnalyticsResponse,
  ExecutionGateway,
  MarketSnapshot,
  ModelResponse,
  OcoPlacementResult,
  Timeframe,
  Quote,
  SymbolMetadata,
} from "../../../packages/contracts/src/index.js";
import {
  checkSpread,
  validateSemantics,
  type SpreadDecision,
} from "../../../packages/risk-engine/src/index.js";
import {
  buildModelPayload,
  type ModelPayloadMode,
} from "../../ai-orchestrator/src/payload.js";
import type { OcoEvaluation } from "./oco-risk-evaluator.js";
import {
  evaluateAnalysisEligibility,
  evaluatePlacementEligibility,
  type SafetyGateInput,
} from "./safety-gates.js";
import {
  AnalysisStateMachine,
  type AnalysisTransition,
} from "./state-machine.js";

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
  }): Promise<{
    readonly response: ModelResponse;
    readonly rawResponse: string;
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
  analytics(analysisId: string, response: AnalyticsResponse): Promise<void>;
  model(
    analysisId: string,
    requestPayload: Readonly<Record<string, unknown>>,
    response: ModelResponse,
    rawResponse: string,
  ): Promise<void>;
  validation(
    analysisId: string,
    stage: "SEMANTIC" | "RISK" | "LIVE_GATE",
    accepted: boolean,
    reasons: readonly string[],
  ): Promise<void>;
  intent(analysisId: string, evaluation: OcoEvaluation): Promise<void>;
  placement(analysisId: string, result: OcoPlacementResult): Promise<void>;
}

export interface OcoRiskProvider {
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

  analytics(analysisId: string, response: AnalyticsResponse): Promise<void> {
    this.events.push({ type: "analytics", analysisId, response });
    return Promise.resolve();
  }

  model(
    analysisId: string,
    requestPayload: Readonly<Record<string, unknown>>,
    response: ModelResponse,
    rawResponse: string,
  ): Promise<void> {
    this.events.push({
      type: "model",
      analysisId,
      requestPayload,
      response,
      rawResponse,
    });
    return Promise.resolve();
  }

  validation(
    analysisId: string,
    stage: "SEMANTIC" | "RISK" | "LIVE_GATE",
    accepted: boolean,
    reasons: readonly string[],
  ): Promise<void> {
    this.events.push({
      type: "validation",
      analysisId,
      stage,
      accepted,
      reasons,
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
  readonly promptVersion: string;
  readonly schemaVersion: "1.0";
  readonly strategyVersion: string;
  readonly minRiskRewardRatio: string;
  readonly minExpirySeconds: number;
  readonly maxExpirySeconds: number;
  readonly maxStopDistanceAtr: string;
  readonly minStopDistancePoints: string | null;
  readonly maxQuoteAgeMs: number;
  readonly maxMetadataAgeMs: number;
  readonly maxOrderBookAgeMs: number;
  readonly maxSpreadPoints: string | null;
  readonly maxSpreadAtrRatio: string | null;
  readonly maxSpreadPercentile: string | null;
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
  readonly performance: (
    analytics: AnalyticsResponse,
  ) => Promise<Readonly<Record<string, unknown>>>;
}

export interface CycleResult {
  readonly analysisId: string;
  readonly outcome: "PLACED" | "NO_TRADE" | "REJECTED";
  readonly reasonCodes: readonly string[];
  readonly placement: OcoPlacementResult | null;
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

      await this.#recordTransition(analysisId, machine, "FEATURED");
      const performance = await this.#options.performance(analytics);
      const payload = buildModelPayload({
        mode: this.#options.modelPayloadMode,
        analysisId,
        symbol: this.#options.symbol,
        analysisTime: snapshot.serverTime,
        serverTime: snapshot.serverTime,
        analyticsFeatures: analytics.features,
        performanceContext: performance,
        promptVersion: this.#options.promptVersion,
        schemaVersion: this.#options.schemaVersion,
        strategyVersion: this.#options.strategyVersion,
      });
      await this.#recordTransition(analysisId, machine, "MODEL_PENDING");
      const model = await this.#options.model.analyze({
        analysisId,
        symbol: this.#options.symbol,
        payload,
      });
      await this.#options.trail.model(
        analysisId,
        payload,
        model.response,
        model.rawResponse,
      );
      await this.#recordTransition(analysisId, machine, "VALIDATING");

      const now = new Date();
      const semantic = validateSemantics(model.response, {
        analysisId,
        symbol: this.#options.symbol,
        now,
        quote: snapshot.quote,
        metadata: snapshot.metadata,
        atr,
        minRiskRewardRatio: this.#options.minRiskRewardRatio,
        minExpirySeconds: this.#options.minExpirySeconds,
        maxExpirySeconds: this.#options.maxExpirySeconds,
        maxStopDistanceAtr: this.#options.maxStopDistanceAtr,
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
      });
      await this.#options.trail.validation(
        analysisId,
        "SEMANTIC",
        semantic.accepted,
        semantic.reasonCodes,
      );
      if (!semantic.accepted) return await reject(semantic.reasonCodes);
      if (!semantic.executable) {
        await this.#recordTransition(analysisId, machine, "ACCEPTED");
        return {
          analysisId,
          outcome: "NO_TRADE",
          reasonCodes: [],
          placement: null,
        };
      }

      const account = await this.#options.account.reconcile(
        snapshot.metadata.symbolId,
      );
      const risk = await this.#options.risk.evaluate({
        response: model.response,
        account,
        metadata: snapshot.metadata,
        quote: snapshot.quote,
      });
      await this.#options.trail.validation(
        analysisId,
        "RISK",
        risk.approved,
        risk.reasonCodes,
      );
      if (!risk.approved || risk.commands === null)
        return await reject(risk.reasonCodes);

      const currentSafety = await this.#options.safety();
      const quoteAge = Date.now() - Date.parse(snapshot.quote.sourceTime);
      const bookAge = Date.now() - Date.parse(snapshot.orderBook.sourceTime);
      const placementGate = evaluatePlacementEligibility({
        ...currentSafety,
        aiCircuitOpen: this.#options.model.circuitOpen,
        relevantPositionCount: account.relevantPositionCount,
        relevantPendingOrderCount: account.relevantPendingOrderCount,
        partialFillPresent: account.hasPartialFill,
        cancellationPending: account.hasCancellationPending,
        previousAnalysisExpired: true,
        accountReconciled: true,
        reconciliationCertain: account.certain,
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
      await this.#recordTransition(analysisId, machine, "ACCEPTED");
      return { analysisId, outcome: "PLACED", reasonCodes: [], placement };
    } catch (error) {
      return await reject([
        error instanceof Error ? error.message : "ANALYSIS_CYCLE_FAILED",
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
