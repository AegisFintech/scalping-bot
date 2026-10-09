import { describe, expect, it, vi } from "vitest";
import { maintainPersistentOrders } from "../../apps/execution-service/src/order-maintenance-loop.js";

function fixture() {
  const events: string[] = [];
  return {
    events,
    maintenance: {
      cancelAll: vi.fn(() => {
        events.push("emergency");
        return Promise.resolve();
      }),
      expireAndReconcile: vi.fn(() => {
        events.push("reconcile");
        return Promise.resolve();
      }),
      // Legacy recall must not receive operating authority, even if available.
      recallStaleBrackets: vi.fn(() => {
        return Promise.reject(
          new Error("AGED_OR_UNKNOWN_GTC_MUST_NOT_BE_RECALLED"),
        );
      }),
    },
    refreshRecovery: vi.fn(() => {
      events.push("recovery");
      return Promise.resolve();
    }),
  };
}

describe("persistent operating maintenance", () => {
  it("reconciles without timed recall or cancellation outside an emergency", async () => {
    const input = fixture();
    await maintainPersistentOrders({ ...input, emergencyStop: false });
    expect(input.events).toEqual(["reconcile", "recovery"]);
    expect(input.maintenance.cancelAll).not.toHaveBeenCalled();
    expect(input.maintenance.recallStaleBrackets).not.toHaveBeenCalled();
  });

  it("preserves explicit emergency cancellation before reconciliation", async () => {
    const input = fixture();
    await maintainPersistentOrders({ ...input, emergencyStop: true });
    expect(input.events).toEqual(["emergency", "reconcile", "recovery"]);
    expect(input.maintenance.cancelAll).toHaveBeenCalledWith(
      "INDEPENDENT_EMERGENCY_CANCELLATION",
    );
    expect(input.maintenance.recallStaleBrackets).not.toHaveBeenCalled();
  });

  it("refreshes recovery and propagates uncertain reconciliation failure", async () => {
    const input = fixture();
    input.maintenance.expireAndReconcile.mockRejectedValueOnce(
      new Error("RECONCILIATION_UNCERTAIN"),
    );
    await expect(
      maintainPersistentOrders({ ...input, emergencyStop: false }),
    ).rejects.toThrow("RECONCILIATION_UNCERTAIN");
    expect(input.refreshRecovery).toHaveBeenCalledOnce();
    expect(input.maintenance.cancelAll).not.toHaveBeenCalled();
    expect(input.maintenance.recallStaleBrackets).not.toHaveBeenCalled();
  });

  it("refreshes recovery without retrying a failed emergency cancellation", async () => {
    const input = fixture();
    input.maintenance.cancelAll.mockRejectedValueOnce(
      new Error("CANCELLATION_UNKNOWN"),
    );
    await expect(
      maintainPersistentOrders({ ...input, emergencyStop: true }),
    ).rejects.toThrow("CANCELLATION_UNKNOWN");
    expect(input.maintenance.cancelAll).toHaveBeenCalledOnce();
    expect(input.maintenance.expireAndReconcile).not.toHaveBeenCalled();
    expect(input.refreshRecovery).toHaveBeenCalledOnce();
    expect(input.maintenance.recallStaleBrackets).not.toHaveBeenCalled();
  });
});
