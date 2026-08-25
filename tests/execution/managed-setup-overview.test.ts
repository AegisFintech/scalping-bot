import { describe, expect, it, vi } from "vitest";

import { PostgresManagedSetupOverview } from "../../apps/execution-service/src/managed-setup-overview.js";

function overviewWithRows(input: {
  readonly groups: readonly Record<string, unknown>[];
  readonly orders?: readonly Record<string, unknown>[];
  readonly positions?: readonly Record<string, unknown>[];
  readonly trades?: readonly Record<string, unknown>[];
}) {
  const query = vi.fn((sql: string) => {
    if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK")
      return Promise.resolve({ rows: [] });
    if (sql.includes("FROM order_groups"))
      return Promise.resolve({ rows: input.groups });
    if (sql.includes("FROM orders"))
      return Promise.resolve({ rows: input.orders ?? [] });
    if (sql.includes("FROM positions"))
      return Promise.resolve({ rows: input.positions ?? [] });
    if (sql.includes("FROM trades"))
      return Promise.resolve({ rows: input.trades ?? [] });
    throw new Error("UNEXPECTED_QUERY");
  });
  const release = vi.fn();
  const read = new PostgresManagedSetupOverview({
    pool: {
      connect: () => Promise.resolve({ query, release }),
    } as never,
    accountId: "account",
    symbolId: "symbol",
    mode: "demo",
  });
  return { read, query, release };
}

describe("managed setup Overview projection", () => {
  it("returns exact decimal strings for the scoped active setup", async () => {
    const now = new Date("2026-08-25T05:00:00.000Z");
    const { read, query, release } = overviewWithRows({
      groups: [
        {
          id: "group",
          state: "ACTIVE",
          expires_at: now,
          updated_at: now,
        },
      ],
      orders: [
        {
          side: "BUY",
          state: "PENDING",
          entry_price: "4642.1000000000",
          stop_loss: "4637.1000000000",
          take_profit: "4652.1000000000",
          normalized_volume: "1.0000000000",
          expires_at: now,
          updated_at: now,
        },
      ],
      positions: [],
    });

    await expect(read.read()).resolves.toMatchObject({
      status: "ACTIVE",
      groupState: "ACTIVE",
      orders: [
        {
          side: "BUY",
          state: "PENDING",
          entryPrice: "4642.1000000000",
          stopLoss: "4637.1000000000",
          takeProfit: "4652.1000000000",
        },
      ],
      position: null,
      trade: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ar.account_id = $1"),
      ["account", "symbol", "demo"],
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports a safe empty state when no managed group exists", async () => {
    const { read } = overviewWithRows({ groups: [] });

    await expect(read.read()).resolves.toEqual({
      status: "NONE",
      groupState: null,
      groupExpiresAt: null,
      groupUpdatedAt: null,
      orders: [],
      position: null,
      trade: null,
    });
  });

  it("returns the exact durable terminal demo trade result", async () => {
    const openedAt = new Date("2026-08-25T05:28:28.765Z");
    const closedAt = new Date("2026-08-25T05:30:10.572Z");
    const { read } = overviewWithRows({
      groups: [
        {
          id: "group",
          state: "CLOSED",
          expires_at: closedAt,
          updated_at: closedAt,
        },
      ],
      trades: [
        {
          direction: "LONG",
          realized_pnl: "-4.6500000000",
          fees: "-0.2800000000",
          opened_at: openedAt,
          closed_at: closedAt,
        },
      ],
      positions: [
        {
          side: "BUY",
          state: "CLOSED",
          entry_price: "4646.9100000000",
          stop_loss: null,
          take_profit: null,
          volume: "100",
          opened_at: openedAt,
          closed_at: closedAt,
          updated_at: closedAt,
        },
      ],
    });

    await expect(read.read()).resolves.toMatchObject({
      status: "LATEST_TERMINAL",
      groupState: "CLOSED",
      trade: {
        direction: "LONG",
        realizedPnl: "-4.6500000000",
        fees: "-0.2800000000",
        openedAt: "2026-08-25T05:28:28.765Z",
        closedAt: "2026-08-25T05:30:10.572Z",
      },
    });
  });

  it("rejects ambiguous strategy positions instead of choosing one", async () => {
    const now = new Date("2026-08-25T05:00:00.000Z");
    const { read, query, release } = overviewWithRows({
      groups: [
        {
          id: "group",
          state: "POSITION_OPEN",
          expires_at: now,
          updated_at: now,
        },
      ],
      positions: [{ updated_at: now }, { updated_at: now }],
    });

    await expect(read.read()).rejects.toThrow(
      "MANAGED_SETUP_POSITION_AMBIGUOUS",
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects multiple active groups instead of hiding one", async () => {
    const now = new Date("2026-08-25T05:00:00.000Z");
    const { read, query } = overviewWithRows({
      groups: [
        { id: "first", state: "ACTIVE", expires_at: now, updated_at: now },
        {
          id: "second",
          state: "POSITION_OPEN",
          expires_at: now,
          updated_at: now,
        },
      ],
    });

    await expect(read.read()).rejects.toThrow(
      "MANAGED_SETUP_ACTIVE_GROUP_AMBIGUOUS",
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rejects ambiguous terminal trade results", async () => {
    const now = new Date("2026-08-25T05:30:10.572Z");
    const { read, query } = overviewWithRows({
      groups: [
        { id: "group", state: "CLOSED", expires_at: now, updated_at: now },
      ],
      trades: [
        {
          direction: "LONG",
          realized_pnl: "1",
          fees: "0",
          opened_at: now,
          closed_at: now,
        },
        {
          direction: "LONG",
          realized_pnl: "2",
          fees: "0",
          opened_at: now,
          closed_at: now,
        },
      ],
    });

    await expect(read.read()).rejects.toThrow("MANAGED_SETUP_TRADE_AMBIGUOUS");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rejects a closed group without a matching position and trade", async () => {
    const now = new Date("2026-08-25T05:30:10.572Z");
    const { read, query } = overviewWithRows({
      groups: [
        { id: "group", state: "CLOSED", expires_at: now, updated_at: now },
      ],
    });

    await expect(read.read()).rejects.toThrow(
      "MANAGED_SETUP_TRADE_STATE_INVALID",
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});
