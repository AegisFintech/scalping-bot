import type pg from "pg";

export interface AutomaticAnalysisCampaignProgress {
  readonly enabled: boolean;
  readonly limit: number | null;
  readonly baseline: number;
  readonly releaseCompleted: number;
  readonly completed: number;
  readonly lifetimeCompleted: number;
  readonly remaining: number | null;
  readonly complete: boolean;
  readonly allowed: boolean;
  readonly reasonCodes: readonly string[];
}

export function evaluateAutomaticAnalysisCampaign(
  releaseCompleted: number,
  configuredLimit: number,
  completedBaseline = 0,
  lifetimeCompleted = releaseCompleted + completedBaseline,
): AutomaticAnalysisCampaignProgress {
  if (
    !Number.isSafeInteger(releaseCompleted) ||
    releaseCompleted < 0 ||
    !Number.isSafeInteger(configuredLimit) ||
    configuredLimit < 0 ||
    !Number.isSafeInteger(completedBaseline) ||
    completedBaseline < 0 ||
    completedBaseline > configuredLimit ||
    !Number.isSafeInteger(lifetimeCompleted) ||
    lifetimeCompleted < releaseCompleted + completedBaseline ||
    !Number.isSafeInteger(releaseCompleted + completedBaseline)
  ) {
    return {
      enabled: configuredLimit > 0,
      limit: configuredLimit > 0 ? configuredLimit : null,
      baseline: 0,
      releaseCompleted: 0,
      completed: 0,
      lifetimeCompleted: 0,
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
      baseline: 0,
      releaseCompleted,
      completed: releaseCompleted,
      lifetimeCompleted,
      remaining: null,
      complete: false,
      allowed: true,
      reasonCodes: [],
    };
  }
  const completed = completedBaseline + releaseCompleted;
  const remaining = Math.max(0, configuredLimit - completed);
  const complete = remaining === 0;
  return {
    enabled: true,
    limit: configuredLimit,
    baseline: completedBaseline,
    releaseCompleted,
    completed,
    lifetimeCompleted,
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
  readonly #mode: string;
  readonly #configuredLimit: number;
  readonly #completedBaseline: number;

  constructor(input: {
    readonly pool: pg.Pool;
    readonly accountId: string;
    readonly symbolId: string;
    readonly strategyVersionId: string;
    readonly mode: string;
    readonly configuredLimit: number;
    readonly completedBaseline?: number;
  }) {
    this.#pool = input.pool;
    this.#accountId = input.accountId;
    this.#symbolId = input.symbolId;
    this.#strategyVersionId = input.strategyVersionId;
    this.#mode = input.mode;
    this.#configuredLimit = input.configuredLimit;
    this.#completedBaseline = input.completedBaseline ?? 0;
  }

  async progress(): Promise<AutomaticAnalysisCampaignProgress> {
    try {
      const result = await this.#pool.query<{
        completed: string;
        lifetime_completed: string;
      }>(
        `SELECT count(DISTINCT ar.id) FILTER (
                  WHERE ar.strategy_version_id = $3
                )::text AS completed,
                count(DISTINCT ar.id)::text AS lifetime_completed
         FROM analysis_runs ar
         JOIN model_requests mr ON mr.analysis_id = ar.id
         JOIN model_responses mres ON mres.model_request_id = mr.id
         WHERE ar.account_id = $1 AND ar.symbol_id = $2
           AND ar.mode = $4
           AND mr.status = 'COMPLETED' AND mres.status = 'COMPLETED'`,
        [this.#accountId, this.#symbolId, this.#strategyVersionId, this.#mode],
      );
      const completedText = result.rows[0]?.completed;
      const lifetimeText = result.rows[0]?.lifetime_completed;
      if (
        completedText === undefined ||
        !/^(?:0|[1-9][0-9]*)$/.test(completedText) ||
        lifetimeText === undefined ||
        !/^(?:0|[1-9][0-9]*)$/.test(lifetimeText)
      ) {
        throw new Error("AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID");
      }
      const completed = Number(completedText);
      const progress = evaluateAutomaticAnalysisCampaign(
        completed,
        this.#configuredLimit,
        this.#completedBaseline,
        Number(lifetimeText),
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
