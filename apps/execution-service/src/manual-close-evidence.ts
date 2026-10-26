import type pg from "pg";
import type { DemoExecutionEvent } from "./demo-execution.js";
import { provePositionClose } from "./position-close-ledger.js";

/** Observes an executed external full/partial close; no broker command authority. */
export async function observedManualClose(
  db: Pick<pg.PoolClient, "query"> | Pick<pg.Pool, "query">,
  event: DemoExecutionEvent,
  accountId: string,
  symbolId: string,
): Promise<boolean> {
  if (event.brokerOrderType !== 1 || event.clientOrderId?.startsWith("cas-"))
    return false;
  const claimed = await db.query(
    `SELECT 1 FROM position_protection pp JOIN positions p ON p.id=pp.position_id
 WHERE p.account_id=$1 AND p.symbol_id=$2 AND p.broker_position_id=$3 AND pp.close_requested_at IS NOT NULL`,
    [accountId, symbolId, event.brokerPositionId],
  );
  if (claimed.rows.length) return false;
  return (await provePositionClose(db, event, accountId, symbolId)) !== null;
}
