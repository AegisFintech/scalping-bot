import type { PendingOrderCommand } from "./index.js";

/** Omitted lifetime is the historical GTD contract, never implicit GTC. */
export function orderTimeInForce(
  command: Pick<PendingOrderCommand, "timeInForce">,
): "GTC" | "GTD" {
  const value = command.timeInForce ?? "GTD";
  if (value !== "GTC" && value !== "GTD")
    throw new Error("ORDER_TIME_IN_FORCE_INVALID");
  return value;
}

/** Even a non-expiring pending order must be submitted from a fresh authorization. */
export function validateSubmissionDeadline(
  command: PendingOrderCommand,
  now = Date.now(),
): void {
  orderTimeInForce(command);
  const expiry = Date.parse(command.expiresAt);
  if (
    !/(Z|[+-]\d{2}:\d{2})$/.test(command.expiresAt) ||
    !Number.isSafeInteger(expiry) ||
    expiry <= now
  )
    throw new Error("ORDER_SUBMISSION_EXPIRED_OR_INVALID");
}

export function pendingOrderExpiresAt(
  command: PendingOrderCommand,
): string | null {
  return orderTimeInForce(command) === "GTC" ? null : command.expiresAt;
}
