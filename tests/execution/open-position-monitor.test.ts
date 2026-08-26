import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  PostgresOpenPositionMonitor,
  unavailableOpenPositionMonitor,
} from "../../apps/execution-service/src/open-position-monitor.js";
import type { PositionUnrealizedPnl } from "../../packages/ctrader-client/src/client.js";

interface TestQuote {
  readonly serverTime: string;
  readonly metadata: { readonly symbolId: string; readonly symbolName: string };
  readonly quote: {
    readonly bid: string;
    readonly ask: string;
    readonly sourceTime: string;
    readonly receivedAt: string;
  };
}

function monitor(
  rows: readonly Record<string, unknown>[],
  overrides: {
    readonly quote?: () => Promise<TestQuote>;
    readonly pnl?: (brokerPositionId: string) => Promise<PositionUnrealizedPnl>;
  } = {},
) {
  const pool = {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as pg.Pool;
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const quote =
    overrides.quote ??
    vi.fn<() => Promise<TestQuote>>().mockResolvedValue({
      serverTime: observedAt,
      metadata: { symbolId: "41", symbolName: "XAUUSD" },
      quote: {
        bid: "4641.2",
        ask: "4641.4",
        sourceTime: observedAt,
        receivedAt: observedAt,
      },
    });
  const pnl =
    overrides.pnl ??
    vi
      .fn<(brokerPositionId: string) => Promise<PositionUnrealizedPnl>>()
      .mockResolvedValue({
        grossUnrealizedPnl: "3.2",
        netUnrealizedPnl: "2.75",
        capturedAt: observedAt,
      });
  return {
    quote,
    pnl,
    subject: new PostgresOpenPositionMonitor({
      pool,
      accountId: "account-uuid",
      symbolId: "symbol-uuid",
      mode: "demo",
      providerSymbolId: "41",
      symbolName: "XAUUSD",
      quote,
      pnl,
    }),
  };
}

const buy = {
  side: "BUY",
  state: "OPEN",
  group_state: "POSITION_OPEN",
  broker_position_id: "7788",
  account_currency: "USD",
  recorded_commission: "-0.3000000000",
};

describe("open position monitor", () => {
  it("uses bid to mark a long and returns broker P/L plus recorded commission", async () => {
    const { subject, pnl } = monitor([buy]);
    const result = await subject.read();

    expect(result).toMatchObject({
      status: "AVAILABLE",
      executionState: "NORMAL",
      side: "BUY",
      accountCurrency: "USD",
      bid: "4641.2",
      ask: "4641.4",
      markPrice: "4641.2",
      grossUnrealizedPnl: "3.2",
      netUnrealizedPnl: "2.75",
      recordedCommission: "-0.3",
    });
    expect(pnl).toHaveBeenCalledWith("7788");
    expect(JSON.stringify(result)).not.toContain("7788");
  });

  it("uses ask to mark a short", async () => {
    const { subject } = monitor([{ ...buy, side: "SELL" }]);
    await expect(subject.read()).resolves.toMatchObject({
      side: "SELL",
      markPrice: "4641.4",
    });
  });

  it("shows exact broker-confirmed values while group reconciliation stays pending", async () => {
    const { subject, quote, pnl } = monitor([
      { ...buy, group_state: "RECONCILIATION_REQUIRED" },
    ]);

    await expect(subject.read()).resolves.toMatchObject({
      status: "AVAILABLE",
      executionState: "RECONCILIATION_REQUIRED",
      side: "BUY",
      markPrice: "4641.2",
      netUnrealizedPnl: "2.75",
    });
    expect(quote).toHaveBeenCalledOnce();
    expect(pnl).toHaveBeenCalledWith("7788");
  });

  it("does not call external sources when there is no open position", async () => {
    const { subject, quote, pnl } = monitor([]);
    await expect(subject.read()).resolves.toEqual({ status: "NONE" });
    expect(quote).not.toHaveBeenCalled();
    expect(pnl).not.toHaveBeenCalled();
  });

  it("fails closed on ambiguous or uncertain durable state", async () => {
    const ambiguous = monitor([buy, { ...buy, broker_position_id: "7789" }]);
    await expect(ambiguous.subject.read()).rejects.toThrow(
      "OPEN_POSITION_MONITOR_AMBIGUOUS",
    );
    expect(ambiguous.quote).not.toHaveBeenCalled();

    const uncertain = monitor([{ ...buy, state: "RECONCILIATION_PENDING" }]);
    await expect(uncertain.subject.read()).rejects.toThrow(
      "OPEN_POSITION_MONITOR_STATE_UNCERTAIN",
    );
    expect(uncertain.pnl).not.toHaveBeenCalled();

    const uncertainGroup = monitor([{ ...buy, group_state: "ACTIVE" }]);
    await expect(uncertainGroup.subject.read()).rejects.toThrow(
      "OPEN_POSITION_MONITOR_GROUP_STATE_UNCERTAIN",
    );
    expect(uncertainGroup.quote).not.toHaveBeenCalled();
  });

  it("fails closed on a mismatched quote or malformed commission", async () => {
    const observedAt = new Date(Date.now() - 1_000).toISOString();
    const mismatched = monitor([buy], {
      quote: vi.fn().mockResolvedValue({
        serverTime: observedAt,
        metadata: { symbolId: "99", symbolName: "XAUUSD" },
        quote: {
          bid: "4641.2",
          ask: "4641.4",
          sourceTime: observedAt,
          receivedAt: observedAt,
        },
      }),
    });
    await expect(mismatched.subject.read()).rejects.toThrow(
      "OPEN_POSITION_MONITOR_SYMBOL_MISMATCH",
    );

    const malformed = monitor([{ ...buy, recorded_commission: "NaN" }]);
    await expect(malformed.subject.read()).rejects.toThrow(
      "OPEN_POSITION_MONITOR_COMMISSION_INVALID",
    );
    expect(malformed.quote).not.toHaveBeenCalled();
  });

  it("does not expose free-form dependency errors", () => {
    expect(
      unavailableOpenPositionMonitor(
        new Error("database failed at private-host.example"),
      ),
    ).toEqual({
      status: "UNAVAILABLE",
      reasonCode: "OPEN_POSITION_MONITOR_UNAVAILABLE",
    });
  });
});
