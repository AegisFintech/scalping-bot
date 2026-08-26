import type pg from "pg";

import type { OpenPositionMonitor } from "../../../packages/contracts/src/index.js";
import type { PositionUnrealizedPnl } from "../../../packages/ctrader-client/src/client.js";
import {
  canonical,
  decimal,
  signedDecimal,
} from "../../../packages/risk-engine/src/decimal.js";

export type { OpenPositionMonitor } from "../../../packages/contracts/src/index.js";

interface PositionRow {
  readonly side: "BUY" | "SELL";
  readonly state: string;
  readonly group_state: string;
  readonly broker_position_id: string | null;
  readonly account_currency: string;
  readonly recorded_commission: string;
}

interface QuoteSnapshot {
  readonly serverTime: string;
  readonly metadata: {
    readonly symbolId: string;
    readonly symbolName: string;
  };
  readonly quote: {
    readonly bid: string;
    readonly ask: string;
    readonly sourceTime: string;
    readonly receivedAt: string;
  };
}

function timestamp(value: string, reason: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(reason);
  return new Date(parsed).toISOString();
}

function money(value: string, reason: string): string {
  return canonical(signedDecimal(value, reason));
}

export class PostgresOpenPositionMonitor {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;
  readonly #mode: string;
  readonly #providerSymbolId: string;
  readonly #symbolName: string;
  readonly #quote: () => Promise<QuoteSnapshot>;
  readonly #pnl: (brokerPositionId: string) => Promise<PositionUnrealizedPnl>;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly mode: string;
    readonly providerSymbolId: string;
    readonly symbolName: string;
    readonly quote: () => Promise<QuoteSnapshot>;
    readonly pnl: (brokerPositionId: string) => Promise<PositionUnrealizedPnl>;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#mode = input.mode;
    this.#providerSymbolId = input.providerSymbolId;
    this.#symbolName = input.symbolName;
    this.#quote = input.quote;
    this.#pnl = input.pnl;
  }

  async read(): Promise<OpenPositionMonitor> {
    const result = await this.#pool.query<PositionRow>(
      `SELECT p.side, p.state, og.state AS group_state, p.broker_position_id,
              a.currency AS account_currency,
              COALESCE((
                SELECT SUM(f.commission)::text
                FROM fills f
                LEFT JOIN orders o ON o.id = f.order_id
                WHERE f.position_id = p.id
                   OR o.order_group_id = p.order_group_id
              ), '0') AS recorded_commission
       FROM positions p
       JOIN accounts a ON a.id = p.account_id
       JOIN order_groups og ON og.id = p.order_group_id
       WHERE p.account_id = $1 AND p.symbol_id = $2 AND og.mode = $3
         AND p.strategy_owned = true
         AND p.state IN ('OPEN','CLOSING','UNKNOWN','RECONCILIATION_PENDING')
       ORDER BY p.updated_at DESC, p.id DESC
       LIMIT 2`,
      [this.#accountId, this.#symbolId, this.#mode],
    );
    if (result.rows.length === 0) return { status: "NONE" };
    if (result.rows.length !== 1)
      throw new Error("OPEN_POSITION_MONITOR_AMBIGUOUS");

    const position = result.rows[0]!;
    if (position.state !== "OPEN")
      throw new Error("OPEN_POSITION_MONITOR_STATE_UNCERTAIN");
    if (
      position.group_state !== "CANCELLING_PEER" &&
      position.group_state !== "POSITION_OPEN" &&
      position.group_state !== "RECONCILIATION_REQUIRED"
    ) {
      throw new Error("OPEN_POSITION_MONITOR_GROUP_STATE_UNCERTAIN");
    }
    if (position.side !== "BUY" && position.side !== "SELL")
      throw new Error("OPEN_POSITION_MONITOR_SIDE_INVALID");
    if (
      position.broker_position_id === null ||
      !/^\d+$/.test(position.broker_position_id)
    ) {
      throw new Error("OPEN_POSITION_MONITOR_BROKER_POSITION_UNAVAILABLE");
    }
    if (!/^[A-Z]{3,12}$/.test(position.account_currency))
      throw new Error("OPEN_POSITION_MONITOR_CURRENCY_INVALID");
    const recordedCommission = money(
      position.recorded_commission,
      "OPEN_POSITION_MONITOR_COMMISSION_INVALID",
    );

    const [quote, pnl] = await Promise.all([
      this.#quote(),
      this.#pnl(position.broker_position_id),
    ]);
    if (
      quote.metadata.symbolId !== this.#providerSymbolId ||
      quote.metadata.symbolName !== this.#symbolName
    ) {
      throw new Error("OPEN_POSITION_MONITOR_SYMBOL_MISMATCH");
    }
    const bid = decimal(quote.quote.bid, "OPEN_POSITION_MONITOR_BID_INVALID");
    const ask = decimal(quote.quote.ask, "OPEN_POSITION_MONITOR_ASK_INVALID");
    if (ask.lt(bid)) throw new Error("OPEN_POSITION_MONITOR_QUOTE_CROSSED");
    const serverTime = timestamp(
      quote.serverTime,
      "OPEN_POSITION_MONITOR_SERVER_TIME_INVALID",
    );
    const sourceTime = timestamp(
      quote.quote.sourceTime,
      "OPEN_POSITION_MONITOR_QUOTE_TIME_INVALID",
    );
    const receivedAt = timestamp(
      quote.quote.receivedAt,
      "OPEN_POSITION_MONITOR_QUOTE_RECEIVED_INVALID",
    );
    if (
      Date.parse(sourceTime) > Date.parse(serverTime) ||
      Date.parse(receivedAt) > Date.now() + 1_000
    ) {
      throw new Error("OPEN_POSITION_MONITOR_QUOTE_TIME_UNCERTAIN");
    }
    const capturedAt = timestamp(
      pnl.capturedAt,
      "OPEN_POSITION_MONITOR_PNL_TIME_INVALID",
    );
    if (Date.parse(capturedAt) > Date.now() + 1_000)
      throw new Error("OPEN_POSITION_MONITOR_PNL_TIME_UNCERTAIN");

    return {
      status: "AVAILABLE",
      executionState:
        position.group_state === "RECONCILIATION_REQUIRED"
          ? "RECONCILIATION_REQUIRED"
          : "NORMAL",
      side: position.side,
      accountCurrency: position.account_currency,
      bid: canonical(bid),
      ask: canonical(ask),
      markPrice: canonical(position.side === "BUY" ? bid : ask),
      grossUnrealizedPnl: money(
        pnl.grossUnrealizedPnl,
        "OPEN_POSITION_MONITOR_GROSS_PNL_INVALID",
      ),
      netUnrealizedPnl: money(
        pnl.netUnrealizedPnl,
        "OPEN_POSITION_MONITOR_NET_PNL_INVALID",
      ),
      recordedCommission,
      quoteSourceTime: sourceTime,
      quoteReceivedAt: receivedAt,
      pnlCapturedAt: capturedAt,
    };
  }
}

export function unavailableOpenPositionMonitor(
  error: unknown,
): OpenPositionMonitor {
  const reasonCode =
    error instanceof Error && /^[A-Z0-9_:]{1,160}$/.test(error.message)
      ? error.message
      : "OPEN_POSITION_MONITOR_UNAVAILABLE";
  return { status: "UNAVAILABLE", reasonCode };
}
