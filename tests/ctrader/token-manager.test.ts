import { describe, expect, it, vi } from "vitest";

import { CTraderTokenManager } from "../../packages/ctrader-client/src/token-manager.js";

describe("cTrader token manager", () => {
  it("refreshes an access token when expiry is unknown", async () => {
    const refreshed = vi.fn();
    const manager = new CTraderTokenManager({
      clientId: "client",
      clientSecret: "secret",
      tokenUrl: "https://example.invalid/token",
      accessToken: "old",
      refreshToken: "refresh",
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: "new",
              refreshToken: "rotated",
              expiresIn: "3600",
            }),
            { status: 200 },
          ),
        ),
      ),
      onRefresh: refreshed,
    });
    expect(manager.expiryKnown).toBe(false);
    await expect(manager.accessToken()).resolves.toBe("new");
    expect(manager.expiryKnown).toBe(true);
    expect(refreshed).toHaveBeenCalledOnce();
  });
});
