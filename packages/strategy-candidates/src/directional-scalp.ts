import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  ModelResponse,
  PendingOrderCommand,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import {
  COST_BALANCED_SCALP_LIMITS,
  QUICK_OCO,
} from "../../config/src/policy.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";
import { SCALP_LIMITS } from "../../scenario-engine/src/scalp-entry.js";
import { oneWayCommission } from "../../risk-engine/src/commission.js";
import { quickOcoCost } from "./quick-oco.js";

function check(
  side: "BUY" | "SELL",
  entry: string,
  target: string,
  stop: string,
  metadata: SymbolMetadata,
  volume: string,
  balanced = false,
) {
  const limits = balanced ? COST_BALANCED_SCALP_LIMITS : SCALP_LIMITS;
  const e = decimal(entry),
    t = decimal(target),
    s = decimal(stop),
    tick = decimal(metadata.tickSize);
  const reward = t.minus(e).abs(),
    risk = s.minus(e).abs();
  const minimum = decimal(metadata.minStopDistance);
  if (
    ![e, t, s].every((p) => p.gt(0) && isTickAligned(p, tick)) ||
    (side === "BUY" ? !(s.lt(e) && t.gt(e)) : !(t.lt(e) && s.gt(e))) ||
    !reward.div(metadata.pipSize).isInteger() ||
    !risk.div(metadata.pipSize).isInteger() ||
    reward.lt(minimum) ||
    risk.lt(minimum) ||
    reward.gt(limits.maximumTargetDistance) ||
    risk.gt(limits.maximumStopDistance) ||
    reward.div(risk).lt(limits.minimumRiskReward)
  )
    throw new Error("SCALP_PROTECTION_INVALID");
  const cost = quickOcoCost(metadata, e, t, decimal(volume));
  if (cost.netPrice.lt(decimal(metadata.pipSize).mul(QUICK_OCO.netTargetPips)))
    throw new Error("SCALP_NET_OBJECTIVE_UNAFFORDABLE");
  if (balanced) {
    const { netReward, netLoss, fees, reserve, perPrice, conversion } =
      balancedPayoff(metadata, e, reward, risk, decimal(volume));
    if (
      netReward.lte(0) ||
      netLoss.lte(0) ||
      netReward.lt(netLoss.mul(COST_BALANCED_SCALP_LIMITS.minimumNetRewardRisk))
    )
      throw new Error("SCALP_NET_REWARD_BELOW_RISK");
    return {
      ...cost.evidence,
      execution_reserve_price: reserve.toFixed(),
      modeled_net_pips: netReward.div(metadata.pipSize).toFixed(),
      modeled_round_trip_commission: fees.mul(perPrice).toFixed(),
      modeled_conversion_fee: reward.mul(perPrice).mul(conversion).toFixed(),
      fee_basis: "BROKER_METADATA_BOTH_OUTCOMES_HIGH_PRICE_BOUND",
      payoff_policy: "net-reward-risk-v1",
      modeled_net_reward_price: netReward.toFixed(),
      modeled_stop_loss_price: netLoss.toFixed(),
      modeled_round_trip_fee_price: fees.toFixed(),
      payoff_execution_reserve_price: reserve.toFixed(),
      minimum_net_reward_risk: "1",
      future_swap: null,
      guaranteed_closing_proceeds: false,
    };
  }
  return cost.evidence;
}

/** Validate supplied exits; never replace, widen or reprice model geometry. */
export function directionalScalpTransform(
  input: {
    snapshot: MarketSnapshot;
    response: ModelResponse;
    maximumStopDistance: string;
    side?: "BUY" | "SELL";
  },
  balanced = false,
) {
  try {
    if (input.side === undefined) throw new Error("SCALP_DIRECTION_REQUIRED");
    const leg =
      input.side === "BUY" ? input.response.buy_stop : input.response.sell_stop;
    if (
      decimal(leg.entry_price)
        .minus(leg.stop_loss)
        .abs()
        .gt(input.maximumStopDistance)
    )
      throw new Error("SCALP_STOP_UNAFFORDABLE");
    const evidence = check(
      input.side,
      leg.entry_price,
      leg.take_profit,
      leg.stop_loss,
      input.snapshot.metadata,
      input.snapshot.metadata.minVolume,
      balanced,
    );
    return {
      accepted: true,
      response: input.response,
      reasonCodes: [] as string[],
      details: { code: "SINGLE_SCALP_MODEL_GEOMETRY", ...evidence },
    };
  } catch (error) {
    const code =
      error instanceof Error && /^SCALP_[A-Z_]+$/.test(error.message)
        ? error.message
        : "SCALP_PROTECTION_INVALID";
    return {
      accepted: false,
      response: null,
      reasonCodes: [code],
      details: { code },
    };
  }
}

export function validateDirectionalScalpCommands(
  commands: readonly PendingOrderCommand[],
  metadata: SymbolMetadata,
  balanced = false,
) {
  const evidence: Record<string, unknown>[] = [];
  try {
    if (commands.length !== 1) throw new Error("SCALP_ONE_COMMAND_REQUIRED");
    const c = commands[0]!;
    if (c.executionOrderType !== "STOP_LIMIT" || c.timeInForce !== "GTD")
      throw new Error("SCALP_LIFETIME_INVALID");
    evidence.push({
      side: c.side,
      volume: c.volume,
      ...check(
        c.side,
        c.entryPrice,
        c.takeProfit,
        c.stopLoss,
        metadata,
        c.volume,
        balanced,
      ),
    });
    return { approved: true, reasonCodes: [] as string[], evidence };
  } catch (error) {
    return {
      approved: false,
      reasonCodes: [
        error instanceof Error && /^SCALP_[A-Z_]+$/.test(error.message)
          ? error.message
          : "SCALP_COMMAND_COST_INVALID",
      ],
      evidence,
    };
  }
}

/** New-release admission; historical transforms retain their original policy. */
export const costBalancedScalpTransform = (
  input: Parameters<typeof directionalScalpTransform>[0],
) => directionalScalpTransform(input, true);
export const validateCostBalancedScalpCommands = (
  commands: readonly PendingOrderCommand[],
  metadata: SymbolMetadata,
) => validateDirectionalScalpCommands(commands, metadata, true);

/** Same conservative price/commission bound in model context and actual admission. */
function balancedPayoff(
  metadata: SymbolMetadata,
  entry: ReturnType<typeof decimal>,
  reward: ReturnType<typeof decimal>,
  risk: ReturnType<typeof decimal>,
  quantity: ReturnType<typeof decimal>,
) {
  const tick = decimal(metadata.tickSize),
    perPrice = decimal(metadata.tickValue).mul(quantity).div(tick);
  if (tick.lte(0) || perPrice.lte(0) || quantity.lte(0))
    throw new Error("SCALP_COST_METADATA_INVALID");
  const reserve = tick.mul(COST_BALANCED_SCALP_LIMITS.exitReservePoints);
  const bound = entry
    .plus(tick.mul(COST_BALANCED_SCALP_LIMITS.entryRangePoints))
    .plus(reward)
    .plus(risk)
    .plus(reserve);
  const fees = oneWayCommission(metadata, bound, quantity).mul(2).div(perPrice);
  const conversion = decimal(metadata.commission.pnlConversionFeeRate).div(100);
  if (conversion.lt(0) || conversion.gte(1))
    throw new Error("SCALP_COST_METADATA_INVALID");
  return {
    perPrice,
    conversion,
    netReward: reward
      .mul(decimal("1").minus(conversion))
      .minus(fees)
      .minus(reserve),
    netLoss: risk.mul(decimal("1").plus(conversion)).plus(fees).plus(reserve),
    fees,
    reserve,
  };
}
export function costBalancedModeledCost(snapshot: MarketSnapshot): string {
  const v = balancedPayoff(
    snapshot.metadata,
    decimal(snapshot.quote.ask),
    decimal(COST_BALANCED_SCALP_LIMITS.maximumTargetDistance),
    decimal(COST_BALANCED_SCALP_LIMITS.maximumStopDistance),
    decimal(snapshot.metadata.minVolume),
  );
  return canonical(
    v.fees.plus(v.reserve).toDecimalPlaces(10, Decimal.ROUND_UP),
  );
}
