import type pg from "pg";

import type {
  ExecutionGateway,
  GatewayOrder,
} from "../../../packages/contracts/src/index.js";

export class OrderMaintenance {
  readonly #pool: pg.Pool;
  readonly #gateway: ExecutionGateway;
  readonly #symbol: string;

  constructor(
    pool: pg.Pool,
    gateway: ExecutionGateway,
    symbol: string,
    private readonly scope: { accountId: string; symbolId: string },
  ) {
    this.#pool = pool;
    this.#gateway = gateway;
    this.#symbol = symbol;
  }

  async expireAndReconcile(): Promise<void> {
    await this.#pool.query(
      `UPDATE analysis_runs a
       SET state = 'EXPIRED', updated_at = now()
       WHERE a.state = 'ACCEPTED' AND a.account_id=$1 AND a.symbol_id=$2
         AND NOT EXISTS (
           SELECT 1 FROM order_groups og
           WHERE og.analysis_id = a.id
             AND og.state NOT IN ('CLOSED', 'EXPIRED', 'FAILED')
         )
         AND (
           a.valid_until <= now()
           OR EXISTS (
             SELECT 1 FROM order_groups og
             WHERE og.analysis_id = a.id
               AND og.state IN ('CLOSED', 'EXPIRED', 'FAILED')
           )
         )`,
      [this.scope.accountId, this.scope.symbolId],
    );
    const filledPeer = await this.#pool.query<{
      client_order_id: string;
      order_group_id: string;
      analysis_id: string;
    }>(
      `SELECT o.client_order_id, o.order_group_id, og.analysis_id
       FROM orders o
       JOIN order_groups og ON og.id = o.order_group_id
       JOIN analysis_runs ar ON ar.id=og.analysis_id
       WHERE ar.account_id=$1 AND ar.symbol_id=$2 AND o.strategy_owned = true
         AND o.state IN ('PENDING', 'PARTIALLY_FILLED', 'CANCEL_PENDING')
         AND EXISTS (
           SELECT 1 FROM orders filled
           WHERE filled.order_group_id = o.order_group_id
             AND filled.id <> o.id
             AND filled.strategy_owned = true
             AND (filled.state IN ('FILLED', 'PARTIALLY_FILLED') OR filled.filled_volume > 0)
         )`,
      [this.scope.accountId, this.scope.symbolId],
    );
    if (filledPeer.rows.length > 0) {
      await this.#cancelRows(filledPeer.rows, "OCO_PEER_FILLED");
    }

    // GTC preserves an intact pair. A broker-confirmed zero-fill terminal leg
    // invalidates that pair; cancel its survivor without treating this as a trade.
    const incompletePair = await this.#pool.query<{
      client_order_id: string;
      order_group_id: string;
      analysis_id: string;
    }>(
      `SELECT o.client_order_id, o.order_group_id, og.analysis_id
       FROM orders o
       JOIN order_groups og ON og.id=o.order_group_id
       JOIN analysis_runs ar ON ar.id=og.analysis_id
       WHERE ar.account_id=$1 AND ar.symbol_id=$2 AND o.account_id=$1
         AND o.strategy_owned = true AND o.filled_volume=0
         AND o.state IN ('PENDING','CANCEL_PENDING')
         AND og.state NOT IN ('CLOSED','EXPIRED','FAILED')
         AND (SELECT count(*) FROM orders pair WHERE pair.order_group_id=og.id)=2
         AND EXISTS (
           SELECT 1 FROM orders peer
           WHERE peer.order_group_id=og.id AND peer.id<>o.id
             AND peer.account_id=$1 AND peer.strategy_owned=true
             AND peer.state IN ('CANCELLED','EXPIRED','REJECTED')
             AND peer.filled_volume=0
             AND EXISTS (
               SELECT 1 FROM broker_execution_events e
               WHERE e.order_id=peer.id AND e.account_id=$1 AND e.symbol_id=$2
                 AND e.mapping_state='MAPPED' AND e.execution_type IN (5,6,7)
                 AND e.normalized_payload->'order'->>'state'=peer.state
             )
         )
         AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.order_group_id=og.id)
         AND NOT EXISTS (SELECT 1 FROM fills f JOIN orders fo ON fo.id=f.order_id WHERE fo.order_group_id=og.id)
         AND NOT EXISTS (
           SELECT 1 FROM broker_execution_events e
           WHERE e.account_id=$1 AND e.symbol_id=$2
             AND e.resolved_at IS NULL AND (e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0)
         )`,
      [this.scope.accountId, this.scope.symbolId],
    );
    if (incompletePair.rows.length > 0)
      await this.#cancelRows(incompletePair.rows, "OCO_PEER_UNFILLED_TERMINAL");

    const result = await this.#pool.query<{
      client_order_id: string;
      order_group_id: string;
      analysis_id: string;
    }>(
      `SELECT o.client_order_id, o.order_group_id, og.analysis_id
       FROM orders o
       JOIN order_groups og ON og.id = o.order_group_id
       JOIN analysis_runs ar ON ar.id=og.analysis_id
       WHERE ar.account_id=$1 AND ar.symbol_id=$2 AND o.strategy_owned = true
         AND o.state IN ('INTENT', 'SUBMITTING', 'PENDING', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'UNKNOWN')
         AND og.time_in_force = 'GTD' AND og.expires_at <= now()`,
      [this.scope.accountId, this.scope.symbolId],
    );
    if (result.rows.length === 0) return;
    await this.#cancelRows(result.rows, "ANALYSIS_EXPIRED");
  }

  async cancelAll(reasonCode: string, datedOnly = false): Promise<void> {
    const result = await this.#pool.query<{
      client_order_id: string;
      order_group_id: string;
      analysis_id: string;
    }>(
      `SELECT o.client_order_id, o.order_group_id, og.analysis_id
       FROM orders o
       JOIN order_groups og ON og.id = o.order_group_id
       JOIN analysis_runs ar ON ar.id=og.analysis_id
       WHERE ar.account_id=$1 AND ar.symbol_id=$2 AND o.strategy_owned = true
         AND o.state IN ('INTENT', 'SUBMITTING', 'PENDING', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'UNKNOWN')
         ${datedOnly ? "AND og.time_in_force = 'GTD'" : ""}`,
      [this.scope.accountId, this.scope.symbolId],
    );
    if (result.rows.length > 0) await this.#cancelRows(result.rows, reasonCode);
  }

  async #cancelRows(
    rows: readonly {
      client_order_id: string;
      order_group_id: string;
      analysis_id: string;
    }[],
    reasonCode: string,
  ): Promise<void> {
    const groups = new Map<
      string,
      { analysisId: string; updates: GatewayOrder[]; failed: boolean }
    >();
    for (const row of rows) {
      const group = groups.get(row.order_group_id) ?? {
        analysisId: row.analysis_id,
        updates: [],
        failed: false,
      };
      groups.set(row.order_group_id, group);
      await this.#pool.query(
        `UPDATE orders SET state = 'CANCEL_PENDING', version = version + 1, updated_at = now()
         WHERE client_order_id=$1 AND account_id=$2 AND order_group_id=$3 AND strategy_owned=true`,
        [row.client_order_id, this.scope.accountId, row.order_group_id],
      );
      try {
        group.updates.push(
          await this.#gateway.cancelStrategyOrder(
            row.client_order_id,
            reasonCode,
          ),
        );
      } catch {
        group.failed = true;
      }
    }
    const reconciliation = await this.#gateway.reconcile(this.#symbol);
    const active = reconciliation.orders.some((order) =>
      ["PENDING", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.state),
    );
    for (const [groupId, group] of groups) {
      for (const update of group.updates) {
        await this.#pool.query(
          `UPDATE orders
           SET state = $2, broker_order_id = COALESCE($3, broker_order_id), filled_volume = $4,
               updated_at = $5, version = version + 1
           WHERE client_order_id=$1 AND account_id=$6 AND order_group_id=$7 AND strategy_owned=true`,
          [
            update.clientOrderId,
            update.state,
            update.brokerOrderId,
            update.filledVolume,
            update.updatedAt,
            this.scope.accountId,
            groupId,
          ],
        );
      }
      let certain =
        // Fill cleanup is never proof of a closed trade. The execution journal
        // owns the subsequent position/trade/group terminal transition.
        reasonCode !== "OCO_PEER_FILLED" &&
        !group.failed &&
        reconciliation.certain &&
        !active &&
        reconciliation.relevantPositionCount === 0;
      if (reasonCode === "OCO_PEER_UNFILLED_TERMINAL") {
        // A fill can race cancellation. Broker flatness alone cannot erase a
        // newly recorded fill/position or incomplete cancellation evidence.
        const terminal = await this.#pool.query<{ certain: boolean }>(
          `SELECT
             (SELECT count(*) FROM orders WHERE order_group_id=$1)=2
             AND NOT EXISTS (SELECT 1 FROM orders WHERE order_group_id=$1
               AND (state NOT IN ('CANCELLED','EXPIRED','REJECTED') OR filled_volume<>0))
             AND NOT EXISTS (SELECT 1 FROM positions WHERE order_group_id=$1)
             AND NOT EXISTS (SELECT 1 FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.order_group_id=$1)
             AND NOT EXISTS (SELECT 1 FROM broker_execution_events e WHERE e.account_id=$2 AND e.symbol_id=$3
               AND e.resolved_at IS NULL AND (e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0)) AS certain`,
          [groupId, this.scope.accountId, this.scope.symbolId],
        );
        certain = certain && terminal.rows[0]?.certain === true;
      }
      await this.#pool.query(
        `UPDATE order_groups
         SET state = $2, cancellation_reason = $3, updated_at = now()
         WHERE id = $1`,
        [
          groupId,
          certain
            ? reasonCode === "OCO_PEER_UNFILLED_TERMINAL"
              ? "FAILED"
              : "EXPIRED"
            : "RECONCILIATION_REQUIRED",
          reasonCode,
        ],
      );
      if (certain) {
        await this.#pool.query(
          "UPDATE analysis_runs SET state = 'EXPIRED', updated_at = now() WHERE id = $1 AND state = 'ACCEPTED'",
          [group.analysisId],
        );
      }
    }
    if (!reconciliation.certain || active)
      throw new Error("ORDER_MAINTENANCE_RECONCILIATION_REQUIRED");
  }
}
