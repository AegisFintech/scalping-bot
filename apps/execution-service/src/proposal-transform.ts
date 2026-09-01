import { Decimal } from "decimal.js";

import type {
  ModelOrderProposal,
  ModelResponse,
  SymbolMetadata,
} from "../../../packages/contracts/src/index.js";
import {
  canonical,
  decimal,
  isTickAligned,
  minimumFeeBufferedTarget,
  type CommissionCoverageEvidence,
} from "../../../packages/risk-engine/src/index.js";

export const STOP_LOSS_TO_TAKE_PROFIT_RATIO = "2";
export const COMMISSION_AWARE_RISK_REWARD_RATIO = "0.5";

export interface CommissionAwareTransformLegDetails extends CommissionCoverageEvidence {
  readonly original_stop_loss: string;
  readonly effective_stop_loss: string;
  readonly original_take_profit: string;
  readonly effective_take_profit: string;
  readonly original_invalidation_price: string;
  readonly effective_invalidation_price: string;
  readonly original_risk_reward_ratio: string;
  readonly effective_risk_reward_ratio: "0.5";
  readonly stop_loss_distance: string;
}

export interface CommissionAwareTransformDetails {
  readonly code: "FEE_BUFFERED_TP_WITH_DOUBLE_SL";
  readonly commission_type: "USD_PER_MILLION_USD";
  readonly commission_rate: string;
  readonly commission_basis_volume: string;
  readonly stop_loss_to_take_profit_ratio: "2";
  readonly effective_risk_reward_ratio: "0.5";
  readonly minimum_expected_net_to_fees_ratio: string;
  readonly buy: CommissionAwareTransformLegDetails;
  readonly sell: CommissionAwareTransformLegDetails;
}

export interface CommissionAwareTransformResult {
  readonly accepted: boolean;
  readonly response: ModelResponse | null;
  readonly reasonCodes: readonly string[];
  readonly details: CommissionAwareTransformDetails | null;
}

export interface CommissionAwareMinimumDistances {
  readonly accepted: boolean;
  readonly reasonCodes: readonly string[];
  readonly takeProfitDistance: string | null;
  readonly stopLossDistance: string | null;
  readonly buy: CommissionCoverageEvidence | null;
  readonly sell: CommissionCoverageEvidence | null;
}

export function deriveCommissionAwareMinimumDistances(input: {
  readonly buyEntryPrice: string;
  readonly sellEntryPrice: string;
  readonly minimumStopDistance: string;
  readonly maximumStopDistance: string;
  readonly minimumExpectedNetToFeesRatio: string;
  readonly metadata: SymbolMetadata;
}): CommissionAwareMinimumDistances {
  try {
    const maximumTakeProfitDistance = canonical(
      decimal(input.maximumStopDistance).div(
        decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO),
      ),
    );
    const minimumTakeProfitDistance = canonical(
      decimal(input.minimumStopDistance).div(
        decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO),
      ),
    );
    const buy = minimumFeeBufferedTarget({
      side: "BUY",
      entryPrice: input.buyEntryPrice,
      volume: input.metadata.minVolume,
      minimumTakeProfitDistance,
      maximumTakeProfitDistance,
      minimumExpectedNetToFeesRatio: input.minimumExpectedNetToFeesRatio,
      metadata: input.metadata,
    });
    const sell = minimumFeeBufferedTarget({
      side: "SELL",
      entryPrice: input.sellEntryPrice,
      volume: input.metadata.minVolume,
      minimumTakeProfitDistance,
      maximumTakeProfitDistance,
      minimumExpectedNetToFeesRatio: input.minimumExpectedNetToFeesRatio,
      metadata: input.metadata,
    });
    const reasonCodes = [
      ...new Set([...buy.reasonCodes, ...sell.reasonCodes]),
    ].sort();
    if (
      !buy.approved ||
      buy.evidence === null ||
      !sell.approved ||
      sell.evidence === null
    ) {
      return {
        accepted: false,
        reasonCodes,
        takeProfitDistance: null,
        stopLossDistance: null,
        buy: buy.evidence,
        sell: sell.evidence,
      };
    }
    const buyDistance = decimal(buy.evidence.take_profit).minus(
      decimal(input.buyEntryPrice),
    );
    const sellDistance = decimal(input.sellEntryPrice).minus(
      decimal(sell.evidence.take_profit),
    );
    const takeProfitDistance = Decimal.max(buyDistance, sellDistance);
    return {
      accepted: true,
      reasonCodes: [],
      takeProfitDistance: canonical(takeProfitDistance),
      stopLossDistance: canonical(
        takeProfitDistance.mul(decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO)),
      ),
      buy: buy.evidence,
      sell: sell.evidence,
    };
  } catch (error) {
    return {
      accepted: false,
      reasonCodes: [
        error instanceof Error
          ? error.message
          : "COMMISSION_AWARE_DISTANCE_INVALID",
      ],
      takeProfitDistance: null,
      stopLossDistance: null,
      buy: null,
      sell: null,
    };
  }
}

function transformLeg(
  side: "BUY" | "SELL",
  proposal: ModelOrderProposal,
  metadata: SymbolMetadata,
  minimumStopDistance: string,
  maximumStopDistance: string,
  minimumExpectedNetToFeesRatio: string,
): {
  readonly proposal: ModelOrderProposal | null;
  readonly details: CommissionAwareTransformLegDetails | null;
  readonly reasonCodes: readonly string[];
} {
  const entry = decimal(proposal.entry_price);
  const originalStopLoss = decimal(proposal.stop_loss);
  const originalInvalidation = decimal(proposal.invalidation_price);
  const originalTakeProfit = decimal(proposal.take_profit);
  const maximumTakeProfitDistance = decimal(maximumStopDistance).div(
    decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO),
  );
  const minimumTakeProfitDistance = decimal(minimumStopDistance).div(
    decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO),
  );
  const selected = minimumFeeBufferedTarget({
    side,
    entryPrice: proposal.entry_price,
    volume: metadata.minVolume,
    minimumTakeProfitDistance: canonical(minimumTakeProfitDistance),
    maximumTakeProfitDistance: canonical(maximumTakeProfitDistance),
    minimumExpectedNetToFeesRatio,
    metadata,
  });
  if (!selected.approved || selected.evidence === null) {
    return {
      proposal: null,
      details: null,
      reasonCodes: selected.reasonCodes,
    };
  }
  const effectiveTakeProfit = decimal(selected.evidence.take_profit);
  const takeProfitDistance = effectiveTakeProfit.minus(entry).abs();
  const stopLossDistance = takeProfitDistance.mul(
    decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO),
  );
  const effectiveStopLoss =
    side === "BUY"
      ? entry.minus(stopLossDistance)
      : entry.plus(stopLossDistance);
  const reasons: string[] = [];
  const tickSize = decimal(metadata.tickSize);
  if (!isTickAligned(effectiveStopLoss, tickSize))
    reasons.push(`${side}_COMMISSION_AWARE_SL_NOT_ON_TICK`);
  if (
    (side === "BUY" && !originalTakeProfit.gte(effectiveTakeProfit)) ||
    (side === "SELL" && !originalTakeProfit.lte(effectiveTakeProfit))
  ) {
    reasons.push(`${side}_AI_TARGET_BELOW_FEE_BUFFERED_TP`);
  }
  if (
    (side === "BUY" && !originalStopLoss.lte(effectiveStopLoss)) ||
    (side === "SELL" && !originalStopLoss.gte(effectiveStopLoss))
  ) {
    reasons.push(`${side}_AI_STOP_DOES_NOT_CONTAIN_DOUBLE_SL`);
  }
  if (
    (side === "BUY" && !originalInvalidation.lte(effectiveStopLoss)) ||
    (side === "SELL" && !originalInvalidation.gte(effectiveStopLoss))
  ) {
    reasons.push(`${side}_AI_INVALIDATION_DOES_NOT_CONTAIN_DOUBLE_SL`);
  }
  const effectiveStopLossText = canonical(effectiveStopLoss);
  const effectiveTakeProfitText = canonical(effectiveTakeProfit);
  const details: CommissionAwareTransformLegDetails = {
    ...selected.evidence,
    original_stop_loss: proposal.stop_loss,
    effective_stop_loss: effectiveStopLossText,
    original_take_profit: proposal.take_profit,
    effective_take_profit: effectiveTakeProfitText,
    original_invalidation_price: proposal.invalidation_price,
    effective_invalidation_price: effectiveStopLossText,
    original_risk_reward_ratio: proposal.risk_reward_ratio,
    effective_risk_reward_ratio: COMMISSION_AWARE_RISK_REWARD_RATIO,
    stop_loss_distance: canonical(stopLossDistance),
  };
  return {
    proposal:
      reasons.length === 0
        ? {
            ...proposal,
            stop_loss: effectiveStopLossText,
            take_profit: effectiveTakeProfitText,
            invalidation_price: effectiveStopLossText,
            risk_reward_ratio: COMMISSION_AWARE_RISK_REWARD_RATIO,
          }
        : null,
    details,
    reasonCodes: reasons,
  };
}

export function applyCommissionAwareExitPolicy(
  response: ModelResponse,
  metadata: SymbolMetadata,
  minimumStopDistance: string,
  maximumStopDistance: string,
  minimumExpectedNetToFeesRatio: string,
): CommissionAwareTransformResult {
  try {
    const buy = transformLeg(
      "BUY",
      response.buy_stop,
      metadata,
      minimumStopDistance,
      maximumStopDistance,
      minimumExpectedNetToFeesRatio,
    );
    const sell = transformLeg(
      "SELL",
      response.sell_stop,
      metadata,
      minimumStopDistance,
      maximumStopDistance,
      minimumExpectedNetToFeesRatio,
    );
    const reasonCodes = [
      ...new Set([...buy.reasonCodes, ...sell.reasonCodes]),
    ].sort();
    const details =
      buy.details === null || sell.details === null
        ? null
        : {
            code: "FEE_BUFFERED_TP_WITH_DOUBLE_SL" as const,
            commission_type: "USD_PER_MILLION_USD" as const,
            commission_rate: metadata.commission.rate,
            commission_basis_volume: metadata.minVolume,
            stop_loss_to_take_profit_ratio:
              STOP_LOSS_TO_TAKE_PROFIT_RATIO as "2",
            effective_risk_reward_ratio:
              COMMISSION_AWARE_RISK_REWARD_RATIO as "0.5",
            minimum_expected_net_to_fees_ratio: minimumExpectedNetToFeesRatio,
            buy: buy.details,
            sell: sell.details,
          };
    return {
      accepted: reasonCodes.length === 0,
      response:
        reasonCodes.length === 0 &&
        buy.proposal !== null &&
        sell.proposal !== null
          ? {
              ...response,
              buy_stop: buy.proposal,
              sell_stop: sell.proposal,
            }
          : null,
      reasonCodes,
      details,
    };
  } catch {
    return {
      accepted: false,
      response: null,
      reasonCodes: ["COMMISSION_AWARE_EXIT_DECIMAL_INVALID"],
      details: null,
    };
  }
}
