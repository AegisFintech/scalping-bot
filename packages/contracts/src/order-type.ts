import type { PendingOrderCommand } from "./index.js";

/** Omitted type retains the historical stop-limit adapter contract. */
export function pendingOrderType(
  command: Pick<PendingOrderCommand, "executionOrderType">,
): "STOP" | "STOP_LIMIT" {
  const value =
    command.executionOrderType === undefined
      ? "STOP_LIMIT"
      : command.executionOrderType;
  if (value !== "STOP" && value !== "STOP_LIMIT")
    throw new Error("ORDER_EXECUTION_TYPE_INVALID");
  return value;
}
