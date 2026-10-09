import { expect, it } from "vitest";
import {
  costPayoffObservation,
  costPayoffReport,
} from "../../packages/evaluation/src/cost-payoff-audit.js";
import { row, auditRow } from "../fixtures/cost-payoff-audit.js";

it("compares exact historical estimates with signed close commission without inventing actual stop risk", () => {
  expect(costPayoffObservation(auditRow)).toMatchObject({
    feeEstimateStatus: "PRE_INTENT_EXACT_VOLUME_MATCHED",
    actualMinusModeledCommission: "0.1",
    intendedTargetToStopDistanceRatio: "0.5",
    adverseEntrySlippagePrice: "1",
    actualFilledStopRisk: null,
    exactExitReason: null,
    providerCost: null,
  });
});
it("signs long and short slippage consistently and permits favorable fills", () => {
  const short = {
    ...auditRow,
    direction: "SHORT" as const,
    intended_stop: "103",
    intended_target: "100",
  };
  expect(costPayoffObservation(short).adverseEntrySlippagePrice).toBe("-1");
  expect(
    costPayoffObservation({
      ...auditRow,
      fills: [{ price: "100", volume: "2" }],
    }).adverseEntrySlippagePrice,
  ).toBe("-1");
});
it("censors missing, ambiguous, late, wrong-volume and internally inconsistent estimates", () => {
  const evidence = auditRow.fee_evidence[0]!;
  const estimate = evidence.estimate as Record<string, unknown>;
  for (const fee_evidence of [
    [],
    [evidence, evidence],
    [{ ...evidence, validated_at: row.opened_at }],
    [{ ...evidence, estimate: { ...estimate, volume: "1" } }],
    [{ ...evidence, estimate: { ...estimate, total_estimated_fees: "0" } }],
    [{ ...evidence, estimate: { ...estimate, entry_price: "100" } }],
    [{ ...evidence, estimate: { ...estimate, side: "SELL" } }],
    [{ ...evidence, estimate: { ...estimate, opening_commission: "-1" } }],
    [{ ...evidence, estimate: { ...estimate, gross_profit: "NaN" } }],
  ]) {
    expect(
      costPayoffObservation({ ...auditRow, fee_evidence }).modeledTargetNet,
    ).toBeNull();
  }
  expect(
    costPayoffObservation({ ...auditRow, fills: [] })
      .actualMinusModeledCommission,
  ).toBeNull();
  expect(
    costPayoffObservation({ ...auditRow, close_evidence: [] })
      .actualMinusModeledCommission,
  ).toBeNull();
});
it("rejects oversized evidence and censors invalid or missing intended geometry", () => {
  expect(() =>
    costPayoffObservation({
      ...auditRow,
      fee_evidence: Array.from(
        { length: 1001 },
        () => auditRow.fee_evidence[0]!,
      ),
    }),
  ).toThrow("COST_AUDIT_EVIDENCE_TOO_LARGE");
  for (const intended_stop of [null, "0", "102"])
    expect(
      costPayoffObservation({ ...auditRow, intended_stop })
        .intendedTargetToStopDistanceRatio,
    ).toBeNull();
  expect(() =>
    costPayoffReport(
      ["0.3.0-fade-limit.3", "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z"],
      [auditRow],
    ),
  ).toThrow("DIAGNOSTIC_COHORT_MISMATCH");
});
