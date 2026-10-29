import { describe, expect, it } from "vitest";
import {
  brokerAnchorMatches,
  type PredispatchBrokerAnchor,
} from "../../apps/execution-service/src/predispatch-broker-anchor.js";
const anchor: PredispatchBrokerAnchor = {
  brokerOrderId: "123",
  clientOrderId: "fixture",
  symbolId: "7",
  side: "BUY",
  volume: "100",
  label: "owned",
};
const order = {
  orderId: "123",
  clientOrderId: "fixture",
  tradeData: { symbolId: "7", tradeSide: 1, volume: "100", label: "owned" },
};
describe("broker account anchor", () => {
  it("requires the exact earlier mapped order", () =>
    expect(brokerAnchorMatches(anchor, [order], false)).toBe(true));
  it.each([
    { orders: [], hasMore: false },
    { orders: [order, order], hasMore: false },
    { orders: [order], hasMore: true },
    { orders: [{ ...order, clientOrderId: "different" }], hasMore: false },
    {
      orders: [{ ...order, tradeData: { ...order.tradeData, symbolId: "8" } }],
      hasMore: false,
    },
    {
      orders: [{ ...order, tradeData: { ...order.tradeData, tradeSide: 2 } }],
      hasMore: false,
    },
    {
      orders: [{ ...order, tradeData: { ...order.tradeData, volume: "101" } }],
      hasMore: false,
    },
    {
      orders: [
        { ...order, tradeData: { ...order.tradeData, label: "manual" } },
      ],
      hasMore: false,
    },
    { orders: [{ ...order, orderId: undefined }], hasMore: false },
  ])(
    "rejects missing, ambiguous or conflicting evidence %#",
    ({ orders, hasMore }) =>
      expect(brokerAnchorMatches(anchor, orders, hasMore)).toBe(false),
  );
});
