import type { PendingOrderCommand } from "./index.js";

export type PendingExecutionOrderType = "STOP" | "STOP_LIMIT" | "LIMIT";

/** Omitted type retains the historical stop-limit adapter contract. */
export function pendingOrderType(
  command: Pick<PendingOrderCommand, "executionOrderType">,
): PendingExecutionOrderType {
  const value =
    command.executionOrderType === undefined
      ? "STOP_LIMIT"
      : command.executionOrderType;
  if (value !== "STOP" && value !== "STOP_LIMIT" && value !== "LIMIT")
    throw new Error("ORDER_EXECUTION_TYPE_INVALID");
  return value;
}

/** cTrader ProtoOrderType acknowledgement numbers for pending entries. */
export function brokerOrderTypeNumber(
  type: PendingExecutionOrderType,
): 2 | 3 | 6 {
  if (type === "STOP") return 3;
  if (type === "LIMIT") return 2;
  return 6;
}
