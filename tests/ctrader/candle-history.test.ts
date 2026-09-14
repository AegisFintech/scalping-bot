import { describe, expect, it, vi } from "vitest";
import { CTraderClient } from "../../packages/ctrader-client/src/client.js";
import {
  CTraderPayload,
  type CTraderEnvelope,
} from "../../packages/ctrader-client/src/protocol.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";

const NOW_MS = 1_788_000_060_000; // an exact UTC minute boundary
const M1 = 60_000;

function trendbars(toTimestamp: number, count: number) {
  const boundary = Math.floor(toTimestamp / M1) * M1;
  const bars = [];
  for (let index = count; index >= 1; index -= 1) {
    const start = boundary - index * M1;
    bars.push({
      utcTimestampInMinutes: String(start / M1),
      low: "440000000",
      deltaOpen: "0",
      deltaHigh: "50000",
      deltaClose: "10000",
      volume: "100",
    });
  }
  return bars;
}

async function buildClient() {
  const transport = new CTraderJsonTransport({ host: "invalid.test" });
  vi.spyOn(transport, "connect").mockResolvedValue(undefined);
  let messageHandler: (message: CTraderEnvelope) => void = () => {
    throw new Error("MESSAGE_HANDLER_NOT_REGISTERED");
  };
  vi.spyOn(transport, "onMessage").mockImplementation((handler) => {
    messageHandler = handler;
    return () => {};
  });
  const request = vi
    .spyOn(transport, "request")
    .mockImplementation((payloadType: number, payload?: unknown) => {
      if (payloadType === CTraderPayload.GET_TRENDBARS_REQ) {
        const body = (payload ?? {}) as Record<string, unknown>;
        const to = Number(body.toTimestamp);
        return Promise.resolve({
          payloadType,
          payload: { trendbar: trendbars(to + 1, 3) },
        });
      }
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
      const staticPayload = payloads[payloadType];
      if (staticPayload === undefined)
        throw new Error(`UNEXPECTED_REQUEST:${payloadType}`);
      return Promise.resolve({ payloadType, payload: staticPayload });
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
    allowOrderCommands: false,
  });
  await client.connect();
  messageHandler({
    payloadType: CTraderPayload.SPOT_EVENT,
    payload: { symbolId: "77", timestamp: NOW_MS },
  });
  vi.spyOn(client, "getServerTime").mockResolvedValue(
    new Date(NOW_MS).toISOString(),
  );
  await client.discoverSymbol("XAUUSD");
  return { client, request };
}

describe("paginated completed candle history", () => {
  it("requests the current boundary without an explicit timestamp", async () => {
    const { client, request } = await buildClient();
    const candles = await client.getCompletedCandles("77", "M1", 3);
    expect(candles).toHaveLength(3);
    const lastCall = request.mock.calls.find(
      (call) => call[0] === CTraderPayload.GET_TRENDBARS_REQ,
    );
    expect(lastCall).toBeDefined();
    const body = lastCall?.[1] as Record<string, unknown>;
    expect(body.toTimestamp).toBe(NOW_MS - 1);
    expect(body.fromTimestamp).toBe(NOW_MS - 9 * M1);
    expect(body.period).toBe(1);
  });

  it("pages backwards from an explicit upper timestamp", async () => {
    const { client, request } = await buildClient();
    const to = NOW_MS - 3 * M1;
    await client.getCompletedCandles("77", "M1", 3, to);
    const lastCall = request.mock.calls.find(
      (call) => call[0] === CTraderPayload.GET_TRENDBARS_REQ,
    );
    const body = lastCall?.[1] as Record<string, unknown>;
    expect(body.toTimestamp).toBe(to - 1);
    expect(body.fromTimestamp).toBe(to - 9 * M1);
  });

  it("clamps a future upper timestamp to the server boundary", async () => {
    const { client, request } = await buildClient();
    await client.getCompletedCandles("77", "M1", 3, NOW_MS + 600_000);
    const lastCall = request.mock.calls.find(
      (call) => call[0] === CTraderPayload.GET_TRENDBARS_REQ,
    );
    const body = lastCall?.[1] as Record<string, unknown>;
    expect(body.toTimestamp).toBe(NOW_MS - 1);
  });

  it("rejects invalid timestamps and insufficient history", async () => {
    const { client, request } = await buildClient();
    for (const invalid of [0, -5, 1.5, Number.NaN]) {
      await expect(
        client.getCompletedCandles("77", "M1", 3, invalid),
      ).rejects.toThrow("CTRADER_CANDLE_TO_TIMESTAMP_INVALID");
    }
    request.mockImplementationOnce(() =>
      Promise.resolve({
        payloadType: CTraderPayload.GET_TRENDBARS_REQ,
        payload: { trendbar: [] },
      }),
    );
    await expect(client.getCompletedCandles("77", "M1", 3)).rejects.toThrow(
      "CTRADER_COMPLETED_CANDLES_INSUFFICIENT",
    );
  });
});
