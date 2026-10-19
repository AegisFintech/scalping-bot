import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  RawDealHistory,
  RawOrderHistory,
} from "../../../packages/ctrader-client/src/client.js";
import {
  normalizeDemoExecution,
  type DemoExecutionEvent,
} from "./demo-execution.js";

export interface RetainedConflictVariant {
  readonly id: string;
  readonly payload: DemoExecutionEvent;
  readonly source: string;
  readonly originalMappingState: string;
  readonly originalReasonCodes: readonly string[];
}

/** Compare all event facts except receipt metadata and historical SL/TP context. */
function economicFacts(event: DemoExecutionEvent): unknown {
  const facts: Record<string, unknown> = { ...event };
  delete facts.payloadHash;
  delete facts.receivedAt;
  if (event.position !== null) {
    const position: Record<string, unknown> = { ...event.position };
    delete position.stopLoss;
    delete position.takeProfit;
    facts.position = position;
  }
  return facts;
}

export function terminalVariantEligibility(
  original: DemoExecutionEvent,
  variants: readonly RetainedConflictVariant[],
): string | null {
  if (
    original.executionType !== 3 ||
    !original.closingOrder ||
    original.brokerOrderType !== 4 ||
    original.order?.state !== "FILLED" ||
    original.position?.state !== "CLOSED" ||
    original.fill === null ||
    original.closeDetail?.closedVolume === null ||
    original.closeDetail === null
  )
    return "DEMO_TERMINAL_ATTESTATION_UNSUPPORTED";
  const originals = variants.filter(
    (v) =>
      v.source === "ORIGINAL_JOURNAL" &&
      v.payload.payloadHash === original.payloadHash,
  );
  if (
    originals.length !== 1 ||
    originals[0]!.originalMappingState !== "MAPPED" ||
    originals[0]!.originalReasonCodes.length !== 0 ||
    !variants.some(
      (v) =>
        v.source === "BROKER_CALLBACK" &&
        v.payload.payloadHash !== original.payloadHash,
    )
  )
    return "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED";
  if (
    variants.length > 32 ||
    variants.some(
      (v) =>
        ![
          "ORIGINAL_JOURNAL",
          "BROKER_CALLBACK",
          "HISTORY_RECONSTRUCTION",
        ].includes(v.source) ||
        !isDeepStrictEqual(economicFacts(v.payload), economicFacts(original)),
    )
  )
    return "DEMO_TERMINAL_VARIANT_FACT_CONFLICT";
  return null;
}

/** History can attest order/deal facts, never reconstructed position protection. */
export function verifyTerminalHistory(
  original: DemoExecutionEvent,
  orders: RawOrderHistory,
  deals: RawDealHistory,
  symbolId: string,
  now: Date,
): { readonly reason: string | null; readonly evidenceHash: string | null } {
  const reject = (reason: string) => ({ reason, evidenceHash: null });
  const at = now.getTime();
  const occurred = Date.parse(original.occurredAt);
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(occurred) ||
    occurred > at ||
    at - occurred > 7 * 86_400_000
  )
    return reject("DEMO_TERMINAL_HISTORY_WINDOW_INVALID");
  if (
    orders.hasMore ||
    deals.hasMore ||
    orders.orders.length > 1000 ||
    deals.deals.length > 1000
  )
    return reject("DEMO_TERMINAL_HISTORY_INCOMPLETE");
  if (
    [orders.receivedAt, deals.receivedAt].some(
      (t) =>
        !Number.isFinite(Date.parse(t)) ||
        Date.parse(t) > at ||
        at - Date.parse(t) > 30_000,
    )
  )
    return reject("DEMO_TERMINAL_HISTORY_STALE");
  const matchedOrders = orders.orders.filter(
    (o) => String(o.orderId) === original.brokerOrderId,
  );
  const matchedDeals = deals.deals.filter(
    (d) => String(d.dealId) === original.brokerFillId,
  );
  if (matchedOrders.length !== 1 || matchedDeals.length !== 1)
    return reject("DEMO_TERMINAL_HISTORY_AMBIGUOUS");
  const order = matchedOrders[0]!;
  const deal = matchedDeals[0]!;
  if (
    String(order.orderStatus) !== "2" ||
    String(deal.dealStatus) !== "2" ||
    String(order.executedVolume) !== String(deal.filledVolume) ||
    String(deal.volume) !== String(deal.filledVolume)
  )
    return reject("DEMO_TERMINAL_HISTORY_PARTIAL");
  const detail = deal.closePositionDetail;
  if (
    detail === null ||
    typeof detail !== "object" ||
    Array.isArray(detail) ||
    [
      "entryPrice",
      "grossProfit",
      "swap",
      "commission",
      "pnlConversionFee",
      "balance",
      "closedVolume",
      "moneyDigits",
    ].some((key) => !(key in detail))
  )
    return reject("DEMO_TERMINAL_HISTORY_COST_EVIDENCE_MISSING");
  const position = original.position;
  if (
    position === null ||
    position.openedAt === null ||
    position.closedAt === null ||
    position.entryPrice === null ||
    String(deal.orderId) !== original.brokerOrderId ||
    String(deal.positionId) !== original.brokerPositionId
  )
    return reject("DEMO_TERMINAL_HISTORY_IDENTITY_MISMATCH");
  try {
    // This position object is local historical context. It is excluded from the
    // independent-history claim and never persisted as a synthetic callback.
    const reconstructed = {
      positionId: position.brokerPositionId,
      positionStatus: 2,
      price: position.entryPrice,
      utcLastUpdateTimestamp: Date.parse(position.updatedAt),
      tradeData: {
        symbolId,
        volume: "0",
        tradeSide: position.side === "BUY" ? 1 : 2,
        openTimestamp: Date.parse(position.openedAt),
        closeTimestamp: Date.parse(position.closedAt),
      },
    };
    const normalized = normalizeDemoExecution(
      {
        executionType: 3,
        order,
        deal,
        position: reconstructed,
        errorCode: null,
        receivedAt: deals.receivedAt,
      },
      { symbolId },
    );
    if (
      normalized === null ||
      !isDeepStrictEqual(economicFacts(original), economicFacts(normalized))
    )
      return reject("DEMO_TERMINAL_HISTORY_FACT_MISMATCH");
    return {
      reason: null,
      evidenceHash: createHash("sha256")
        .update(
          JSON.stringify({
            order,
            deal,
            orderReceivedAt: orders.receivedAt,
            dealReceivedAt: deals.receivedAt,
          }),
        )
        .digest("hex"),
    };
  } catch {
    return reject("DEMO_TERMINAL_HISTORY_INVALID");
  }
}
