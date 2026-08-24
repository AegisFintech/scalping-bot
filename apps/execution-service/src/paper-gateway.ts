import { Decimal } from "decimal.js";

import type {
  ExecutionGateway,
  GatewayOrder,
  OcoPlacementResult,
  PendingOrderCommand,
  ReconciliationSnapshot,
} from "../../../packages/contracts/src/index.js";
import {
  canonical,
  decimal,
} from "../../../packages/risk-engine/src/decimal.js";

type PaperGroupState =
  "ACTIVE" | "POSITION_OPEN" | "RECONCILIATION_REQUIRED" | "CLOSED";

interface MutablePaperOrder {
  command: PendingOrderCommand;
  state: GatewayOrder["state"];
  filledVolume: string;
  updatedAt: string;
  reasonCode: string | null;
}

interface PaperGroup {
  readonly idempotencyKey: string;
  readonly orderGroupId: string;
  readonly orders: [MutablePaperOrder, MutablePaperOrder];
  state: PaperGroupState;
}

interface PaperPosition {
  readonly order: MutablePaperOrder;
  readonly side: "BUY" | "SELL";
  readonly entryPrice: Decimal;
  readonly volume: Decimal;
  readonly openedAt: string;
  state: "OPEN" | "CLOSED" | "UNKNOWN";
  realizedPnl: Decimal;
  exitPrice: Decimal | null;
  reasonCode: string | null;
  updatedAt: string;
}

export interface PaperGatewayOptions {
  readonly tickSize?: string;
  readonly tickValue?: string;
  readonly slippagePoints?: string;
  readonly maxSlippagePoints?: string;
  readonly maxSlippageBps?: string;
}

export interface PaperPositionSummary {
  readonly clientOrderId: string;
  readonly side: "BUY" | "SELL";
  readonly state: "OPEN" | "CLOSED" | "UNKNOWN";
  readonly entryPrice: string;
  readonly exitPrice: string | null;
  readonly volume: string;
  readonly realizedPnl: string;
  readonly reasonCode: string | null;
  readonly openedAt: string;
  readonly stopLoss: string;
  readonly takeProfit: string;
  readonly updatedAt: string;
}

export interface PaperAccountMark {
  readonly realizedPnl: string;
  readonly unrealizedPnl: string;
  readonly relevantPositionCount: number;
  readonly relevantPendingOrderCount: number;
  readonly hasPartialFill: boolean;
  readonly certain: boolean;
}

function external(order: MutablePaperOrder): GatewayOrder {
  return {
    clientOrderId: order.command.clientOrderId,
    brokerOrderId: `paper:${order.command.clientOrderId}`,
    state: order.state,
    filledVolume: order.filledVolume,
    updatedAt: order.updatedAt,
    reasonCode: order.reasonCode,
  };
}

function validatePair(
  commands: readonly [PendingOrderCommand, PendingOrderCommand],
): void {
  const [first, second] = commands;
  if (
    first.orderGroupId !== second.orderGroupId ||
    first.analysisId !== second.analysisId ||
    first.symbol !== second.symbol
  ) {
    throw new Error("PAPER_OCO_PAIR_MISMATCH");
  }
  if (new Set(commands.map((command) => command.side)).size !== 2)
    throw new Error("PAPER_OCO_SIDES_INVALID");
  for (const command of commands) {
    if (decimal(command.volume).lte(0)) throw new Error("PAPER_VOLUME_INVALID");
    if (Date.parse(command.expiresAt) <= Date.now())
      throw new Error("PAPER_ORDER_EXPIRED");
  }
}

export class PaperGateway implements ExecutionGateway {
  readonly kind = "paper" as const;
  readonly canSubmitToBroker = false;
  readonly #groups = new Map<string, PaperGroup>();
  readonly #orders = new Map<string, MutablePaperOrder>();
  readonly #positions: PaperPosition[] = [];
  readonly #tickSize: Decimal;
  readonly #tickValue: Decimal;
  readonly #slippagePoints: Decimal;
  readonly #maxSlippagePoints: Decimal;
  readonly #maxSlippageBps: Decimal;

  constructor(options: PaperGatewayOptions = {}) {
    this.#tickSize = decimal(options.tickSize ?? "0.01");
    this.#tickValue = decimal(options.tickValue ?? "0.01");
    this.#slippagePoints = decimal(options.slippagePoints ?? "0");
    this.#maxSlippagePoints = decimal(options.maxSlippagePoints ?? "5");
    this.#maxSlippageBps = decimal(options.maxSlippageBps ?? "2");
    if (
      this.#tickSize.lte(0) ||
      this.#tickValue.lte(0) ||
      this.#slippagePoints.lt(0) ||
      this.#maxSlippagePoints.lt(0) ||
      this.#maxSlippageBps.lt(0) ||
      this.#slippagePoints.gt(this.#maxSlippagePoints)
    ) {
      throw new Error("PAPER_SLIPPAGE_CONFIG_INVALID");
    }
  }

  placeOco(
    commands: readonly [PendingOrderCommand, PendingOrderCommand],
  ): Promise<OcoPlacementResult> {
    validatePair(commands);
    const groupKey = commands
      .map((command) => command.idempotencyKey)
      .sort()
      .join(":");
    const existing = this.#groups.get(groupKey);
    if (existing !== undefined) {
      return Promise.resolve({
        orderGroupId: existing.orderGroupId,
        idempotentReplay: true,
        orders: existing.orders.map(external),
      });
    }
    if (commands.some((command) => this.#orders.has(command.clientOrderId)))
      throw new Error("PAPER_CLIENT_ORDER_ID_CONFLICT");
    const now = new Date().toISOString();
    const orders = commands.map<MutablePaperOrder>((command) => ({
      command,
      state: "PENDING",
      filledVolume: "0",
      updatedAt: now,
      reasonCode: null,
    })) as [MutablePaperOrder, MutablePaperOrder];
    const group: PaperGroup = {
      idempotencyKey: groupKey,
      orderGroupId: commands[0].orderGroupId,
      orders,
      state: "ACTIVE",
    };
    this.#groups.set(groupKey, group);
    for (const order of orders)
      this.#orders.set(order.command.clientOrderId, order);
    return Promise.resolve({
      orderGroupId: group.orderGroupId,
      idempotentReplay: false,
      orders: orders.map(external),
    });
  }

  cancelStrategyOrder(
    clientOrderId: string,
    reasonCode: string,
  ): Promise<GatewayOrder> {
    const order = this.#orders.get(clientOrderId);
    if (order === undefined) throw new Error("PAPER_ORDER_NOT_FOUND");
    if (order.state === "PENDING" || order.state === "PARTIALLY_FILLED") {
      order.state = "CANCELLED";
      order.updatedAt = new Date().toISOString();
      order.reasonCode = reasonCode;
    }
    return Promise.resolve(external(order));
  }

  processQuote(
    symbol: string,
    bidText: string,
    askText: string,
    at: Date,
    partialVolume?: string,
  ): readonly GatewayOrder[] {
    const bid = decimal(bidText);
    const ask = decimal(askText);
    if (bid.gte(ask)) throw new Error("PAPER_QUOTE_CROSSED");
    const changed: GatewayOrder[] = [];
    for (const position of this.#positions.filter(
      (item) => item.state === "OPEN" && item.order.command.symbol === symbol,
    )) {
      const command = position.order.command;
      const stop = decimal(command.stopLoss);
      const target = decimal(command.takeProfit);
      const stopHit = position.side === "BUY" ? bid.lte(stop) : ask.gte(stop);
      const targetHit =
        position.side === "BUY" ? bid.gte(target) : ask.lte(target);
      if (!stopHit && !targetHit) continue;
      const exitPrice = stopHit ? stop : target;
      position.exitPrice = exitPrice;
      const pricePnl =
        position.side === "BUY"
          ? exitPrice.minus(position.entryPrice)
          : position.entryPrice.minus(exitPrice);
      position.realizedPnl = pricePnl
        .div(this.#tickSize)
        .mul(this.#tickValue)
        .mul(position.volume);
      position.state = "CLOSED";
      position.updatedAt = at.toISOString();
      position.reasonCode = stopHit ? "PAPER_STOP_LOSS" : "PAPER_TAKE_PROFIT";
      position.order.updatedAt = position.updatedAt;
      position.order.reasonCode = position.reasonCode;
      changed.push(external(position.order));
      const group = [...this.#groups.values()].find((candidate) =>
        candidate.orders.includes(position.order),
      );
      if (
        group !== undefined &&
        group.orders.every(
          (order) =>
            this.#positions
              .filter((item) => item.order === order)
              .every((item) => item.state === "CLOSED") ||
            order.state === "CANCELLED" ||
            order.state === "EXPIRED" ||
            order.state === "REJECTED",
        )
      )
        group.state = "CLOSED";
    }
    for (const group of this.#groups.values()) {
      if (group.state !== "ACTIVE") continue;
      if (group.orders[0].command.symbol !== symbol) continue;
      const active = group.orders.filter((order) => order.state === "PENDING");
      for (const order of active) {
        if (Date.parse(order.command.expiresAt) <= at.getTime()) {
          order.state = "EXPIRED";
          order.updatedAt = at.toISOString();
          order.reasonCode = "PAPER_ORDER_EXPIRED";
          changed.push(external(order));
        }
      }
      const pending = group.orders.filter((order) => order.state === "PENDING");
      if (pending.length === 0) {
        group.state = "CLOSED";
        continue;
      }
      const triggered = pending.filter((order) =>
        order.command.side === "BUY"
          ? ask.gte(decimal(order.command.entryPrice))
          : bid.lte(decimal(order.command.entryPrice)),
      );
      if (triggered.length === 0) continue;
      for (const order of triggered) {
        const requested = decimal(order.command.volume);
        const fill =
          partialVolume === undefined
            ? requested
            : Decimal.min(decimal(partialVolume), requested);
        const marketPrice = order.command.side === "BUY" ? ask : bid;
        const entry = decimal(order.command.entryPrice);
        const baseFill =
          order.command.side === "BUY"
            ? Decimal.max(entry, marketPrice)
            : Decimal.min(entry, marketPrice);
        const fillPrice =
          order.command.side === "BUY"
            ? baseFill.plus(this.#tickSize.mul(this.#slippagePoints))
            : baseFill.minus(this.#tickSize.mul(this.#slippagePoints));
        const deviation = fillPrice.minus(entry).abs().div(this.#tickSize);
        const deviationBps = fillPrice
          .minus(entry)
          .abs()
          .div(entry)
          .mul(10_000);
        if (
          deviation.gt(this.#maxSlippagePoints) ||
          deviationBps.gt(this.#maxSlippageBps)
        ) {
          order.state = "REJECTED";
          order.updatedAt = at.toISOString();
          order.reasonCode = "PAPER_SLIPPAGE_EXCEEDED";
          changed.push(external(order));
          continue;
        }
        order.filledVolume = canonical(fill);
        order.state = fill.lt(requested) ? "PARTIALLY_FILLED" : "FILLED";
        order.updatedAt = at.toISOString();
        order.reasonCode = fill.lt(requested)
          ? "PAPER_PARTIAL_FILL"
          : "PAPER_TRIGGER_FILLED";
        changed.push(external(order));
        this.#positions.push({
          order,
          side: order.command.side,
          entryPrice: fillPrice,
          volume: fill,
          openedAt: at.toISOString(),
          state: "OPEN",
          realizedPnl: new Decimal(0),
          exitPrice: null,
          reasonCode: null,
          updatedAt: at.toISOString(),
        });
      }
      const filled = triggered.filter(
        (order) =>
          order.state === "FILLED" || order.state === "PARTIALLY_FILLED",
      );
      if (filled.length > 1) {
        for (const position of this.#positions.filter((item) =>
          filled.includes(item.order),
        ))
          position.state = "UNKNOWN";
        group.state = "RECONCILIATION_REQUIRED";
        continue;
      }
      const activeFill = filled[0];
      if (activeFill === undefined) {
        group.state = "CLOSED";
        const peer = group.orders.find((order) => order.state === "PENDING");
        if (peer !== undefined) {
          peer.state = "CANCELLED";
          peer.updatedAt = at.toISOString();
          peer.reasonCode = "PAPER_OCO_PEER_REJECTED";
          changed.push(external(peer));
        }
        continue;
      }
      group.state = "POSITION_OPEN";
      const peer = group.orders.find((order) => order !== activeFill);
      if (peer?.state === "PENDING") {
        peer.state = "CANCELLED";
        peer.updatedAt = at.toISOString();
        peer.reasonCode = "PAPER_OCO_PEER_FILLED";
        changed.push(external(peer));
      }
    }
    return changed;
  }

  positions(): readonly PaperPositionSummary[] {
    return this.#positions.map((position) => ({
      clientOrderId: position.order.command.clientOrderId,
      side: position.side,
      state: position.state,
      entryPrice: canonical(position.entryPrice),
      exitPrice:
        position.exitPrice === null ? null : canonical(position.exitPrice),
      volume: canonical(position.volume),
      realizedPnl: canonical(position.realizedPnl),
      reasonCode: position.reasonCode,
      openedAt: position.openedAt,
      stopLoss: position.order.command.stopLoss,
      takeProfit: position.order.command.takeProfit,
      updatedAt: position.updatedAt,
    }));
  }

  accountMark(
    symbol: string,
    bidText: string,
    askText: string,
  ): PaperAccountMark {
    const bid = decimal(bidText);
    const ask = decimal(askText);
    const positions = this.#positions.filter(
      (item) => item.order.command.symbol === symbol,
    );
    const realized = positions
      .filter((item) => item.state === "CLOSED")
      .reduce((total, item) => total.plus(item.realizedPnl), new Decimal(0));
    const open = positions.filter((item) => item.state === "OPEN");
    const unrealized = open.reduce((total, item) => {
      const difference =
        item.side === "BUY"
          ? bid.minus(item.entryPrice)
          : item.entryPrice.minus(ask);
      return total.plus(
        difference.div(this.#tickSize).mul(this.#tickValue).mul(item.volume),
      );
    }, new Decimal(0));
    const relevantOrders = [...this.#orders.values()].filter(
      (order) => order.command.symbol === symbol,
    );
    return {
      realizedPnl: canonical(realized),
      unrealizedPnl: canonical(unrealized),
      relevantPositionCount: positions.filter((item) => item.state !== "CLOSED")
        .length,
      relevantPendingOrderCount: relevantOrders.filter((order) =>
        ["PENDING", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.state),
      ).length,
      hasPartialFill: relevantOrders.some(
        (order) => order.state === "PARTIALLY_FILLED",
      ),
      certain: !positions.some((item) => item.state === "UNKNOWN"),
    };
  }

  reconcile(symbol: string): Promise<ReconciliationSnapshot> {
    const orders = [...this.#orders.values()].filter(
      (order) => order.command.symbol === symbol,
    );
    const uncertain = [...this.#groups.values()].some(
      (group) => group.state === "RECONCILIATION_REQUIRED",
    );
    return Promise.resolve({
      asOf: new Date().toISOString(),
      certain: !uncertain,
      reasonCodes: uncertain ? ["PAPER_DUAL_FILL_RECONCILIATION_REQUIRED"] : [],
      orders: orders.map(external),
      relevantPositionCount: this.#positions.filter(
        (position) =>
          position.order.command.symbol === symbol &&
          (position.state === "OPEN" || position.state === "UNKNOWN"),
      ).length,
    });
  }
}
