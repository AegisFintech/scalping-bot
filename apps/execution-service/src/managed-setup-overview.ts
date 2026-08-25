import type pg from "pg";

export interface ManagedOrderOverview {
  readonly side: "BUY" | "SELL";
  readonly state: string;
  readonly entryPrice: string;
  readonly stopLoss: string;
  readonly takeProfit: string;
  readonly volume: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
}

export interface ManagedPositionOverview {
  readonly side: "BUY" | "SELL";
  readonly state: string;
  readonly entryPrice: string | null;
  readonly stopLoss: string | null;
  readonly takeProfit: string | null;
  readonly volume: string;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  readonly updatedAt: string;
}

export interface ManagedTradeOverview {
  readonly direction: "LONG" | "SHORT";
  readonly realizedPnl: string;
  readonly fees: string;
  readonly openedAt: string;
  readonly closedAt: string;
}

export interface ManagedSetupOverview {
  readonly status: "ACTIVE" | "LATEST_TERMINAL" | "NONE" | "UNAVAILABLE";
  readonly groupState: string | null;
  readonly groupExpiresAt: string | null;
  readonly groupUpdatedAt: string | null;
  readonly orders: readonly ManagedOrderOverview[];
  readonly position: ManagedPositionOverview | null;
  readonly trade: ManagedTradeOverview | null;
}

interface GroupRow {
  readonly id: string;
  readonly state: string;
  readonly expires_at: Date;
  readonly updated_at: Date;
}

interface OrderRow {
  readonly side: "BUY" | "SELL";
  readonly state: string;
  readonly entry_price: string;
  readonly stop_loss: string;
  readonly take_profit: string;
  readonly normalized_volume: string;
  readonly expires_at: Date;
  readonly updated_at: Date;
}

interface PositionRow {
  readonly side: "BUY" | "SELL";
  readonly state: string;
  readonly entry_price: string | null;
  readonly stop_loss: string | null;
  readonly take_profit: string | null;
  readonly volume: string;
  readonly opened_at: Date | null;
  readonly closed_at: Date | null;
  readonly updated_at: Date;
}

interface TradeRow {
  readonly direction: "LONG" | "SHORT";
  readonly realized_pnl: string;
  readonly fees: string;
  readonly opened_at: Date;
  readonly closed_at: Date;
}

const TERMINAL_GROUP_STATES = new Set(["CLOSED", "EXPIRED", "FAILED"]);

function timestamp(value: Date | null, reason: string): string | null {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error(reason);
  return value.toISOString();
}

export class PostgresManagedSetupOverview {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;
  readonly #mode: string;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly mode: string;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#mode = input.mode;
  }

  async read(): Promise<ManagedSetupOverview> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const groups = await client.query<GroupRow>(
        `SELECT og.id, og.state, og.expires_at, og.updated_at
         FROM order_groups og
         JOIN analysis_runs ar ON ar.id = og.analysis_id
         WHERE ar.account_id = $1 AND ar.symbol_id = $2
           AND og.mode = $3
         ORDER BY CASE WHEN og.state IN ('CLOSED','EXPIRED','FAILED')
                       THEN 1 ELSE 0 END,
                  og.updated_at DESC, og.id DESC
         LIMIT 2`,
        [this.#accountId, this.#symbolId, this.#mode],
      );
      const activeGroups = groups.rows.filter(
        (candidate) => !TERMINAL_GROUP_STATES.has(candidate.state),
      );
      if (activeGroups.length > 1)
        throw new Error("MANAGED_SETUP_ACTIVE_GROUP_AMBIGUOUS");
      const group = activeGroups[0] ?? groups.rows[0];
      if (group === undefined) {
        await client.query("COMMIT");
        return {
          status: "NONE",
          groupState: null,
          groupExpiresAt: null,
          groupUpdatedAt: null,
          orders: [],
          position: null,
          trade: null,
        };
      }
      const orders = await client.query<OrderRow>(
        `SELECT side, state, entry_price::text, stop_loss::text,
                take_profit::text, normalized_volume::text,
                expires_at, updated_at
         FROM orders
         WHERE account_id = $1 AND order_group_id = $2
           AND strategy_owned = true
         ORDER BY side`,
        [this.#accountId, group.id],
      );
      const positions = await client.query<PositionRow>(
        `SELECT side, state, entry_price::text, stop_loss::text,
                take_profit::text, volume::text, opened_at, closed_at,
                updated_at
         FROM positions
         WHERE account_id = $1 AND symbol_id = $2 AND order_group_id = $3
           AND strategy_owned = true
         ORDER BY updated_at DESC`,
        [this.#accountId, this.#symbolId, group.id],
      );
      if (positions.rows.length > 1)
        throw new Error("MANAGED_SETUP_POSITION_AMBIGUOUS");
      const trades = await client.query<TradeRow>(
        `SELECT direction, realized_pnl::text, fees::text, opened_at, closed_at
         FROM trades
         WHERE order_group_id = $1
         ORDER BY closed_at DESC
         LIMIT 2`,
        [group.id],
      );
      if (trades.rows.length > 1)
        throw new Error("MANAGED_SETUP_TRADE_AMBIGUOUS");
      const position = positions.rows[0];
      const trade = trades.rows[0];
      if (
        (group.state === "CLOSED" &&
          (position === undefined ||
            position.state !== "CLOSED" ||
            trade === undefined)) ||
        (group.state !== "CLOSED" && trade !== undefined) ||
        (trade !== undefined &&
          position !== undefined &&
          ((trade.direction === "LONG" && position.side !== "BUY") ||
            (trade.direction === "SHORT" && position.side !== "SELL")))
      ) {
        throw new Error("MANAGED_SETUP_TRADE_STATE_INVALID");
      }
      const overview: ManagedSetupOverview = {
        status: TERMINAL_GROUP_STATES.has(group.state)
          ? "LATEST_TERMINAL"
          : "ACTIVE",
        groupState: group.state,
        groupExpiresAt: timestamp(
          group.expires_at,
          "MANAGED_SETUP_GROUP_EXPIRY_INVALID",
        ),
        groupUpdatedAt: timestamp(
          group.updated_at,
          "MANAGED_SETUP_GROUP_UPDATE_INVALID",
        ),
        orders: orders.rows.map((order) => ({
          side: order.side,
          state: order.state,
          entryPrice: order.entry_price,
          stopLoss: order.stop_loss,
          takeProfit: order.take_profit,
          volume: order.normalized_volume,
          expiresAt: timestamp(
            order.expires_at,
            "MANAGED_SETUP_ORDER_EXPIRY_INVALID",
          )!,
          updatedAt: timestamp(
            order.updated_at,
            "MANAGED_SETUP_ORDER_UPDATE_INVALID",
          )!,
        })),
        position:
          position === undefined
            ? null
            : {
                side: position.side,
                state: position.state,
                entryPrice: position.entry_price,
                stopLoss: position.stop_loss,
                takeProfit: position.take_profit,
                volume: position.volume,
                openedAt: timestamp(
                  position.opened_at,
                  "MANAGED_SETUP_POSITION_OPEN_INVALID",
                ),
                closedAt: timestamp(
                  position.closed_at,
                  "MANAGED_SETUP_POSITION_CLOSE_INVALID",
                ),
                updatedAt: timestamp(
                  position.updated_at,
                  "MANAGED_SETUP_POSITION_UPDATE_INVALID",
                )!,
              },
        trade:
          trade === undefined
            ? null
            : {
                direction: trade.direction,
                realizedPnl: trade.realized_pnl,
                fees: trade.fees,
                openedAt: timestamp(
                  trade.opened_at,
                  "MANAGED_SETUP_TRADE_OPEN_INVALID",
                )!,
                closedAt: timestamp(
                  trade.closed_at,
                  "MANAGED_SETUP_TRADE_CLOSE_INVALID",
                )!,
              },
      };
      await client.query("COMMIT");
      return overview;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export const UNAVAILABLE_MANAGED_SETUP: ManagedSetupOverview = {
  status: "UNAVAILABLE",
  groupState: null,
  groupExpiresAt: null,
  groupUpdatedAt: null,
  orders: [],
  position: null,
  trade: null,
};
