import { expect, it } from "vitest";
import { validateAccountPnlEvidence } from "../../packages/ctrader-client/src/account-evidence.js";
it("requires one authoritative P/L row for every reconciled account position", () => {
  expect(() => validateAccountPnlEvidence([], [])).not.toThrow();
  expect(() =>
    validateAccountPnlEvidence([{ positionId: "1" }], [{ positionId: "1" }]),
  ).not.toThrow();
  for (const pnl of [
    [],
    [{ positionId: "2" }],
    [{ positionId: "1" }, { positionId: "1" }],
  ])
    expect(() =>
      validateAccountPnlEvidence([{ positionId: "1" }], pnl),
    ).toThrow("CTRADER_ACCOUNT_PNL_INCOMPLETE");
});
