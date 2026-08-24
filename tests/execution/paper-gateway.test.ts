import { describe, expect, it } from "vitest";

import { PaperGateway } from "../../apps/execution-service/src/paper-gateway.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";

function commands(): [PendingOrderCommand, PendingOrderCommand] {
  const base = {
    analysisId: "analysis-1",
    orderGroupId: "group-1",
    symbol: "XAUUSD",
    volume: "10",
    stopLoss: "99",
    takeProfit: "105",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    strategyLabel: "scalper:v1",
  };
  return [
    {
      ...base,
      idempotencyKey: "buy-key",
      clientOrderId: "buy-1",
      side: "BUY",
      entryPrice: "101",
    },
    {
      ...base,
      idempotencyKey: "sell-key",
      clientOrderId: "sell-1",
      side: "SELL",
      entryPrice: "98",
      stopLoss: "100",
      takeProfit: "94",
    },
  ];
}

describe("paper gateway", () => {
  it("is idempotent and never submits to a broker", async () => {
    const gateway = new PaperGateway();
    expect(gateway.canSubmitToBroker).toBe(false);
    expect((await gateway.placeOco(commands())).idempotentReplay).toBe(false);
    expect((await gateway.placeOco(commands())).idempotentReplay).toBe(true);
  });

  it("fills one leg and cancels its OCO peer", async () => {
    const gateway = new PaperGateway();
    await gateway.placeOco(commands());
    const changes = gateway.processQuote(
      "XAUUSD",
      "100.90",
      "101.00",
      new Date(),
    );
    expect(
      changes.find((order) => order.clientOrderId === "buy-1")?.state,
    ).toBe("FILLED");
    expect(
      changes.find((order) => order.clientOrderId === "sell-1")?.state,
    ).toBe("CANCELLED");
    expect((await gateway.reconcile("XAUUSD")).certain).toBe(true);
  });

  it("blocks on a simulated dual-fill race", async () => {
    const gateway = new PaperGateway({
      maxSlippagePoints: "20",
      maxSlippageBps: "20",
    });
    await gateway.placeOco(commands());
    gateway.processQuote("XAUUSD", "97.90", "101.10", new Date());
    const state = await gateway.reconcile("XAUUSD");
    expect(state.certain).toBe(false);
    expect(state.relevantPositionCount).toBe(2);
  });

  it("tracks a filled position through a conservative stop exit", async () => {
    const gateway = new PaperGateway();
    await gateway.placeOco(commands());
    gateway.processQuote("XAUUSD", "100.90", "101.00", new Date());
    expect((await gateway.reconcile("XAUUSD")).relevantPositionCount).toBe(1);
    gateway.processQuote("XAUUSD", "98.90", "99.00", new Date());
    expect(gateway.positions()[0]).toMatchObject({
      state: "CLOSED",
      exitPrice: "99",
      reasonCode: "PAPER_STOP_LOSS",
    });
    expect(gateway.accountMark("XAUUSD", "98.90", "99.00")).toMatchObject({
      realizedPnl: "-20",
      unrealizedPnl: "0",
      relevantPositionCount: 0,
    });
    expect((await gateway.reconcile("XAUUSD")).relevantPositionCount).toBe(0);
  });
});
