import { Decimal } from "decimal.js";
import {
  numberField,
  record,
  stringField,
} from "../../../packages/ctrader-client/src/protocol.js";

export interface PredispatchBrokerAnchor {
  brokerOrderId: string;
  clientOrderId: string;
  symbolId: string;
  side: "BUY" | "SELL";
  volume: string;
  label: string;
}

/** Bind the selected broker account to an earlier mapped owned order. */
export function brokerAnchorMatches(
  anchor: PredispatchBrokerAnchor,
  orders: readonly Record<string, unknown>[],
  hasMore: boolean,
): boolean {
  if (
    hasMore !== false ||
    !anchor.brokerOrderId ||
    !anchor.clientOrderId ||
    !anchor.symbolId ||
    !anchor.label ||
    !["BUY", "SELL"].includes(anchor.side)
  )
    return false;
  try {
    const matches = orders.filter(
      (order) => stringField(order, "orderId") === anchor.brokerOrderId,
    );
    if (matches.length !== 1) return false;
    const order = matches[0]!;
    const data = record(order.tradeData, "PREDISPATCH_ANCHOR_INVALID");
    const expectedVolume = new Decimal(anchor.volume);
    return (
      expectedVolume.isFinite() &&
      expectedVolume.gt(0) &&
      expectedVolume.isInteger() &&
      stringField(order, "clientOrderId") === anchor.clientOrderId &&
      stringField(data, "symbolId") === anchor.symbolId &&
      numberField(data, "tradeSide") === (anchor.side === "BUY" ? 1 : 2) &&
      new Decimal(stringField(data, "volume")).eq(expectedVolume) &&
      stringField(data, "label") === anchor.label
    );
  } catch {
    return false;
  }
}
