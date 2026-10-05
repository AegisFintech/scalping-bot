import { Decimal } from "decimal.js";
import { signedDecimal } from "../../risk-engine/src/decimal.js";
import {
  learningObservation,
  learningWindow,
  type LearningRow,
} from "./demo-learning.js";

/** Offline observations: no broker, inference or strategy promotion authority. */
export interface DiagnosticRow extends LearningRow {
  equity: string | null;
  intent_at: string;
  decided_at: string | null;
  expected_volume: string | null;
  fills: readonly { price: string; volume: string }[];
  protection: { samples: number; verified: number; missingStop: number } | null;
}
const value = (s: string) => signedDecimal(s, "DIAGNOSTIC_DECIMAL_INVALID");
const text = (d: Decimal) => d.toDecimalPlaces(10).toFixed();
export function diagnosticWindow(args: readonly string[]) {
  const window = learningWindow(args);
  if (Date.parse(window.until) - Date.parse(window.from) > 31 * 86400000)
    throw new Error("DIAGNOSTIC_WINDOW_TOO_LARGE");
  return window;
}
export function diagnosticObservation(row: DiagnosticRow) {
  if (row.fills.length > 1000) throw new Error("DIAGNOSTIC_EVIDENCE_TOO_LARGE");
  const base = learningObservation(row);
  const intent = Date.parse(row.intent_at);
  if (!Number.isFinite(intent) || intent > Date.parse(row.opened_at))
    throw new Error("DIAGNOSTIC_TIME_INVALID");
  const decided = row.decided_at === null ? NaN : Date.parse(row.decided_at);
  const equity = row.equity === null ? null : value(row.equity);
  const equityMatched =
    equity !== null &&
    equity.gt(0) &&
    Number.isFinite(decided) &&
    decided <= intent;
  let volume = new Decimal(0),
    weighted = new Decimal(0);
  for (const fill of row.fills) {
    const p = value(fill.price),
      v = value(fill.volume);
    if (p.lte(0) || v.lte(0)) throw new Error("DIAGNOSTIC_FILL_INVALID");
    volume = volume.plus(v);
    weighted = weighted.plus(p.mul(v));
  }
  const expected =
    row.expected_volume === null ? null : value(row.expected_volume);
  const fillMatched =
    expected !== null && expected.gt(0) && volume.eq(expected);
  const protection = row.protection;
  if (
    protection !== null &&
    (Object.values(protection).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      protection.verified > protection.samples ||
      protection.missingStop > protection.samples)
  )
    throw new Error("DIAGNOSTIC_PROTECTION_INVALID");
  return {
    ...base,
    equityEvidenceStatus: equityMatched
      ? "PRE_INTENT_MATCHED"
      : "MISSING_OR_INVALID",
    preIntentEquity: equityMatched ? text(equity) : null,
    netOverPreIntentEquityPercent: equityMatched
      ? text(value(row.net).div(equity).mul(100))
      : null,
    fillEvidenceStatus: fillMatched
      ? "VOLUME_MATCHED"
      : row.fills.length === 0
        ? "MISSING"
        : "PARTIAL_OR_MISMATCHED",
    filledVolume: fillMatched ? text(volume) : null,
    entryFillVwap: fillMatched ? text(weighted.div(volume)) : null,
    protectionEvidenceStatus:
      protection !== null && protection.samples > 0
        ? "OBSERVED_SAMPLES"
        : "MISSING",
    protectionSamples: protection?.samples ?? 0,
    verifiedProtectionSamples: protection?.verified ?? 0,
    missingStopSamples: protection?.missingStop ?? 0,
    actualFilledStopRisk: null,
    exactExitReason: null,
    providerCost: null,
  };
}
export function diagnosticReport(
  args: readonly string[],
  rows: readonly DiagnosticRow[],
) {
  const window = diagnosticWindow(args);
  if (rows.length > 10000) throw new Error("DIAGNOSTIC_WINDOW_TOO_LARGE");
  if (
    rows.some(
      (r) =>
        Date.parse(r.closed_at) < Date.parse(window.from) ||
        Date.parse(r.closed_at) >= Date.parse(window.until),
    )
  )
    throw new Error("DIAGNOSTIC_COHORT_MISMATCH");
  return {
    reportVersion: "trading-diagnostics-1.0" as const,
    label: "OBSERVED_DEMO_NOT_PORTFOLIO_RETURN" as const,
    ...window,
    equityBasis:
      "PER_TRADE_PRE_INTENT_RECONCILED_EQUITY_NOT_ACCOUNT_RETURN" as const,
    brokerAuthority: false as const,
    observations: rows.map(diagnosticObservation),
  };
}
