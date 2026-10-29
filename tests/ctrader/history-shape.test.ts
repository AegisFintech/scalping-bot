import { describe, expect, it, vi } from "vitest";
import { CTraderClient } from "../../packages/ctrader-client/src/client.js";
import { CTraderPayload as P } from "../../packages/ctrader-client/src/protocol.js";
import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";
import { CTraderJsonTransport } from "../../packages/ctrader-client/src/transport.js";

describe("raw broker history and reconciliation trust boundary", () => {
  describe.each(["orders", "deals", "positions", "pending"] as const)(
    "%s",
    (kind) => {
      it.each([
        "malformed",
        "missing-account",
        "wrong-account",
        "valid-empty",
      ] as const)(
        "validates %s at the broker response boundary",
        async (scenario) => {
          const transport = new CTraderJsonTransport({ host: "invalid.test" });
          vi.spyOn(transport, "connect").mockResolvedValue(undefined);
          vi.spyOn(transport, "onMessage").mockImplementation(() => () => {});
          const request = vi
            .spyOn(transport, "request")
            .mockImplementation((payloadType) => {
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
              return Promise.resolve({ payloadType, payload });
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
            kind === "deals"
              ? "deal"
              : kind === "positions"
                ? "position"
                : "order";
          request.mockResolvedValue({
            payloadType: P.RECONCILE_RES,
            payload: {
              ...(scenario === "missing-account"
                ? {}
                : {
                    ctidTraderAccountId:
                      scenario === "wrong-account" ? "456" : "123",
                  }),
              ...(scenario === "malformed" ? { [key]: {} } : {}),
              hasMore: false,
            },
          });
          const from = new Date(Date.now() - 60_000),
            until = new Date();
          const response =
            kind === "orders"
              ? client.orderHistoryRaw(from, until)
              : kind === "deals"
                ? client.dealHistoryRaw(from, until)
                : client.reconcileRaw();
          if (scenario === "valid-empty") {
            const result = await response;
            expect("orders" in result ? result.orders : result.deals).toEqual(
              [],
            );
            if ("positions" in result) expect(result.positions).toEqual([]);
          } else
            await expect(response).rejects.toThrow(
              scenario === "malformed"
                ? "CTRADER_REPEATED_FIELD_INVALID"
                : scenario === "wrong-account"
                  ? "CTRADER_RESPONSE_ACCOUNT_MISMATCH"
                  : "CTRADER_FIELD_INVALID:ctidTraderAccountId",
            );
          await client.disconnect();
        },
      );
    },
  );
});
