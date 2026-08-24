import { describe, expect, it } from "vitest";

import {
  normalizeDealHistory,
  normalizeExternalCashFlows,
} from "../../packages/ctrader-client/src/client.js";
import { protocolInteger } from "../../packages/ctrader-client/src/protocol.js";

describe("cTrader cash-flow normalization", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const to = new Date("2026-01-01T23:59:59.999Z");

  it("adjusts for capital flows but leaves trading charges in performance", () => {
    expect(
      normalizeExternalCashFlows(
        [
          {
            operationType: 0,
            balanceHistoryId: "1",
            delta: "10000",
            moneyDigits: 2,
            changeBalanceTimestamp: from.getTime() + 1,
          },
          {
            operationType: 1,
            balanceHistoryId: "2",
            delta: "-2500",
            moneyDigits: 2,
            changeBalanceTimestamp: from.getTime() + 2,
          },
          {
            operationType: 22,
            balanceHistoryId: "3",
            delta: "-100",
            moneyDigits: 2,
            changeBalanceTimestamp: from.getTime() + 3,
          },
        ],
        from,
        to,
      ),
    ).toMatchObject({ netFlows: "75", operationCount: 2 });
  });

  it("fails closed on unknown balance operation types", () => {
    expect(() =>
      normalizeExternalCashFlows(
        [
          {
            operationType: 999,
            balanceHistoryId: "1",
            delta: "1",
            moneyDigits: 2,
            changeBalanceTimestamp: from.getTime() + 1,
          },
        ],
        from,
        to,
      ),
    ).toThrow("CTRADER_CASH_FLOW_TYPE_UNKNOWN");
  });
});

describe("cTrader JSON integer serialization", () => {
  it("converts validated protocol integers to JSON numbers", () => {
    expect(protocolInteger("123456", "INVALID")).toBe(123456);
  });

  it("fails closed instead of losing precision", () => {
    expect(() =>
      protocolInteger("9007199254740992", "CTRADER_ID_UNSAFE"),
    ).toThrow("CTRADER_ID_UNSAFE");
  });
});

describe("cTrader deal-history evidence", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const to = new Date("2026-01-01T12:00:00.000Z");

  it("reports an empty bounded broker day", () => {
    expect(normalizeDealHistory([], false, from, to)).toMatchObject({
      dealCount: 0,
      hasMore: false,
    });
  });

  it("fails closed on malformed pagination or an unbounded range", () => {
    expect(() => normalizeDealHistory([], "false", from, to)).toThrow(
      "CTRADER_DEAL_HISTORY_HAS_MORE_INVALID",
    );
    expect(() =>
      normalizeDealHistory(
        [],
        false,
        from,
        new Date("2026-01-09T00:00:00.000Z"),
      ),
    ).toThrow("CTRADER_DEAL_HISTORY_RANGE_INVALID");
  });
});
