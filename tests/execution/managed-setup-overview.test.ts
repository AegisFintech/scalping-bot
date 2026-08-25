import { describe, expect, it, vi } from "vitest";

import { PostgresManagedSetupOverview } from "../../apps/execution-service/src/managed-setup-overview.js";

function overviewWithRows(input: {
  readonly groups: readonly Record<string, unknown>[];
  readonly orders?: readonly Record<string, unknown>[];
  readonly positions?: readonly Record<string, unknown>[];
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
});
