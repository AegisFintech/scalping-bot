import type pg from "pg";

/** A market close is authorized only by a durable, scoped position-close claim. */
export async function protectiveCloseAuthorized(
  database: Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">,
  input: {
    accountId: string;
    symbolId: string;
    brokerPositionId: string;
    brokerOrderId: string;
    occurredAt: string;
    closedVolume: string | null;
  },
): Promise<boolean> {
  const result = await database.query(
    `SELECT pp.position_id FROM position_protection pp
     JOIN positions p ON p.id=pp.position_id JOIN order_groups og ON og.id=p.order_group_id
     WHERE p.account_id=$1 AND p.symbol_id=$2 AND p.broker_position_id=$3
       AND p.strategy_owned=true AND og.mode='demo'
       AND pp.close_requested_at <= $5::timestamptz
       AND $5::timestamptz <= pp.close_requested_at + interval '120 seconds'
       AND (pp.broker_close_order_id IS NULL OR pp.broker_close_order_id=$4)
       AND ($6::numeric IS NULL OR pp.close_volume=$6::numeric)`,
    [
      input.accountId,
      input.symbolId,
      input.brokerPositionId,
      input.brokerOrderId,
      input.occurredAt,
      input.closedVolume,
    ],
  );
  return result.rows.length === 1;
}
