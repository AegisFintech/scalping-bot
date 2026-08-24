import { Decimal } from "decimal.js";

import type {
  ExecutionGateway,
  GatewayOrder,
  OcoPlacementResult,
  PendingOrderCommand,
  ReconciliationSnapshot,
} from "../../../packages/contracts/src/index.js";
import type {
  BrokerExecution,
  RawReconciliation,
} from "../../../packages/ctrader-client/src/client.js";
import {
  numberField,
  optionalNumberField,
  optionalStringField,
  record,
  stringField,
} from "../../../packages/ctrader-client/src/protocol.js";
import { decimal } from "../../../packages/risk-engine/src/decimal.js";
import { DEMO_ACKNOWLEDGEMENT } from "./demo-authorization.js";

export interface CTraderTradingClient {
  readonly tokenExpiryKnown: boolean;
  readonly tradePermission: boolean;
  placeStop(command: PendingOrderCommand): Promise<BrokerExecution>;
  cancelOrder(brokerOrderId: string): Promise<BrokerExecution>;
  reconcileRaw(): Promise<RawReconciliation>;
  onExecution(handler: (execution: BrokerExecution) => void): () => void;
}

export interface CTraderDemoGatewayOptions {
  readonly client: CTraderTradingClient;
  readonly symbolId: string;
  readonly symbolName: string;
  readonly placementEnabled?: boolean;
  readonly acknowledgement?: string;
  readonly strategyLabelPrefix?: string;
  readonly blockManualOrders?: boolean;
  readonly blockManualPositions?: boolean;
  readonly tickSize: string;
  readonly maxSlippagePoints: string;
  readonly maxSlippageBps: string;
}

interface TrackedOrder {
  readonly command: PendingOrderCommand;
  brokerOrderId: string | null;
  state: GatewayOrder["state"];
  filledVolume: string;
  updatedAt: string;
  reasonCode: string | null;
}

interface TrackedGroup {
  readonly key: string;
  readonly orderGroupId: string;
  readonly orders: [TrackedOrder, TrackedOrder];
}

function orderTradeData(
  order: Record<string, unknown>,
): Record<string, unknown> {
  return record(order.tradeData, "CTRADER_TRADE_DATA_INVALID");
}

function external(order: TrackedOrder): GatewayOrder {
  return {
    clientOrderId: order.command.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    state: order.state,
    filledVolume: order.filledVolume,
    updatedAt: order.updatedAt,
    reasonCode: order.reasonCode,
  };
}

function stateFromOrder(order: Record<string, unknown>): GatewayOrder["state"] {
  const executed = decimal(optionalStringField(order, "executedVolume") ?? "0");
  const total = decimal(stringField(orderTradeData(order), "volume"));
  if (executed.gt(0) && executed.lt(total)) return "PARTIALLY_FILLED";
  switch (numberField(order, "orderStatus")) {
    case 1:
      return "PENDING";
    case 2:
      return "FILLED";
    case 3:
      return "REJECTED";
    case 4:
      return "EXPIRED";
    case 5:
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

function validatePair(
  commands: readonly [PendingOrderCommand, PendingOrderCommand],
): void {
  const [buy, sell] =
    commands[0].side === "BUY" ? commands : [commands[1], commands[0]];
  if (buy.side !== "BUY" || sell.side !== "SELL")
    throw new Error("DEMO_OCO_SIDES_INVALID");
  if (
    buy.orderGroupId !== sell.orderGroupId ||
    buy.analysisId !== sell.analysisId ||
    buy.symbol !== sell.symbol
  ) {
    throw new Error("DEMO_OCO_PAIR_MISMATCH");
  }
  for (const command of commands) {
    if (
      decimal(command.volume).lte(0) ||
      !decimal(command.volume).isInteger()
    ) {
      throw new Error("DEMO_VOLUME_INVALID");
    }
    if (Date.parse(command.expiresAt) <= Date.now())
      throw new Error("DEMO_ORDER_EXPIRED");
  }
}

export class CTraderDemoGateway implements ExecutionGateway {
  readonly kind = "ctrader-demo" as const;
  readonly canSubmitToBroker = true;
  readonly #options: Required<
    Omit<CTraderDemoGatewayOptions, "client" | "acknowledgement">
  > & {
    readonly client: CTraderTradingClient;
    readonly acknowledgement: string;
  };
  readonly #groups = new Map<string, TrackedGroup>();
  readonly #orders = new Map<string, TrackedOrder>();
  readonly #cancelInFlight = new Set<string>();
  #uncertainReason: string | null = null;

  constructor(options: CTraderDemoGatewayOptions) {
    this.#options = {
      client: options.client,
      symbolId: options.symbolId,
      symbolName: options.symbolName,
      placementEnabled: options.placementEnabled ?? false,
      acknowledgement: options.acknowledgement ?? "",
      strategyLabelPrefix: options.strategyLabelPrefix ?? "ctrader-ai-scalper",
      blockManualOrders: options.blockManualOrders ?? true,
      blockManualPositions: options.blockManualPositions ?? true,
      tickSize: options.tickSize,
      maxSlippagePoints: options.maxSlippagePoints,
      maxSlippageBps: options.maxSlippageBps,
    };
    if (
      new Decimal(this.#options.tickSize).lte(0) ||
      new Decimal(this.#options.maxSlippagePoints).lt(0) ||
      new Decimal(this.#options.maxSlippageBps).lt(0)
    ) {
      throw new Error("DEMO_SLIPPAGE_CONFIG_INVALID");
    }
    options.client.onExecution((execution) => this.#handleExecution(execution));
  }

  async placeOco(
    commands: readonly [PendingOrderCommand, PendingOrderCommand],
  ): Promise<OcoPlacementResult> {
    validatePair(commands);
    this.#assertPlacementEnabled(commands);
    const key = commands
      .map((command) => command.idempotencyKey)
      .sort()
      .join(":");
    const known = this.#groups.get(key);
    if (known !== undefined) {
      return {
        orderGroupId: known.orderGroupId,
        idempotentReplay: true,
        orders: known.orders.map(external),
      };
    }

    const brokerState = await this.#options.client.reconcileRaw();
    const recovered = this.#recoverIdempotent(commands, brokerState, key);
    if (recovered !== null) return recovered;
    this.#assertNoRelevantState(brokerState);

    const now = new Date().toISOString();
    const tracked = commands.map((command): TrackedOrder => ({
      command,
      brokerOrderId: null,
      state: "UNKNOWN",
      filledVolume: "0",
      updatedAt: now,
      reasonCode: "DEMO_PLACEMENT_PENDING",
    })) as [TrackedOrder, TrackedOrder];
    const group: TrackedGroup = {
      key,
      orderGroupId: commands[0].orderGroupId,
      orders: tracked,
    };
    this.#groups.set(key, group);
    for (const item of tracked)
      this.#orders.set(item.command.clientOrderId, item);

    const firstExecution = await this.#options.client.placeStop(commands[0]);
    this.#applyExecution(firstExecution);
    if (
      firstExecution.executionType === 3 ||
      firstExecution.executionType === 11
    ) {
      this.#uncertainReason = "DEMO_FIRST_LEG_FILLED_BEFORE_OCO_COMPLETE";
      throw new Error(this.#uncertainReason);
    }
    await this.#options.client.reconcileRaw();

    try {
      const secondExecution = await this.#options.client.placeStop(commands[1]);
      this.#applyExecution(secondExecution);
      await this.#options.client.reconcileRaw();
    } catch (error) {
      const first = tracked[0];
      if (first.brokerOrderId !== null && first.state === "PENDING") {
        try {
          const cancellation = await this.#options.client.cancelOrder(
            first.brokerOrderId,
          );
          this.#applyExecution(cancellation);
        } catch {
          this.#uncertainReason =
            "DEMO_SECOND_LEG_FAILED_CANCELLATION_UNCERTAIN";
        }
      }
      await this.#options.client.reconcileRaw();
      throw new Error(
        this.#uncertainReason ?? "DEMO_SECOND_LEG_FAILED_FIRST_LEG_CANCELLED",
        { cause: error },
      );
    }

    return {
      orderGroupId: group.orderGroupId,
      idempotentReplay: false,
      orders: group.orders.map(external),
    };
  }

  async cancelStrategyOrder(
    clientOrderId: string,
    reasonCode: string,
  ): Promise<GatewayOrder> {
    const tracked = this.#orders.get(clientOrderId);
    if (tracked === undefined) throw new Error("DEMO_STRATEGY_ORDER_NOT_FOUND");
    if (
      !tracked.command.strategyLabel.startsWith(
        this.#options.strategyLabelPrefix,
      )
    ) {
      throw new Error("DEMO_MANUAL_ORDER_CANCELLATION_DENIED");
    }
    if (tracked.brokerOrderId === null)
      throw new Error("DEMO_BROKER_ORDER_ID_UNKNOWN");
    if (tracked.state !== "PENDING" && tracked.state !== "PARTIALLY_FILLED")
      return external(tracked);
    const execution = await this.#options.client.cancelOrder(
      tracked.brokerOrderId,
    );
    this.#applyExecution(execution, reasonCode);
    await this.#options.client.reconcileRaw();
    return external(tracked);
  }

  async reconcile(symbol: string): Promise<ReconciliationSnapshot> {
    if (symbol !== this.#options.symbolName)
      throw new Error("DEMO_RECONCILE_SYMBOL_MISMATCH");
    try {
      const raw = await this.#options.client.reconcileRaw();
      const relevantOrders = raw.orders.filter((order) =>
        this.#isRelevantOrder(order),
      );
      const relevantPositions = raw.positions.filter((position) =>
        this.#isRelevantPosition(position),
      );
      const brokerOrders = relevantOrders.map((order): GatewayOrder => {
        const data = orderTradeData(order);
        const clientOrderId =
          optionalStringField(order, "clientOrderId") ??
          `manual:${stringField(order, "orderId")}`;
        return {
          clientOrderId,
          brokerOrderId: stringField(order, "orderId"),
          state: stateFromOrder(order),
          filledVolume: optionalStringField(order, "executedVolume") ?? "0",
          updatedAt:
            optionalNumberField(order, "utcLastUpdateTimestamp") === undefined
              ? raw.receivedAt
              : new Date(
                  numberField(order, "utcLastUpdateTimestamp"),
                ).toISOString(),
          reasonCode:
            optionalStringField(data, "label")?.startsWith(
              this.#options.strategyLabelPrefix,
            ) === true
              ? null
              : "DEMO_MANUAL_ORDER_BLOCKING",
        };
      });
      const ordersByClientId = new Map(
        [...this.#orders.values()].map((order) => [
          order.command.clientOrderId,
          external(order),
        ]),
      );
      for (const order of brokerOrders)
        ordersByClientId.set(order.clientOrderId, order);
      const orders = [...ordersByClientId.values()];
      const uncertain =
        this.#uncertainReason !== null ||
        orders.some((order) => order.state === "UNKNOWN");
      return {
        asOf: raw.receivedAt,
        certain: !uncertain,
        reasonCodes: uncertain
          ? [this.#uncertainReason ?? "DEMO_UNKNOWN_ORDER_STATE"]
          : [],
        orders,
        relevantPositionCount: relevantPositions.length,
      };
    } catch {
      return {
        asOf: new Date().toISOString(),
        certain: false,
        reasonCodes: ["DEMO_RECONCILIATION_FAILED"],
        orders: [],
        relevantPositionCount: 0,
      };
    }
  }

  #assertPlacementEnabled(commands: readonly PendingOrderCommand[]): void {
    if (!this.#options.placementEnabled)
      throw new Error("DEMO_ORDER_PLACEMENT_DISABLED");
    if (this.#options.acknowledgement !== DEMO_ACKNOWLEDGEMENT)
      throw new Error("DEMO_ACKNOWLEDGEMENT_REQUIRED");
    if (!this.#options.client.tokenExpiryKnown)
      throw new Error("DEMO_TOKEN_EXPIRY_UNKNOWN");
    if (!this.#options.client.tradePermission)
      throw new Error("DEMO_TRADE_PERMISSION_REQUIRED");
    if (this.#uncertainReason !== null) throw new Error(this.#uncertainReason);
    if (
      commands.some((command) => command.symbol !== this.#options.symbolName)
    ) {
      throw new Error("DEMO_ORDER_SYMBOL_MISMATCH");
    }
  }

  #recoverIdempotent(
    commands: readonly [PendingOrderCommand, PendingOrderCommand],
    raw: RawReconciliation,
    key: string,
  ): OcoPlacementResult | null {
    const matches = commands.map((command) =>
      raw.orders.find(
        (order) =>
          optionalStringField(order, "clientOrderId") === command.clientOrderId,
      ),
    );
    if (matches.every((match) => match === undefined)) return null;
    if (matches.some((match) => match === undefined)) {
      this.#uncertainReason = "DEMO_PARTIAL_IDEMPOTENCY_RECOVERY";
      throw new Error(this.#uncertainReason);
    }
    const now = raw.receivedAt;
    const tracked = commands.map((command, index): TrackedOrder => {
      const match = matches[index] as Record<string, unknown>;
      return {
        command,
        brokerOrderId: stringField(match, "orderId"),
        state: stateFromOrder(match),
        filledVolume: optionalStringField(match, "executedVolume") ?? "0",
        updatedAt: now,
        reasonCode: "DEMO_RECOVERED_AFTER_RESTART",
      };
    }) as [TrackedOrder, TrackedOrder];
    const group: TrackedGroup = {
      key,
      orderGroupId: commands[0].orderGroupId,
      orders: tracked,
    };
    this.#groups.set(key, group);
    for (const item of tracked)
      this.#orders.set(item.command.clientOrderId, item);
    return {
      orderGroupId: group.orderGroupId,
      idempotentReplay: true,
      orders: tracked.map(external),
    };
  }

  #assertNoRelevantState(raw: RawReconciliation): void {
    if (raw.positions.some((position) => this.#isRelevantPosition(position))) {
      throw new Error("DEMO_RELEVANT_POSITION_BLOCKING");
    }
    if (raw.orders.some((order) => this.#isRelevantOrder(order))) {
      throw new Error("DEMO_RELEVANT_PENDING_ORDER_BLOCKING");
    }
  }

  #isRelevantOrder(order: Record<string, unknown>): boolean {
    const data = orderTradeData(order);
    if (stringField(data, "symbolId") !== this.#options.symbolId) return false;
    const label = optionalStringField(data, "label") ?? "";
    return (
      this.#options.blockManualOrders ||
      label.startsWith(this.#options.strategyLabelPrefix)
    );
  }

  #isRelevantPosition(position: Record<string, unknown>): boolean {
    const data = orderTradeData(position);
    if (stringField(data, "symbolId") !== this.#options.symbolId) return false;
    const label = optionalStringField(data, "label") ?? "";
    return (
      this.#options.blockManualPositions ||
      label.startsWith(this.#options.strategyLabelPrefix)
    );
  }

  #handleExecution(execution: BrokerExecution): void {
    this.#applyExecution(execution);
    if (
      execution.order === null ||
      (execution.executionType !== 3 && execution.executionType !== 11)
    )
      return;
    const clientOrderId = optionalStringField(execution.order, "clientOrderId");
    if (clientOrderId === undefined) return;
    const filled = this.#orders.get(clientOrderId);
    if (filled === undefined) return;
    const group = [...this.#groups.values()].find((candidate) =>
      candidate.orders.includes(filled),
    );
    const peer = group?.orders.find((order) => order !== filled);
    if (
      peer?.brokerOrderId === null ||
      peer?.brokerOrderId === undefined ||
      peer.state !== "PENDING"
    )
      return;
    if (this.#cancelInFlight.has(peer.command.clientOrderId)) return;
    this.#cancelInFlight.add(peer.command.clientOrderId);
    void this.#options.client
      .cancelOrder(peer.brokerOrderId)
      .then((result) => {
        this.#applyExecution(result, "DEMO_OCO_PEER_FILLED");
        return this.#options.client.reconcileRaw();
      })
      .catch(() => {
        this.#uncertainReason = "DEMO_OCO_CANCELLATION_RECONCILIATION_REQUIRED";
      })
      .finally(() => this.#cancelInFlight.delete(peer.command.clientOrderId));
  }

  #applyExecution(execution: BrokerExecution, reasonCode?: string): void {
    if (execution.order === null) return;
    const clientOrderId = optionalStringField(execution.order, "clientOrderId");
    if (clientOrderId === undefined) return;
    const tracked = this.#orders.get(clientOrderId);
    if (tracked === undefined) return;
    tracked.brokerOrderId = stringField(execution.order, "orderId");
    tracked.state =
      execution.executionType === 11
        ? "PARTIALLY_FILLED"
        : stateFromOrder(execution.order);
    tracked.filledVolume =
      optionalStringField(execution.order, "executedVolume") ?? "0";
    tracked.updatedAt = execution.receivedAt;
    tracked.reasonCode = reasonCode ?? execution.errorCode;
    if (execution.executionType === 3 || execution.executionType === 11) {
      const executionPrice =
        optionalNumberField(execution.order, "executionPrice") ??
        (execution.deal === null
          ? undefined
          : optionalNumberField(execution.deal, "executionPrice"));
      if (executionPrice === undefined) {
        this.#uncertainReason = "DEMO_FILL_PRICE_MISSING";
        tracked.reasonCode = this.#uncertainReason;
        return;
      }
      const entry = new Decimal(tracked.command.entryPrice);
      const deviation = new Decimal(executionPrice).minus(entry).abs();
      const points = deviation.div(this.#options.tickSize);
      const basisPoints = deviation.div(entry).mul(10_000);
      if (
        points.gt(this.#options.maxSlippagePoints) ||
        basisPoints.gt(this.#options.maxSlippageBps)
      ) {
        this.#uncertainReason = "DEMO_FILL_SLIPPAGE_EXCEEDED";
        tracked.reasonCode = this.#uncertainReason;
      }
    }
  }
}

export { DEMO_ACKNOWLEDGEMENT };
