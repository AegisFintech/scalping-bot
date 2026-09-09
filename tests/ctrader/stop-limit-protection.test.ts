import { describe, expect, it } from "vitest";

import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
import {
  stopLimitProtectionFields,
  stopProtectionFields,
  stopLimitLifetimeFields,
  validateGtcAcknowledgement,
} from "../../packages/ctrader-client/src/client.js";

function command(side: "BUY" | "SELL"): PendingOrderCommand {
  return {
    idempotencyKey: `key-${side}`,
    analysisId: "analysis",
    orderGroupId: "group",
    clientOrderId: `client-${side}`,
    symbol: "XAUUSD",
    side,
    volume: "100",
    entryPrice: side === "BUY" ? "4437.35" : "4419.27",
    stopLoss: side === "BUY" ? "4436.27" : "4420.35",
    takeProfit: side === "BUY" ? "4437.89" : "4418.73",
    expiresAt: "2026-09-01T08:00:00.000Z",
    strategyLabel: "ctrader-ai-scalper:test",
  };
}

describe("cTrader stop-limit protection", () => {
  it.each(["BUY", "SELL"] as const)(
    "encodes %s SL/TP distances relative to the actual fill",
    (side) => {
      expect(
        stopLimitProtectionFields(command(side), { digits: 2 }, "5"),
      ).toEqual({
        orderType: 6,
        stopPrice: side === "BUY" ? 4437.35 : 4419.27,
        slippageInPoints: 5,
        relativeStopLoss: 108000,
        relativeTakeProfit: 54000,
      });
    },
  );

  it.each(["0", "0.5", "2147483648"])(
    "rejects invalid stop-limit slippage %s",
    (value) => {
      expect(() =>
        stopLimitProtectionFields(command("BUY"), { digits: 2 }, value),
      ).toThrow("CTRADER_STOP_LIMIT_SLIPPAGE_INVALID");
    },
  );

  it("rejects a relative protection distance that the protocol cannot represent exactly", () => {
    expect(() =>
      stopLimitProtectionFields(
        { ...command("BUY"), takeProfit: "4437.350001" },
        { digits: 6 },
        "5",
      ),
    ).toThrow("CTRADER_RELATIVE_TAKE_PROFIT_INVALID");
  });

  it("rejects invalid side geometry before broker submission", () => {
    expect(() =>
      stopLimitProtectionFields(
        { ...command("SELL"), takeProfit: "4420" },
        { digits: 2 },
        "5",
      ),
    ).toThrow("CTRADER_RELATIVE_PROTECTION_GEOMETRY_INVALID");
  });
});

describe("broker lifetime encoding", () => {
  const now = Date.parse("2026-09-01T07:59:30Z");
  it("encodes GTC without expirationTimestamp while preserving fresh submission", () => {
    expect(
      stopLimitLifetimeFields({ ...command("BUY"), timeInForce: "GTC" }, now),
    ).toEqual({ timeInForce: 2 });
    expect(stopLimitLifetimeFields(command("BUY"), now)).toEqual({
      timeInForce: 1,
      expirationTimestamp: Date.parse(command("BUY").expiresAt),
    });
  });
  it.each(["invalid", "2026-09-01T07:59:00Z", "2026-09-01T08:00:00"])(
    "rejects stale or ambiguous GTC submission %s",
    (expiresAt) => {
      expect(() =>
        stopLimitLifetimeFields(
          { ...command("BUY"), timeInForce: "GTC", expiresAt },
          now,
        ),
      ).toThrow("ORDER_SUBMISSION_EXPIRED_OR_INVALID");
    },
  );
  it("rejects an unknown lifetime instead of treating it as non-expiring", () => {
    expect(() =>
      stopLimitLifetimeFields(
        { ...command("BUY"), timeInForce: "UNKNOWN" as "GTC" },
        now,
      ),
    ).toThrow("ORDER_TIME_IN_FORCE_INVALID");
  });
});

it("requires the broker to acknowledge GTC without a dated expiry", () => {
  const c = { ...command("BUY"), timeInForce: "GTC" as const };
  expect(() =>
    validateGtcAcknowledgement(c, { orderStatus: 1, timeInForce: 2 }),
  ).not.toThrow();
  expect(() =>
    validateGtcAcknowledgement(c, { orderStatus: 1, timeInForce: 1 }),
  ).toThrow("CTRADER_GTC_ACKNOWLEDGEMENT_MISMATCH");
  expect(() =>
    validateGtcAcknowledgement(c, {
      orderStatus: 1,
      timeInForce: 2,
      expirationTimestamp: 123,
    }),
  ).toThrow("CTRADER_GTC_ACKNOWLEDGEMENT_MISMATCH");
});

describe("ordinary stop protection", () => {
  it.each(["BUY", "SELL"] as const)(
    "encodes %s without a fill-price ceiling",
    (side) => {
      expect(
        stopProtectionFields(
          { ...command(side), executionOrderType: "STOP" },
          { digits: 2 },
        ),
      ).toEqual({
        orderType: 3,
        stopPrice: side === "BUY" ? 4437.35 : 4419.27,
        relativeStopLoss: 108000,
        relativeTakeProfit: 54000,
      });
    },
  );
  it("rejects invalid protection and inexact entry precision", () => {
    expect(() =>
      stopProtectionFields(
        { ...command("SELL"), stopLoss: "4418" },
        { digits: 2 },
      ),
    ).toThrow("CTRADER_RELATIVE_PROTECTION_GEOMETRY_INVALID");
    expect(() =>
      stopProtectionFields(
        { ...command("BUY"), entryPrice: "4437.351" },
        { digits: 2 },
      ),
    ).toThrow();
  });
});
