import { describe, expect, it, vi } from "vitest";

import { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import type { ExecutionGateway } from "../../packages/contracts/src/index.js";

function maintenanceFixture(input: {
  readonly cancelFails?: boolean;
  readonly reconciliationOrders?: readonly {
    readonly clientOrderId: string;
    readonly brokerOrderId: string | null;
    readonly state: "PENDING" | "CANCELLED";
    readonly filledVolume: string;
    readonly updatedAt: string;
    readonly reasonCode: string | null;
  }[];
}) {
  const updates: Array<readonly unknown[]> = [];
  const query = vi.fn((sql: string, values?: readonly unknown[]) => {
    if (sql.includes("UPDATE analysis_runs"))
      return Promise.resolve({ rows: [] });
    if (sql.includes("filled.id <> o.id")) {
      return Promise.resolve({
        rows: [
          {
            client_order_id: "cas-sell-peer",
            order_group_id: "group",
            analysis_id: "analysis",
          },
        ],
      });
    }
    if (sql.includes("og.expires_at <= now()"))
      return Promise.resolve({ rows: [] });
    if (
      sql.startsWith("UPDATE orders") ||
      sql.startsWith("UPDATE order_groups")
    ) {
      updates.push(values ?? []);
      return Promise.resolve({ rows: [] });
    }
    throw new Error("UNEXPECTED_QUERY");
  });
  const cancelStrategyOrder = input.cancelFails
    ? vi.fn(() => Promise.reject(new Error("BROKER_CANCEL_FAILED")))
    : vi.fn(() =>
        Promise.resolve({
          clientOrderId: "cas-sell-peer",
          brokerOrderId: "202",
          state: "CANCELLED" as const,
          filledVolume: "0",
          updatedAt: "2026-08-25T12:00:05.000Z",
          reasonCode: "OCO_PEER_FILLED",
        }),
      );
  const gateway = {
    kind: "ctrader-demo",
    canSubmitToBroker: true,
    placeOco: vi.fn(),
    cancelStrategyOrder,
    reconcile: vi.fn(() =>
      Promise.resolve({
        asOf: "2026-08-25T12:00:06.000Z",
        certain: true,
        reasonCodes: [],
        orders: input.reconciliationOrders ?? [],
        relevantPositionCount: 1,
      }),
    ),
  } satisfies ExecutionGateway;
  return {
    maintenance: new OrderMaintenance({ query } as never, gateway, "XAUUSD"),
    cancelStrategyOrder,
    updates,
  };
}

describe("order maintenance", () => {
  it("retries a pending OCO peer immediately after its sibling fills", async () => {
    const { maintenance, cancelStrategyOrder, updates } = maintenanceFixture(
      {},
    );

    await expect(maintenance.expireAndReconcile()).resolves.toBeUndefined();

    expect(cancelStrategyOrder).toHaveBeenCalledWith(
      "cas-sell-peer",
      "OCO_PEER_FILLED",
    );
    expect(updates).toContainEqual([
      "group",
      "RECONCILIATION_REQUIRED",
      "OCO_PEER_FILLED",
    ]);
  });

  it("retains reconciliation-required state when peer cancellation fails", async () => {
    const { maintenance, updates } = maintenanceFixture({
      cancelFails: true,
      reconciliationOrders: [
        {
          clientOrderId: "cas-sell-peer",
          brokerOrderId: "202",
          state: "PENDING",
          filledVolume: "0",
          updatedAt: "2026-08-25T12:00:06.000Z",
          reasonCode: null,
        },
      ],
    });

    await expect(maintenance.expireAndReconcile()).rejects.toThrow(
      "ORDER_MAINTENANCE_RECONCILIATION_REQUIRED",
    );
    expect(updates).toContainEqual([
      "group",
      "RECONCILIATION_REQUIRED",
      "OCO_PEER_FILLED",
    ]);
  });
});
