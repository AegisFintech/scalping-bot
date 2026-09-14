import { describe, expect, it, vi } from "vitest";
import { CTraderClient } from "../../packages/ctrader-client/src/client.js";
import { CTraderPayload } from "../../packages/ctrader-client/src/protocol.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";

function limitCommand(
  overrides: Partial<PendingOrderCommand> = {},
): PendingOrderCommand {
  return {
    executionOrderType: "LIMIT",
    idempotencyKey: "limit-fixture",
    analysisId: "analysis",
    orderGroupId: "group",
    clientOrderId: "client-buy-limit",
    symbol: "XAUUSD",
    side: "BUY",
    volume: "100",
    entryPrice: "4400",
    stopLoss: "4389",
    takeProfit: "4405.50",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    timeInForce: "GTC",
    strategyLabel: "ctrader-ai-scalper:fixture",
    ...overrides,
  };
}

async function buildClient() {
  const transport = new CTraderJsonTransport({ host: "invalid.test" });
  vi.spyOn(transport, "connect").mockResolvedValue(undefined);
  vi.spyOn(transport, "onMessage").mockImplementation(() => () => {});
  const request = vi
    .spyOn(transport, "request")
    .mockImplementation((payloadType) => {
      const payloads: Readonly<Record<number, Record<string, unknown>>> = {
        [CTraderPayload.APPLICATION_AUTH_REQ]: {},
        [CTraderPayload.GET_ACCOUNTS_REQ]: {
          permissionScope: 1,
          ctidTraderAccount: [{ ctidTraderAccountId: "123", isLive: false }],
        },
        [CTraderPayload.ACCOUNT_AUTH_REQ]: {},
        [CTraderPayload.TRADER_REQ]: { trader: { depositAssetId: "2" } },
        [CTraderPayload.ASSET_LIST_REQ]: {
          asset: [
            { assetId: "1", name: "XAU" },
            { assetId: "2", name: "USD" },
            { assetId: "3", name: "$" },
          ],
        },
        [CTraderPayload.SYMBOLS_LIST_REQ]: {
          symbol: [
            {
              symbolId: "77",
              symbolName: "XAUUSD",
              baseAssetId: "1",
              quoteAssetId: "2",
            },
          ],
        },
        [CTraderPayload.SYMBOL_BY_ID_REQ]: {
          symbol: [
            {
              symbolId: "77",
              digits: 2,
              pipPosition: 2,
              tradingMode: 0,
              distanceSetIn: 1,
              scheduleTimeZone: "UTC",
              schedule: [{ startSecond: 0, endSecond: 604800 }],
              lotSize: "10000",
              minVolume: "100",
              maxVolume: "100000",
              stepVolume: "100",
              slDistance: 1,
              commissionType: 1,
              preciseTradingCommissionRate: "3000000000",
              preciseMinCommission: "0",
              minCommissionType: 2,
              minCommissionAsset: "USD",
              pnlConversionFeeRate: 0,
            },
          ],
        },
      };
      const payload = payloads[payloadType];
      if (payload === undefined)
        throw new Error(`UNEXPECTED_REQUEST:${payloadType}`);
      return Promise.resolve({ payloadType, payload });
    });
  const tokenManager = new CTraderTokenManager({
    clientId: "fixture",
    clientSecret: "fixture",
    tokenUrl: "https://invalid.test/token",
    accessToken: "fixture",
    refreshToken: "",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  });
  const client = new CTraderClient({
    clientId: "fixture",
    clientSecret: "fixture",
    accountId: "123",
    connectionMode: "demo",
    tokenManager,
    transport,
    allowOrderCommands: true,
  });
  await client.connect();
  await client.discoverSymbol("XAUUSD");
  return { client, request };
}

const executionEvent = (orderType: number) => ({
  payloadType: CTraderPayload.EXECUTION_EVENT,
  payload: {
    executionType: 2,
    order: { orderId: "1", orderType, orderStatus: 1, timeInForce: 2 },
  },
});

describe("LIMIT pending order wire transport", () => {
  it("sends a GTC LIMIT with relative protection and no stop trigger fields", async () => {
    const { client, request } = await buildClient();
    const command = limitCommand();
    request.mockResolvedValue(executionEvent(2));
    await client.placeLimit(command);
    expect(request).toHaveBeenLastCalledWith(
      CTraderPayload.NEW_ORDER_REQ,
      {
        ctidTraderAccountId: 123,
        symbolId: 77,
        orderType: 2,
        limitPrice: 4400,
        relativeStopLoss: 1_100_000,
        relativeTakeProfit: 550_000,
        tradeSide: 1,
        volume: 100,
        timeInForce: 2,
        label: command.strategyLabel,
        clientOrderId: command.clientOrderId,
      },
      [CTraderPayload.EXECUTION_EVENT],
    );
  });

  it("rejects a non-LIMIT acknowledgement and cross-type dispatch", async () => {
    const { client, request } = await buildClient();
    request.mockResolvedValue(executionEvent(3));
    await expect(client.placeLimit(limitCommand())).rejects.toThrow(
      "CTRADER_ORDER_TYPE_ACKNOWLEDGEMENT_MISMATCH",
    );
    await expect(client.placeStop(limitCommand())).rejects.toThrow(
      "CTRADER_ORDER_EXECUTION_TYPE_MISMATCH",
    );
    await expect(client.placeStopLimit(limitCommand(), "5")).rejects.toThrow(
      "CTRADER_ORDER_EXECUTION_TYPE_MISMATCH",
    );
  });

  it("rejects invalid protective geometry on limit entries", async () => {
    const { client, request } = await buildClient();
    request.mockResolvedValue(executionEvent(2));
    await expect(
      client.placeLimit(limitCommand({ stopLoss: "4401" })),
    ).rejects.toThrow("CTRADER_RELATIVE_PROTECTION_GEOMETRY_INVALID");
    await expect(
      client.placeLimit(
        limitCommand({ side: "SELL", stopLoss: "4389", takeProfit: "4405.50" }),
      ),
    ).rejects.toThrow("CTRADER_RELATIVE_PROTECTION_GEOMETRY_INVALID");
  });
});
