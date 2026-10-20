import type pg from "pg";
import type { DemoExecutionEvent } from "./demo-execution.js";

/** Observes an already executed external full close; never authorizes a command. */
export async function observedFullManualClose(
  db: Pick<pg.PoolClient, "query"> | Pick<pg.Pool, "query">,
  event: DemoExecutionEvent,
  accountId: string,
  symbolId: string,
): Promise<boolean> {
  if (
    event.brokerOrderType !== 1 ||
    !event.closingOrder ||
    event.executionType !== 3 ||
    event.clientOrderId !== null ||
    event.position?.state !== "CLOSED" ||
    event.order?.state !== "FILLED" ||
    event.fill === null ||
    event.closeDetail?.closedVolume == null ||
    event.brokerPositionId === null ||
    event.brokerOrderId === null ||
    event.fill.brokerPositionId !== event.brokerPositionId ||
    event.fill.brokerOrderId !== event.brokerOrderId
  )
    return false;
  const result = await db.query(
    `SELECT p.id FROM positions p JOIN order_groups g ON g.id=p.order_group_id
     WHERE p.account_id=$1 AND p.symbol_id=$2 AND p.broker_position_id=$3
       AND p.strategy_owned AND g.mode='demo' AND p.side=$4
       AND p.entry_price=$5 AND p.opened_at=$6 AND p.opened_at<=$7
       AND $8::numeric>0 AND $8::numeric=$9::numeric
       AND $8::numeric=(SELECT sum(f.volume) FROM fills f WHERE f.position_id=p.id AND f.order_id IS NOT NULL)
       AND NOT EXISTS(SELECT 1 FROM position_protection pp WHERE pp.position_id=p.id AND pp.close_requested_at IS NOT NULL)
       AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.account_id=$1 AND o.broker_order_id=$10)`,
    [
      accountId,
      symbolId,
      event.brokerPositionId,
      event.position.side,
      event.closeDetail.entryPrice,
      event.position.openedAt,
      event.occurredAt,
      event.closeDetail.closedVolume,
      event.fill.volume,
      event.brokerOrderId,
    ],
  );
  return result.rows.length === 1;
}
