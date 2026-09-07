import { Decimal } from "decimal.js";
import type {
  AccountState,
  Quote,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { FIXED_DEFAULTS } from "../../config/src/policy.js";
import {
  canonical,
  decimal,
  isTickAligned,
  sizePosition,
  checkSpread,
  type PositionRiskDecision,
} from "../../risk-engine/src/index.js";
import { evaluateCommissionCoverage } from "../../risk-engine/src/commission.js";
import type { ScenarioEntry } from "./rules.js";
import { time } from "./plan.js";

// Freeze the historical directional-replay budget. Production risk-policy changes
// must not silently reprice earlier research evidence; this path has no broker authority.
const RESEARCH_SETUP_RISK_PERCENT = "0.001";

export interface ScenarioRiskContext {
  readonly account: AccountState;
  readonly metadata: SymbolMetadata;
  readonly atr: string;
  readonly observedSpreadPercentile: string | null;
  readonly spreadSamples: number;
  readonly sessionAbnormal: boolean;
  readonly riskMultiplier: "0" | "0.25" | "0.5" | "1";
  readonly remainingDailyBudget: string;
  readonly equityFloor: string;
  readonly maxPositionNotional: string;
  readonly estimatedMarginPerVolume: string;
  readonly entryAllowed: boolean;
}

export function admitEntry(
  entry: ScenarioEntry,
  quote: Quote,
  now: number,
  context: ScenarioRiskContext,
): PositionRiskDecision {
  const reject = (...reasonCodes: string[]): PositionRiskDecision => ({
    approved: false,
    reasonCodes,
    normalizedVolume: null,
    rawVolume: null,
    riskBudget: null,
    maximumLoss: null,
    estimatedMargin: null,
  });
  try {
    const c = context,
      a = c.account,
      m = c.metadata;
    if (!Number.isSafeInteger(now) || now < 0)
      return reject("SCENARIO_CONTEXT_STALE");
    if (now % 86_400_000 >= 86_400_000 - 900_000)
      return reject("SCENARIO_FINANCING_WINDOW");
    if (
      !c.entryAllowed ||
      !a.certain ||
      a.reasonCodes.length ||
      a.hasPartialFill ||
      a.hasCancellationPending ||
      a.relevantPositionCount !== 0 ||
      a.relevantPendingOrderCount !== 0
    )
      return reject("SCENARIO_ACCOUNT_BLOCKED");
    if (
      now - time(a.reconciledAt) < 0 ||
      now - time(a.reconciledAt) > 3000 ||
      now - time(m.metadataTime) < 0 ||
      now - time(m.metadataTime) > 86_400_000 ||
      now - time(quote.sourceTime) < 0 ||
      now - time(quote.sourceTime) > 3000 ||
      time(quote.receivedAt) < time(quote.sourceTime) ||
      time(quote.receivedAt) > now
    )
      return reject("SCENARIO_CONTEXT_STALE");
    if (
      decimal(c.equityFloor).lte(0) ||
      decimal(a.equity).lte(c.equityFloor) ||
      decimal(c.maxPositionNotional).lte(0) ||
      decimal(c.remainingDailyBudget).lte(0) ||
      !["1", "0.5", "0.25"].includes(c.riskMultiplier)
    )
      return reject("SCENARIO_CAPITAL_BLOCKED");
    const spread = checkSpread({
      bid: quote.bid,
      ask: quote.ask,
      tickSize: m.tickSize,
      atr: c.atr,
      maxPoints: FIXED_DEFAULTS.MAX_SPREAD_POINTS,
      maxAtrRatio: FIXED_DEFAULTS.MAX_SPREAD_ATR_RATIO,
      observedPercentile:
        Number.isSafeInteger(c.spreadSamples) && c.spreadSamples >= 30
          ? c.observedSpreadPercentile
          : null,
      maxPercentile: FIXED_DEFAULTS.MAX_SPREAD_PERCENTILE,
      sessionAbnormal: c.sessionAbnormal,
      liveMode: false,
    });
    if (!spread.approved) return reject(...spread.reasonCodes);
    const price = decimal(entry.entry),
      stop = decimal(entry.stop),
      target = decimal(entry.target);
    if (
      [price, stop, target, decimal(quote.bid), decimal(quote.ask)].some(
        (p) => p.lte(0) || !isTickAligned(p, decimal(m.tickSize)),
      )
    )
      return reject("SCENARIO_PRICE_PRECISION_INVALID");
    const minimum = Decimal.max(m.tickSize, m.minStopDistance),
      risk = price.minus(stop).abs();
    if (
      entry.side === "BUY"
        ? price.lt(decimal(quote.ask).plus(minimum))
        : price.gt(decimal(quote.bid).minus(minimum))
    )
      return reject("SCENARIO_ENTRY_ALREADY_PASSED");
    if (
      (entry.side === "BUY"
        ? !(stop.lt(price) && target.gt(price))
        : !(stop.gt(price) && target.lt(price))) ||
      risk.lt(minimum) ||
      target.minus(price).abs().lt(minimum) ||
      risk.gt(decimal(c.atr).mul(FIXED_DEFAULTS.MAX_STOP_DISTANCE_ATR)) ||
      price
        .minus(entry.side === "BUY" ? quote.ask : quote.bid)
        .abs()
        .gt(decimal(c.atr).mul(FIXED_DEFAULTS.MAX_ENTRY_DISTANCE_ATR)) ||
      target
        .minus(price)
        .abs()
        .div(risk)
        .lt(FIXED_DEFAULTS.MIN_RISK_REWARD_RATIO)
    )
      return reject("SCENARIO_EXIT_GEOMETRY_INVALID");
    // Retain the existing half-setup ceiling even for a single confirmed leg.
    const percent = Decimal.min(
      decimal(RESEARCH_SETUP_RISK_PERCENT).mul(c.riskMultiplier).div(2),
      decimal(c.remainingDailyBudget).div(a.equity).mul(100),
    ).toDecimalPlaces(8, Decimal.ROUND_DOWN);
    const decision = sizePosition({
      equity: a.equity,
      availableMargin: a.availableMargin,
      baseRiskPercent: canonical(percent),
      maxRiskPercent: RESEARCH_SETUP_RISK_PERCENT,
      entryPrice: entry.entry,
      stopLoss: entry.stop,
      estimatedMarginPerVolume: c.estimatedMarginPerVolume,
      currentMargin: canonical(
        Decimal.max(0, decimal(a.equity).minus(a.availableMargin)),
      ),
      maxMarginUsagePercent: FIXED_DEFAULTS.MAX_MARGIN_USAGE_PERCENT,
      maxPositionNotional: c.maxPositionNotional,
      metadata: m,
      adverseSlippagePoints: "10",
    });
    if (!decision.approved || decision.normalizedVolume === null)
      return decision;
    const fees = evaluateCommissionCoverage({
      side: entry.side,
      entryPrice: entry.entry,
      takeProfit: entry.target,
      volume: decision.normalizedVolume,
      minimumExpectedNetToFeesRatio:
        FIXED_DEFAULTS.MIN_EXPECTED_NET_TO_FEES_RATIO,
      metadata: m,
    });
    return fees.approved ? decision : reject(...fees.reasonCodes);
  } catch {
    return reject("SCENARIO_ADMISSION_INVALID");
  }
}
