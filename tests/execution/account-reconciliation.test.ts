import { expect, it, vi } from "vitest";
import {
  accountFailureCode,
  reconcileAccountSafely,
} from "../../apps/execution-service/src/account-reconciliation.js";
import type { AccountState } from "../../packages/contracts/src/index.js";

it("preserves reconciled pending exposure without creating an account failure", async () => {
  const state: AccountState = {
    reconciledAt: "2026-09-07T12:00:00.000Z",
    certain: true,
    equity: "10000",
    balance: "10000",
    availableMargin: "10000",
    relevantPositionCount: 0,
    relevantPendingOrderCount: 2,
    hasPartialFill: false,
    hasCancellationPending: false,
    reasonCodes: [],
  };
  const report = vi.fn();
  expect(
    await reconcileAccountSafely(
      { reconcile: () => Promise.resolve(state) },
      "7",
      report,
    ),
  ).toBe(state);
  expect(report).not.toHaveBeenCalled();
});

it("retains the known cause while returning no spendable equity on failure", async () => {
  const report = vi.fn();
  const state = await reconcileAccountSafely(
    {
      reconcile: () =>
        Promise.reject(new Error("CTRADER_ACCOUNT_PNL_INCOMPLETE")),
    },
    "7",
    report,
  );
  expect(state).toMatchObject({
    certain: false,
    equity: "0",
    availableMargin: "0",
    reasonCodes: [
      "ACCOUNT_RECONCILIATION_FAILED",
      "CTRADER_ACCOUNT_PNL_INCOMPLETE",
    ],
  });
  expect(report).toHaveBeenCalledWith("CTRADER_ACCOUNT_PNL_INCOMPLETE");
});

it.each([
  ["CTRADER_REQUEST_TIMEOUT:2187", "CTRADER_REQUEST_TIMEOUT:2187"],
  ["CTRADER_FIELD_INVALID:private-value", "CTRADER_ACCOUNT_FIELD_INVALID"],
  ["CTRADER_REQUEST_TIMEOUT:123456789", "ACCOUNT_RECONCILIATION_FAILED"],
  ["PRIVATE_CREDENTIAL_VALUE", "ACCOUNT_RECONCILIATION_FAILED"],
  ["connection to private-host failed", "ACCOUNT_RECONCILIATION_FAILED"],
])("redacts account exceptions %s", (message, expected) => {
  expect(accountFailureCode(new Error(message))).toBe(expected);
});
