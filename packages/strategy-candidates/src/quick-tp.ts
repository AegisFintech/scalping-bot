import { Decimal } from "decimal.js";
import type { ModelResponse } from "../../contracts/src/index.js";
import {
  canonical,
  decimal,
  evaluateCommissionCoverage,
  isTickAligned,
  minimumFeeBufferedTarget,
  type CommissionCoverageEvidence,
} from "../../risk-engine/src/index.js";
import {
  buildBreakoutCandidate,
  type BreakoutCandidateInput,
} from "./breakout.js";

/** Frozen proposal constants, not operator environment tuning knobs. */
export const QUICK_TP_CANDIDATE = {
  version: "breakout-quick-tp-candidate-1.0",
  authority: "RESEARCH_ONLY",
  slAtr: "2.5",
  maximumTpAtr: "2",
  minimumNetToFees: "1.5",
  netStopFraction: "0.1",
  entryReservePoints: "30",
  exitReservePoints: "65",
} as const;

export interface QuickTpCandidateInput extends BreakoutCandidateInput {
  readonly atr: string;
  readonly maximumStopDistance: string;
  /** Already approved exact quantities for conditional evaluation; never resized here. */
  readonly volumes: { readonly buy: string; readonly sell: string };
}
export interface QuickTpCandidateResult {
  readonly version: typeof QUICK_TP_CANDIDATE.version;
  readonly authority: "RESEARCH_ONLY";
  readonly accepted: boolean;
  readonly reasonCodes: readonly string[];
  readonly response: ModelResponse | null;
  readonly evidence: readonly CommissionCoverageEvidence[];
}

/** Small native broker TP; no quote-triggered market close or promotion authority. */
export function buildQuickTpCandidate(
  input: QuickTpCandidateInput,
): QuickTpCandidateResult {
  const reject = (reasons: readonly string[]): QuickTpCandidateResult => ({
    version: QUICK_TP_CANDIDATE.version,
    authority: "RESEARCH_ONLY",
    accepted: false,
    reasonCodes: reasons,
    response: null,
    evidence: [],
  });
  const breakout = buildBreakoutCandidate(input);
  if (!breakout.accepted || breakout.response === null)
    return reject(breakout.reasonCodes);
  try {
    const { metadata } = input;
    const tick = decimal(metadata.tickSize),
      pip = decimal(metadata.pipSize);
    const atr = decimal(input.atr);
    if (atr.lte(0) || pip.lte(0)) throw new Error("invalid ATR");
    // Stop rounds inward. Never increase an unaffordable stop or approved volume.
    const stopDistance = atr
      .mul(QUICK_TP_CANDIDATE.slAtr)
      .div(tick)
      .floor()
      .mul(tick);
    const minDistance = Decimal.max(tick, decimal(metadata.minStopDistance));
    if (
      stopDistance.lt(minDistance) ||
      stopDistance.gt(decimal(input.maximumStopDistance))
    )
      return reject(["QUICK_TP_STOP_UNAFFORDABLE_OR_INVALID"]);
    const maximumTarget = atr
      .mul(QUICK_TP_CANDIDATE.maximumTpAtr)
      .div(pip)
      .floor()
      .mul(pip);
    const reserve = tick.mul(
      decimal(QUICK_TP_CANDIDATE.entryReservePoints).plus(
        QUICK_TP_CANDIDATE.exitReservePoints,
      ),
    );
    const response = structuredClone(breakout.response);
    const evidence: CommissionCoverageEvidence[] = [];
    for (const [side, leg, volumeText] of [
      ["BUY", response.buy_stop, input.volumes.buy],
      ["SELL", response.sell_stop, input.volumes.sell],
    ] as const) {
      const volume = decimal(volumeText),
        entry = decimal(leg.entry_price);
      const step = decimal(metadata.volumeStep);
      if (
        step.lte(0) ||
        !volume.isInteger() ||
        volume.lt(decimal(metadata.minVolume)) ||
        volume.gt(decimal(metadata.maxVolume)) ||
        !volume.mod(step).isZero()
      )
        return reject(["QUICK_TP_APPROVED_VOLUME_INVALID"]);
      // Exact-volume fee floor; adverse reserves + 0.10 original SL are additional.
      const feeFloor = minimumFeeBufferedTarget({
        side,
        entryPrice: leg.entry_price,
        volume: volumeText,
        minimumTakeProfitDistance: canonical(minDistance),
        maximumTakeProfitDistance: canonical(maximumTarget),
        minimumExpectedNetToFeesRatio: QUICK_TP_CANDIDATE.minimumNetToFees,
        metadata,
      });
      if (!feeFloor.approved || feeFloor.evidence === null)
        return reject(feeFloor.reasonCodes);
      const distance = decimal(feeFloor.evidence.take_profit)
        .minus(entry)
        .abs()
        .plus(reserve)
        .plus(stopDistance.mul(QUICK_TP_CANDIDATE.netStopFraction))
        .div(pip)
        .ceil()
        .mul(pip);
      if (distance.gt(maximumTarget))
        return reject(["QUICK_TP_COSTS_EXCEED_TARGET_CAP"]);
      const stop =
        side === "BUY" ? entry.minus(stopDistance) : entry.plus(stopDistance);
      const target =
        side === "BUY" ? entry.plus(distance) : entry.minus(distance);
      if (
        stop.lte(0) ||
        target.lte(0) ||
        !isTickAligned(stop, tick) ||
        !isTickAligned(target, tick)
      )
        return reject(["QUICK_TP_GEOMETRY_INVALID"]);
      const coverage = evaluateCommissionCoverage({
        side,
        entryPrice: leg.entry_price,
        takeProfit: canonical(target),
        volume: volumeText,
        minimumExpectedNetToFeesRatio: QUICK_TP_CANDIDATE.minimumNetToFees,
        metadata,
      });
      if (!coverage.approved || coverage.evidence === null)
        return reject(coverage.reasonCodes);
      evidence.push(coverage.evidence);
      Object.assign(leg, {
        stop_loss: canonical(stop),
        invalidation_price: canonical(stop),
        take_profit: canonical(target),
        risk_reward_ratio: canonical(
          distance.div(stopDistance).toDecimalPlaces(10, Decimal.ROUND_DOWN),
        ),
      });
    }
    return {
      version: QUICK_TP_CANDIDATE.version,
      authority: "RESEARCH_ONLY",
      accepted: true,
      reasonCodes: [],
      response,
      evidence,
    };
  } catch {
    return reject(["QUICK_TP_INPUT_INVALID"]);
  }
}
