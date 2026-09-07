import { describe, expect, it, vi } from "vitest";
import { CTraderClient } from "../../packages/ctrader-client/src/client.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderPayload as P } from "../../packages/ctrader-client/src/protocol.js";
import { DailyRiskStore } from "../../apps/execution-service/src/daily-risk-store.js";
import { reconcileAccountSafely } from "../../apps/execution-service/src/account-reconciliation.js";

type Row = Record<string, unknown>;
function pending(positionId: number, symbolId = 7): Row {
  return {
    positionId,
    orderStatus: 1,
    executedVolume: 0,
    tradeData: { symbolId, volume: 100, tradeSide: positionId === 101 ? 1 : 2 },
  };
}
function pnl(positionId: number, net = 0): Row {
  return { positionId, grossUnrealizedPnL: net, netUnrealizedPnL: net };
}
function fixture() {
  const state: { positions: Row[]; orders: Row[]; pnl: Row[] } = {
    positions: [],
    orders: [],
    pnl: [],
  };
  const makeClient = async () => {
    const transport = new CTraderJsonTransport({ host: "invalid.test" });
    vi.spyOn(transport, "connect").mockResolvedValue(undefined);
    const request = vi
      .spyOn(transport, "request")
      .mockImplementation((type) => {
        const payloads: Record<number, Row> = {
          [P.APPLICATION_AUTH_REQ]: {},
          [P.GET_ACCOUNTS_REQ]: {
            permissionScope: 1,
            ctidTraderAccount: [{ ctidTraderAccountId: 123, isLive: false }],
          },
          [P.ACCOUNT_AUTH_REQ]: {},
          [P.TRADER_REQ]: {
            trader: { depositAssetId: 2, moneyDigits: 2, balance: 1000000 },
          },
          [P.ASSET_LIST_REQ]: { asset: [{ assetId: 2, name: "USD" }] },
          [P.RECONCILE_REQ]: { position: state.positions, order: state.orders },
          [P.POSITION_UNREALIZED_PNL_REQ]: {
            moneyDigits: 2,
            positionUnrealizedPnL: state.pnl,
          },
        };
        if (!(type in payloads)) throw new Error("UNEXPECTED_BROKER_MUTATION");
        return Promise.resolve({ payloadType: type, payload: payloads[type]! });
      });
    const client = new CTraderClient({
      clientId: "fixture",
      clientSecret: "fixture",
      accountId: "123",
      connectionMode: "demo",
      allowOrderCommands: false,
      transport,
      tokenManager: new CTraderTokenManager({
        clientId: "fixture",
        clientSecret: "fixture",
        tokenUrl: "https://invalid.test/token",
        accessToken: "fixture",
        refreshToken: "",
      }),
    });
    await client.connect();
    return { client, request };
  };
  return { state, makeClient };
}

describe("account reconciliation through a protected pending-order lifecycle", () => {
  it("keeps pending orders accounted for across polls and restart, then prices a fill", async () => {
    const { state, makeClient } = fixture();
    const { client, request } = await makeClient();
    expect(await client.reconcile("7")).toMatchObject({
      certain: true,
      equity: "10000",
      relevantPendingOrderCount: 0,
    });
    state.orders = [pending(101), pending(102)];
    state.pnl = [pnl(101), pnl(102)];
    const report = vi.fn();
    for (let i = 0; i < 3; i++) {
      const account = await reconcileAccountSafely(client, "7", report);
      expect(account).toMatchObject({
        certain: true,
        equity: "10000",
        availableMargin: "10000",
        relevantPositionCount: 0,
        relevantPendingOrderCount: 2,
        hasPartialFill: false,
        reasonCodes: [],
      });
      const query = vi.fn((sql: string) =>
        Promise.resolve(
          sql.startsWith("SELECT baseline_equity")
            ? { rows: [{ baseline_equity: "10000", locked_out: false }] }
            : { rows: [{ locked_out: false }] },
        ),
      );
      const risk = await new DailyRiskStore({ query } as never).reconcile({
        accountId: "fixture",
        account,
        timezone: "UTC",
        thresholdPercent: "5",
        includeUnrealized: true,
        netFlows: "0",
        allowBaselineBootstrap: false,
        baselineCaptureGraceSeconds: 60,
      });
      expect(risk).toEqual({
        lockedOut: false,
        lossPercent: "0",
        remainingLossBudget: "500",
      });
    }
    expect(report).not.toHaveBeenCalled();
    const restarted = await makeClient();
    expect(await restarted.client.reconcile("7")).toMatchObject({
      certain: true,
      relevantPendingOrderCount: 2,
    });
    state.orders = [pending(102)];
    state.positions = [
      {
        positionId: 101,
        positionStatus: 1,
        usedMargin: 100,
        moneyDigits: 2,
        tradeData: { symbolId: 7, volume: 100 },
      },
    ];
    state.pnl = [pnl(101, -52), pnl(102)];
    expect(await client.reconcile("7")).toMatchObject({
      certain: true,
      equity: "9999.48",
      availableMargin: "9998.48",
      relevantPositionCount: 1,
      relevantPendingOrderCount: 1,
    });
    state.orders = [];
    state.positions = [];
    state.pnl = [];
    expect(await client.reconcile("7")).toMatchObject({
      certain: true,
      relevantPositionCount: 0,
      relevantPendingOrderCount: 0,
    });
    expect(
      request.mock.calls.every(
        ([type]) =>
          ![P.NEW_ORDER_REQ, P.CANCEL_ORDER_REQ].includes(type as never),
      ),
    ).toBe(true);
  });

  it("still blocks another symbol even when its pending P/L is exactly zero", async () => {
    const { state, makeClient } = fixture();
    state.orders = [pending(101, 8)];
    state.pnl = [pnl(101)];
    const { client } = await makeClient();
    expect(await client.reconcile("7")).toMatchObject({
      certain: false,
      reasonCodes: ["ACCOUNT_OTHER_SYMBOL_EXPOSURE_UNPRICED"],
    });
  });

  it("rejects a fill whose required P/L row is missing, with a safe diagnostic", async () => {
    const { state, makeClient } = fixture();
    state.orders = [pending(102)];
    state.pnl = [pnl(102)];
    state.positions = [
      {
        positionId: 101,
        positionStatus: 1,
        usedMargin: 100,
        moneyDigits: 2,
        tradeData: { symbolId: 7, volume: 100 },
      },
    ];
    const { client } = await makeClient();
    const report = vi.fn();
    const account = await reconcileAccountSafely(client, "7", report);
    expect(account).toMatchObject({ certain: false, equity: "0" });
    expect(report).toHaveBeenCalledWith("CTRADER_ACCOUNT_PNL_INCOMPLETE");
    await expect(
      new DailyRiskStore({} as never).reconcile({
        accountId: "fixture",
        account,
        timezone: "UTC",
        thresholdPercent: "5",
        includeUnrealized: true,
        netFlows: "0",
        allowBaselineBootstrap: false,
        baselineCaptureGraceSeconds: 60,
      }),
    ).rejects.toThrow("DAILY_RISK_ACCOUNT_UNCERTAIN");
  });

  it("does not waive open-position margin evidence", async () => {
    const { state, makeClient } = fixture();
    state.positions = [
      {
        positionId: 101,
        positionStatus: 1,
        tradeData: { symbolId: 7, volume: 100 },
      },
    ];
    state.pnl = [pnl(101)];
    const { client } = await makeClient();
    await expect(client.reconcile("7")).rejects.toThrow(
      "CTRADER_USED_MARGIN_UNKNOWN",
    );
  });
});
