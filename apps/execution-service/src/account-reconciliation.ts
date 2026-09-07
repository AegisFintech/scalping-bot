import type {
  AccountAdapter,
  AccountState,
} from "../../../packages/contracts/src/index.js";

const FAILURE_CODES = new Set([
  "CTRADER_ACCOUNT_PNL_INCOMPLETE",
  "CTRADER_USED_MARGIN_UNKNOWN",
  "CTRADER_ACCOUNT_NOT_AUTHENTICATED",
  "CTRADER_NOT_CONNECTED",
  "CTRADER_TRANSPORT_CLOSED",
  "CTRADER_CONNECTION_LOST_RECONCILIATION_REQUIRED",
  "CTRADER_REQUEST_REJECTED",
  "CTRADER_TRADE_DATA_INVALID",
  "CTRADER_OBJECT_INVALID",
]);

/** Return only known codes, never a broker body, identifier or arbitrary exception. */
export function accountFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "ACCOUNT_RECONCILIATION_FAILED";
  if (FAILURE_CODES.has(error.message)) return error.message;
  if (/^CTRADER_REQUEST_TIMEOUT:(2121|2124|2187)$/.test(error.message))
    return error.message;
  if (error.message.startsWith("CTRADER_FIELD_INVALID:"))
    return "CTRADER_ACCOUNT_FIELD_INVALID";
  return "ACCOUNT_RECONCILIATION_FAILED";
}

export async function reconcileAccountSafely(
  account: Pick<AccountAdapter, "reconcile">,
  symbolId: string,
  report: (reason: string) => void,
  now = () => new Date().toISOString(),
): Promise<AccountState> {
  try {
    return await account.reconcile(symbolId);
  } catch (error) {
    const reason = accountFailureCode(error);
    report(reason);
    return {
      reconciledAt: now(),
      certain: false,
      equity: "0",
      balance: "0",
      availableMargin: "0",
      relevantPositionCount: 0,
      relevantPendingOrderCount: 0,
      hasPartialFill: false,
      hasCancellationPending: false,
      reasonCodes: [...new Set(["ACCOUNT_RECONCILIATION_FAILED", reason])],
    };
  }
}
