import { describe, expect, it, vi } from "vitest";
import { CTraderClient } from "../../packages/ctrader-client/src/client.js";
import { CTraderPayload } from "../../packages/ctrader-client/src/protocol.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
describe("ordinary STOP wire transport", () => {
  it("sends GTC STOP with relative protection, rejects broker type mismatch and wrong dispatch method", async () => {
    const transport = new CTraderJsonTransport({ host: "invalid.test" });
    vi.spyOn(transport, "connect").mockResolvedValue(undefined);
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
      accessTokenExpiresAt: new Date(Date.now() + 3600000),
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

    const command: PendingOrderCommand = {
      executionOrderType: "STOP",
      idempotencyKey: "stop-fixture",
      analysisId: "analysis",
      orderGroupId: "group",
      clientOrderId: "client-buy",
      symbol: "XAUUSD",
      side: "BUY",
      volume: "100",
      entryPrice: "4400",
      stopLoss: "4398.94",
      takeProfit: "4400.53",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      timeInForce: "GTC",
      strategyLabel: "ctrader-ai-scalper:fixture",
    };
    const response = (orderType: number) => ({
      payloadType: CTraderPayload.EXECUTION_EVENT,
      payload: {
        executionType: 2,
        order: { orderId: "1", orderType, orderStatus: 1, timeInForce: 2 },
      },
    });
    request.mockResolvedValue(response(3));
    await client.placeStop(command);
    expect(request).toHaveBeenLastCalledWith(
      CTraderPayload.NEW_ORDER_REQ,
      {
        ctidTraderAccountId: 123,
        symbolId: 77,
        orderType: 3,
        stopPrice: 4400,
        relativeStopLoss: 106000,
        relativeTakeProfit: 53000,
        tradeSide: 1,
        volume: 100,
        timeInForce: 2,
        label: command.strategyLabel,
        clientOrderId: command.clientOrderId,
        stopTriggerMethod: 1,
      },
      [CTraderPayload.EXECUTION_EVENT],
    );
    request.mockResolvedValue(response(6));
    await expect(client.placeStop(command)).rejects.toThrow(
      "CTRADER_ORDER_TYPE_ACKNOWLEDGEMENT_MISMATCH",
    );
    await expect(client.placeStopLimit(command, "5")).rejects.toThrow(
      "CTRADER_ORDER_EXECUTION_TYPE_MISMATCH",
    );
    await expect(
      client.placeStop({ ...command, executionOrderType: "STOP_LIMIT" }),
    ).rejects.toThrow("CTRADER_ORDER_EXECUTION_TYPE_MISMATCH");
    request.mockResolvedValue(response(4));
    await client.amendPositionProtection("801", "XAUUSD", "4398.95", "4397.36");
    expect(request).toHaveBeenLastCalledWith(
      CTraderPayload.AMEND_POSITION_SLTP_REQ,
      {
        ctidTraderAccountId: 123,
        positionId: 801,
        stopLoss: 4398.95,
        takeProfit: 4397.36,
        stopLossTriggerMethod: 1,
      },
      [CTraderPayload.EXECUTION_EVENT],
    );
    await expect(
      client.amendPositionProtection("801", "XAUUSD", "4398.951", "4397.36"),
    ).rejects.toThrow("CTRADER_POSITION_PROTECTION_INVALID");
    const readOnly = new CTraderClient({
      clientId: "fixture",
      clientSecret: "fixture",
      accountId: "123",
      connectionMode: "demo",
      tokenManager,
      transport,
      allowOrderCommands: false,
    });
    await expect(
      readOnly.amendPositionProtection("801", "XAUUSD", "4398.95", "4397.36"),
    ).rejects.toThrow();
  });
});
