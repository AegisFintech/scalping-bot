import { describe, expect, it, vi } from "vitest";
import { CTraderClient } from "../../packages/ctrader-client/src/client.js";
import { CTraderPayload as P } from "../../packages/ctrader-client/src/protocol.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";

describe("raw broker history and reconciliation trust boundary", () => {
  it.each(["orders", "deals", "positions", "pending"] as const)(
    "rejects malformed %s rather than reporting an empty account",
    async (kind) => {
      const transport = new CTraderJsonTransport({ host: "invalid.test" });
      vi.spyOn(transport, "connect").mockResolvedValue(undefined);
      vi.spyOn(transport, "onMessage").mockImplementation(() => () => {});
      const request = vi
        .spyOn(transport, "request")
        .mockImplementation(async (payloadType) => {
          const payloads: Record<number, Record<string, unknown>> = {
            [P.APPLICATION_AUTH_REQ]: {},
            [P.ACCOUNT_AUTH_REQ]: {},
            [P.GET_ACCOUNTS_REQ]: {
              ctidTraderAccount: [
                { ctidTraderAccountId: "123", isLive: false },
              ],
            },
            [P.TRADER_REQ]: { trader: { depositAssetId: "2" } },
            [P.ASSET_LIST_REQ]: { asset: [{ assetId: "2", name: "USD" }] },
          };
          const payload = payloads[payloadType];
          if (!payload) throw new Error("UNEXPECTED_REQUEST");
          return { payloadType, payload };
        });
      const client = new CTraderClient({
        clientId: "fixture",
        clientSecret: "fixture",
        connectionMode: "demo",
        allowOrderCommands: false,
        transport,
        tokenManager: new CTraderTokenManager({
          clientId: "fixture",
          clientSecret: "fixture",
          tokenUrl: "https://invalid.test/token",
          accessToken: "fixture",
          refreshToken: "",
          accessTokenExpiresAt: new Date(Date.now() + 3600000),
        }),
      });
      await client.connect();
      const key =
        kind === "deals" ? "deal" : kind === "positions" ? "position" : "order";
      request.mockResolvedValue({
        payloadType: P.RECONCILE_RES,
        payload: { [key]: {}, hasMore: false },
      });
      const from = new Date(Date.now() - 60_000),
        until = new Date();
      await expect(
        kind === "orders"
          ? client.orderHistoryRaw(from, until)
          : kind === "deals"
            ? client.dealHistoryRaw(from, until)
            : client.reconcileRaw(),
      ).rejects.toThrow("CTRADER_REPEATED_FIELD_INVALID");
      await client.disconnect();
    },
  );
});
