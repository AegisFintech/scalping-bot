import { describe, expect, it } from "vitest";

import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
import { stopLimitProtectionFields } from "../../packages/ctrader-client/src/client.js";

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
