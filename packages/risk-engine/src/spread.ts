import { canonical, decimal } from "./decimal.js";

export interface SpreadInput {
  readonly bid: string;
  readonly ask: string;
  readonly tickSize: string;
  readonly atr: string;
  readonly maxPoints: string | null;
  readonly maxAtrRatio: string | null;
  readonly observedPercentile: string | null;
  readonly maxPercentile: string | null;
  readonly sessionAbnormal: boolean;
  readonly liveMode: boolean;
}

export interface SpreadDecision {
  readonly approved: boolean;
  readonly spreadPoints: string | null;
  readonly spreadAtrRatio: string | null;
  readonly reasonCodes: readonly string[];
}

export function checkSpread(input: SpreadInput): SpreadDecision {
  try {
    if (
      input.liveMode &&
      input.maxPoints === null &&
      input.maxAtrRatio === null &&
      input.maxPercentile === null
    ) {
      return {
        approved: false,
        spreadPoints: null,
        spreadAtrRatio: null,
        reasonCodes: ["SPREAD_PROTECTION_REQUIRED"],
      };
    }
    const spread = decimal(input.ask).minus(decimal(input.bid));
    const points = spread.div(decimal(input.tickSize));
    const atrRatio = spread.div(decimal(input.atr));
    const reasons: string[] = [];
    if (spread.lt(0)) reasons.push("SPREAD_CROSSED");
    if (input.sessionAbnormal) reasons.push("SPREAD_SESSION_ABNORMAL");
    if (input.maxPoints !== null && points.gt(decimal(input.maxPoints)))
      reasons.push("SPREAD_POINTS_EXCEEDED");
    if (input.maxAtrRatio !== null && atrRatio.gt(decimal(input.maxAtrRatio)))
      reasons.push("SPREAD_ATR_EXCEEDED");
    if (
      input.maxPercentile !== null &&
      (input.observedPercentile === null ||
        decimal(input.observedPercentile).gt(decimal(input.maxPercentile)))
    ) {
      reasons.push(
        input.observedPercentile === null
          ? "SPREAD_HISTORY_MISSING"
          : "SPREAD_PERCENTILE_EXCEEDED",
      );
    }
    return {
      approved: reasons.length === 0,
      spreadPoints: canonical(points),
      spreadAtrRatio: canonical(atrRatio),
      reasonCodes: reasons,
    };
  } catch {
    return {
      approved: false,
      spreadPoints: null,
      spreadAtrRatio: null,
      reasonCodes: ["SPREAD_INPUT_INVALID"],
    };
  }
}
