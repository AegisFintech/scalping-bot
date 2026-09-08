import { afterEach, describe, expect, it, vi } from "vitest";

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
    if (
      sql.includes("FROM orders o") ||
      sql.includes("UPDATE analysis_runs a")
    ) {
      expect(values).toEqual(["account", "symbol"]);
      expect(sql).toContain("account_id=$1");
      expect(sql).toContain("symbol_id=$2");
    }
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
    maintenance: new OrderMaintenance({ query } as never, gateway, "XAUUSD", {
      accountId: "account",
      symbolId: "symbol",
    }),
    cancelStrategyOrder,
    updates,
  };
}

describe("order maintenance", () => {
  afterEach(() => vi.useRealTimers());

  it.each([60, 100, 180])(
    "leaves a reconciled unfilled pair active until its actual %s-second expiry",
    async (lifetime) => {
      vi.useFakeTimers();
      const start = Date.parse("2026-09-07T12:00:00Z");
      const expires = start + lifetime * 1000;
      const rows = ["buy", "sell"].map((side) => ({
        client_order_id: `fixture-${side}`,
        order_group_id: "group",
        analysis_id: "analysis",
      }));
      const query = vi.fn((sql: string, values?: readonly unknown[]) => {
        if (sql.includes("FROM orders o")) {
          expect(sql).toContain("o.strategy_owned = true");
          expect(values).toEqual(["account", "symbol"]);
        }
        return Promise.resolve({
          rows:
            sql.includes("og.expires_at <= now()") && Date.now() >= expires
              ? rows
              : [],
        });
      });
      const cancelStrategyOrder = vi.fn((clientOrderId: string) =>
        Promise.resolve({
          clientOrderId,
          brokerOrderId: null,
          state: "CANCELLED" as const,
          filledVolume: "0",
          updatedAt: new Date().toISOString(),
          reasonCode: "ANALYSIS_EXPIRED",
        }),
      );
      const gateway = {
        kind: "ctrader-demo",
        canSubmitToBroker: true,
        placeOco: vi.fn(),
        cancelStrategyOrder,
        reconcile: () =>
          Promise.resolve({
            asOf: new Date().toISOString(),
            certain: true,
            reasonCodes: [],
            orders: [],
            relevantPositionCount: 0,
          }),
      } satisfies ExecutionGateway;
      const maintenance = new OrderMaintenance(
        { query } as never,
        gateway,
        "XAUUSD",
        { accountId: "account", symbolId: "symbol" },
      );
      for (const seconds of [2, 7, 30, 59, lifetime - 1]) {
        vi.setSystemTime(start + seconds * 1000);
        await maintenance.expireAndReconcile();
        expect(cancelStrategyOrder).not.toHaveBeenCalled();
      }
      vi.setSystemTime(expires);
      await maintenance.expireAndReconcile();
      expect(cancelStrategyOrder.mock.calls).toEqual([
        ["fixture-buy", "ANALYSIS_EXPIRED"],
        ["fixture-sell", "ANALYSIS_EXPIRED"],
      ]);
    },
  );

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

it("preserves GTC on timer maintenance and normal shutdown, but includes it in emergency cancellation", async () => {
  const query = vi.fn((sql: string) => {
    if (sql.includes("og.expires_at <= now()"))
      expect(sql).toContain("og.time_in_force = 'GTD'");
    return Promise.resolve({ rows: [] });
  });
  const cancelStrategyOrder = vi.fn();
  const gateway = { cancelStrategyOrder } as unknown as ExecutionGateway;
  const maintenance = new OrderMaintenance(
    { query } as never,
    gateway,
    "XAUUSD",
    { accountId: "account", symbolId: "symbol" },
  );
  await maintenance.expireAndReconcile();
  await maintenance.cancelAll("SERVICE_SHUTDOWN", true);
  expect(query.mock.calls.at(-1)?.[0]).toContain("og.time_in_force = 'GTD'");
  await maintenance.cancelAll("EMERGENCY");
  expect(query.mock.calls.at(-1)?.[0]).not.toContain(
    "og.time_in_force = 'GTD'",
  );
  expect(cancelStrategyOrder).not.toHaveBeenCalled();
});
