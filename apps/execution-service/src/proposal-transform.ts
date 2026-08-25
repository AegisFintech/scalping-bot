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
} from "../../../packages/risk-engine/src/index.js";

export const TAKE_PROFIT_DISTANCE_DIVISOR = "2";

export interface TakeProfitTransformLegDetails {
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly original_take_profit: string;
  readonly effective_take_profit: string;
  readonly original_risk_reward_ratio: string;
  readonly effective_risk_reward_ratio: string;
}

export interface TakeProfitTransformDetails {
  readonly code: "TAKE_PROFIT_DISTANCE_DIVIDED_BY_2";
  readonly divisor: "2";
  readonly buy: TakeProfitTransformLegDetails;
  readonly sell: TakeProfitTransformLegDetails;
}

export interface TakeProfitTransformResult {
  readonly accepted: boolean;
  readonly response: ModelResponse | null;
  readonly reasonCodes: readonly string[];
  readonly details: TakeProfitTransformDetails | null;
}

export function proposalMinimumRiskRewardRatio(
  effectiveMinimum: string,
): string {
  return canonical(
    decimal(effectiveMinimum, "TAKE_PROFIT_EFFECTIVE_RR_INVALID").mul(
      decimal(TAKE_PROFIT_DISTANCE_DIVISOR),
    ),
  );
}

function transformedRatio(
  entry: Decimal,
  stopLoss: Decimal,
  takeProfit: Decimal,
): string {
  const risk = entry.minus(stopLoss).abs();
  if (risk.lte(0)) throw new Error("TAKE_PROFIT_TRANSFORM_RISK_INVALID");
  return canonical(
    takeProfit
      .minus(entry)
      .abs()
      .div(risk)
      .toDecimalPlaces(10, Decimal.ROUND_DOWN),
  );
}

function transformLeg(
  side: "BUY" | "SELL",
  proposal: ModelOrderProposal,
  tickSize: Decimal,
): {
  readonly proposal: ModelOrderProposal;
  readonly details: TakeProfitTransformLegDetails;
  readonly reasonCodes: readonly string[];
} {
  const entry = decimal(proposal.entry_price);
  const stopLoss = decimal(proposal.stop_loss);
  const originalTakeProfit = decimal(proposal.take_profit);
  const effectiveTakeProfit = entry
    .plus(originalTakeProfit)
    .div(decimal(TAKE_PROFIT_DISTANCE_DIVISOR));
  const effectiveTakeProfitText = canonical(effectiveTakeProfit);
  const reasons: string[] = [];
  if (
    (side === "BUY" && !originalTakeProfit.gt(entry)) ||
    (side === "SELL" && !originalTakeProfit.lt(entry))
  ) {
    reasons.push(`${side}_TP_DISTANCE_INVALID`);
  }
  if (!isTickAligned(effectiveTakeProfit, tickSize)) {
    reasons.push(`${side}_TP_MIDPOINT_NOT_ON_TICK`);
  }
  const effectiveRiskRewardRatio = transformedRatio(
    entry,
    stopLoss,
    effectiveTakeProfit,
  );
  return {
    proposal: {
      ...proposal,
      take_profit: effectiveTakeProfitText,
      risk_reward_ratio: effectiveRiskRewardRatio,
    },
    details: {
      entry_price: proposal.entry_price,
      stop_loss: proposal.stop_loss,
      original_take_profit: proposal.take_profit,
      effective_take_profit: effectiveTakeProfitText,
      original_risk_reward_ratio: proposal.risk_reward_ratio,
      effective_risk_reward_ratio: effectiveRiskRewardRatio,
    },
    reasonCodes: reasons,
  };
}

export function halveTakeProfitDistances(
  response: ModelResponse,
  metadata: SymbolMetadata,
): TakeProfitTransformResult {
  try {
    const tickSize = decimal(metadata.tickSize);
    if (tickSize.lte(0)) {
      return {
        accepted: false,
        response: null,
        reasonCodes: ["TAKE_PROFIT_TRANSFORM_TICK_INVALID"],
        details: null,
      };
    }
    const buy = transformLeg("BUY", response.buy_stop, tickSize);
    const sell = transformLeg("SELL", response.sell_stop, tickSize);
    const reasonCodes = [...buy.reasonCodes, ...sell.reasonCodes].sort();
    const details: TakeProfitTransformDetails = {
      code: "TAKE_PROFIT_DISTANCE_DIVIDED_BY_2",
      divisor: "2",
      buy: buy.details,
      sell: sell.details,
    };
    return {
      accepted: reasonCodes.length === 0,
      response:
        reasonCodes.length === 0
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
      reasonCodes: ["TAKE_PROFIT_TRANSFORM_DECIMAL_INVALID"],
      details: null,
    };
  }
}
