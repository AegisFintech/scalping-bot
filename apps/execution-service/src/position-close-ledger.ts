import { Decimal } from "decimal.js";
import type pg from "pg";
import type {
  DemoExecutionEvent,
  DemoExecutionCloseDetail,
} from "./demo-execution.js";

/** Evidence of an executed close only. Never authorizes a broker command. */
export async function provePositionClose(
  db: Pick<pg.PoolClient, "query"> | Pick<pg.Pool, "query">,
  event: DemoExecutionEvent,
  accountId: string,
  symbolId: string,
): Promise<{ positionId: string; aggregate: DemoExecutionCloseDetail } | null> {
  const f = event.fill,
    d = event.closeDetail,
    p = event.position;
  if (
    !f ||
    !d ||
    !p ||
    !event.closingOrder ||
    ![1, 4].includes(event.brokerOrderType ?? 0) ||
    ![3, 11].includes(event.executionType) ||
    !["FILLED", "PARTIALLY_FILLED"].includes(event.order?.state ?? "") ||
    !event.brokerOrderId ||
    !event.brokerPositionId ||
    !d.closedVolume ||
    p.entryPrice === null ||
    !new Decimal(p.entryPrice).eq(d.entryPrice) ||
    f.brokerPositionId !== event.brokerPositionId ||
    f.brokerOrderId !== event.brokerOrderId ||
    p.brokerPositionId !== event.brokerPositionId ||
    !new Decimal(f.volume).eq(d.closedVolume)
  )
    return null;
  if (
    p.state === "CLOSED" &&
    (p.closedAt === null || Date.parse(p.closedAt) !== Date.parse(f.occurredAt))
  )
    return null;
  const r = await db.query<{
    id: string;
    entry_volume: string;
    closed_volume: string;
    gross: string;
    commission: string;
    swap: string;
    conversion: string;
    duplicate: boolean;
  }>(
    `SELECT p.id, COALESCE((SELECT sum(f.volume) FROM fills f WHERE f.position_id=p.id AND f.order_id IS NOT NULL),0)::text entry_volume,
 COALESCE(c.volume,0)::text closed_volume,COALESCE(c.gross,0)::text gross,COALESCE(c.commission,0)::text commission,
 COALESCE(c.swap,0)::text swap,COALESCE(c.conversion,0)::text conversion,
 EXISTS(SELECT 1 FROM position_close_deals k WHERE k.position_id=p.id AND k.broker_deal_id=$8) duplicate
 FROM positions p JOIN order_groups g ON g.id=p.order_group_id
 LEFT JOIN LATERAL(SELECT sum(closed_volume) volume,sum(gross_profit) gross,sum(commission) commission,
 sum(swap) swap,sum(conversion_fee) conversion FROM position_close_deals WHERE position_id=p.id) c ON true
 WHERE p.account_id=$1 AND p.symbol_id=$2 AND p.broker_position_id=$3 AND p.strategy_owned AND g.mode='demo'
 AND p.side=$4 AND p.entry_price=$5 AND p.opened_at=$6 AND p.opened_at<=$7
 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.account_id=$1 AND o.broker_order_id=$9)`,
    [
      accountId,
      symbolId,
      event.brokerPositionId,
      p.side,
      d.entryPrice,
      p.openedAt,
      event.occurredAt,
      f.brokerFillId,
      event.brokerOrderId,
    ],
  );
  if (r.rows.length !== 1) return null;
  const row = r.rows[0]!;
  // A replay must be handled by the existing immutable event-key path, not counted twice.
  if (row.duplicate) return null;
  const closed = new Decimal(row.closed_volume).plus(d.closedVolume),
    remaining = new Decimal(row.entry_volume).minus(closed);
  if (
    closed.lte(0) ||
    remaining.lt(0) ||
    !new Decimal(p.volume).eq(remaining) ||
    (remaining.eq(0) ? p.state !== "CLOSED" : p.state !== "OPEN")
  )
    return null;
  return {
    positionId: row.id,
    aggregate: {
      ...d,
      closedVolume: closed.toFixed(),
      grossProfit: new Decimal(row.gross).plus(d.grossProfit).toFixed(),
      commission: new Decimal(row.commission).plus(d.commission).toFixed(),
      swap: new Decimal(row.swap).plus(d.swap).toFixed(),
      pnlConversionFee: new Decimal(row.conversion)
        .plus(d.pnlConversionFee)
        .toFixed(),
    },
  };
}
export async function recordPositionClose(
  db: Pick<pg.PoolClient, "query">,
  event: DemoExecutionEvent,
  accountId: string,
  symbolId: string,
  external: boolean,
) {
  const proof = await provePositionClose(db, event, accountId, symbolId);
  if (!proof) throw new Error("DEMO_CLOSE_DEAL_EVIDENCE_INVALID");
  const d = event.closeDetail!,
    f = event.fill!;
  await db.query(
    `INSERT INTO position_close_deals(account_id,symbol_id,position_id,broker_deal_id,broker_order_id,closed_volume,
 entry_price,gross_profit,commission,swap,conversion_fee,occurred_at,external_intervention,evidence_hash)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      accountId,
      symbolId,
      proof.positionId,
      f.brokerFillId,
      event.brokerOrderId,
      d.closedVolume,
      d.entryPrice,
      d.grossProfit,
      d.commission,
      d.swap,
      d.pnlConversionFee,
      event.occurredAt,
      external,
      event.payloadHash,
    ],
  );
  return proof.aggregate;
}
