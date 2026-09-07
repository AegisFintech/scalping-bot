import { stringField } from "./protocol.js";

/** Every open position needs P/L; brokers can also report zero P/L for pending position IDs. */
export function validateAccountPnlEvidence(
  positions: readonly Record<string, unknown>[],
  pnl: readonly Record<string, unknown>[],
  orders: readonly Record<string, unknown>[] = [],
): void {
  const expected = positions.map((p) => stringField(p, "positionId"));
  const supplied = pnl.map((p) => stringField(p, "positionId"));
  if (
    new Set(expected).size !== expected.length ||
    new Set(supplied).size !== supplied.length ||
    expected.some((id) => !supplied.includes(id))
  )
    throw new Error("CTRADER_ACCOUNT_PNL_INCOMPLETE");

  for (const row of pnl) {
    const id = stringField(row, "positionId");
    if (expected.includes(id)) continue;
    // A pending order reserves a position identity without opening a position.
    // Require explicit broker evidence: one accepted, wholly unfilled order and
    // exactly zero gross AND net P/L. Never suppress unpriced open exposure.
    const matches = orders.filter(
      (order) =>
        order.positionId != null && stringField(order, "positionId") === id,
    );
    const pending = matches[0];
    if (
      matches.length !== 1 ||
      pending === undefined ||
      stringField(pending, "orderStatus") !== "1" ||
      stringField(pending, "executedVolume") !== "0" ||
      stringField(row, "grossUnrealizedPnL") !== "0" ||
      stringField(row, "netUnrealizedPnL") !== "0"
    )
      throw new Error("CTRADER_ACCOUNT_PNL_INCOMPLETE");
  }
}
