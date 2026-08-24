import { readFile } from "node:fs/promises";
import path from "node:path";

import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  recoverDemoExecutions,
  type DemoExecutionHistoryClient,
} from "../../apps/execution-service/src/demo-execution-recovery.js";
import type {
  DemoExecutionEvent,
  DemoExecutionStore,
} from "../../apps/execution-service/src/demo-execution.js";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";

async function fixture(name: string): Promise<BrokerExecution> {
  return JSON.parse(
    await readFile(path.resolve("tests", "fixtures", "ctrader", name), "utf8"),
  ) as BrokerExecution;
}

function pool(
  orderRows: readonly Record<string, unknown>[],
  positionRows: readonly Record<string, unknown>[] = [],
  mappedFillRows: readonly Record<string, unknown>[] = [],
): pg.Pool {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      const rows = sql.includes("SELECT o.client_order_id")
        ? orderRows
        : sql.includes("FROM positions p")
          ? positionRows
          : mappedFillRows;
      return Promise.resolve({ rows });
    }),
  } as unknown as pg.Pool;
}

class RecoveryClient implements DemoExecutionHistoryClient {
  orders: readonly Record<string, unknown>[] = [];
  deals: readonly Record<string, unknown>[] = [];
  positions: readonly Record<string, unknown>[] = [];
  hasMore = false;

  orderHistoryRaw(): Promise<{
    receivedAt: string;
    orders: readonly Record<string, unknown>[];
    hasMore: boolean;
  }> {
    return Promise.resolve({
      receivedAt: "2026-08-24T04:02:00.000Z",
      orders: this.orders,
      hasMore: this.hasMore,
    });
  }

  dealHistoryRaw(): Promise<{
    receivedAt: string;
    deals: readonly Record<string, unknown>[];
    hasMore: boolean;
  }> {
    return Promise.resolve({
      receivedAt: "2026-08-24T04:02:00.000Z",
      deals: this.deals,
      hasMore: this.hasMore,
    });
  }

  reconcileRaw(): Promise<{
    receivedAt: string;
    positions: readonly Record<string, unknown>[];
    orders: readonly Record<string, unknown>[];
  }> {
    return Promise.resolve({
      receivedAt: "2026-08-24T04:02:00.000Z",
      positions: this.positions,
      orders: [],
    });
  }
}

class RecoveryStore implements DemoExecutionStore {
  readonly events: DemoExecutionEvent[] = [];

  persist(event: DemoExecutionEvent): Promise<{
    certain: boolean;
    reasonCodes: readonly string[];
  }> {
    this.events.push(event);
    return Promise.resolve({ certain: true, reasonCodes: [] });
  }

  readiness(): Promise<{ certain: boolean; reasonCodes: readonly string[] }> {
    return Promise.resolve({ certain: true, reasonCodes: [] });
  }
}

describe("cTrader demo execution restart recovery", () => {
  it("does not request broker history when no durable order is unresolved", async () => {
    const client = new RecoveryClient();
    const orderHistory = vi.spyOn(client, "orderHistoryRaw");
    await expect(
      recoverDemoExecutions({
        pool: pool([]),
        accountId: "account",
        symbolId: "symbol",
        client,
        store: new RecoveryStore(),
        normalizer: { symbolId: "7" },
      }),
    ).resolves.toEqual({ certain: true, reasonCodes: [] });
    expect(orderHistory).not.toHaveBeenCalled();
  });

  it("recovers a strategy order by client ID and persists it", async () => {
    const accepted = await fixture("demo-order-accepted-v1.json");
    const client = new RecoveryClient();
    client.orders = [accepted.order as Record<string, unknown>];
    const store = new RecoveryStore();
    await expect(
      recoverDemoExecutions({
        pool: pool([
          {
            client_order_id: "cas-buy-111111111111111111111111",
            broker_order_id: null,
            created_at: new Date("2026-08-24T04:00:00.000Z"),
          },
        ]),
        accountId: "account",
        symbolId: "symbol",
        client,
        store,
        normalizer: { symbolId: "7" },
        now: () => new Date("2026-08-24T04:05:00.000Z"),
      }),
    ).resolves.toEqual({ certain: true, reasonCodes: [] });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      executionType: 2,
      brokerOrderId: "501",
      order: { state: "PENDING" },
    });
  });

  it("selects the newest matching broker order using numeric timestamps", async () => {
    const accepted = await fixture("demo-order-accepted-v1.json");
    const newer = structuredClone(accepted.order) as Record<string, unknown>;
    newer.orderStatus = 5;
    newer.utcLastUpdateTimestamp = 1787544060000;
    const client = new RecoveryClient();
    client.orders = [accepted.order as Record<string, unknown>, newer];
    const store = new RecoveryStore();
    await expect(
      recoverDemoExecutions({
        pool: pool([
          {
            client_order_id: "cas-buy-111111111111111111111111",
            broker_order_id: "501",
            created_at: new Date("2026-08-24T04:00:00.000Z"),
          },
        ]),
        accountId: "account",
        symbolId: "symbol",
        client,
        store,
        normalizer: { symbolId: "7" },
        now: () => new Date("2026-08-24T04:05:00.000Z"),
      }),
    ).resolves.toEqual({ certain: true, reasonCodes: [] });
    expect(store.events[0]?.order?.state).toBe("CANCELLED");
  });

  it("fails closed when broker history is paginated", async () => {
    const accepted = await fixture("demo-order-accepted-v1.json");
    const client = new RecoveryClient();
    client.orders = [accepted.order as Record<string, unknown>];
    client.hasMore = true;
    await expect(
      recoverDemoExecutions({
        pool: pool([
          {
            client_order_id: "cas-buy-111111111111111111111111",
            broker_order_id: null,
            created_at: new Date("2026-08-24T04:00:00.000Z"),
          },
        ]),
        accountId: "account",
        symbolId: "symbol",
        client,
        store: new RecoveryStore(),
        normalizer: { symbolId: "7" },
        now: () => new Date("2026-08-24T04:05:00.000Z"),
      }),
    ).resolves.toEqual({
      certain: false,
      reasonCodes: ["DEMO_RECOVERY_HISTORY_PAGINATION_REQUIRED"],
    });
  });

  it("uses exact entry identity, skips mapped fills, and reconstructs a broker SL/TP close", async () => {
    const filled = await fixture("demo-order-filled-v1.json");
    const closed = await fixture("demo-position-closed-v1.json");
    const closingOrder = structuredClone(closed.order) as Record<
      string,
      unknown
    >;
    closingOrder.clientOrderId = "cas-buy-111111111111111111111111";
    const client = new RecoveryClient();
    client.orders = [filled.order as Record<string, unknown>, closingOrder];
    client.deals = [
      filled.deal as Record<string, unknown>,
      closed.deal as Record<string, unknown>,
    ];
    const store = new RecoveryStore();

    await expect(
      recoverDemoExecutions({
        pool: pool(
          [
            {
              client_order_id: "cas-buy-111111111111111111111111",
              broker_order_id: "501",
              created_at: new Date("2026-08-24T04:00:00.000Z"),
            },
          ],
          [
            {
              broker_position_id: "801",
              side: "BUY",
              volume: "100",
              entry_price: "2001.28",
              stop_loss: "1999.25",
              take_profit: "2005.25",
              opened_at: new Date("2026-08-24T04:01:00.000Z"),
              created_at: new Date("2026-08-24T04:00:00.000Z"),
            },
          ],
          [{ broker_fill_id: "902" }],
        ),
        accountId: "account",
        symbolId: "symbol",
        client,
        store,
        normalizer: { symbolId: "7" },
        now: () => new Date("2026-08-24T04:05:00.000Z"),
      }),
    ).resolves.toEqual({ certain: true, reasonCodes: [] });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      eventKey: "deal:903",
      brokerOrderId: "601",
      brokerPositionId: "801",
      brokerOrderType: 4,
      closingOrder: true,
      position: { state: "CLOSED", entryPrice: "2001.28" },
      closeDetail: { closedVolume: "100" },
    });
  });

  it("fails closed when a disappeared position has no closing order evidence", async () => {
    const closed = await fixture("demo-position-closed-v1.json");
    const client = new RecoveryClient();
    client.deals = [closed.deal as Record<string, unknown>];

    await expect(
      recoverDemoExecutions({
        pool: pool(
          [],
          [
            {
              broker_position_id: "801",
              side: "BUY",
              volume: "100",
              entry_price: "2001.28",
              stop_loss: null,
              take_profit: null,
              opened_at: new Date("2026-08-24T04:01:00.000Z"),
              created_at: new Date("2026-08-24T04:00:00.000Z"),
            },
          ],
        ),
        accountId: "account",
        symbolId: "symbol",
        client,
        store: new RecoveryStore(),
        normalizer: { symbolId: "7" },
        now: () => new Date("2026-08-24T04:05:00.000Z"),
      }),
    ).resolves.toEqual({
      certain: false,
      reasonCodes: ["DEMO_RECOVERY_CLOSING_ORDER_NOT_FOUND"],
    });
  });
});
