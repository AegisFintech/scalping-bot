import { Decimal } from "decimal.js";
import type pg from "pg";

import type {
  BrokerExecution,
  RawDealHistory,
  RawOrderHistory,
  RawReconciliation,
} from "../../../packages/ctrader-client/src/client.js";
import {
  numberField,
  optionalNumberField,
  optionalStringField,
  record,
  stringField,
} from "../../../packages/ctrader-client/src/protocol.js";
import {
  normalizeDemoExecution,
  type DemoExecutionNormalizerOptions,
  type DemoExecutionPersistenceResult,
  type DemoExecutionStore,
} from "./demo-execution.js";

export interface DemoExecutionHistoryClient {
  orderHistoryRaw(from: Date, to: Date): Promise<RawOrderHistory>;
  dealHistoryRaw(
    from: Date,
    to: Date,
    maxRows?: number,
  ): Promise<RawDealHistory>;
  reconcileRaw(): Promise<RawReconciliation>;
}

export interface DemoExecutionRecoveryOptions {
  readonly pool: pg.Pool;
  readonly accountId: string;
  readonly symbolId: string;
  readonly client: DemoExecutionHistoryClient;
  readonly store: DemoExecutionStore;
  readonly normalizer: DemoExecutionNormalizerOptions;
  readonly now?: () => Date;
}

interface LocalOrder {
  readonly client_order_id: string;
  readonly broker_order_id: string | null;
  readonly created_at: Date;
}

interface LocalPosition {
  readonly broker_position_id: string;
  readonly side: "BUY" | "SELL";
  readonly volume: string;
  readonly entry_price: string | null;
  readonly stop_loss: string | null;
  readonly take_profit: string | null;
  readonly opened_at: Date | null;
  readonly created_at: Date;
}

interface MappedFill {
  readonly broker_fill_id: string;
}

function reconstructPosition(
  position: LocalPosition,
  symbolId: string,
  strategyLabel: string,
  status: 1 | 2,
  updatedAt: number,
): Record<string, unknown> | null {
  if (position.entry_price === null) return null;
  return {
    positionId: position.broker_position_id,
    positionStatus: status,
    price: position.entry_price,
    utcLastUpdateTimestamp: updatedAt,
    tradeData: {
      symbolId,
      volume: status === 2 ? "0" : position.volume,
      tradeSide: position.side === "BUY" ? 1 : 2,
      ...(position.opened_at === null
        ? {}
        : { openTimestamp: position.opened_at.getTime() }),
      ...(status === 2 ? { closeTimestamp: updatedAt } : {}),
      label: strategyLabel,
    },
    ...(position.stop_loss === null ? {} : { stopLoss: position.stop_loss }),
    ...(position.take_profit === null
      ? {}
      : { takeProfit: position.take_profit }),
  };
}

function orderTradeData(
  order: Record<string, unknown>,
): Record<string, unknown> {
  return record(order.tradeData, "CTRADER_TRADE_DATA_INVALID");
}

function executionTypeForOrder(order: Record<string, unknown>): number {
  const total = new Decimal(stringField(orderTradeData(order), "volume"));
  const executed = new Decimal(
    optionalStringField(order, "executedVolume") ?? "0",
  );
  if (executed.gt(0) && executed.lt(total)) return 11;
  switch (numberField(order, "orderStatus")) {
    case 1:
      return 2;
    case 2:
      return 3;
    case 3:
      return 7;
    case 4:
      return 6;
    case 5:
      return 5;
    default:
      throw new Error("CTRADER_ORDER_STATUS_INVALID");
  }
}

function executionTypeForDeal(
  deal: Record<string, unknown>,
  order: Record<string, unknown>,
): number {
  return numberField(deal, "dealStatus") === 3 ||
    executionTypeForOrder(order) === 11
    ? 11
    : 3;
}

export async function recoverDemoExecutions(
  options: DemoExecutionRecoveryOptions,
): Promise<DemoExecutionPersistenceResult> {
  const localOrders = await options.pool.query<LocalOrder>(
    `SELECT o.client_order_id,
            COALESCE((
              SELECT e.broker_order_id
              FROM broker_execution_events e
              WHERE e.order_id = o.id AND e.mapping_state = 'MAPPED'
                AND e.execution_type IN (3, 11)
                AND e.broker_order_id IS NOT NULL
              ORDER BY e.occurred_at DESC, e.id DESC
              LIMIT 1
            ), o.broker_order_id) AS broker_order_id,
            og.created_at
     FROM orders o
     JOIN order_groups og ON og.id = o.order_group_id
     JOIN analysis_runs ar ON ar.id = og.analysis_id
     WHERE o.account_id = $1 AND ar.symbol_id = $2
       AND og.state NOT IN ('CLOSED','EXPIRED','FAILED')
     ORDER BY og.created_at ASC`,
    [options.accountId, options.symbolId],
  );
  const localPositions = await options.pool.query<LocalPosition>(
    `SELECT p.broker_position_id, p.side, p.volume::text, p.entry_price::text,
            p.stop_loss::text, p.take_profit::text,
            p.opened_at, og.created_at
     FROM positions p
     JOIN order_groups og ON og.id = p.order_group_id
     JOIN analysis_runs ar ON ar.id = og.analysis_id
     WHERE p.account_id = $1 AND p.symbol_id = $2
       AND p.broker_position_id IS NOT NULL
       AND p.state IN ('OPEN','CLOSING','UNKNOWN','RECONCILIATION_PENDING')
       AND og.state NOT IN ('CLOSED','EXPIRED','FAILED')
     ORDER BY og.created_at ASC`,
    [options.accountId, options.symbolId],
  );
  if (localOrders.rows.length === 0 && localPositions.rows.length === 0)
    return { certain: true, reasonCodes: [] };
  const mappedFills = await options.pool.query<MappedFill>(
    `SELECT broker_fill_id
     FROM broker_execution_events
     WHERE account_id = $1 AND symbol_id = $2
       AND mapping_state = 'MAPPED' AND broker_fill_id IS NOT NULL`,
    [options.accountId, options.symbolId],
  );
  const mappedFillIds = new Set(
    mappedFills.rows.map((row) => row.broker_fill_id),
  );
  const now = options.now?.() ?? new Date();
  const earliest = [...localOrders.rows, ...localPositions.rows]
    .map((row) => row.created_at)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (earliest === undefined || !Number.isFinite(earliest.getTime()))
    return {
      certain: false,
      reasonCodes: ["DEMO_RECOVERY_LOCAL_TIMESTAMP_INVALID"],
    };
  const maximumWindowMs = 7 * 24 * 60 * 60 * 1_000;
  if (now.getTime() - earliest.getTime() > maximumWindowMs)
    return {
      certain: false,
      reasonCodes: ["DEMO_RECOVERY_HISTORY_WINDOW_EXCEEDED"],
    };
  const from = new Date(Math.max(0, earliest.getTime() - 5 * 60_000));
  const reconciliationPromise = options.client.reconcileRaw();
  const orders = await options.client.orderHistoryRaw(from, now);
  const deals = await options.client.dealHistoryRaw(from, now, 1_000);
  const reconciliation = await reconciliationPromise;
  if (orders.hasMore || deals.hasMore)
    return {
      certain: false,
      reasonCodes: ["DEMO_RECOVERY_HISTORY_PAGINATION_REQUIRED"],
    };
  const historyOrders = [...orders.orders, ...reconciliation.orders];
  const reasons = new Set<string>();
  const processedDealIds = new Set<string>();
  const persistRaw = async (
    raw: BrokerExecution,
    completedOrder: boolean,
  ): Promise<void> => {
    try {
      const event = normalizeDemoExecution(raw, options.normalizer);
      if (event === null) {
        reasons.add("DEMO_RECOVERY_STRATEGY_OWNERSHIP_MISSING");
        return;
      }
      const result = await options.store.persist(event);
      for (const reason of result.reasonCodes) {
        if (!(
          reason === "DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED" &&
          completedOrder
        )) {
          reasons.add(reason);
        }
      }
      if (!result.certain && result.reasonCodes.length === 0)
        reasons.add("DEMO_RECOVERY_PERSISTENCE_UNCERTAIN");
    } catch (error) {
      reasons.add(
        error instanceof Error ? error.message : "DEMO_RECOVERY_FAILED",
      );
    }
  };
  for (const localOrder of localOrders.rows) {
    const matches = historyOrders.filter((order) => {
      const clientOrderId = optionalStringField(order, "clientOrderId");
      const brokerOrderId = optionalStringField(order, "orderId");
      if (localOrder.broker_order_id !== null)
        return brokerOrderId === localOrder.broker_order_id;
      return (
        clientOrderId === localOrder.client_order_id &&
        order.closingOrder !== true &&
        optionalNumberField(order, "orderType") !== 4
      );
    });
    const orderIds = new Set(
      matches.map((order) => stringField(order, "orderId")),
    );
    if (orderIds.size !== 1) {
      reasons.add(
        orderIds.size === 0
          ? "DEMO_RECOVERY_BROKER_ORDER_NOT_FOUND"
          : "DEMO_RECOVERY_BROKER_ORDER_AMBIGUOUS",
      );
      continue;
    }
    const order = matches.sort(
      (left, right) =>
        (optionalNumberField(right, "utcLastUpdateTimestamp") ?? 0) -
        (optionalNumberField(left, "utcLastUpdateTimestamp") ?? 0),
    )[0];
    if (order === undefined) {
      reasons.add("DEMO_RECOVERY_BROKER_ORDER_NOT_FOUND");
      continue;
    }
    const brokerOrderId = stringField(order, "orderId");
    const brokerOrderDeals = deals.deals
      .filter((deal) => stringField(deal, "orderId") === brokerOrderId)
      .sort(
        (left, right) =>
          numberField(left, "executionTimestamp") -
          numberField(right, "executionTimestamp"),
      );
    for (const deal of brokerOrderDeals)
      processedDealIds.add(stringField(deal, "dealId"));
    const orderDeals = brokerOrderDeals.filter(
      (deal) => !mappedFillIds.has(stringField(deal, "dealId")),
    );
    const rawEvents: BrokerExecution[] =
      brokerOrderDeals.length === 0
        ? [
            {
              executionType: executionTypeForOrder(order),
              order,
              position: null,
              deal: null,
              errorCode: null,
              receivedAt: orders.receivedAt,
            },
          ]
        : orderDeals.map((deal) => {
            const positionId = stringField(deal, "positionId");
            const position =
              reconciliation.positions.find(
                (candidate) =>
                  stringField(candidate, "positionId") === positionId,
              ) ??
              (() => {
                const localPosition = localPositions.rows.find(
                  (candidate) => candidate.broker_position_id === positionId,
                );
                return localPosition === undefined
                  ? null
                  : reconstructPosition(
                      localPosition,
                      options.normalizer.symbolId,
                      optionalStringField(orderTradeData(order), "label") ?? "",
                      1,
                      numberField(deal, "executionTimestamp"),
                    );
              })();
            return {
              executionType: executionTypeForDeal(deal, order),
              order,
              position,
              deal,
              errorCode: null,
              receivedAt: deals.receivedAt,
            };
          });
    for (const raw of rawEvents) {
      await persistRaw(raw, executionTypeForOrder(order) === 3);
    }
  }
  for (const localPosition of localPositions.rows) {
    const closingDeals = deals.deals.filter(
      (deal) =>
        stringField(deal, "positionId") === localPosition.broker_position_id &&
        deal.closePositionDetail !== undefined &&
        !processedDealIds.has(stringField(deal, "dealId")),
    );
    if (closingDeals.length === 0) {
      const stillOpen = reconciliation.positions.some(
        (position) =>
          stringField(position, "positionId") ===
          localPosition.broker_position_id,
      );
      if (!stillOpen)
        reasons.add("DEMO_RECOVERY_POSITION_CLOSE_DEAL_NOT_FOUND");
      continue;
    }
    if (closingDeals.length !== 1) {
      reasons.add("DEMO_RECOVERY_MULTIPLE_CLOSING_DEALS_UNSUPPORTED");
      continue;
    }
    const deal = closingDeals[0]!;
    const brokerOrderId = stringField(deal, "orderId");
    const closingOrders = historyOrders.filter(
      (order) => stringField(order, "orderId") === brokerOrderId,
    );
    if (closingOrders.length !== 1) {
      reasons.add(
        closingOrders.length === 0
          ? "DEMO_RECOVERY_CLOSING_ORDER_NOT_FOUND"
          : "DEMO_RECOVERY_CLOSING_ORDER_AMBIGUOUS",
      );
      continue;
    }
    const closingOrder = closingOrders[0]!;
    if (
      optionalNumberField(closingOrder, "orderType") !== 4 ||
      closingOrder.closingOrder !== true
    ) {
      reasons.add("DEMO_RECOVERY_CLOSING_ORDER_INVALID");
      continue;
    }
    const reconstructed = reconstructPosition(
      localPosition,
      options.normalizer.symbolId,
      optionalStringField(orderTradeData(closingOrder), "label") ?? "",
      2,
      numberField(deal, "executionTimestamp"),
    );
    if (reconstructed === null) {
      reasons.add("DEMO_RECOVERY_POSITION_ENTRY_PRICE_MISSING");
      continue;
    }
    await persistRaw(
      {
        executionType: executionTypeForDeal(deal, closingOrder),
        order: closingOrder,
        position: reconstructed,
        deal,
        errorCode: null,
        receivedAt: deals.receivedAt,
      },
      true,
    );
  }
  return { certain: reasons.size === 0, reasonCodes: [...reasons].sort() };
}
