import { describe, expect, it, vi } from "vitest";

import {
  CTraderDemoGateway,
  DEMO_ACKNOWLEDGEMENT,
  type CTraderTradingClient,
} from "../../apps/execution-service/src/demo-gateway.js";
import type { PendingOrderCommand } from "../../packages/contracts/src/index.js";
import type {
  BrokerExecution,
  RawReconciliation,
} from "../../packages/ctrader-client/src/client.js";

function command(side: "BUY" | "SELL"): PendingOrderCommand {
  return {
    idempotencyKey: `idempotency-${side}`,
    analysisId: "analysis",
    orderGroupId: "group",
    clientOrderId: `client-${side}`,
    symbol: "XAUUSD",
    side,
    volume: "100",
    entryPrice: side === "BUY" ? "2001" : "1999",
    stopLoss: side === "BUY" ? "2000" : "2000",
    takeProfit: side === "BUY" ? "2003" : "1997",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    strategyLabel: "ctrader-ai-scalper:test",
  };
}

function event(
  command: PendingOrderCommand,
  orderStatus: number,
): BrokerExecution {
  return {
    executionType: orderStatus === 5 ? 5 : 2,
    order: {
      orderId: command.side === "BUY" ? "101" : "102",
      orderStatus,
      clientOrderId: command.clientOrderId,
      executedVolume: "0",
      tradeData: {
        symbolId: "7",
        volume: command.volume,
        tradeSide: command.side === "BUY" ? 1 : 2,
        label: command.strategyLabel,
      },
    },
    position: null,
    deal: null,
    errorCode: null,
    receivedAt: new Date().toISOString(),
  };
}

class MockClient implements CTraderTradingClient {
  readonly tokenExpiryKnown = true;
  readonly tradePermission = true;
  readonly orders: Record<string, unknown>[] = [];
  readonly cancelled: string[] = [];
  failSecond = false;
  #handler: ((execution: BrokerExecution) => void) | null = null;

  onExecution(handler: (execution: BrokerExecution) => void): () => void {
    this.#handler = handler;
    return () => {
      this.#handler = null;
    };
  }

  placeStop(order: PendingOrderCommand): Promise<BrokerExecution> {
    if (this.failSecond && order.side === "SELL")
      return Promise.reject(new Error("broker rejected"));
    const result = event(order, 1);
    this.orders.push(result.order as Record<string, unknown>);
    this.#handler?.(result);
    return Promise.resolve(result);
  }

  cancelOrder(brokerOrderId: string): Promise<BrokerExecution> {
    this.cancelled.push(brokerOrderId);
    const source = this.orders.find((order) => order.orderId === brokerOrderId);
    if (source === undefined) return Promise.reject(new Error("missing"));
    source.orderStatus = 5;
    const result: BrokerExecution = {
      executionType: 5,
      order: source,
      position: null,
      deal: null,
      errorCode: null,
      receivedAt: new Date().toISOString(),
    };
    this.#handler?.(result);
    return Promise.resolve(result);
  }

  fill(clientOrderId: string): void {
    const source = this.orders.find(
      (order) => order.clientOrderId === clientOrderId,
    );
    if (source === undefined) throw new Error("missing");
    source.orderStatus = 2;
    source.executedVolume = (
      source.tradeData as Record<string, unknown>
    ).volume;
    const data = source.tradeData as Record<string, unknown>;
    const result: BrokerExecution = {
      executionType: 3,
      order: source,
      position: {
        positionId: "801",
        positionStatus: 1,
        price: 2001.01,
        tradeData: data,
      },
      deal: {
        dealId: "901",
        orderId: source.orderId,
        positionId: "801",
        volume: data.volume,
        filledVolume: data.volume,
        symbolId: data.symbolId,
        createTimestamp: Date.now(),
        executionTimestamp: Date.now(),
        executionPrice: 2001.01,
        tradeSide: data.tradeSide,
        dealStatus: 2,
        label: data.label,
      },
      errorCode: null,
      receivedAt: new Date().toISOString(),
    };
    this.#handler?.(result);
  }

  reconcileRaw(): Promise<RawReconciliation> {
    return Promise.resolve({
      receivedAt: new Date().toISOString(),
      positions: [],
      orders: this.orders,
    });
  }
}

describe("cTrader demo gateway", () => {
  it("is disabled unless separately enabled and acknowledged", async () => {
    const gateway = new CTraderDemoGateway({
      client: new MockClient(),
      symbolId: "7",
      symbolName: "XAUUSD",
      tickSize: "0.01",
      maxSlippagePoints: "5",
      maxSlippageBps: "2",
    });
    await expect(
      gateway.placeOco([command("BUY"), command("SELL")]),
    ).rejects.toThrow("DEMO_ORDER_PLACEMENT_DISABLED");
  });

  it("cancels the first leg if the second leg fails", async () => {
    const client = new MockClient();
    client.failSecond = true;
    const gateway = new CTraderDemoGateway({
      client,
      symbolId: "7",
      symbolName: "XAUUSD",
      placementEnabled: true,
      acknowledgement: DEMO_ACKNOWLEDGEMENT,
      tickSize: "0.01",
      maxSlippagePoints: "5",
      maxSlippageBps: "2",
    });
    await expect(
      gateway.placeOco([command("BUY"), command("SELL")]),
    ).rejects.toThrow("DEMO_SECOND_LEG_FAILED_FIRST_LEG_CANCELLED");
    expect(client.cancelled).toEqual(["101"]);
  });

  it("cancels the pending peer once after a broker fill", async () => {
    const client = new MockClient();
    const gateway = new CTraderDemoGateway({
      client,
      symbolId: "7",
      symbolName: "XAUUSD",
      placementEnabled: true,
      acknowledgement: DEMO_ACKNOWLEDGEMENT,
      tickSize: "0.01",
      maxSlippagePoints: "5",
      maxSlippageBps: "2",
    });
    await gateway.placeOco([command("BUY"), command("SELL")]);
    client.fill("client-BUY");
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));
    client.fill("client-BUY");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.cancelled).toEqual(["102"]);
  });
});
