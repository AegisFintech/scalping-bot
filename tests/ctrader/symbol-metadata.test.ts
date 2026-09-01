import { describe, expect, it, vi } from "vitest";

import {
  CTraderClient,
  normalizeSymbolCommission,
  normalizeSymbolPip,
} from "../../packages/ctrader-client/src/client.js";
import { CTraderPayload } from "../../packages/ctrader-client/src/protocol.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";

describe("cTrader symbol commission metadata", () => {
  it("uses broker pipPosition instead of inferring a pip from display digits", () => {
    expect(normalizeSymbolPip(2, 2)).toEqual({
      digits: 2,
      pipPosition: 2,
      pipSize: "0.01",
    });
    expect(() => normalizeSymbolPip(2, 3)).toThrow(
      "CTRADER_SYMBOL_PIP_POSITION_INVALID",
    );
  });

  it("decodes the configured demo broker precise commission fields", () => {
    expect(
      normalizeSymbolCommission({
        commissionType: 1,
        preciseTradingCommissionRate: "3000000000",
        preciseMinCommission: "0",
        minCommissionType: 2,
        minCommissionAsset: "USD",
        pnlConversionFeeRate: 0,
      }),
    ).toEqual({
      type: "USD_PER_MILLION_USD",
      rate: "30",
      minimum: "0",
      minimumType: "QUOTE_CURRENCY",
      minimumAsset: "USD",
      pnlConversionFeeRate: "0",
    });
  });

  it("rejects missing or unknown precise broker commission terms", () => {
    expect(() =>
      normalizeSymbolCommission({
        commissionType: 9,
        preciseTradingCommissionRate: "3000000000",
        preciseMinCommission: "0",
        minCommissionType: 2,
        minCommissionAsset: "USD",
      }),
    ).toThrow("CTRADER_COMMISSION_TYPE_UNSUPPORTED");
    expect(() =>
      normalizeSymbolCommission({
        commissionType: 1,
        preciseMinCommission: "0",
        minCommissionType: 2,
        minCommissionAsset: "USD",
      }),
    ).toThrow("CTRADER_FIELD_INVALID:preciseTradingCommissionRate");
  });

  it("loads asset names and complete fee metadata through read-only discovery", async () => {
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
    });
    const client = new CTraderClient({
      clientId: "fixture",
      clientSecret: "fixture",
      accountId: "123",
      connectionMode: "demo",
      tokenManager,
      transport,
    });

    await client.connect();
    const metadata = await client.discoverSymbol("XAUUSD");

    expect(metadata).toMatchObject({
      symbolName: "XAUUSD",
      pipPosition: 2,
      pipSize: "0.01",
      baseAsset: "XAU",
      quoteAsset: "USD",
      accountAsset: "USD",
      quoteToAccountConversionRate: "1",
      commission: {
        type: "USD_PER_MILLION_USD",
        rate: "30",
        minimum: "0",
      },
    });
    expect(request).toHaveBeenCalledWith(
      CTraderPayload.ASSET_LIST_REQ,
      { ctidTraderAccountId: 123 },
      [CTraderPayload.ASSET_LIST_RES],
    );
  });
});
