import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  ModelResponse,
  PendingOrderCommand,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { QUICK_OCO } from "../../config/src/policy.js";
import {
  canonical,
  decimal,
  isTickAligned,
} from "../../risk-engine/src/decimal.js";
import { oneWayCommission } from "../../risk-engine/src/commission.js";

/** Ex-ante reserve. Executable bid/ask spread is not subtracted a second time. */
export function quickOcoCost(
  metadata: SymbolMetadata,
  entry: Decimal,
  target: Decimal,
  volume: Decimal,
) {
  const tick = decimal(metadata.tickSize),
    pip = decimal(metadata.pipSize);
  const perPrice = decimal(metadata.tickValue).mul(volume).div(tick);
  const conversionRate = decimal(metadata.commission.pnlConversionFeeRate).div(
    100,
  );
  if (
    tick.lte(0) ||
    pip.lte(0) ||
    !pip.div(tick).isInteger() ||
    perPrice.lte(0) ||
    conversionRate.lt(0) ||
    conversionRate.gte(1)
  )
    throw new Error("QUICK_OCO_COST_METADATA_INVALID");
  const reserve = tick.mul(
    decimal(QUICK_OCO.entryReservePoints).plus(QUICK_OCO.exitReservePoints),
  );
  const priceBound = Decimal.max(entry, target).plus(reserve);
  const commission = oneWayCommission(metadata, priceBound, volume).mul(2);
  const gross = entry.minus(target).abs().mul(perPrice);
  const conversion = gross.mul(conversionRate);
  const netPrice = gross
    .minus(commission)
    .minus(conversion)
    .div(perPrice)
    .minus(reserve);
  return {
    netPrice,
    evidence: {
      gross_target_pips: canonical(entry.minus(target).abs().div(pip)),
      modeled_round_trip_commission: canonical(commission),
      modeled_conversion_fee: canonical(conversion),
      execution_reserve_price: canonical(reserve),
      modeled_net_pips: canonical(
        netPrice.div(pip).toDecimalPlaces(10, Decimal.ROUND_DOWN),
      ),
      net_objective_pips: QUICK_OCO.netTargetPips,
      fee_basis: "BROKER_METADATA_HIGH_PRICE_BOUND",
      future_swap: null,
      guaranteed_closing_proceeds: false,
    },
  };
}

export function quickOcoTransform(input: {
  snapshot: MarketSnapshot;
  response: ModelResponse;
  maximumStopDistance: string;
}) {
  const reject = (code: string) => ({
    accepted: false,
    response: null,
    reasonCodes: [code],
    details: { code },
  });
  try {
    const m = input.snapshot.metadata,
      tick = decimal(m.tickSize),
      pip = decimal(m.pipSize),
      result = structuredClone(input.response);
    const buy = decimal(result.buy_stop.entry_price),
      sell = decimal(result.sell_stop.entry_price);
    if (
      tick.lte(0) ||
      pip.lte(0) ||
      !pip.div(tick).isInteger() ||
      buy.lte(sell) ||
      sell.lte(0) ||
      ![buy, sell].every((p) => isTickAligned(p, tick))
    )
      return reject("QUICK_OCO_RANGE_INVALID");
    const maxStop = decimal(input.maximumStopDistance),
      volume = decimal(m.minVolume),
      objective = pip.mul(QUICK_OCO.netTargetPips);
    const details = [];
    for (const [leg, entry, direction] of [
      [result.buy_stop, buy, 1],
      [result.sell_stop, sell, -1],
    ] as const) {
      const distance = decimal(QUICK_OCO.targetPriceDistance)
        .div(pip)
        .ceil()
        .mul(pip);
      if (
        distance.lt(
          Decimal.max(pip, tick.mul(5), decimal(m.minStopDistance)),
        ) ||
        decimal(QUICK_OCO.stopPriceDistance).gt(maxStop)
      )
        return reject("QUICK_OCO_PROTECTION_UNAFFORDABLE");
      const target = entry.plus(distance.mul(direction)),
        stop = entry.minus(decimal(QUICK_OCO.stopPriceDistance).mul(direction));
      if (
        stop.lte(0) ||
        target.lte(0) ||
        ![stop, target].every((p) => isTickAligned(p, tick))
      )
        return reject("QUICK_OCO_PROTECTION_INVALID");
      const cost = quickOcoCost(m, entry, target, volume);
      if (cost.netPrice.lt(objective))
        return reject("QUICK_OCO_NET_OBJECTIVE_UNAFFORDABLE");
      Object.assign(leg, {
        stop_loss: canonical(stop),
        invalidation_price: canonical(stop),
        take_profit: canonical(target),
        risk_reward_ratio: "0.0571428571",
      });
      details.push({
        side: direction === 1 ? "BUY" : "SELL",
        tp_distance: canonical(distance),
        sl_distance: canonical(decimal(QUICK_OCO.stopPriceDistance)),
        ...cost.evidence,
      });
    }
    Object.assign(result.technical_map, {
      upside_targets: [result.buy_stop.take_profit],
      downside_targets: [result.sell_stop.take_profit],
    });
    Object.assign(result, {
      setup_tags: [...result.setup_tags, "QUICK_OCO_SMALL_TP_FIXED_STOP"],
    });
    return {
      accepted: true,
      response: result,
      reasonCodes: [],
      details: {
        code: "QUICK_OCO_COST_AWARE_NATIVE",
        stop_to_target_ratio: QUICK_OCO.stopToTarget,
        legs: details,
      },
    };
  } catch {
    return reject("QUICK_OCO_COST_OR_PROTECTION_INVALID");
  }
}

export function validateQuickOcoCommands(
  commands: readonly PendingOrderCommand[],
  metadata: SymbolMetadata,
) {
  const reasonCodes: string[] = [],
    evidence: Record<string, unknown>[] = [];
  if (commands.length !== 2 || new Set(commands.map((c) => c.side)).size !== 2)
    return {
      approved: false,
      reasonCodes: ["QUICK_OCO_COMMAND_PAIR_REQUIRED"],
      evidence,
    };
  try {
    for (const command of commands) {
      const entry = decimal(command.entryPrice),
        target = decimal(command.takeProfit),
        stop = decimal(command.stopLoss);
      const tp = entry.minus(target).abs(),
        sl = entry.minus(stop).abs(),
        pip = decimal(metadata.pipSize),
        tick = decimal(metadata.tickSize);
      if (
        command.executionOrderType !== "STOP_LIMIT" ||
        !tp.eq(
          decimal(QUICK_OCO.targetPriceDistance).div(pip).ceil().mul(pip),
        ) ||
        !tp.div(pip).isInteger() ||
        !sl.eq(decimal(QUICK_OCO.stopPriceDistance)) ||
        ![entry, target, stop].every(
          (p) => p.gt(0) && isTickAligned(p, tick),
        ) ||
        (command.side === "BUY"
          ? !(target.gt(entry) && stop.lt(entry))
          : !(target.lt(entry) && stop.gt(entry)))
      )
        throw new Error("QUICK_OCO_COMMAND_GEOMETRY_INVALID");
      const cost = quickOcoCost(
        metadata,
        entry,
        target,
        decimal(command.volume),
      );
      evidence.push({
        side: command.side,
        volume: command.volume,
        ...cost.evidence,
      });
      if (cost.netPrice.lt(pip.mul(QUICK_OCO.netTargetPips)))
        reasonCodes.push(command.side + "_QUICK_OCO_NET_OBJECTIVE_UNMET");
    }
  } catch {
    reasonCodes.push("QUICK_OCO_COMMAND_COST_INVALID");
  }
  return { approved: reasonCodes.length === 0, reasonCodes, evidence };
}

/** Current provider cost context, excludes entry slippage already in the fill basis. */
export function quickOcoModeledCost(snapshot: MarketSnapshot): string {
  const entry = decimal(snapshot.quote.ask),
    distance = decimal(QUICK_OCO.targetPriceDistance)
      .div(snapshot.metadata.pipSize)
      .ceil()
      .mul(snapshot.metadata.pipSize);
  const cost = quickOcoCost(
    snapshot.metadata,
    entry,
    entry.plus(distance),
    decimal(snapshot.metadata.minVolume),
  );
  return canonical(
    distance.minus(cost.netPrice).toDecimalPlaces(10, Decimal.ROUND_UP),
  );
}
