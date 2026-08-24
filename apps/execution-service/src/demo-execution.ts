import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

import type { GatewayOrder } from "../../../packages/contracts/src/index.js";
import type { BrokerExecution } from "../../../packages/ctrader-client/src/client.js";
import {
  numberField,
  optionalNumberField,
  optionalStringField,
  record,
  stringField,
} from "../../../packages/ctrader-client/src/protocol.js";
import { canonical } from "../../../packages/risk-engine/src/decimal.js";

export interface DemoExecutionFill {
  readonly brokerFillId: string;
  readonly brokerOrderId: string;
  readonly brokerPositionId: string;
  readonly price: string;
  readonly volume: string;
  readonly commission: string;
  readonly occurredAt: string;
}

export interface DemoExecutionCloseDetail {
  readonly entryPrice: string;
  readonly grossProfit: string;
  readonly swap: string;
  readonly commission: string;
  readonly pnlConversionFee: string;
  readonly balance: string;
  readonly closedVolume: string | null;
  readonly quoteToDepositConversionRate: string | null;
  readonly balanceVersion: string | null;
}

export interface DemoExecutionPosition {
  readonly brokerPositionId: string;
  readonly side: "BUY" | "SELL";
  readonly state: "OPEN" | "CLOSED" | "UNKNOWN" | "RECONCILIATION_PENDING";
  readonly volume: string;
  readonly entryPrice: string | null;
  readonly stopLoss: string | null;
  readonly takeProfit: string | null;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  readonly updatedAt: string;
}

export interface DemoExecutionEvent {
  readonly schemaVersion: "1.0";
  readonly eventKey: string;
  readonly payloadHash: string;
  readonly executionType: number;
  readonly clientOrderId: string | null;
  readonly brokerOrderId: string | null;
  readonly brokerPositionId: string | null;
  readonly brokerFillId: string | null;
  readonly order: GatewayOrder | null;
  readonly position: DemoExecutionPosition | null;
  readonly fill: DemoExecutionFill | null;
  readonly closeDetail: DemoExecutionCloseDetail | null;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly errorCode: string | null;
}

export interface DemoExecutionPersistenceResult {
  readonly certain: boolean;
  readonly reasonCodes: readonly string[];
}

export interface DemoExecutionStore {
  persist(event: DemoExecutionEvent): Promise<DemoExecutionPersistenceResult>;
}

export interface DemoExecutionNormalizerOptions {
  readonly symbolId: string;
  readonly strategyLabelPrefix?: string;
}

function isoTimestamp(value: number, reason: string): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(reason);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(reason);
  return date.toISOString();
}

function optionalTimestamp(
  value: number | undefined,
  reason: string,
): string | null {
  return value === undefined ? null : isoTimestamp(value, reason);
}

function decimalField(object: Record<string, unknown>, key: string): string {
  const value = stringField(object, key);
  try {
    return canonical(new Decimal(value));
  } catch {
    throw new Error(`CTRADER_FIELD_INVALID:${key}`);
  }
}

function optionalDecimalField(
  object: Record<string, unknown>,
  key: string,
): string | null {
  const value = optionalStringField(object, key);
  if (value === undefined) return null;
  try {
    return canonical(new Decimal(value));
  } catch {
    throw new Error(`CTRADER_FIELD_INVALID:${key}`);
  }
}

function priceField(
  object: Record<string, unknown>,
  key: string,
  required: boolean,
): string | null {
  const value = optionalNumberField(object, key);
  if (value === undefined) {
    if (required) throw new Error(`CTRADER_FIELD_INVALID:${key}`);
    return null;
  }
  const price = new Decimal(value);
  if (!price.isFinite() || price.lte(0))
    throw new Error(`CTRADER_FIELD_INVALID:${key}`);
  return canonical(price);
}

function money(
  object: Record<string, unknown>,
  key: string,
  moneyDigits: number,
  fallback?: string,
): string {
  const value = optionalStringField(object, key) ?? fallback;
  if (value === undefined) throw new Error(`CTRADER_FIELD_INVALID:${key}`);
  if (!Number.isSafeInteger(moneyDigits) || moneyDigits < 0 || moneyDigits > 18)
    throw new Error("CTRADER_MONEY_DIGITS_INVALID");
  try {
    return canonical(new Decimal(value).div(new Decimal(10).pow(moneyDigits)));
  } catch {
    throw new Error(`CTRADER_FIELD_INVALID:${key}`);
  }
}

function tradeData(entity: Record<string, unknown>): Record<string, unknown> {
  return record(entity.tradeData, "CTRADER_TRADE_DATA_INVALID");
}

function assertSymbol(
  entity: Record<string, unknown> | null,
  symbolId: string,
): void {
  if (entity === null) return;
  const data = tradeData(entity);
  if (stringField(data, "symbolId") !== symbolId)
    throw new Error("DEMO_EXECUTION_SYMBOL_MISMATCH");
}

function label(entity: Record<string, unknown> | null): string {
  return entity === null
    ? ""
    : (optionalStringField(tradeData(entity), "label") ?? "");
}

function side(data: Record<string, unknown>): "BUY" | "SELL" {
  switch (numberField(data, "tradeSide")) {
    case 1:
      return "BUY";
    case 2:
      return "SELL";
    default:
      throw new Error("CTRADER_TRADE_SIDE_INVALID");
  }
}

function orderState(order: Record<string, unknown>): GatewayOrder["state"] {
  const data = tradeData(order);
  const total = new Decimal(decimalField(data, "volume"));
  const executed = new Decimal(
    optionalDecimalField(order, "executedVolume") ?? "0",
  );
  if (!total.isInteger() || total.lte(0) || !executed.isInteger())
    throw new Error("CTRADER_ORDER_VOLUME_INVALID");
  if (executed.lt(0) || executed.gt(total))
    throw new Error("CTRADER_ORDER_EXECUTED_VOLUME_INVALID");
  if (executed.gt(0) && executed.lt(total)) return "PARTIALLY_FILLED";
  switch (numberField(order, "orderStatus")) {
    case 1:
      return executed.eq(0) ? "PENDING" : "UNKNOWN";
    case 2:
      return executed.eq(total) ? "FILLED" : "UNKNOWN";
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

function normalizeOrder(
  order: Record<string, unknown>,
  receivedAt: string,
  errorCode: string | null,
): GatewayOrder {
  const updatedAt = optionalTimestamp(
    optionalNumberField(order, "utcLastUpdateTimestamp"),
    "CTRADER_ORDER_TIMESTAMP_INVALID",
  );
  return {
    clientOrderId: optionalStringField(order, "clientOrderId") ?? "",
    brokerOrderId: stringField(order, "orderId"),
    state: orderState(order),
    filledVolume: optionalDecimalField(order, "executedVolume") ?? "0",
    updatedAt: updatedAt ?? receivedAt,
    reasonCode: errorCode,
  };
}

function assertExecutionOrderState(
  executionType: number,
  state: GatewayOrder["state"],
): void {
  const allowed: Partial<Record<number, readonly GatewayOrder["state"][]>> = {
    2: ["PENDING"],
    3: ["FILLED"],
    4: ["PENDING", "PARTIALLY_FILLED"],
    5: ["CANCELLED", "PARTIALLY_FILLED"],
    6: ["EXPIRED", "PARTIALLY_FILLED"],
    7: ["REJECTED"],
    11: ["PARTIALLY_FILLED"],
  };
  const allowedStates = allowed[executionType];
  if (allowedStates !== undefined && !allowedStates.includes(state))
    throw new Error("DEMO_EXECUTION_ORDER_STATE_MISMATCH");
}

function normalizePosition(
  position: Record<string, unknown>,
  receivedAt: string,
): DemoExecutionPosition {
  const data = tradeData(position);
  const status = numberField(position, "positionStatus");
  const state: DemoExecutionPosition["state"] =
    status === 1
      ? "OPEN"
      : status === 2
        ? "CLOSED"
        : status === 3
          ? "RECONCILIATION_PENDING"
          : "UNKNOWN";
  const updatedAt = optionalTimestamp(
    optionalNumberField(position, "utcLastUpdateTimestamp"),
    "CTRADER_POSITION_TIMESTAMP_INVALID",
  );
  const volume = new Decimal(decimalField(data, "volume"));
  if (!volume.isInteger() || volume.lt(0))
    throw new Error("CTRADER_POSITION_VOLUME_INVALID");
  return {
    brokerPositionId: stringField(position, "positionId"),
    side: side(data),
    state,
    volume: canonical(volume),
    entryPrice: priceField(position, "price", state === "OPEN"),
    stopLoss: priceField(position, "stopLoss", false),
    takeProfit: priceField(position, "takeProfit", false),
    openedAt: optionalTimestamp(
      optionalNumberField(data, "openTimestamp"),
      "CTRADER_POSITION_OPEN_TIMESTAMP_INVALID",
    ),
    closedAt: optionalTimestamp(
      optionalNumberField(data, "closeTimestamp"),
      "CTRADER_POSITION_CLOSE_TIMESTAMP_INVALID",
    ),
    updatedAt: updatedAt ?? receivedAt,
  };
}

function normalizeCloseDetail(
  deal: Record<string, unknown>,
): DemoExecutionCloseDetail | null {
  if (deal.closePositionDetail === undefined) return null;
  const detail = record(
    deal.closePositionDetail,
    "CTRADER_CLOSE_POSITION_DETAIL_INVALID",
  );
  const digits = numberField(detail, "moneyDigits");
  const closedVolume = optionalDecimalField(detail, "closedVolume");
  if (closedVolume !== null) {
    const volume = new Decimal(closedVolume);
    if (!volume.isInteger() || volume.lte(0))
      throw new Error("CTRADER_CLOSE_VOLUME_INVALID");
  }
  const balanceVersion = optionalStringField(detail, "balanceVersion") ?? null;
  if (balanceVersion !== null && !/^\d+$/.test(balanceVersion))
    throw new Error("CTRADER_BALANCE_VERSION_INVALID");
  return {
    entryPrice: priceField(detail, "entryPrice", true) as string,
    grossProfit: money(detail, "grossProfit", digits),
    swap: money(detail, "swap", digits),
    commission: money(detail, "commission", digits),
    pnlConversionFee: money(detail, "pnlConversionFee", digits, "0"),
    balance: money(detail, "balance", digits),
    closedVolume,
    quoteToDepositConversionRate: priceField(
      detail,
      "quoteToDepositConversionRate",
      false,
    ),
    balanceVersion,
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function normalizeDemoExecution(
  execution: BrokerExecution,
  options: DemoExecutionNormalizerOptions,
): DemoExecutionEvent | null {
  const received = new Date(execution.receivedAt);
  if (!Number.isFinite(received.getTime()))
    throw new Error("CTRADER_EXECUTION_RECEIVED_AT_INVALID");
  const receivedAt = received.toISOString();
  const order = execution.order;
  const position = execution.position;
  const deal = execution.deal;
  assertSymbol(order, options.symbolId);
  assertSymbol(position, options.symbolId);
  if (deal !== null && stringField(deal, "symbolId") !== options.symbolId) {
    throw new Error("DEMO_EXECUTION_SYMBOL_MISMATCH");
  }
  const prefix = options.strategyLabelPrefix ?? "ctrader-ai-scalper";
  const clientOrderId =
    order === null
      ? null
      : (optionalStringField(order, "clientOrderId") ?? null);
  const dealLabel =
    deal === null ? "" : (optionalStringField(deal, "label") ?? "");
  const strategyOwned =
    clientOrderId?.startsWith("cas-") === true ||
    label(order).startsWith(prefix) ||
    label(position).startsWith(prefix) ||
    dealLabel.startsWith(prefix);
  if (!strategyOwned) return null;
  if (
    [2, 3, 4, 5, 6, 7, 8, 11].includes(execution.executionType) &&
    order === null
  )
    throw new Error("DEMO_EXECUTION_ORDER_MISSING");
  if ([3, 11].includes(execution.executionType) && deal === null)
    throw new Error("DEMO_EXECUTION_DEAL_MISSING");
  if (
    [3, 11].includes(execution.executionType) &&
    clientOrderId?.startsWith("cas-") === true &&
    position === null
  ) {
    throw new Error("DEMO_EXECUTION_POSITION_MISSING");
  }

  const normalizedOrder =
    order === null
      ? null
      : normalizeOrder(order, receivedAt, execution.errorCode);
  if (normalizedOrder !== null)
    assertExecutionOrderState(execution.executionType, normalizedOrder.state);
  if (normalizedOrder?.clientOrderId === "" && deal === null)
    throw new Error("DEMO_EXECUTION_CLIENT_ORDER_ID_MISSING");
  const normalizedPosition =
    position === null ? null : normalizePosition(position, receivedAt);
  const brokerOrderId =
    normalizedOrder?.brokerOrderId ??
    (deal === null ? null : stringField(deal, "orderId"));
  const brokerPositionId =
    normalizedPosition?.brokerPositionId ??
    (deal === null ? null : stringField(deal, "positionId"));
  let fill: DemoExecutionFill | null = null;
  let brokerFillId: string | null = null;
  let closeDetail: DemoExecutionCloseDetail | null = null;
  if (deal !== null) {
    brokerFillId = stringField(deal, "dealId");
    if (brokerOrderId !== stringField(deal, "orderId"))
      throw new Error("DEMO_EXECUTION_DEAL_ORDER_MISMATCH");
    if (brokerPositionId !== stringField(deal, "positionId"))
      throw new Error("DEMO_EXECUTION_DEAL_POSITION_MISMATCH");
    const dealStatus = numberField(deal, "dealStatus");
    if (
      [3, 11].includes(execution.executionType) &&
      ![2, 3].includes(dealStatus)
    )
      throw new Error("DEMO_EXECUTION_DEAL_STATUS_INVALID");
    const occurredAt = isoTimestamp(
      numberField(deal, "executionTimestamp"),
      "CTRADER_DEAL_TIMESTAMP_INVALID",
    );
    const digits = optionalNumberField(deal, "moneyDigits");
    let commission = "0";
    if (optionalStringField(deal, "commission") !== undefined) {
      if (digits === undefined) throw new Error("CTRADER_MONEY_DIGITS_INVALID");
      commission = money(deal, "commission", digits);
    }
    const fillVolume = new Decimal(decimalField(deal, "filledVolume"));
    if (!fillVolume.isInteger() || fillVolume.lte(0))
      throw new Error("CTRADER_DEAL_FILLED_VOLUME_INVALID");
    fill = {
      brokerFillId,
      brokerOrderId,
      brokerPositionId,
      price: priceField(deal, "executionPrice", true) as string,
      volume: canonical(fillVolume),
      commission,
      occurredAt,
    };
    closeDetail = normalizeCloseDetail(deal);
  }
  const occurredAt =
    fill?.occurredAt ??
    normalizedOrder?.updatedAt ??
    normalizedPosition?.updatedAt ??
    receivedAt;
  const payload = {
    schemaVersion: "1.0" as const,
    executionType: execution.executionType,
    clientOrderId,
    brokerOrderId,
    brokerPositionId,
    brokerFillId,
    order: normalizedOrder,
    position: normalizedPosition,
    fill,
    closeDetail,
    occurredAt,
    errorCode: execution.errorCode,
  };
  const payloadHash = hash(payload);
  return {
    ...payload,
    eventKey:
      brokerFillId === null ? `event:${payloadHash}` : `deal:${brokerFillId}`,
    payloadHash,
    receivedAt,
  };
}

export class DurableDemoExecutionRecorder {
  readonly #store: DemoExecutionStore;
  readonly #options: DemoExecutionNormalizerOptions;
  #tail: Promise<void> = Promise.resolve();
  #reasonCodes = new Set<string>();

  constructor(
    store: DemoExecutionStore,
    options: DemoExecutionNormalizerOptions,
  ) {
    this.#store = store;
    this.#options = options;
  }

  enqueue(execution: BrokerExecution): void {
    this.#tail = this.#tail.then(async () => {
      try {
        const normalized = normalizeDemoExecution(execution, this.#options);
        if (normalized === null) return;
        const result = await this.#store.persist(normalized);
        for (const reason of result.reasonCodes) this.#reasonCodes.add(reason);
        if (!result.certain && result.reasonCodes.length === 0)
          this.#reasonCodes.add("DEMO_EXECUTION_PERSISTENCE_UNCERTAIN");
      } catch (error) {
        this.#reasonCodes.add(
          error instanceof Error
            ? error.message
            : "DEMO_EXECUTION_PERSISTENCE_FAILED",
        );
      }
    });
  }

  async flush(): Promise<DemoExecutionPersistenceResult> {
    while (true) {
      const tail = this.#tail;
      await tail;
      if (tail === this.#tail) break;
    }
    return {
      certain: this.#reasonCodes.size === 0,
      reasonCodes: [...this.#reasonCodes].sort(),
    };
  }
}
