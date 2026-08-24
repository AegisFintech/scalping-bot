import { createHash, randomUUID } from "node:crypto";

import { Decimal } from "decimal.js";

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
}

export interface OcoEvaluation {
  readonly approved: boolean;
  readonly reasonCodes: readonly string[];
  readonly risk: OcoRiskDecision | null;
  readonly commands: readonly [PendingOrderCommand, PendingOrderCommand] | null;
  readonly equity: string | null;
  readonly perLegRiskPercent: string | null;
}

export class OcoRiskEvaluator {
  readonly #options: OcoRiskEvaluatorOptions;

  constructor(options: OcoRiskEvaluatorOptions) {
    this.#options = options;
  }

  async evaluate(input: {
    readonly response: ModelResponse;
    readonly account: AccountState;
    readonly metadata: SymbolMetadata;
    readonly quote: Quote;
  }): Promise<OcoEvaluation> {
    if (!input.account.certain) return this.#reject("RISK_ACCOUNT_UNCERTAIN");
    if (input.response.decision !== "PLACE_OCO")
      return this.#reject("RISK_NO_EXECUTABLE_DECISION");
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
        baseRiskPercent: this.#options.baseRiskPercent,
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
        setupRiskPercent: this.#options.baseRiskPercent,
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
          perLegRiskPercent: canonical(
            decimal(this.#options.baseRiskPercent).div(2),
          ),
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
          perLegRiskPercent: canonical(
            decimal(this.#options.baseRiskPercent).div(2),
          ),
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
        perLegRiskPercent: canonical(
          decimal(this.#options.baseRiskPercent).div(2),
        ),
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
