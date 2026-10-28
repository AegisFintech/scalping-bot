import type {
  MarketSnapshot,
  ModelResponse,
  PendingOrderCommand,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { QUICK_OCO } from "../../config/src/policy.js";
import { decimal, isTickAligned } from "../../risk-engine/src/decimal.js";
import { SCALP_LIMITS } from "../../scenario-engine/src/scalp-entry.js";
import { quickOcoCost } from "./quick-oco.js";

function check(
  side: "BUY" | "SELL",
  entry: string,
  target: string,
  stop: string,
  metadata: SymbolMetadata,
  volume: string,
) {
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
    reward.gt(SCALP_LIMITS.maximumTargetDistance) ||
    risk.gt(SCALP_LIMITS.maximumStopDistance) ||
    reward.div(risk).lt(SCALP_LIMITS.minimumRiskReward)
  )
    throw new Error("SCALP_PROTECTION_INVALID");
  const cost = quickOcoCost(metadata, e, t, decimal(volume));
  if (cost.netPrice.lt(decimal(metadata.pipSize).mul(QUICK_OCO.netTargetPips)))
    throw new Error("SCALP_NET_OBJECTIVE_UNAFFORDABLE");
  return cost.evidence;
}

/** Validate supplied exits; never replace, widen or reprice model geometry. */
export function directionalScalpTransform(input: {
  snapshot: MarketSnapshot;
  response: ModelResponse;
  maximumStopDistance: string;
  side?: "BUY" | "SELL";
}) {
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
