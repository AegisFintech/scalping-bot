import { describe, expect, it, vi } from "vitest";

import { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import type {
  ExecutionGateway,
  GatewayOrder,
} from "../../packages/contracts/src/index.js";

const scope = {
  accountId: "00000000-0000-4000-8000-000000000010",
  symbolId: "1",
};

function fakeOrder(clientOrderId: string, state: string): GatewayOrder {
  return {
    clientOrderId,
    brokerOrderId: clientOrderId.replace("client-", "broker-"),
    state: state as GatewayOrder["state"],
    filledVolume: "0",
    updatedAt: new Date().toISOString(),
    reasonCode: null,
  };
}

function buildOrderMaintenance(
  pool: { query: ReturnType<typeof vi.fn> },
  gateway: ExecutionGateway,
  bracketRecallBars: number,
): OrderMaintenance {
  return new OrderMaintenance(pool as never, gateway, "XAUUSD", scope, {
    bracketRecallBars,
  });
}

describe("OrderMaintenance.recallStaleBrackets", () => {
  it("is a no-op when bracketRecallBars is not configured", async () => {
    const query = vi.fn();
    const cancel = vi.fn();
    const maintenance = buildOrderMaintenance(
      { query },
      { cancelStrategyOrder: cancel } as never,
      0,
    );
    await maintenance.recallStaleBrackets();
    expect(query).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels owned pendings whose scenario context is older than the recall window", async () => {
    const cancel = vi
      .fn()
      .mockResolvedValue(fakeOrder("client-BUY", "CANCELLED"));
    const reconcile = vi.fn().mockResolvedValue({
      certain: true,
      reasonCodes: [],
      relevantPositionCount: 0,
      orders: [],
    });
    const gateway = {
      cancelStrategyOrder: cancel,
      reconcile: reconcile,
    } as unknown as ExecutionGateway;
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          client_order_id: "client-BUY",
          order_group_id: "g1",
          analysis_id: "a1",
        },
      ],
    });
    const maintenance = buildOrderMaintenance({ query }, gateway, 30);
    await maintenance.recallStaleBrackets();
    expect(query).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(
      "client-BUY",
      "BRACKET_CONTEXT_EXPIRED_RECALL",
    );
    expect(reconcile).toHaveBeenCalledWith("XAUUSD");
  });

  it("does nothing when no brackets match", async () => {
    const cancel = vi.fn();
    const reconcile = vi.fn();
    const gateway = {
      cancelStrategyOrder: cancel,
      reconcile: reconcile,
    } as unknown as ExecutionGateway;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const maintenance = buildOrderMaintenance({ query }, gateway, 30);
    await maintenance.recallStaleBrackets();
    expect(cancel).not.toHaveBeenCalled();
  });
});
