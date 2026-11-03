import type { TrialProfile } from "./demo-trial.js";
import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  ModelResponse,
  PendingOrderCommand,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import {
  COST_BALANCED_SCALP_LIMITS,
  DEMO_TRIAL_SCALP_LIMITS,
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
  trial?: TrialProfile,
  volumeStage: "MINIMUM_DIAGNOSTIC" | "ACTUAL" = "ACTUAL",
) {
  const limits = trial
    ? DEMO_TRIAL_SCALP_LIMITS
    : balanced
      ? COST_BALANCED_SCALP_LIMITS
      : SCALP_LIMITS;
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
  if (
    (!trial || volumeStage === "ACTUAL") &&
    cost.netPrice.lt(decimal(metadata.pipSize).mul(QUICK_OCO.netTargetPips))
  )
    throw new Error("SCALP_NET_OBJECTIVE_UNAFFORDABLE");
  if (trial) {
    if (!reward.eq(trial.targetDistance))
      throw new Error("SCALP_TRIAL_TARGET_MISMATCH");
    const evidence = trialPayoffEvidence(
      metadata,
      entry,
      target,
      stop,
      volume,
      trial,
    );
    if (
      volumeStage === "ACTUAL" &&
      decimal(evidence.modeled_base_target_net_price).lt(
        decimal(metadata.pipSize).mul(QUICK_OCO.netTargetPips),
      )
    )
      throw new Error("SCALP_TRIAL_TARGET_UNAFFORDABLE");
    return { ...cost.evidence, trial_cost_admission: evidence };
  }
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

function rejectedPayoff(
  input: Parameters<typeof directionalScalpTransform>[0],
  balanced: boolean,
): Record<string, unknown> {
  if (!balanced || input.side === undefined) return {};
  const leg =
    input.side === "BUY" ? input.response.buy_stop : input.response.sell_stop;
  try {
    return {
      cost_admission: costBalancedPayoffEvidence(
        input.snapshot.metadata,
        leg.entry_price,
        leg.take_profit,
        leg.stop_loss,
        input.snapshot.metadata.minVolume,
      ),
    };
  } catch {
    return { cost_evidence_unavailable: true };
  }
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
  trial?: TrialProfile,
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
      trial,
      trial ? "MINIMUM_DIAGNOSTIC" : "ACTUAL",
    );
    return {
      accepted: true,
      response: input.response,
      reasonCodes: [] as string[],
      details: {
        code: trial
          ? "SINGLE_SCALP_TRIAL_GEOMETRY_PENDING_VOLUME_CHECK"
          : "SINGLE_SCALP_MODEL_GEOMETRY",
        ...evidence,
      },
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
      details: {
        code,
        ...rejectedPayoff(input, balanced),
        ...(() => {
          if (!trial || !input.side) return {};
          try {
            const leg =
              input.side === "BUY"
                ? input.response.buy_stop
                : input.response.sell_stop;
            return {
              trial_cost_admission: trialPayoffEvidence(
                input.snapshot.metadata,
                leg.entry_price,
                leg.take_profit,
                leg.stop_loss,
                input.snapshot.metadata.minVolume,
                trial,
              ),
            };
          } catch {
            return { trial_cost_evidence_unavailable: true };
          }
        })(),
      },
    };
  }
}

export function validateDirectionalScalpCommands(
  commands: readonly PendingOrderCommand[],
  metadata: SymbolMetadata,
  balanced = false,
  trial?: TrialProfile,
) {
  const evidence: Record<string, unknown>[] = [];
  try {
    if (commands.length !== 1) throw new Error("SCALP_ONE_COMMAND_REQUIRED");
    const c = commands[0]!;
    if (c.executionOrderType !== "STOP_LIMIT" || c.timeInForce !== "GTD")
      throw new Error("SCALP_LIFETIME_INVALID");
    const diagnostic: Record<string, unknown> = {
      side: c.side,
      volume: c.volume,
    };
    if (balanced) {
      try {
        diagnostic.cost_admission = costBalancedPayoffEvidence(
          metadata,
          c.entryPrice,
          c.takeProfit,
          c.stopLoss,
          c.volume,
        );
      } catch {
        diagnostic.cost_evidence_unavailable = true;
      }
      evidence.push(diagnostic);
    }
    if (trial) {
      if (c.entryRangePoints !== String(trial.entryRangePoints))
        throw new Error("SCALP_TRIAL_RANGE_MISMATCH");
      diagnostic.trial_cost_admission = trialPayoffEvidence(
        metadata,
        c.entryPrice,
        c.takeProfit,
        c.stopLoss,
        c.volume,
        trial,
      );
      evidence.push(diagnostic);
    }
    const approved = {
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
        trial,
      ),
    };
    if (balanced || trial) Object.assign(diagnostic, approved);
    else evidence.push(approved);
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
  reservePoints: string = COST_BALANCED_SCALP_LIMITS.exitReservePoints,
  entryPoints: string = COST_BALANCED_SCALP_LIMITS.entryRangePoints,
) {
  const tick = decimal(metadata.tickSize),
    perPrice = decimal(metadata.tickValue).mul(quantity).div(tick);
  if (tick.lte(0) || perPrice.lte(0) || quantity.lte(0))
    throw new Error("SCALP_COST_METADATA_INVALID");
  const reserve = tick.mul(reservePoints);
  const bound = entry
    .plus(tick.mul(entryPoints))
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

/** Numeric admission evidence, not actual costs or a counterfactual execution. */
export function costBalancedPayoffEvidence(
  metadata: SymbolMetadata,
  entry: string,
  target: string,
  stop: string,
  volume: string,
) {
  const e = decimal(entry),
    reward = decimal(target).minus(e).abs(),
    risk = decimal(stop).minus(e).abs();
  const v = balancedPayoff(metadata, e, reward, risk, decimal(volume));
  const satisfies = (distance: ReturnType<typeof decimal>) => {
    const candidate = balancedPayoff(
      metadata,
      e,
      distance,
      risk,
      decimal(volume),
    );
    return (
      candidate.netReward.gt(0) &&
      candidate.netReward.gte(
        candidate.netLoss.mul(COST_BALANCED_SCALP_LIMITS.minimumNetRewardRisk),
      )
    );
  };
  let low = decimal("0"),
    high = decimal(COST_BALANCED_SCALP_LIMITS.maximumTargetDistance);
  let required: ReturnType<typeof decimal> | null = null;
  if (satisfies(high)) {
    for (let i = 0; i < 64; i++) {
      const mid = low.plus(high).div(2);
      if (satisfies(mid)) high = mid;
      else low = mid;
    }
    required = high.toDecimalPlaces(10, Decimal.ROUND_UP);
  }
  return {
    evidence_version: "scalp-cost-admission-1.0",
    volume,
    target_distance_price: canonical(reward),
    stop_distance_price: canonical(risk),
    modeled_commission_price: canonical(v.fees),
    modeled_exit_reserve_price: canonical(v.reserve),
    modeled_target_conversion_price: canonical(reward.mul(v.conversion)),
    modeled_target_net_price: canonical(v.netReward),
    modeled_stop_loss_price: canonical(v.netLoss),
    target_threshold_status:
      required === null
        ? "UNAVAILABLE_AT_POLICY_CEILING"
        : "VERIFIED_COST_THRESHOLD",
    minimum_target_distance_price:
      required === null ? null : canonical(required),
    modeled_target_shortfall_price:
      required === null
        ? null
        : canonical(
            Decimal.max(0, required.minus(reward)).toDecimalPlaces(
              10,
              Decimal.ROUND_UP,
            ),
          ),
    modeled_break_even_win_fraction: v.netReward.gt(0)
      ? canonical(
          v.netLoss
            .div(v.netLoss.plus(v.netReward))
            .toDecimalPlaces(10, Decimal.ROUND_UP),
        )
      : null,
    spread_deducted_again: false,
    actual_exit_cost: null,
    guaranteed_closing_proceeds: false,
  };
}

/** Distinct experimental target allowance; stress loss reserve remains unchanged. */
export function trialPayoffEvidence(
  metadata: SymbolMetadata,
  entry: string,
  target: string,
  stop: string,
  volume: string,
  profile: TrialProfile,
) {
  if (
    !Number.isSafeInteger(metadata.digits) ||
    metadata.digits < 0 ||
    metadata.digits > 10 ||
    !decimal(metadata.tickSize).eq(decimal("10").pow(-metadata.digits))
  )
    throw new Error("SCALP_TRIAL_POINT_BASIS_UNSUPPORTED");
  const e = decimal(entry),
    reward = decimal(target).minus(e).abs(),
    risk = decimal(stop).minus(e).abs();
  const base = balancedPayoff(
    metadata,
    e,
    reward,
    risk,
    decimal(volume),
    String(profile.baseExitReservePoints),
    String(profile.entryRangePoints),
  );
  const stress = balancedPayoff(
    metadata,
    e,
    reward,
    risk,
    decimal(volume),
    String(profile.stressExitReservePoints),
    String(profile.entryRangePoints),
  );
  return {
    evidence_version: "demo-trial-cost-1.0",
    volume,
    target_distance_price: canonical(reward),
    stop_distance_price: canonical(risk),
    modeled_base_target_net_price: canonical(base.netReward),
    modeled_stress_target_net_price: canonical(stress.netReward),
    modeled_stress_stop_loss_price: canonical(stress.netLoss),
    modeled_base_commission_price: canonical(base.fees),
    modeled_stress_commission_price: canonical(stress.fees),
    base_exit_reserve_price: canonical(base.reserve),
    stress_exit_reserve_price: canonical(stress.reserve),
    modeled_break_even_win_fraction: base.netReward.gt(0)
      ? canonical(stress.netLoss.div(stress.netLoss.plus(base.netReward)))
      : null,
    spread_deducted_again: false,
    actual_exit_cost: null,
    guaranteed_closing_proceeds: false,
  };
}
export const demoTrialScalpTransform = (
  input: Parameters<typeof directionalScalpTransform>[0],
  profile: TrialProfile,
) => directionalScalpTransform(input, false, profile);
export const validateDemoTrialScalpCommands = (
  commands: readonly PendingOrderCommand[],
  metadata: SymbolMetadata,
  profile: TrialProfile,
) => validateDirectionalScalpCommands(commands, metadata, false, profile);
