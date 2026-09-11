import { describe, expect, it, vi } from "vitest";

import {
  CTraderDemoGateway,
  DEMO_ACKNOWLEDGEMENT,
  type CTraderTradingClient,
} from "../../apps/execution-service/src/demo-gateway.js";
import type {
  GatewayOrder,
  PendingOrderCommand,
} from "../../packages/contracts/src/index.js";
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

function terminalOrders(
  buy = "client-BUY",
  sell = "client-SELL",
): GatewayOrder[] {
  return [
    {
      clientOrderId: buy,
      brokerOrderId: "101",
      state: "FILLED",
      filledVolume: "100",
      updatedAt: new Date().toISOString(),
      reasonCode: null,
    },
    {
      clientOrderId: sell,
      brokerOrderId: "102",
      state: "CANCELLED",
      filledVolume: "0",
      updatedAt: new Date().toISOString(),
      reasonCode: null,
    },
  ];
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
      orderType: command.executionOrderType === "STOP" ? 3 : 6,
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
  readonly placementSlippagePoints: string[] = [];
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

  placeStopLimit(
    order: PendingOrderCommand,
    maxSlippagePoints: string,
  ): Promise<BrokerExecution> {
    if (this.failSecond && order.side === "SELL")
      return Promise.reject(new Error("broker rejected"));
    this.placementSlippagePoints.push(maxSlippagePoints);
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

  fill(clientOrderId: string, executionPrice = 2001.01): void {
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
        price: executionPrice,
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
        executionPrice,
        tradeSide: data.tradeSide,
        dealStatus: 2,
        label: data.label,
      },
      errorCode: null,
      receivedAt: new Date().toISOString(),
    };
    this.#handler?.(result);
  }

  deliver(execution: BrokerExecution): void {
    this.#handler?.(execution);
  }

  closeWithBrokerChild(clientOrderId: string): void {
    const source = this.orders.find(
      (order) => order.clientOrderId === clientOrderId,
    );
    if (source === undefined) throw new Error("missing");
    const data = source.tradeData as Record<string, unknown>;
    const closingOrder = {
      ...source,
      orderId: "601",
      orderType: 4,
      closingOrder: true,
      orderStatus: 2,
    };
    this.orders.push(closingOrder);
    this.#handler?.({
      executionType: 3,
      order: closingOrder,
      position: {
        positionId: "801",
        positionStatus: 2,
        price: 2001.01,
        tradeData: { ...data, volume: "0" },
      },
      deal: {
        dealId: "902",
        orderId: "601",
        positionId: "801",
        volume: data.volume,
        filledVolume: data.volume,
        symbolId: data.symbolId,
        executionTimestamp: Date.now(),
        executionPrice: 1999,
        dealStatus: 2,
        label: data.label,
      },
      errorCode: null,
      receivedAt: new Date().toISOString(),
    });
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
  function restartedGateway(client: MockClient) {
    return new CTraderDemoGateway({
      client,
      symbolId: "7",
      symbolName: "XAUUSD",
      tickSize: "0.01",
      maxSlippagePoints: "5",
      maxSlippageBps: "2",
    });
  }

  it("cancels an existing owned GTC order after restart without replaying placement", async () => {
    const client = new MockClient();
    const old = {
      ...command("BUY"),
      timeInForce: "GTC" as const,
      expiresAt: "2026-01-01T00:00:00Z",
    };
    client.orders.push(event(old, 1).order!);
    const gateway = restartedGateway(client);
    await expect(
      gateway.cancelStrategyOrder(
        old.clientOrderId,
        "OCO_PEER_UNFILLED_TERMINAL",
      ),
    ).resolves.toMatchObject({
      state: "CANCELLED",
      filledVolume: "0",
      brokerOrderId: "101",
    });
    await gateway.cancelStrategyOrder(
      old.clientOrderId,
      "OCO_PEER_UNFILLED_TERMINAL",
    );
    expect(client.cancelled).toEqual(["101"]);
    expect(client.placementSlippagePoints).toEqual([]);
  });

  it.each([
    "missing",
    "duplicate",
    "manual",
    "symbol",
    "closing",
    "type",
    "state",
  ])(
    "rejects %s broker evidence before cancelling a recovered order",
    async (failure) => {
      const client = new MockClient();
      const order = event(command("BUY"), 1).order!;
      const data = order.tradeData as Record<string, unknown>;
      if (failure !== "missing") client.orders.push(order);
      if (failure === "duplicate") client.orders.push(structuredClone(order));
      if (failure === "manual") data.label = "manual";
      if (failure === "symbol") data.symbolId = "8";
      if (failure === "closing") order.closingOrder = true;
      if (failure === "type") order.orderType = 1;
      if (failure === "state") order.orderStatus = 99;
      await expect(
        restartedGateway(client).cancelStrategyOrder(
          "client-BUY",
          "OCO_PEER_UNFILLED_TERMINAL",
        ),
      ).rejects.toThrow(/^DEMO_RECOVERED_ORDER_/);
      expect(client.cancelled).toEqual([]);
    },
  );

  it("rejects a mismatched broker cancellation response after restart", async () => {
    const client = new MockClient();
    client.orders.push(event(command("BUY"), 1).order!);
    vi.spyOn(client, "cancelOrder").mockResolvedValue(
      event(command("SELL"), 5),
    );
    await expect(
      restartedGateway(client).cancelStrategyOrder(
        "client-BUY",
        "OCO_PEER_UNFILLED_TERMINAL",
      ),
    ).rejects.toThrow("DEMO_RECOVERED_ORDER_OWNERSHIP_UNCERTAIN");
  });

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
    expect(client.placementSlippagePoints).toEqual(["5", "5"]);
    client.fill("client-BUY");
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));
    client.fill("client-BUY");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.cancelled).toEqual(["102"]);
  });

  it("fails before placement when stop-limit slippage is not a positive integer", () => {
    expect(
      () =>
        new CTraderDemoGateway({
          client: new MockClient(),
          symbolId: "7",
          symbolName: "XAUUSD",
          placementEnabled: true,
          acknowledgement: DEMO_ACKNOWLEDGEMENT,
          tickSize: "0.01",
          maxSlippagePoints: "0.5",
          maxSlippageBps: "2",
        }),
    ).toThrow("DEMO_SLIPPAGE_CONFIG_INVALID");
  });

  it("does not replace the entry identity with a broker closing child", async () => {
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

    client.closeWithBrokerChild("client-BUY");
    const reconciliation = await gateway.reconcile("XAUUSD");

    expect(
      reconciliation.orders.find(
        (order) => order.clientOrderId === "client-BUY",
      ),
    ).toMatchObject({ brokerOrderId: "101", state: "FILLED" });
    expect(reconciliation.orders).toContainEqual(
      expect.objectContaining({
        clientOrderId: "closing:601",
        brokerOrderId: "601",
      }),
    );
    expect(client.cancelled).toEqual(["102"]);
  });

  it("retains fill-slippage uncertainty until matching terminal proof is certain", async () => {
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
    client.fill("client-BUY", 2001.1);
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));

    await expect(gateway.reconcile("XAUUSD")).resolves.toMatchObject({
      certain: false,
      reasonCodes: ["DEMO_FILL_SLIPPAGE_EXCEEDED"],
    });
    gateway.acknowledgeCertainTerminalRecovery({
      orderGroupId: "group",
      terminalProofKey: `terminal:${"a".repeat(64)}`,
      orders: terminalOrders(),
      certain: false,
    });
    await expect(gateway.reconcile("XAUUSD")).resolves.toMatchObject({
      certain: false,
      reasonCodes: ["DEMO_FILL_SLIPPAGE_EXCEEDED"],
    });
  });

  it("releases only a matching terminal group's fill-slippage latch", async () => {
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
    client.fill("client-BUY", 2001.1);
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));

    gateway.acknowledgeCertainTerminalRecovery({
      orderGroupId: "different-group",
      terminalProofKey: `terminal:${"b".repeat(64)}`,
      orders: terminalOrders(),
      certain: true,
    });
    await expect(gateway.reconcile("XAUUSD")).resolves.toMatchObject({
      certain: false,
      reasonCodes: ["DEMO_FILL_SLIPPAGE_EXCEEDED"],
    });

    gateway.acknowledgeCertainTerminalRecovery({
      orderGroupId: "group",
      terminalProofKey: `terminal:${"c".repeat(64)}`,
      orders: terminalOrders(),
      certain: true,
    });
    await expect(gateway.reconcile("XAUUSD")).resolves.toMatchObject({
      certain: true,
      reasonCodes: [],
    });
  });
});

describe("ordinary STOP demo OCO", () => {
  const pair = (): [PendingOrderCommand, PendingOrderCommand] => [
    { ...command("BUY"), executionOrderType: "STOP", timeInForce: "GTC" },
    { ...command("SELL"), executionOrderType: "STOP", timeInForce: "GTC" },
  ];
  const gateway = (client: MockClient) =>
    new CTraderDemoGateway({
      client,
      symbolId: "7",
      symbolName: "XAUUSD",
      placementEnabled: true,
      acknowledgement: DEMO_ACKNOWLEDGEMENT,
      tickSize: "0.01",
      maxSlippagePoints: "30",
      maxSlippageBps: "2",
    });
  it("places STOP, accepts a 17-point gap, cancels the peer exactly once", async () => {
    const client = new MockClient();
    const g = gateway(client);
    const commands = pair();
    await g.placeOco(commands);
    expect(client.orders.map((o) => o.orderType)).toEqual([3, 3]);
    expect(client.placementSlippagePoints).toEqual([]);
    expect((await g.placeOco(commands)).idempotentReplay).toBe(true);
    client.fill("client-BUY", 2001.17);
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));
    expect((await g.reconcile("XAUUSD")).certain).toBe(true);
    client.fill("client-BUY", 2001.17);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.cancelled).toEqual(["102"]);
  });
  it("retains actual fills and cancels the peer even beyond the modeled reserve", async () => {
    const client = new MockClient();
    const g = gateway(client);
    await g.placeOco(pair());
    client.fill("client-BUY", 2001.35);
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));
    const state = await g.reconcile("XAUUSD");
    expect(state.certain).toBe(false);
    expect(state.reasonCodes).toContain("DEMO_FILL_SLIPPAGE_EXCEEDED");
    expect(state.orders).toContainEqual(
      expect.objectContaining({ state: "FILLED", filledVolume: "100" }),
    );
  });
  it("cancels a surviving STOP if the second submission fails", async () => {
    const client = new MockClient();
    client.failSecond = true;
    await expect(gateway(client).placeOco(pair())).rejects.toThrow(
      "DEMO_SECOND_LEG_FAILED_FIRST_LEG_CANCELLED",
    );
    expect(client.cancelled).toEqual(["101"]);
  });
  it("rejects mixed types and conflicting idempotent replay before submission", async () => {
    const client = new MockClient();
    const g = gateway(client);
    const commands = pair();
    await expect(g.placeOco([commands[0], command("SELL")])).rejects.toThrow(
      "DEMO_OCO_EXECUTION_TYPE_MISMATCH",
    );
    expect(client.orders).toHaveLength(0);
    await g.placeOco(commands);
    await expect(g.placeOco([command("BUY"), command("SELL")])).rejects.toThrow(
      "DEMO_IDEMPOTENCY_TYPE_MISMATCH",
    );
    await expect(
      gateway(client).placeOco([command("BUY"), command("SELL")]),
    ).rejects.toThrow("DEMO_IDEMPOTENCY_TYPE_MISMATCH");
    expect(client.orders).toHaveLength(2);
  });
  it("uses exact durable terminal orders after a delayed callback and retains replay idempotency", async () => {
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
    const commands = [command("BUY"), command("SELL")] as const;
    await gateway.placeOco(commands);
    const delayed = event(commands[0], 1);
    client.fill("client-BUY", 2001.1);
    await vi.waitFor(() => expect(client.cancelled).toEqual(["102"]));
    client.deliver(delayed);
    client.orders.splice(0); // Broker is flat; callback cache is deliberately stale.
    const proof = {
      orderGroupId: "group",
      terminalProofKey: `terminal:${"d".repeat(64)}`,
      certain: true,
      orders: terminalOrders(),
    };
    for (const orders of [
      [],
      terminalOrders().slice(0, 1),
      terminalOrders().map((o) => ({ ...o, brokerOrderId: "999" })),
      terminalOrders().map((o) => ({ ...o, state: "UNKNOWN" as const })),
      terminalOrders().map((o) => ({ ...o, filledVolume: "101" })),
      [terminalOrders()[0]!, terminalOrders()[0]!],
    ]) {
      gateway.acknowledgeCertainTerminalRecovery({ ...proof, orders });
      expect((await gateway.reconcile("XAUUSD")).certain).toBe(false);
    }
    gateway.acknowledgeCertainTerminalRecovery(proof);
    gateway.acknowledgeCertainTerminalRecovery(proof);
    client.deliver(delayed);
    expect(await gateway.reconcile("XAUUSD")).toMatchObject({
      certain: true,
      orders: [],
    });
    const replay = await gateway.placeOco(commands);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.orders.map((o) => o.state)).toEqual(["FILLED", "CANCELLED"]);
    expect(client.orders).toHaveLength(0);
  });

  it("does not let an older closed group release a newer group's slippage latch", async () => {
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
    const proof = {
      orderGroupId: "group",
      terminalProofKey: `terminal:${"e".repeat(64)}`,
      certain: true,
      orders: terminalOrders(),
    };
    await gateway.placeOco([command("BUY"), command("SELL")]);
    client.fill("client-BUY", 2001.1);
    await vi.waitFor(() => expect(client.cancelled).toHaveLength(1));
    gateway.acknowledgeCertainTerminalRecovery(proof);
    client.orders.splice(0);
    const commands = (["BUY", "SELL"] as const).map((side) => ({
      ...command(side),
      orderGroupId: "next-group",
      clientOrderId: `next-${side}`,
      idempotencyKey: `next-${side}`,
    }));
    await gateway.placeOco([commands[0]!, commands[1]!]);
    client.fill("next-BUY", 2001.1);
    await vi.waitFor(() => expect(client.cancelled).toHaveLength(2));
    gateway.acknowledgeCertainTerminalRecovery(proof);
    expect((await gateway.reconcile("XAUUSD")).reasonCodes).toEqual([
      "DEMO_FILL_SLIPPAGE_EXCEEDED",
    ]);
    gateway.acknowledgeCertainTerminalRecovery({
      ...proof,
      orderGroupId: "next-group",
      orders: terminalOrders("next-BUY", "next-SELL"),
    });
    expect((await gateway.reconcile("XAUUSD")).certain).toBe(true);
  });
});
