import type { OrderMaintenance } from "./order-maintenance.js";

/** Accepted GTC orders have no context-age cancellation authority. */
export async function maintainPersistentOrders(input: {
  readonly maintenance: Pick<
    OrderMaintenance,
    "cancelAll" | "expireAndReconcile"
  >;
  readonly emergencyStop: boolean;
  readonly refreshRecovery: () => Promise<void>;
}): Promise<void> {
  try {
    if (input.emergencyStop)
      await input.maintenance.cancelAll("INDEPENDENT_EMERGENCY_CANCELLATION");
    // expireAndReconcile preserves null-expiry GTC and exact OCO peer cleanup.
    await input.maintenance.expireAndReconcile();
  } finally {
    await input.refreshRecovery();
  }
}
