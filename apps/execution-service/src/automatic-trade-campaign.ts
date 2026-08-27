import type pg from "pg";

export interface AutomaticTradeCampaignProgress {
  readonly enabled: boolean;
  readonly limit: number | null;
  readonly baseline: number;
  readonly releaseClosedTrades: number;
  readonly closedTrades: number;
  readonly remaining: number | null;
  readonly complete: boolean;
  readonly allowed: boolean;
  readonly reasonCodes: readonly string[];
}

export function evaluateAutomaticTradeCampaign(
  releaseClosedTrades: number,
  configuredLimit: number,
  closedTradeBaseline = 0,
): AutomaticTradeCampaignProgress {
  if (
    !Number.isSafeInteger(releaseClosedTrades) ||
    releaseClosedTrades < 0 ||
    !Number.isSafeInteger(configuredLimit) ||
    configuredLimit < 0 ||
    !Number.isSafeInteger(closedTradeBaseline) ||
    closedTradeBaseline < 0 ||
    closedTradeBaseline > configuredLimit ||
    !Number.isSafeInteger(releaseClosedTrades + closedTradeBaseline)
  ) {
    return {
      enabled: configuredLimit > 0,
      limit: configuredLimit > 0 ? configuredLimit : null,
      baseline: 0,
      releaseClosedTrades: 0,
      closedTrades: 0,
      remaining: null,
      complete: false,
      allowed: false,
      reasonCodes: ["AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID"],
    };
  }
  if (configuredLimit === 0) {
    return {
      enabled: false,
      limit: null,
      baseline: 0,
      releaseClosedTrades,
      closedTrades: releaseClosedTrades,
      remaining: null,
      complete: false,
      allowed: true,
      reasonCodes: [],
    };
  }
  const closedTrades = closedTradeBaseline + releaseClosedTrades;
  const remaining = Math.max(0, configuredLimit - closedTrades);
  const complete = remaining === 0;
  return {
    enabled: true,
    limit: configuredLimit,
    baseline: closedTradeBaseline,
    releaseClosedTrades,
    closedTrades,
    remaining,
    complete,
    allowed: !complete,
    reasonCodes: complete ? ["AUTOMATIC_TRADE_CAMPAIGN_COMPLETE"] : [],
  };
}

export class PostgresAutomaticTradeCampaign {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;
  readonly #strategyVersionId: string;
  readonly #configuredLimit: number;
  readonly #closedTradeBaseline: number;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly strategyVersionId: string;
    readonly configuredLimit: number;
    readonly closedTradeBaseline?: number;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#strategyVersionId = input.strategyVersionId;
    this.#configuredLimit = input.configuredLimit;
    this.#closedTradeBaseline = input.closedTradeBaseline ?? 0;
  }

  async progress(): Promise<AutomaticTradeCampaignProgress> {
    try {
      const result = await this.#pool.query<{ closed_trades: string }>(
        `SELECT count(DISTINCT t.id)::text AS closed_trades
         FROM analysis_runs ar
         JOIN order_groups og ON og.analysis_id = ar.id
         JOIN trades t ON t.order_group_id = og.id
         WHERE ar.account_id = $1 AND ar.symbol_id = $2
           AND ar.strategy_version_id = $3
           AND ar.mode = 'demo' AND og.mode = 'demo' AND t.mode = 'demo'
           AND og.state = 'CLOSED' AND t.closed_at IS NOT NULL`,
        [this.#accountId, this.#symbolId, this.#strategyVersionId],
      );
      const countText = result.rows[0]?.closed_trades;
      if (countText === undefined || !/^(?:0|[1-9][0-9]*)$/.test(countText)) {
        throw new Error("AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID");
      }
      const progress = evaluateAutomaticTradeCampaign(
        Number(countText),
        this.#configuredLimit,
        this.#closedTradeBaseline,
      );
      if (!progress.allowed && !progress.complete) {
        throw new Error(
          progress.reasonCodes[0] ??
            "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID",
        );
      }
      return progress;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID"
      ) {
        throw error;
      }
      throw new Error("AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_UNAVAILABLE", {
        cause: error,
      });
    }
  }
}

export async function enforceAutomaticTradeCampaign(
  progress: AutomaticTradeCampaignProgress,
  persistPause: () => Promise<void>,
): Promise<boolean> {
  if (progress.allowed) return true;
  if (!progress.complete) {
    throw new Error(
      progress.reasonCodes[0] ?? "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID",
    );
  }
  await persistPause();
  return false;
}
