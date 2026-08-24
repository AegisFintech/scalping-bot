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
  const local = await options.pool.query<LocalOrder>(
    `SELECT o.client_order_id, o.broker_order_id, og.created_at
     FROM orders o
     JOIN order_groups og ON og.id = o.order_group_id
     JOIN analysis_runs ar ON ar.id = og.analysis_id
     WHERE o.account_id = $1 AND ar.symbol_id = $2
       AND og.state NOT IN ('CLOSED','EXPIRED','FAILED')
     ORDER BY og.created_at ASC`,
    [options.accountId, options.symbolId],
  );
  if (local.rows.length === 0) return { certain: true, reasonCodes: [] };
  const now = options.now?.() ?? new Date();
  const earliest = local.rows[0]?.created_at;
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
  for (const localOrder of local.rows) {
    const matches = historyOrders.filter((order) => {
      const clientOrderId = optionalStringField(order, "clientOrderId");
      const brokerOrderId = optionalStringField(order, "orderId");
      return (
        clientOrderId === localOrder.client_order_id ||
        (localOrder.broker_order_id !== null &&
          brokerOrderId === localOrder.broker_order_id)
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
    const orderDeals = deals.deals
      .filter((deal) => stringField(deal, "orderId") === brokerOrderId)
      .sort(
        (left, right) =>
          numberField(left, "executionTimestamp") -
          numberField(right, "executionTimestamp"),
      );
    const rawEvents: BrokerExecution[] =
      orderDeals.length === 0
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
              ) ?? null;
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
      try {
        const event = normalizeDemoExecution(raw, options.normalizer);
        if (event === null) {
          reasons.add("DEMO_RECOVERY_STRATEGY_OWNERSHIP_MISSING");
          continue;
        }
        const result = await options.store.persist(event);
        for (const reason of result.reasonCodes) {
          if (!(
            reason === "DEMO_PARTIAL_FILL_RECONCILIATION_REQUIRED" &&
            executionTypeForOrder(order) === 3
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
    }
  }
  return { certain: reasons.size === 0, reasonCodes: [...reasons].sort() };
}
