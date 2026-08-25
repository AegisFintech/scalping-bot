import type pg from "pg";

export interface AutomaticAnalysisCampaignProgress {
  readonly enabled: boolean;
  readonly limit: number | null;
  readonly completed: number;
  readonly remaining: number | null;
  readonly complete: boolean;
  readonly allowed: boolean;
  readonly reasonCodes: readonly string[];
}

export function evaluateAutomaticAnalysisCampaign(
  completed: number,
  configuredLimit: number,
): AutomaticAnalysisCampaignProgress {
  if (
    !Number.isSafeInteger(completed) ||
    completed < 0 ||
    !Number.isSafeInteger(configuredLimit) ||
    configuredLimit < 0
  ) {
    return {
      enabled: configuredLimit > 0,
      limit: configuredLimit > 0 ? configuredLimit : null,
      completed: 0,
      remaining: null,
      complete: false,
      allowed: false,
      reasonCodes: ["AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID"],
    };
  }
  if (configuredLimit === 0) {
    return {
      enabled: false,
      limit: null,
      completed,
      remaining: null,
      complete: false,
      allowed: true,
      reasonCodes: [],
    };
  }
  const remaining = Math.max(0, configuredLimit - completed);
  const complete = remaining === 0;
  return {
    enabled: true,
    limit: configuredLimit,
    completed,
    remaining,
    complete,
    allowed: !complete,
    reasonCodes: complete ? ["AUTOMATIC_ANALYSIS_CAMPAIGN_COMPLETE"] : [],
  };
}

export class PostgresAutomaticAnalysisCampaign {
  readonly #pool: pg.Pool;
  readonly #accountId: string;
  readonly #symbolId: string;
  readonly #strategyVersionId: string;
  readonly #configuredLimit: number;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly strategyVersionId: string;
    readonly configuredLimit: number;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#strategyVersionId = input.strategyVersionId;
    this.#configuredLimit = input.configuredLimit;
  }

  async progress(): Promise<AutomaticAnalysisCampaignProgress> {
    try {
      const result = await this.#pool.query<{ completed: string }>(
        `SELECT count(DISTINCT ar.id)::text AS completed
         FROM analysis_runs ar
         JOIN model_requests mr ON mr.analysis_id = ar.id
         JOIN model_responses mres ON mres.model_request_id = mr.id
         WHERE ar.account_id = $1 AND ar.symbol_id = $2
           AND ar.strategy_version_id = $3
           AND mr.status = 'COMPLETED' AND mres.status = 'COMPLETED'`,
        [this.#accountId, this.#symbolId, this.#strategyVersionId],
      );
      const completedText = result.rows[0]?.completed;
      if (
        completedText === undefined ||
        !/^(?:0|[1-9][0-9]*)$/.test(completedText)
      ) {
        throw new Error("AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID");
      }
      const completed = Number(completedText);
      const progress = evaluateAutomaticAnalysisCampaign(
        completed,
        this.#configuredLimit,
      );
      if (!progress.allowed && !progress.complete) {
        throw new Error(
          progress.reasonCodes[0] ??
            "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID",
        );
      }
      return progress;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID"
      ) {
        throw error;
      }
      throw new Error("AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE", {
        cause: error,
      });
    }
  }
}

export async function enforceAutomaticAnalysisCampaign(
  progress: AutomaticAnalysisCampaignProgress,
  persistPause: () => Promise<void>,
): Promise<boolean> {
  if (progress.allowed) return true;
  if (!progress.complete) {
    throw new Error(
      progress.reasonCodes[0] ?? "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID",
    );
  }
  await persistPause();
  return false;
}
