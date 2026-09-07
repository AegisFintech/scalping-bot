import { describe, expect, it } from "vitest";
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

const pending = {
  positionId: 101,
  orderStatus: 1,
  executedVolume: 0,
};
const zeroPnl = {
  positionId: 101,
  grossUnrealizedPnL: 0,
  netUnrealizedPnL: 0,
};

describe("broker P/L records for unfilled pending orders", () => {
  it("accepts two zero-P/L records linked to a confirmed unfilled OCO pair", () => {
    expect(() =>
      validateAccountPnlEvidence(
        [],
        [zeroPnl, { ...zeroPnl, positionId: 102 }],
        [pending, { ...pending, positionId: 102 }],
      ),
    ).not.toThrow();
    // A broker may omit these rows. They are optional only for unfilled orders.
    expect(() => validateAccountPnlEvidence([], [], [pending])).not.toThrow();
  });
  it("still requires P/L for an open position when other pending records are present", () => {
    expect(() =>
      validateAccountPnlEvidence([{ positionId: 200 }], [zeroPnl], [pending]),
    ).toThrow("CTRADER_ACCOUNT_PNL_INCOMPLETE");
    expect(() =>
      validateAccountPnlEvidence(
        [{ positionId: 200 }],
        [
          zeroPnl,
          { positionId: 200, grossUnrealizedPnL: -15, netUnrealizedPnL: -20 },
        ],
        [pending],
      ),
    ).not.toThrow();
  });
  it.each([
    [{ ...pending, executedVolume: 1 }],
    [{ ...pending, orderStatus: 2 }],
    [{ ...pending, orderStatus: 5 }],
    [{ ...pending, positionId: 999 }],
    [pending, { ...pending }],
    [],
  ])(
    "rejects unknown, partial, terminal or ambiguous pending evidence: %j",
    (...orders) => {
      expect(() => validateAccountPnlEvidence([], [zeroPnl], orders)).toThrow(
        "CTRADER_ACCOUNT_PNL_INCOMPLETE",
      );
    },
  );
  it.each([
    { ...zeroPnl, netUnrealizedPnL: -1 },
    { ...zeroPnl, grossUnrealizedPnL: 1 },
    { ...zeroPnl, netUnrealizedPnL: 1 },
  ])("rejects nonzero P/L even with a matching unfilled order: %j", (row) => {
    expect(() => validateAccountPnlEvidence([], [row], [pending])).toThrow(
      "CTRADER_ACCOUNT_PNL_INCOMPLETE",
    );
  });
  it("rejects duplicate P/L and absent executed-volume evidence", () => {
    expect(() =>
      validateAccountPnlEvidence([], [zeroPnl, zeroPnl], [pending]),
    ).toThrow("CTRADER_ACCOUNT_PNL_INCOMPLETE");
    expect(() =>
      validateAccountPnlEvidence(
        [],
        [zeroPnl],
        [{ positionId: 101, orderStatus: 1 }],
      ),
    ).toThrow("CTRADER_FIELD_INVALID:executedVolume");
  });
});
