import type {
  ExecutionGateway,
  GatewayOrder,
  OcoPlacementResult,
  PendingOrderCommand,
  ReconciliationSnapshot,
} from "../../../packages/contracts/src/index.js";
import type { SafetyGateResult } from "./safety-gates.js";

export interface LiveCompatibleGatewayOptions {
  readonly brokerGateway: ExecutionGateway;
  readonly evaluateGate: () => Promise<SafetyGateResult>;
}

/**
 * Dormant live-compatible boundary. Production wiring deliberately does not instantiate this
 * class. It adds a last-moment reconciliation and safety gate around a broker-capable adapter.
 */
export class LiveCompatibleGateway implements ExecutionGateway {
  readonly kind = "ctrader-live" as const;
  readonly canSubmitToBroker = true;
  readonly #options: LiveCompatibleGatewayOptions;

  constructor(options: LiveCompatibleGatewayOptions) {
    if (!options.brokerGateway.canSubmitToBroker)
      throw new Error("LIVE_BROKER_GATEWAY_NOT_CAPABLE");
    this.#options = options;
  }

  async placeOco(
    commands: readonly [PendingOrderCommand, PendingOrderCommand],
  ): Promise<OcoPlacementResult> {
    const reconciliation = await this.#options.brokerGateway.reconcile(
      commands[0].symbol,
    );
    const blockers = reconciliation.orders.filter((order) =>
      ["PENDING", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.state),
    );
    if (
      !reconciliation.certain ||
      reconciliation.relevantPositionCount > 0 ||
      blockers.length > 0
    ) {
      throw new Error("LIVE_PREORDER_RECONCILIATION_BLOCKED");
    }
    const gate = await this.#options.evaluateGate();
    if (!gate.allowed)
      throw new Error(`LIVE_GATE_REJECTED:${gate.reasonCodes.join(",")}`);
    return this.#options.brokerGateway.placeOco(commands);
  }

  async cancelStrategyOrder(
    clientOrderId: string,
    reasonCode: string,
  ): Promise<GatewayOrder> {
    const result = await this.#options.brokerGateway.cancelStrategyOrder(
      clientOrderId,
      reasonCode,
    );
    return result;
  }

  reconcile(symbol: string): Promise<ReconciliationSnapshot> {
    return this.#options.brokerGateway.reconcile(symbol);
  }
}

export class DisabledLiveGateway implements ExecutionGateway {
  readonly kind = "ctrader-live" as const;
  readonly canSubmitToBroker = false;

  placeOco(): Promise<OcoPlacementResult> {
    return Promise.reject(new Error("LIVE_GATEWAY_NOT_WIRED"));
  }

  cancelStrategyOrder(): Promise<GatewayOrder> {
    return Promise.reject(new Error("LIVE_GATEWAY_NOT_WIRED"));
  }

  reconcile(): Promise<ReconciliationSnapshot> {
    return Promise.resolve({
      asOf: new Date().toISOString(),
      certain: false,
      reasonCodes: ["LIVE_GATEWAY_NOT_WIRED"],
      orders: [],
      relevantPositionCount: 0,
    });
  }
}
