import { Decimal } from "decimal.js";
import { canonical, decimal, signedDecimal } from "./decimal.js";

/** Account-wide remaining loss capacity, before allocating the OCO race budget. */
export function availableCapitalRiskPercent(
  equity: string,
  dailyRemaining: string,
  equityFloor: string | null,
): string {
  const current = decimal(equity);
  if (current.lte(0)) throw new Error("CAPITAL_EQUITY_INVALID");
  const remaining = Decimal.min(
    decimal(dailyRemaining),
    equityFloor === null
      ? current
      : Decimal.max(0, current.minus(decimal(equityFloor))),
  );
  return remaining
    .div(current)
    .mul(100)
    .toDecimalPlaces(10, Decimal.ROUND_DOWN)
    .toFixed();
}

export interface CapitalState {
  readonly referenceEquity: string;
  readonly highWaterEquity: string;
  readonly adjustedEquity: string;
  readonly cumulativeNetFlows: string;
  readonly drawdownPercent: string;
  readonly riskMultiplier: "0" | "0.25" | "0.5" | "1";
  readonly lockedOut: boolean;
}

export function capitalRisk(input: {
  readonly equity: string;
  readonly cumulativeNetFlows: string;
  readonly dailyLossPercent: string;
  readonly previous: CapitalState | null;
  readonly referenceEquity: string;
  readonly observedHighWater: string;
}): CapitalState {
  const equity = decimal(input.equity);
  const flows = signedDecimal(input.cumulativeNetFlows);
  const adjusted = equity.minus(flows);
  const reference = decimal(
    input.previous?.referenceEquity ?? input.referenceEquity,
  );
  const high = Decimal.max(
    reference,
    decimal(input.observedHighWater),
    decimal(input.previous?.highWaterEquity ?? input.referenceEquity),
    adjusted,
  );
  if (equity.lte(0) || reference.lte(0) || adjusted.lt(0))
    throw new Error("CAPITAL_STATE_INVALID");
  const drawdown = high.minus(adjusted).div(high).mul(100);
  const daily = decimal(input.dailyLossPercent);
  const locked = input.previous?.lockedOut === true || drawdown.gte(5);
  let multiplier: CapitalState["riskMultiplier"] = locked
    ? "0"
    : drawdown.gte(4) || daily.gte(0.75)
      ? "0.25"
      : drawdown.gte(2) || daily.gte(0.5)
        ? "0.5"
        : "1";
  // Hysteresis: recover only below both thresholds; restarting does not reset it.
  if (!locked && input.previous && !(drawdown.lt(1) && daily.lt(0.25))) {
    multiplier = Decimal.min(
      multiplier,
      input.previous.riskMultiplier,
    ).toFixed() as CapitalState["riskMultiplier"];
  }
  return {
    referenceEquity: canonical(reference),
    highWaterEquity: canonical(high),
    adjustedEquity: canonical(adjusted),
    cumulativeNetFlows: canonical(flows),
    drawdownPercent: drawdown.toDecimalPlaces(8, Decimal.ROUND_UP).toFixed(),
    riskMultiplier: multiplier,
    lockedOut: locked,
  };
}
