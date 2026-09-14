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

export const STOP_LOSS_TO_TAKE_PROFIT_RATIO = "1";
export const COMMISSION_AWARE_RISK_REWARD_RATIO = "1";

function pipBound(
  stopDistance: string,
  metadata: SymbolMetadata,
  minimum: boolean,
): string {
  const pip = decimal(metadata.pipSize);
  if (pip.lte(0)) throw new Error("COMMISSION_PIP_SIZE_INVALID");
  const count = decimal(stopDistance)
    .div(decimal(STOP_LOSS_TO_TAKE_PROFIT_RATIO))
    .div(pip);
  // Internal division may produce an eleventh decimal. Project the bound onto
  // the already mandatory whole-pip search grid, tightening in both directions.
  return canonical((minimum ? count.ceil() : count.floor()).mul(pip));
}

export interface CommissionAwareTransformLegDetails extends CommissionCoverageEvidence {
  readonly original_stop_loss: string;
  readonly effective_stop_loss: string;
  readonly original_take_profit: string;
  readonly effective_take_profit: string;
  readonly original_invalidation_price: string;
  readonly effective_invalidation_price: string;
  readonly original_risk_reward_ratio: string;
  readonly effective_risk_reward_ratio: "1";
  readonly stop_loss_distance: string;
}

export interface CommissionAwareTransformDetails {
  readonly code: "FEE_BUFFERED_TP_WITH_DOUBLE_SL";
  readonly commission_type: "USD_PER_MILLION_USD";
  readonly commission_rate: string;
  readonly commission_basis_volume: string;
  readonly stop_loss_to_take_profit_ratio: "1";
  readonly effective_risk_reward_ratio: "1";
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
    const maximumTakeProfitDistance = pipBound(
      input.maximumStopDistance,
      input.metadata,
      false,
    );
    const minimumTakeProfitDistance = pipBound(
      input.minimumStopDistance,
      input.metadata,
      true,
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
  const maximumTakeProfitDistance = pipBound(
    maximumStopDistance,
    metadata,
    false,
  );
  const minimumTakeProfitDistance = pipBound(
    minimumStopDistance,
    metadata,
    true,
  );
  const selected = minimumFeeBufferedTarget({
    side,
    entryPrice: proposal.entry_price,
    volume: metadata.minVolume,
    minimumTakeProfitDistance,
    maximumTakeProfitDistance,
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
              STOP_LOSS_TO_TAKE_PROFIT_RATIO as "1",
            effective_risk_reward_ratio:
              COMMISSION_AWARE_RISK_REWARD_RATIO as "1",
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

/** ISSUE-102: fade-limit release transform. */
export interface FadeLimitExitDetails {
  readonly entry: string;
  readonly stop: string;
  readonly target: string;
  readonly risk_reward: string;
}

export interface FadeLimitExitResult {
  readonly accepted: boolean;
  readonly response: ModelResponse | null;
  readonly reasonCodes: readonly string[];
  readonly buy: FadeLimitExitDetails | null;
  readonly sell: FadeLimitExitDetails | null;
  readonly details: {
    readonly code: "FADE_LIMIT_EXIT";
    readonly atr: string;
    readonly sl_distance: string;
    readonly tp_distance: string;
  } | null;
}

function alignToTick(price: Decimal, tickSize: Decimal): string {
  if (price.lte(0) || tickSize.lte(0)) {
    throw new Error("FADE_LIMIT_TICK_INVALID");
  }
  const ticks = price.div(tickSize);
  return canonical(ticks.toDecimalPlaces(0, 4).mul(tickSize));
}

function fadeLeg(
  side: "BUY" | "SELL",
  level: string,
  atr: string,
  slAtr: string,
  tpAtr: string,
  maximumStopDistance: string,
  metadata: SymbolMetadata,
  expiresAt: string,
  reasons: string[],
): { proposal: ModelOrderProposal; details: FadeLimitExitDetails } {
  const entry = decimal(level);
  const atrDecimal = decimal(atr);
  const tick = decimal(metadata.tickSize);
  if (!entry.gt(0) || !atrDecimal.gt(0)) {
    throw new Error("FADE_LIMIT_INPUT_INVALID");
  }
  const slDistance = decimal(slAtr).mul(atrDecimal);
  const tpDistance = decimal(tpAtr).mul(atrDecimal);
  const max = decimal(maximumStopDistance);
  const sl = side === "BUY" ? entry.minus(slDistance) : entry.plus(slDistance);
  const tp = side === "BUY" ? entry.plus(tpDistance) : entry.minus(tpDistance);
  if (slDistance.gt(max)) reasons.push(`${side}_FADE_SL_DISTANCE_EXCEEDS_MAX`);
  if (tpDistance.gt(max)) reasons.push(`${side}_FADE_TP_DISTANCE_EXCEEDS_MAX`);
  const slAligned = alignToTick(sl, tick);
  const tpAligned = alignToTick(tp, tick);
  if (side === "BUY") {
    if (!(decimal(slAligned).lt(entry) && decimal(tpAligned).gt(entry)))
      reasons.push("BUY_FADE_LEVEL_ORDER_INVALID");
  } else {
    if (!(decimal(slAligned).gt(entry) && decimal(tpAligned).lt(entry)))
      reasons.push("SELL_FADE_LEVEL_ORDER_INVALID");
  }
  const risk = entry.minus(decimal(slAligned)).abs();
  const reward = decimal(tpAligned).minus(entry).abs();
  const rr = risk.gt(0) ? canonical(reward.div(risk)) : "0";
  return {
    proposal: {
      trigger_price: level,
      entry_price: level,
      stop_loss: slAligned,
      take_profit: tpAligned,
      invalidation_price: slAligned,
      risk_reward_ratio: rr,
      expires_at: expiresAt,
    },
    details: {
      entry: level,
      stop: slAligned,
      target: tpAligned,
      risk_reward: rr,
    },
  };
}

export function applyFadeLimitExitPolicy(input: {
  readonly response: ModelResponse;
  readonly metadata: SymbolMetadata;
  readonly atr: string;
  readonly slAtr: string;
  readonly tpAtr: string;
  readonly maximumStopDistance: string;
}): FadeLimitExitResult {
  try {
    const reasonCodes: string[] = [];
    const buy = fadeLeg(
      "BUY",
      input.response.sell_stop.entry_price,
      input.atr,
      input.slAtr,
      input.tpAtr,
      input.maximumStopDistance,
      input.metadata,
      input.response.buy_stop.expires_at,
      reasonCodes,
    );
    const sell = fadeLeg(
      "SELL",
      input.response.buy_stop.entry_price,
      input.atr,
      input.slAtr,
      input.tpAtr,
      input.maximumStopDistance,
      input.metadata,
      input.response.buy_stop.expires_at,
      reasonCodes,
    );
    if (reasonCodes.length > 0) {
      return {
        accepted: false,
        response: null,
        reasonCodes,
        buy: null,
        sell: null,
        details: null,
      };
    }
    const buyDetails = buy.details;
    const sellDetails = sell.details;
    return {
      accepted: true,
      reasonCodes: [],
      buy: buyDetails,
      sell: sellDetails,
      details: {
        code: "FADE_LIMIT_EXIT" as const,
        atr: input.atr,
        sl_distance: decimal(input.slAtr).mul(decimal(input.atr)).toString(),
        tp_distance: decimal(input.tpAtr).mul(decimal(input.atr)).toString(),
      },
      response: {
        ...input.response,
        buy_stop: buy.proposal,
        sell_stop: sell.proposal,
        setup_tags: [
          ...input.response.setup_tags.filter(
            (tag) => tag !== "DIRECT_ENTRY_PAIR_OCO",
          ),
          "DIRECT_FADE_LIMIT_PAIR_OCO",
        ],
      },
    };
  } catch {
    return {
      accepted: false,
      response: null,
      reasonCodes: ["FADE_LIMIT_TRANSFORM_INVALID"],
      buy: null,
      sell: null,
      details: null,
    };
  }
}
