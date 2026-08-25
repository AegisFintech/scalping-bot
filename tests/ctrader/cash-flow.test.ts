import { describe, expect, it } from "vitest";

import {
  normalizeDealHistory,
  normalizeExternalCashFlows,
  normalizePositionUnrealizedPnl,
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

describe("cTrader position P/L normalization", () => {
  it("selects one broker position and preserves exact scaled money", () => {
    expect(
      normalizePositionUnrealizedPnl(
        {
          moneyDigits: 2,
          positionUnrealizedPnL: [
            {
              positionId: "41",
              grossUnrealizedPnL: "999",
              netUnrealizedPnL: "950",
            },
            {
              positionId: "42",
              grossUnrealizedPnL: "1234",
              netUnrealizedPnL: "1200",
            },
          ],
        },
        "42",
        new Date("2026-08-25T04:00:00.000Z"),
      ),
    ).toEqual({
      grossUnrealizedPnl: "12.34",
      netUnrealizedPnl: "12",
      capturedAt: "2026-08-25T04:00:00.000Z",
    });
  });

  it("fails closed on missing, duplicate, or malformed position P/L", () => {
    const payload = {
      moneyDigits: 2,
      positionUnrealizedPnL: [
        {
          positionId: "42",
          grossUnrealizedPnL: "1234",
          netUnrealizedPnL: "1200",
        },
      ],
    };
    expect(() => normalizePositionUnrealizedPnl(payload, "43")).toThrow(
      "CTRADER_POSITION_PNL_MISSING",
    );
    expect(() =>
      normalizePositionUnrealizedPnl(
        {
          ...payload,
          positionUnrealizedPnL: [
            ...payload.positionUnrealizedPnL,
            payload.positionUnrealizedPnL[0],
          ],
        },
        "42",
      ),
    ).toThrow("CTRADER_POSITION_PNL_AMBIGUOUS");
    expect(() =>
      normalizePositionUnrealizedPnl({ ...payload, moneyDigits: 13 }, "42"),
    ).toThrow("CTRADER_POSITION_PNL_MONEY_DIGITS_INVALID");
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
