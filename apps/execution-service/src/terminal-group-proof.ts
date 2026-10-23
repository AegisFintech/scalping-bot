import type { LocalUnsentEntryProof } from "../../../packages/contracts/src/local-unsent-entry-proof.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Decimal } from "decimal.js";
import type {
  RawDealHistory,
  RawOrderHistory,
  RawReconciliation,
} from "../../../packages/ctrader-client/src/client.js";
import { type DemoExecutionEvent } from "./demo-execution.js";
import {
  terminalVariantEligibility,
  verifyTerminalHistory,
  type RetainedConflictVariant,
} from "./terminal-conflict-proof.js";

export interface TerminalGroupSnapshot {
  readonly group: {
    readonly id: string;
    readonly accountId: string;
    readonly symbolId: string;
    readonly mode: string;
    readonly state: string;
    readonly entrySide?: "BUY" | "SELL" | null;
  };
  readonly orders: readonly {
    readonly id: string;
    readonly accountId: string;
    readonly clientId: string;
    readonly brokerId: string | null;
    readonly side: string;
    readonly state: string;
    readonly owned: boolean;
    readonly volume: string;
    readonly filled: string;
    readonly updatedAt: string | null;
    readonly localUnsent?: LocalUnsentEntryProof;
  }[];
  readonly positions: readonly {
    readonly id: string;
    readonly accountId: string;
    readonly symbolId: string;
    readonly brokerId: string | null;
    readonly side: string;
    readonly state: string;
    readonly owned: boolean;
    readonly entryPrice: string | null;
    readonly openedAt: string | null;
    readonly closedAt: string | null;
  }[];
  readonly fills: readonly {
    readonly id: string;
    readonly orderId: string | null;
    readonly positionId: string | null;
    readonly brokerId: string | null;
    readonly price: string;
    readonly volume: string;
    readonly commission: string;
    readonly occurredAt: string;
  }[];
  readonly trades: readonly {
    readonly positionId: string | null;
    readonly mode: string;
    readonly direction: string;
    readonly pnl: string;
    readonly fees: string;
    readonly openedAt: string;
    readonly closedAt: string;
  }[];
  readonly events: readonly {
    readonly id: string;
    readonly accountId: string;
    readonly symbolId: string;
    readonly positionId: string | null;
    readonly mapping: string;
    readonly reasons: readonly string[];
    readonly resolved: boolean;
    readonly payload: DemoExecutionEvent;
  }[];
  readonly variants: readonly (RetainedConflictVariant & {
    readonly eventId: string;
  })[];
}

export interface TerminalHistoryEvidence {
  readonly orders: RawOrderHistory;
  readonly deals: RawDealHistory;
  readonly reconciliation: RawReconciliation;
}
export interface TerminalGroupProof {
  readonly reason: string | null;
  readonly eventHashes: Readonly<Record<string, string>>;
  readonly evidenceHash: string | null;
}
export function terminalSnapshotHash(snapshot: TerminalGroupSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...snapshot,
        events: snapshot.events.map((event) => ({ ...event, resolved: false })),
      }),
    )
    .digest("hex");
}
const sameTime = (a: string | null, b: string | null): boolean =>
  a !== null &&
  b !== null &&
  Number.isFinite(Date.parse(a)) &&
  Date.parse(a) === Date.parse(b);
const eq = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && new Decimal(a).isFinite() && new Decimal(a).eq(b);
const reject = (reason: string): TerminalGroupProof => ({
  reason,
  eventHashes: {},
  evidenceHash: null,
});

/** Financial proof only: no broker commands, journal updates or authority alone. */
export function proveTerminalGroup(
  snapshot: TerminalGroupSnapshot,
  history: TerminalHistoryEvidence,
  symbol: string,
  now: Date,
): TerminalGroupProof {
  return checkGroup(snapshot, history, symbol, now, false);
}

/** Read-only financial audit. Missing historical callbacks NEVER become authority. */
export function auditLegacyTerminalGroup(
  snapshot: TerminalGroupSnapshot,
  history: TerminalHistoryEvidence,
  symbol: string,
  now: Date,
) {
  const result = checkGroup(snapshot, history, symbol, now, true);
  return {
    decision: "HOLD" as const,
    brokerAuthority: false as const,
    financialEvidenceComplete:
      result.reason === null || result.legacyFinancialVerified === true,
    legacyGapIsOnlyFailedCheck: result.legacyFinancialVerified === true,
    reason: result.reason,
    evidenceHash: result.evidenceHash,
  };
}

function checkGroup(
  snapshot: TerminalGroupSnapshot,
  history: TerminalHistoryEvidence,
  symbol: string,
  now: Date,
  readOnlyLegacyAudit: boolean,
): TerminalGroupProof & { readonly legacyFinancialVerified?: true } {
  let legacyMissing = false;
  try {
    const { group, orders, positions, fills, trades, events, variants } =
      snapshot;
    if (group.entrySide != null && !["BUY", "SELL"].includes(group.entrySide))
      return reject("DEMO_TERMINAL_GROUP_INCOMPLETE");
    const expected = group.entrySide == null ? 2 : 1;
    if (
      group.mode !== "demo" ||
      group.state !== "CLOSED" ||
      orders.length !== expected ||
      positions.length < 1 ||
      positions.length > expected ||
      trades.length !== positions.length ||
      fills.length > 16 ||
      events.length > 128 ||
      variants.length > 64 ||
      new Set(orders.map((o) => o.side)).size !== expected ||
      (group.entrySide != null &&
        orders.some((o) => o.side !== group.entrySide)) ||
      orders.some(
        (o) =>
          !o.owned ||
          o.accountId !== group.accountId ||
          (o.brokerId === null && o.localUnsent === undefined) ||
          !["BUY", "SELL"].includes(o.side),
      ) ||
      positions.some(
        (p) =>
          !p.owned ||
          p.accountId !== group.accountId ||
          p.symbolId !== group.symbolId ||
          p.state !== "CLOSED" ||
          p.brokerId === null,
      )
    )
      return reject("DEMO_TERMINAL_GROUP_INCOMPLETE");
    const received = Date.parse(history.reconciliation.receivedAt);
    if (
      !Number.isFinite(received) ||
      received > now.getTime() ||
      now.getTime() - received > 30_000 ||
      history.reconciliation.orders.length !== 0 ||
      history.reconciliation.positions.length !== 0
    )
      return reject("DEMO_TERMINAL_ACCOUNT_NOT_RECONCILED");
    if (
      history.orders.hasMore ||
      history.deals.hasMore ||
      history.orders.orders.length > 1000 ||
      history.deals.deals.length > 1000
    )
      return reject("DEMO_TERMINAL_HISTORY_INCOMPLETE");
    if (
      events.some(
        (e) => e.accountId !== group.accountId || e.symbolId !== group.symbolId,
      )
    )
      return reject("DEMO_TERMINAL_EVENT_SCOPE_MISMATCH");
    if (
      events.some(
        (e) =>
          !(e.mapping === "MAPPED" && e.reasons.length === 0) &&
          !(
            e.mapping === "MAPPED" &&
            e.payload.brokerOrderType === 4 &&
            e.payload.closingOrder &&
            e.payload.fill === null &&
            e.payload.closeDetail === null &&
            ((e.payload.executionType === 2 &&
              isDeepStrictEqual(e.reasons, [
                "DEMO_CLOSING_ORDER_AWAITING_DEAL",
              ])) ||
              (e.payload.executionType === 4 &&
                isDeepStrictEqual(e.reasons, [
                  "DEMO_ORDER_REPLACED_RECONCILIATION_REQUIRED",
                ]))) &&
            events.some(
              (close) =>
                close.positionId !== null &&
                close.positionId === e.positionId &&
                close.payload.closingOrder &&
                close.payload.brokerOrderId === e.payload.brokerOrderId &&
                close.payload.fill !== null &&
                close.payload.closeDetail !== null &&
                Date.parse(close.payload.occurredAt) >=
                  Date.parse(e.payload.occurredAt),
            )
          ) &&
          !(
            e.mapping === "CONFLICT" &&
            isDeepStrictEqual(e.reasons, ["DEMO_BROKER_EVENT_KEY_CONFLICT"]) &&
            e.payload.closingOrder
          ),
      )
    )
      return reject("DEMO_TERMINAL_ADDITIONAL_UNCERTAINTY");
    // Do not silently bless older entry-event conflicts or incomplete variant sets.
    if (
      variants.some(
        (v) =>
          !events.some((e) => e.id === v.eventId && e.payload.closingOrder),
      )
    )
      return reject("DEMO_TERMINAL_VARIANT_FACT_CONFLICT");
    const expectedDeals = new Set<string>();
    for (const order of orders) {
      if (order.brokerId === null) {
        const p = order.localUnsent;
        if (
          !p ||
          p.orderId !== order.id ||
          p.groupId !== group.id ||
          p.accountId !== group.accountId ||
          p.symbolId !== group.symbolId ||
          p.clientId !== order.clientId ||
          order.state !== "REJECTED" ||
          !eq(order.filled, "0") ||
          ![
            "MARKET_SESSION_CLOSED",
            "MARKET_SESSION_UNAVAILABLE",
            "DEMO_PEER_WITHHELD_BEFORE_DISPATCH",
            "DEMO_PREFLIGHT_RECONCILIATION_WITHHELD",
          ].includes(p.reason) ||
          !Number.isFinite(Date.parse(p.sourceUpdatedAt)) ||
          !Number.isFinite(Date.parse(p.recordedAt)) ||
          Date.parse(p.sourceUpdatedAt) > Date.parse(p.recordedAt) ||
          Date.parse(p.recordedAt) > received ||
          fills.some((f) => f.orderId === order.id) ||
          events.some((e) => e.payload.clientOrderId === order.clientId) ||
          variants.some((v) => v.payload.clientOrderId === order.clientId) ||
          history.orders.orders.some((o) => o.clientOrderId === order.clientId)
        )
          return reject("DEMO_TERMINAL_LOCAL_UNSENT_PROOF_INVALID");
        continue;
      }
      const rawOrders = history.orders.orders.filter(
        (o) => String(o.orderId) === order.brokerId,
      );
      if (rawOrders.length !== 1)
        return reject("DEMO_TERMINAL_ENTRY_HISTORY_AMBIGUOUS");
      const raw = rawOrders[0]!;
      const data = raw.tradeData as Record<string, unknown> | undefined;
      if (
        !data ||
        String(data.symbolId) !== symbol ||
        String(data.tradeSide) !== (order.side === "BUY" ? "1" : "2") ||
        raw.clientOrderId !== order.clientId ||
        !eq(String(data.volume), order.volume) ||
        typeof data.label !== "string" ||
        !data.label.startsWith("ctrader-ai-scalper") ||
        raw.closingOrder === true
      )
        return reject("DEMO_TERMINAL_ENTRY_OWNERSHIP_MISMATCH");
      const statuses: Record<string, string> = {
        FILLED: "2",
        CANCELLED: "5",
        EXPIRED: "4",
        REJECTED: "3",
      };
      if (
        statuses[order.state] !== String(raw.orderStatus) ||
        !eq(String(raw.executedVolume), order.filled) ||
        !sameTime(
          order.updatedAt,
          new Date(Number(raw.utcLastUpdateTimestamp)).toISOString(),
        )
      )
        return reject("DEMO_TERMINAL_ENTRY_STATE_MISMATCH");
      const entryFills = fills.filter((f) => f.orderId === order.id);
      const rawDeals = history.deals.deals.filter(
        (d) => String(d.orderId) === order.brokerId,
      );
      if (order.state !== "FILLED") {
        if (
          !eq(order.filled, "0") ||
          entryFills.length !== 0 ||
          rawDeals.length !== 0
        )
          return reject("DEMO_TERMINAL_PEER_NOT_ZERO_FILL");
        continue;
      }
      if (
        !eq(order.filled, order.volume) ||
        entryFills.length === 0 ||
        rawDeals.length !== entryFills.length ||
        !eq(
          entryFills
            .reduce((sum, f) => sum.plus(f.volume), new Decimal(0))
            .toString(),
          order.filled,
        )
      )
        return reject("DEMO_TERMINAL_ENTRY_VOLUME_MISMATCH");
      for (const fill of entryFills) {
        const matches = rawDeals.filter(
          (d) => String(d.dealId) === fill.brokerId,
        );
        const position = positions.find((p) => p.id === fill.positionId);
        if (
          matches.length !== 1 ||
          !position ||
          position.side !== order.side ||
          fill.brokerId === null
        )
          return reject("DEMO_TERMINAL_ENTRY_DEAL_AMBIGUOUS");
        const deal = matches[0]!;
        if (
          typeof deal.commission !== "string" ||
          typeof deal.moneyDigits !== "number"
        )
          return reject("DEMO_TERMINAL_HISTORY_COST_EVIDENCE_MISSING");
        if (
          String(deal.dealStatus) !== "2" ||
          String(deal.positionId) !== position.brokerId ||
          String(deal.tradeSide) !== (position.side === "BUY" ? "1" : "2") ||
          deal.closePositionDetail !== undefined
        )
          return reject("DEMO_TERMINAL_ENTRY_DEAL_MISMATCH");
        const digits = Number(deal.moneyDigits);
        if (
          !Number.isSafeInteger(digits) ||
          digits < 0 ||
          digits > 18 ||
          String(deal.symbolId) !== symbol ||
          !eq(String(deal.volume), String(deal.filledVolume)) ||
          !eq(String(deal.executionPrice), fill.price) ||
          !eq(String(deal.filledVolume), fill.volume) ||
          !eq(
            new Decimal(deal.commission)
              .div(new Decimal(10).pow(digits))
              .toString(),
            fill.commission,
          ) ||
          !sameTime(
            new Date(Number(deal.executionTimestamp)).toISOString(),
            fill.occurredAt,
          )
        )
          return reject("DEMO_TERMINAL_ENTRY_FINANCIAL_MISMATCH");
        expectedDeals.add(fill.brokerId);
      }
    }
    const eventHashes: Record<string, string> = {};
    for (const position of positions) {
      const closes = events.filter(
        (e) =>
          e.positionId === position.id &&
          e.payload.closingOrder &&
          e.payload.fill !== null &&
          e.payload.closeDetail !== null,
      );
      const positionTrades = trades.filter((t) => t.positionId === position.id);
      const closeFills = fills.filter(
        (f) => f.positionId === position.id && f.orderId === null,
      );
      const entries = fills.filter(
        (f) => f.positionId === position.id && f.orderId !== null,
      );
      if (
        closes.length !== 1 ||
        positionTrades.length !== 1 ||
        closeFills.length !== 1 ||
        entries.length === 0
      )
        return reject("DEMO_TERMINAL_POSITION_INCOMPLETE");
      const event = closes[0]!;
      if (event.mapping === "CONFLICT") {
        const eligible = terminalVariantEligibility(
          event.payload,
          variants.filter((v) => v.eventId === event.id),
        );
        if (eligible !== null) {
          if (
            readOnlyLegacyAudit &&
            !variants.some((v) => v.eventId === event.id) &&
            eligible === "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED"
          )
            legacyMissing = true;
          else return reject(eligible);
        }
      } else if (
        event.mapping !== "MAPPED" ||
        event.reasons.length !== 0 ||
        variants.some((v) => v.eventId === event.id)
      ) {
        return reject("DEMO_TERMINAL_ADDITIONAL_UNCERTAINTY");
      }
      const checked = verifyTerminalHistory(
        event.payload,
        history.orders,
        history.deals,
        symbol,
        now,
      );
      if (checked.reason !== null) return reject(checked.reason);
      const detail = event.payload.closeDetail!;
      const fill = closeFills[0]!;
      const trade = positionTrades[0]!;
      const entryVolume = entries.reduce(
        (sum, f) => sum.plus(f.volume),
        new Decimal(0),
      );
      const fees = new Decimal(detail.commission)
        .plus(detail.swap)
        .plus(detail.pnlConversionFee);
      if (
        event.payload.brokerPositionId !== position.brokerId ||
        event.payload.position?.side !== position.side ||
        !sameTime(
          event.payload.position?.openedAt ?? null,
          position.openedAt,
        ) ||
        !sameTime(
          event.payload.position?.closedAt ?? null,
          position.closedAt,
        ) ||
        !sameTime(position.closedAt, event.payload.occurredAt) ||
        !sameTime(trade.closedAt, position.closedAt) ||
        !sameTime(trade.openedAt, position.openedAt) ||
        !sameTime(fill.occurredAt, position.closedAt) ||
        trade.mode !== "demo" ||
        trade.direction !== (position.side === "BUY" ? "LONG" : "SHORT") ||
        fill.brokerId !== event.payload.brokerFillId ||
        !eq(detail.entryPrice, position.entryPrice) ||
        !eq(detail.closedVolume, entryVolume.toString()) ||
        !eq(fill.volume, detail.closedVolume) ||
        !eq(fill.price, event.payload.fill!.price) ||
        !eq(fill.commission, event.payload.fill!.commission) ||
        !eq(trade.fees, fees.toString()) ||
        !eq(trade.pnl, new Decimal(detail.grossProfit).plus(fees).toString())
      )
        return reject("DEMO_TERMINAL_LOCAL_FINANCIAL_MISMATCH");
      eventHashes[event.id] = event.payload.payloadHash;
      expectedDeals.add(event.payload.brokerFillId!);
    }
    if (
      orders.filter((o) => o.state === "FILLED").length !== positions.length ||
      fills.some(
        (f) =>
          !positions.some((p) => p.id === f.positionId) ||
          (f.orderId !== null && !orders.some((o) => o.id === f.orderId)),
      ) ||
      history.deals.deals.some(
        (d) =>
          (positions.some((p) => p.brokerId === String(d.positionId)) ||
            orders.some((o) => o.brokerId === String(d.orderId)) ||
            events.some(
              (e) =>
                e.payload.closingOrder &&
                e.payload.brokerOrderId === String(d.orderId),
            )) &&
          !expectedDeals.has(String(d.dealId)),
      )
    )
      return reject("DEMO_TERMINAL_UNEXPECTED_DEAL");
    if (legacyMissing)
      return {
        reason: "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED",
        eventHashes: {},
        evidenceHash: createHash("sha256")
          .update(JSON.stringify(history))
          .digest("hex"),
        legacyFinancialVerified: true,
      };
    return {
      reason: null,
      eventHashes,
      evidenceHash: createHash("sha256")
        .update(JSON.stringify(history))
        .digest("hex"),
    };
  } catch {
    return reject("DEMO_TERMINAL_GROUP_EVIDENCE_INVALID");
  }
}
