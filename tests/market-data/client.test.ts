import { describe, expect, it } from "vitest";

import { MarketDataHttpClient } from "../../packages/market-data-client/src/client.js";

describe("market-data HTTP client", () => {
  it("rejects URLs containing credentials", () => {
    expect(
      () =>
        new MarketDataHttpClient({
          baseUrl: "http://user:secret@127.0.0.1:8081",
        }),
    ).toThrow("MARKET_DATA_BASE_URL_CREDENTIALS_FORBIDDEN");
  });
});
