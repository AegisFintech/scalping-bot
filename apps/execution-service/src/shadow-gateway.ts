import type {
  ExecutionGateway,
  GatewayOrder,
  OcoPlacementResult,
  PendingOrderCommand,
  ReconciliationSnapshot,
} from "../../../packages/contracts/src/index.js";

export class ShadowGateway implements ExecutionGateway {
  readonly kind = "shadow" as const;
  readonly canSubmitToBroker = false;
  readonly #intents = new Map<string, GatewayOrder>();

  placeOco(
    commands: readonly [PendingOrderCommand, PendingOrderCommand],
  ): Promise<OcoPlacementResult> {
    const replay = commands.every((command) =>
      this.#intents.has(command.idempotencyKey),
    );
    const now = new Date().toISOString();
    for (const command of commands) {
      if (!this.#intents.has(command.idempotencyKey)) {
        this.#intents.set(command.idempotencyKey, {
          clientOrderId: command.clientOrderId,
          brokerOrderId: null,
          state: "REJECTED",
          filledVolume: "0",
          updatedAt: now,
          reasonCode: "SHADOW_NO_BROKER_SUBMISSION",
        });
      }
    }
    return Promise.resolve({
      orderGroupId: commands[0].orderGroupId,
      idempotentReplay: replay,
      orders: commands.map((command) =>
        this.#intents.get(command.idempotencyKey)!,
      ),
    });
  }

  cancelStrategyOrder(
    clientOrderId: string,
    reasonCode: string,
  ): Promise<GatewayOrder> {
    const found = [...this.#intents.values()].find(
      (order) => order.clientOrderId === clientOrderId,
    );
    if (found === undefined) throw new Error("SHADOW_INTENT_NOT_FOUND");
    return Promise.resolve({ ...found, reasonCode });
  }

  reconcile(symbol: string): Promise<ReconciliationSnapshot> {
    void symbol;
    return Promise.resolve({
      asOf: new Date().toISOString(),
      certain: true,
      reasonCodes: [],
      orders: [...this.#intents.values()],
      relevantPositionCount: 0,
    });
  }
}
