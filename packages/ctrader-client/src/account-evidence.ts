import { stringField } from "./protocol.js";

/** A missing or duplicated P/L row must not manufacture spendable equity. */
export function validateAccountPnlEvidence(
  positions: readonly Record<string, unknown>[],
  pnl: readonly Record<string, unknown>[],
): void {
  const expected = positions.map((p) => stringField(p, "positionId"));
  const supplied = pnl.map((p) => stringField(p, "positionId"));
  if (
    new Set(expected).size !== expected.length ||
    new Set(supplied).size !== supplied.length ||
    expected.length !== supplied.length ||
    supplied.some((id) => !expected.includes(id))
  )
    throw new Error("CTRADER_ACCOUNT_PNL_INCOMPLETE");
}
