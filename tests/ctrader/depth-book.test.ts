import { describe, expect, it } from "vitest";

import { CTraderDepthBook } from "../../packages/ctrader-client/src/depth-book.js";

describe("cTrader depth book", () => {
  it("applies incremental changes and marks reconnects discontinuous", () => {
    const book = new CTraderDepthBook();
    book.apply(
      {
        newQuotes: [
          { id: "1", size: "100", bid: "200000000" },
          { id: "2", size: "200", ask: "200010000" },
        ],
        deletedQuotes: [],
      },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(book.snapshot(1, new Date("2026-01-01T00:00:01Z"))).toMatchObject({
      bids: [{ price: "2000", size: "1" }],
      asks: [{ price: "2000.1", size: "2" }],
      complete: true,
      discontinuity: false,
    });
    book.markReconnect();
    expect(() => book.snapshot(1)).toThrow("CTRADER_DEPTH_UNAVAILABLE");
  });
});
