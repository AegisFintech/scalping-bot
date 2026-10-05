import { expect, it } from "vitest";
import {
  diagnosticObservation,
  diagnosticReport,
  diagnosticWindow,
  type DiagnosticRow,
} from "../../packages/evaluation/src/trading-diagnostics.js";
export const row: DiagnosticRow = {
  direction: "LONG",
  opened_at: "2026-10-02T01:00:00Z",
  closed_at: "2026-10-02T02:00:00Z",
  intent_at: "2026-10-02T00:59:00Z",
  decided_at: "2026-10-02T00:58:00Z",
  net: "-12",
  fees: "-2",
  risk_budget: "5",
  model_level: "100",
  effective_entry: "101",
  ema_alignment: null,
  equity: "1000",
  expected_volume: "2",
  fills: [
    { price: "101", volume: "1" },
    { price: "103", volume: "1" },
  ],
  protection: { samples: 1, verified: 1, missingStop: 0 },
  close_evidence: [
    {
      gross: "-10",
      swap: "0",
      commission: "-2",
      conversion: "0",
      order_type: 4,
    },
  ],
};
it("keeps matched fill VWAP, signed costs and pre-intent equity distinct from stop risk", () => {
  const result = diagnosticObservation(row);
  expect(result).toMatchObject({
    entryFillVwap: "102",
    filledVolume: "2",
    netOverPreIntentEquityPercent: "-1.2",
    approvedLegBudget: "5",
    actualFilledStopRisk: null,
    exactExitReason: null,
    providerCost: null,
    closeEvidenceStatus: "MATCHED",
    exitMechanism: "NATIVE_PROTECTION",
    verifiedProtectionSamples: 1,
  });
});
it("never accepts late equity, partial fills or post-close protection as historical proof", () => {
  expect(
    diagnosticObservation({
      ...row,
      decided_at: row.opened_at,
      fills: [row.fills[0]!],
      protection: { samples: 0, verified: 0, missingStop: 0 },
    }),
  ).toMatchObject({
    preIntentEquity: null,
    entryFillVwap: null,
    fillEvidenceStatus: "PARTIAL_OR_MISMATCHED",
    protectionEvidenceStatus: "MISSING",
  });
});
it("retains unknown measurements instead of filling them with zero", () => {
  expect(
    diagnosticObservation({
      ...row,
      equity: null,
      fills: [],
      protection: null,
      close_evidence: [],
    }),
  ).toMatchObject({
    preIntentEquity: null,
    entryFillVwap: null,
    closeEvidenceStatus: "MISSING",
    costComponents: null,
  });
});
it("rejects invalid fills, oversized windows and mismatched cohorts", () => {
  expect(() =>
    diagnosticObservation({ ...row, fills: [{ price: "0", volume: "1" }] }),
  ).toThrow("DIAGNOSTIC_FILL_INVALID");
  expect(() =>
    diagnosticWindow([
      "0.3.0-fade-limit.3",
      "2026-08-01T00:00:00Z",
      "2026-10-01T00:00:00Z",
    ]),
  ).toThrow();
  expect(() =>
    diagnosticReport(
      ["0.3.0-fade-limit.3", "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z"],
      [row],
    ),
  ).toThrow("DIAGNOSTIC_COHORT_MISMATCH");
});
it("rejects impossible protection counts and oversized fill evidence", () => {
  expect(() =>
    diagnosticObservation({
      ...row,
      protection: { samples: 1, verified: 2, missingStop: 0 },
    }),
  ).toThrow("DIAGNOSTIC_PROTECTION_INVALID");
  expect(() =>
    diagnosticObservation({
      ...row,
      fills: Array.from({ length: 1001 }, () => ({ price: "1", volume: "1" })),
    }),
  ).toThrow("DIAGNOSTIC_EVIDENCE_TOO_LARGE");
});
