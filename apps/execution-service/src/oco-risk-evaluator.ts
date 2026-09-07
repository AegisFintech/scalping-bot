import { createHash, randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";
import { stopCostReserve } from "../../../packages/risk-engine/src/commission.js";

import type {
  AccountState,
  ModelResponse,
  PendingOrderCommand,
  Quote,
  SymbolMetadata,
} from "../../../packages/contracts/src/index.js";
import {
  canonical,
  decimal,
  maximumAffordableStopDistance,
  sizeOcoPair,
  type OcoRiskDecision,
  type PositionRiskInput,
} from "../../../packages/risk-engine/src/index.js";

export interface MarginEstimator {
  estimate(
    symbolId: string,
    side: "BUY" | "SELL",
    volume: string,
  ): Promise<string>;
}

export interface OcoRiskEvaluatorOptions {
  readonly marginEstimator: MarginEstimator;
  readonly baseRiskPercent: string;
  readonly maxRiskPercent: string;
  readonly maxMarginUsagePercent: string;
  readonly maxPositionNotional: string | null;
  readonly strategyVersion: string;
  readonly strategyLabelPrefix?: string;
  readonly riskMultiplier?: () => string;
  readonly riskPercentCap?: () => string;
}

export interface OcoEvaluation {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly risk: OcoRiskDecision | null;
  readonly commands: readonly [PendingOrderCommand, PendingOrderCommand] | null;
  readonly equity: string | null;
  readonly perLegRiskPercent: string | null;
}

export interface OcoProposalRiskConstraints {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly maxStopDistance: string | null;
}

export class OcoRiskEvaluator {
  readonly #options: OcoRiskEvaluatorOptions;

  constructor(options: OcoRiskEvaluatorOptions) {
    this.#options = options;
  }

  proposalConstraints(input: {
    readonly account: AccountState;
    readonly metadata: SymbolMetadata;
    readonly quote?: Quote;
  }): OcoProposalRiskConstraints {
    if (!input.account.certain) {
      return {
        approved: false,
        reasonCodes: ["RISK_ACCOUNT_UNCERTAIN"],
        maxStopDistance: null,
      };
    }
    const result = maximumAffordableStopDistance({
      equity: input.account.equity,
      setupRiskPercent: this.#effectiveRisk(),
      maxRiskPercent: this.#options.maxRiskPercent,
      metadata: input.metadata,
    });
    if (
      !result.approved ||
      result.maxStopDistance === null ||
      input.quote === undefined
    )
      return result;
    try {
      const reserve = stopCostReserve({
        metadata: input.metadata,
        entryPrice: input.quote.ask,
        stopLoss: canonical(
          decimal(input.quote.ask).plus(decimal(result.maxStopDistance)),
        ),
        volume: input.metadata.minVolume,
        adverseSlippagePoints: "10",
      });
      const budget = decimal(input.account.equity)
        .mul(this.#effectiveRisk())
        .div(200)
        .minus(reserve);
      const ticks = budget
        .div(
          decimal(input.metadata.tickValue).mul(
            decimal(input.metadata.minVolume),
          ),
        )
        .floor();
      if (ticks.lt(1)) throw new Error("RISK_COSTS_VOLUME_BELOW_MIN");
      return {
        ...result,
        maxStopDistance: canonical(ticks.mul(decimal(input.metadata.tickSize))),
      };
    } catch {
      return {
        approved: false,
        reasonCodes: ["RISK_COSTS_VOLUME_BELOW_MIN"],
        maxStopDistance: null,
      };
    }
  }

  currentSetupRiskPercent(): string {
    return this.#effectiveRisk();
  }

  #effectiveRisk(): string {
    const multiplier = this.#options.riskMultiplier?.() ?? "1";
    if (!["1", "0.5", "0.25"].includes(multiplier))
      throw new Error("CAPITAL_RISK_UNAVAILABLE_OR_LOCKED");
    const risk = Decimal.min(
      decimal(this.#options.baseRiskPercent).mul(multiplier),
      decimal(
        this.#options.riskPercentCap?.() ?? this.#options.baseRiskPercent,
      ),
    );
    if (risk.lte(0)) throw new Error("CAPITAL_RISK_BUDGET_EXHAUSTED");
    return canonical(risk);
  }

  async evaluate(input: {
    readonly response: ModelResponse;
    readonly account: AccountState;
    readonly metadata: SymbolMetadata;
    readonly quote: Quote;
  }): Promise<OcoEvaluation> {
    if (!input.account.certain) return this.#reject("RISK_ACCOUNT_UNCERTAIN");
    if (
      input.account.relevantPositionCount > 0 ||
      input.account.relevantPendingOrderCount > 0 ||
      input.account.hasPartialFill ||
      input.account.hasCancellationPending
    )
      return this.#reject("RISK_EXISTING_EXPOSURE");
    try {
      const minimum = input.metadata.minVolume;
      const [buyMinimumMargin, sellMinimumMargin] = await Promise.all([
        this.#options.marginEstimator.estimate(
          input.metadata.symbolId,
          "BUY",
          minimum,
        ),
        this.#options.marginEstimator.estimate(
          input.metadata.symbolId,
          "SELL",
          minimum,
        ),
      ]);
      const currentMargin = Decimal.max(
        0,
        decimal(input.account.equity).minus(
          decimal(input.account.availableMargin),
        ),
      );
      const shared = {
        equity: input.account.equity,
        availableMargin: input.account.availableMargin,
        baseRiskPercent: this.#effectiveRisk(),
        maxRiskPercent: this.#options.maxRiskPercent,
        currentMargin: canonical(currentMargin),
        maxMarginUsagePercent: this.#options.maxMarginUsagePercent,
        maxPositionNotional: this.#options.maxPositionNotional,
        metadata: input.metadata,
      };
      const leg = (
        entryPrice: string,
        stopLoss: string,
        minimumMargin: string,
      ): PositionRiskInput => ({
        ...shared,
        entryPrice,
        stopLoss,
        estimatedMarginPerVolume: canonical(
          decimal(minimumMargin).div(decimal(minimum)),
        ),
      });
      const risk = sizeOcoPair({
        setupRiskPercent: this.#effectiveRisk(),
        buy: leg(
          input.response.buy_stop.entry_price,
          input.response.buy_stop.stop_loss,
          buyMinimumMargin,
        ),
        sell: leg(
          input.response.sell_stop.entry_price,
          input.response.sell_stop.stop_loss,
          sellMinimumMargin,
        ),
      });
      if (
        !risk.approved ||
        risk.buy.normalizedVolume === null ||
        risk.sell.normalizedVolume === null
      ) {
        return {
          approved: false,
          reasonCodes: risk.reasonCodes,
          risk,
          commands: null,
          equity: input.account.equity,
          perLegRiskPercent: canonical(decimal(this.#effectiveRisk()).div(2)),
        };
      }
      const [buyMargin, sellMargin] = await Promise.all([
        this.#options.marginEstimator.estimate(
          input.metadata.symbolId,
          "BUY",
          risk.buy.normalizedVolume,
        ),
        this.#options.marginEstimator.estimate(
          input.metadata.symbolId,
          "SELL",
          risk.sell.normalizedVolume,
        ),
      ]);
      const combinedMargin = decimal(buyMargin).plus(decimal(sellMargin));
      const reasons: string[] = [];
      if (combinedMargin.gt(decimal(input.account.availableMargin)))
        reasons.push("OCO_MARGIN_INSUFFICIENT");
      if (
        currentMargin
          .plus(combinedMargin)
          .div(decimal(input.account.equity))
          .mul(100)
          .gt(decimal(this.#options.maxMarginUsagePercent))
      ) {
        reasons.push("OCO_MARGIN_USAGE_EXCEEDED");
      }
      if (reasons.length > 0)
        return {
          approved: false,
          reasonCodes: reasons,
          risk,
          commands: null,
          equity: input.account.equity,
          perLegRiskPercent: canonical(decimal(this.#effectiveRisk()).div(2)),
        };
      const orderGroupId = randomUUID();
      const make = (
        side: "BUY" | "SELL",
        volume: string,
      ): PendingOrderCommand => {
        const proposal =
          side === "BUY" ? input.response.buy_stop : input.response.sell_stop;
        const identity = [
          this.#options.strategyVersion,
          input.response.analysis_id,
          input.response.symbol,
          side,
          input.response.schema_version,
        ].join(":");
        const digest = createHash("sha256").update(identity).digest("hex");
        return {
          idempotencyKey: digest,
          analysisId: input.response.analysis_id,
          orderGroupId,
          clientOrderId: `cas-${side.toLowerCase()}-${digest.slice(0, 24)}`,
          symbol: input.response.symbol,
          side,
          volume,
          entryPrice: proposal.entry_price,
          stopLoss: proposal.stop_loss,
          takeProfit: proposal.take_profit,
          expiresAt: proposal.expires_at,
          strategyLabel:
            `${this.#options.strategyLabelPrefix ?? "ctrader-ai-scalper"}:${this.#options.strategyVersion}`.slice(
              0,
              100,
            ),
        };
      };
      return {
        approved: true,
        reasonCodes: [],
        risk,
        commands: [
          make("BUY", risk.buy.normalizedVolume),
          make("SELL", risk.sell.normalizedVolume),
        ],
        equity: input.account.equity,
        perLegRiskPercent: canonical(decimal(this.#effectiveRisk()).div(2)),
      };
    } catch (error) {
      return this.#reject(
        error instanceof Error ? error.message : "RISK_EVALUATION_FAILED",
      );
    }
  }

  #reject(reason: string): OcoEvaluation {
    return {
      approved: false,
      reasonCodes: [reason],
      risk: null,
      commands: null,
      equity: null,
      perLegRiskPercent: null,
    };
  }
}
