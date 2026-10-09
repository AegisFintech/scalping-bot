import type { Decimal } from "decimal.js";
import { z } from "zod";
import { signedDecimal } from "../../risk-engine/src/decimal.js";
import {
  diagnosticObservation,
  diagnosticReport,
  type DiagnosticRow,
} from "./trading-diagnostics.js";

const decimalText = z.string().refine((s) => {
  try {
    signedDecimal(s);
    return true;
  } catch {
    return false;
  }
});
const estimateSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  entry_price: decimalText,
  take_profit: decimalText,
  volume: decimalText,
  gross_profit: decimalText,
  opening_commission: decimalText,
  closing_commission: decimalText,
  pnl_conversion_fee: decimalText,
  total_estimated_fees: decimalText,
  expected_net_profit: decimalText,
});
export interface CostPayoffRow extends DiagnosticRow {
  intended_stop: string | null;
  intended_target: string | null;
  fee_evidence: readonly { validated_at: string; estimate: unknown }[];
}
const number = (s: string) => signedDecimal(s, "COST_AUDIT_DECIMAL_INVALID");
const text = (d: Decimal) => d.toDecimalPlaces(10).toFixed();
export function costPayoffObservation(row: CostPayoffRow) {
  const base = diagnosticObservation(row);
  if (row.fee_evidence.length > 1000)
    throw new Error("COST_AUDIT_EVIDENCE_TOO_LARGE");
  const entry =
    row.effective_entry === null ? null : number(row.effective_entry);
  const stop = row.intended_stop === null ? null : number(row.intended_stop);
  const target =
    row.intended_target === null ? null : number(row.intended_target);
  const sign = row.direction === "LONG" ? 1 : -1;
  const geometry =
    entry !== null &&
    stop !== null &&
    target !== null &&
    stop.gt(0) &&
    target.gt(0) &&
    entry.minus(stop).mul(sign).gt(0) &&
    target.minus(entry).mul(sign).gt(0);
  const candidate =
    row.fee_evidence.length === 1 ? row.fee_evidence[0] : undefined;
  const parsed = estimateSchema.safeParse(candidate?.estimate);
  let estimate = null;
  if (
    parsed.success &&
    candidate !== undefined &&
    geometry &&
    base.filledVolume !== null
  ) {
    const e = parsed.data;
    const time = Date.parse(candidate.validated_at);
    const fees = number(e.opening_commission)
      .plus(number(e.closing_commission))
      .plus(number(e.pnl_conversion_fee));
    if (
      Number.isFinite(time) &&
      time <= Date.parse(row.intent_at) &&
      e.side === (row.direction === "LONG" ? "BUY" : "SELL") &&
      number(e.entry_price).eq(entry) &&
      number(e.take_profit).eq(target) &&
      number(e.volume).eq(base.filledVolume) &&
      number(e.volume).gt(0) &&
      [
        e.gross_profit,
        e.opening_commission,
        e.closing_commission,
        e.pnl_conversion_fee,
      ].every((s) => number(s).gte(0)) &&
      fees.eq(number(e.total_estimated_fees)) &&
      number(e.gross_profit).minus(fees).eq(number(e.expected_net_profit))
    )
      estimate = e;
  }
  const modeledCommission =
    estimate === null
      ? null
      : number(estimate.opening_commission).plus(
          number(estimate.closing_commission),
        );
  const actualCommission =
    base.costComponents === null
      ? null
      : number(base.costComponents.commission).neg();
  return {
    ...base,
    intendedStop: row.intended_stop,
    intendedTarget: row.intended_target,
    intendedGeometryStatus: geometry ? "VALID" : "MISSING_OR_INVALID",
    intendedTargetToStopDistanceRatio: geometry
      ? text(target.minus(entry).abs().div(entry.minus(stop).abs()))
      : null,
    adverseEntrySlippagePrice:
      entry !== null && base.entryFillVwap !== null
        ? text(number(base.entryFillVwap).minus(entry).mul(sign))
        : null,
    feeEstimateStatus:
      estimate !== null
        ? "PRE_INTENT_EXACT_VOLUME_MATCHED"
        : row.fee_evidence.length === 0
          ? "MISSING"
          : "AMBIGUOUS_OR_MISMATCHED",
    modeledTargetGross: estimate?.gross_profit ?? null,
    modeledTargetNet: estimate?.expected_net_profit ?? null,
    modeledTargetFees: estimate?.total_estimated_fees ?? null,
    modeledRoundTripCommission:
      modeledCommission === null ? null : text(modeledCommission),
    actualCommissionCost:
      actualCommission === null ? null : text(actualCommission),
    actualMinusModeledCommission:
      actualCommission !== null && modeledCommission !== null
        ? text(actualCommission.minus(modeledCommission))
        : null,
  };
}
export function costPayoffReport(
  args: readonly string[],
  rows: readonly CostPayoffRow[],
) {
  const base = diagnosticReport(args, rows);
  return {
    ...base,
    reportVersion: "cost-payoff-audit-1.0" as const,
    promotionAuthority: false as const,
    observations: rows.map(costPayoffObservation),
  };
}
