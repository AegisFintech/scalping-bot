import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import type { AiAnalysisResult } from "../../../packages/ai-client/src/client.js";
import {
  ProviderFailure,
  providerTelemetrySchema,
} from "../../../packages/ai-client/src/telemetry.js";
import type { ModelProvider } from "./coordinator.js";
import { scenarioOco } from "../../../packages/scenario-engine/src/oco.js";
import {
  time,
  validatePlan,
  type ScenarioPlan,
} from "../../../packages/scenario-engine/src/plan.js";
import type { ScenarioPlanner } from "../../../packages/scenario-engine/src/planner.js";

export interface StoredContext {
  id: string;
  state: "REQUESTING" | "READY" | "FAILED";
  requestedAt: string;
  capturedAt: string;
  validUntil: string;
  availableAt: string | null;
  tickSize: string;
  plan: ScenarioPlan | null;
  consumed: boolean;
}
export interface ContextStore {
  latest(): Promise<StoredContext | null>;
  claim(input: {
    id: string;
    sourceAnalysisId: string;
    capturedAt: string;
    tickSize: string;
  }): Promise<boolean>;
  finish(
    id: string,
    result: AiAnalysisResult<ScenarioPlan> | null,
    reason: string | null,
    telemetry?: unknown,
  ): Promise<void>;
}
export class PostgresContextStore implements ContextStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly scope: {
      accountId: string;
      symbolId: string;
      mode: string;
    },
  ) {}
  async summary() {
    const result = await this.pool.query(
      `SELECT c.state,c.requested_at,c.valid_until,c.duration_ms,c.reason,c.requested_model,
      c.telemetry->>'returnedModel' AS returned_model,
      EXISTS(SELECT 1 FROM order_groups g WHERE g.context_plan_id=c.id) AS consumed,
      (SELECT count(*)::int FROM scenario_contexts x WHERE x.account_id=c.account_id AND x.symbol_id=c.symbol_id AND x.mode=c.mode AND x.requested_at>=clock_timestamp()-interval '24 hours') AS calls_24h
      FROM scenario_contexts c WHERE c.account_id=$1 AND c.symbol_id=$2 AND c.mode=$3 ORDER BY c.requested_at DESC LIMIT 1`,
      [this.scope.accountId, this.scope.symbolId, this.scope.mode],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }
  async latest(): Promise<StoredContext | null> {
    const result = await this.pool.query(
      `SELECT c.id,c.state,c.requested_at,c.captured_at,c.valid_until,c.available_at,c.tick_size,c.plan,
      EXISTS(SELECT 1 FROM order_groups g WHERE g.context_plan_id=c.id) AS consumed
      FROM scenario_contexts c WHERE account_id=$1 AND symbol_id=$2 AND mode=$3 ORDER BY requested_at DESC LIMIT 1`,
      [this.scope.accountId, this.scope.symbolId, this.scope.mode],
    );
    const r = result.rows[0] as
      | {
          id: string;
          state: StoredContext["state"];
          requested_at: Date;
          captured_at: Date;
          valid_until: Date;
          available_at: Date | null;
          tick_size: string;
          plan: ScenarioPlan | null;
          consumed: boolean;
        }
      | undefined;
    return r === undefined
      ? null
      : {
          id: r.id,
          state: r.state,
          requestedAt: r.requested_at.toISOString(),
          capturedAt: r.captured_at.toISOString(),
          validUntil: r.valid_until.toISOString(),
          availableAt: r.available_at?.toISOString() ?? null,
          tickSize: r.tick_size,
          plan: r.plan,
          consumed: r.consumed,
        };
  }
  async claim(input: {
    id: string;
    sourceAnalysisId: string;
    capturedAt: string;
    tickSize: string;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Cross-process single-flight and restart-persistent five-minute cost budget.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          JSON.stringify([
            this.scope.accountId,
            this.scope.symbolId,
            this.scope.mode,
          ]),
        ],
      );
      const result = await client.query(
        `INSERT INTO scenario_contexts
        (id,account_id,symbol_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,source_analysis_id)
        SELECT $1,$2,$3,$4,clock_timestamp(),$5::timestamptz,$5::timestamptz+interval '5 minutes','REQUESTING','gpt-6-astra/u64',$6,$7
        WHERE NOT EXISTS(SELECT 1 FROM scenario_contexts WHERE account_id=$2 AND symbol_id=$3 AND mode=$4 AND requested_at > clock_timestamp()-interval '5 minutes') RETURNING id`,
        [
          input.id,
          this.scope.accountId,
          this.scope.symbolId,
          this.scope.mode,
          input.capturedAt,
          input.tickSize,
          input.sourceAnalysisId,
        ],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async finish(
    id: string,
    result: AiAnalysisResult<ScenarioPlan> | null,
    reason: string | null,
    telemetry?: unknown,
  ): Promise<void> {
    const usage = result?.telemetry ?? telemetry;
    const parsed =
      usage === undefined ? null : providerTelemetrySchema.parse(usage);
    if (parsed !== null && parsed.requestedModel !== "gpt-6-astra/u64")
      throw new Error("SCENARIO_PROVIDER_IDENTITY_MISMATCH");
    const updated = await this.pool.query(
      `UPDATE scenario_contexts SET state=$2,completed_at=clock_timestamp(),duration_ms=GREATEST(0,floor(extract(epoch FROM (clock_timestamp()-requested_at))*1000))::integer,available_at=CASE WHEN $2='READY' THEN clock_timestamp() ELSE NULL END,
      plan=$3::jsonb,telemetry=$4::jsonb,reason=$5 WHERE id=$1 AND state='REQUESTING' AND account_id=$6 AND symbol_id=$7 AND mode=$8`,
      [
        id,
        result === null ? "FAILED" : "READY",
        result === null ? null : JSON.stringify(result.response),
        parsed === null ? null : JSON.stringify(parsed),
        reason,
        this.scope.accountId,
        this.scope.symbolId,
        this.scope.mode,
      ],
    );
    if (updated.rowCount !== 1) throw new Error("SCENARIO_COMPLETION_MISSING");
  }
}

/** Paid inference runs in a detached bounded task, never in the order-handling promise. */
export class ReusableScenarioModel implements ModelProvider {
  readonly circuitOpen = false; // A provider outage does not invalidate an already validated map.
  readonly circuitOpenUntil = null;
  private nextEvaluationAt = 0;
  private task: Promise<void> | null = null;
  private prepared: {
    id: string;
    analysisId: string;
    response: ReturnType<typeof scenarioOco>;
  } | null = null;
  private readonly artifact;
  constructor(
    private readonly store: ContextStore,
    private readonly planner: Pick<ScenarioPlanner, "generate">,
    private readonly now = Date.now,
    private readonly report: (reason: string) => void = () => {},
  ) {
    const content = readFileSync(
      "prompts/scenario-execution-v1.md",
      "utf8",
    ).trim();
    this.artifact = {
      version: "scenario-execution-v1" as const,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }
  get canEvaluate(): boolean {
    return this.task === null && this.now() >= this.nextEvaluationAt;
  }
  async settled(): Promise<void> {
    await this.task;
  }
  async prepare(
    input: Parameters<NonNullable<ModelProvider["prepare"]>>[0],
  ): Promise<string | null> {
    this.prepared = null;
    const existing = await this.store.latest();
    const now = this.now();
    if (
      existing !== null &&
      existing.state === "READY" &&
      !existing.consumed &&
      time(existing.validUntil) >= now + 65_000
    ) {
      if (
        existing.availableAt === null ||
        existing.tickSize !== input.snapshot.metadata.tickSize
      )
        throw new Error("SCENARIO_CONTEXT_METADATA_CHANGED");
      const plan = validatePlan(JSON.stringify(existing.plan), {
        analysisId: existing.id,
        symbol: input.snapshot.metadata.symbolName,
        capturedAt: existing.capturedAt,
        availableAt: existing.availableAt,
        tickSize: existing.tickSize,
      });
      if (time(existing.availableAt) > now)
        throw new Error("SCENARIO_CONTEXT_TIME_REGRESSION");
      try {
        const response = scenarioOco(plan, input.payload);
        this.prepared = {
          id: existing.id,
          analysisId: response.analysis_id,
          response,
        };
        return null;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/^SCENARIO_WAIT_[A-Z_]+$/.test(error.message)
        )
          throw error;
        this.nextEvaluationAt = now + 10_000;
        return error.message;
      }
    }
    const due = existing === null ? 0 : time(existing.requestedAt) + 300_000;
    if (now < due || this.task !== null) {
      this.nextEvaluationAt = this.task === null ? due : now + 5_000;
      return existing?.consumed
        ? "SCENARIO_MAP_CONSUMED"
        : "SCENARIO_REFRESH_PENDING";
    }
    const id = randomUUID();
    if (
      !(await this.store.claim({
        id,
        sourceAnalysisId: String(input.payload.analysis_id),
        capturedAt: input.snapshot.serverTime,
        tickSize: input.snapshot.metadata.tickSize,
      }))
    ) {
      this.nextEvaluationAt = now + 10_000;
      return "SCENARIO_REFRESH_ALREADY_CLAIMED";
    }
    this.nextEvaluationAt = now + 300_000;
    this.task = this.planner
      .generate({
        analysisId: id,
        symbol: input.snapshot.metadata.symbolName,
        capturedAt: input.snapshot.serverTime,
        tickSize: input.snapshot.metadata.tickSize,
        candles: input.snapshot.candles,
        chart: input.chart,
      })
      .then(async (result) => {
        // Validate again at the trust boundary before granting local execution access.
        const plan = validatePlan(result.rawResponse, {
          analysisId: id,
          symbol: input.snapshot.metadata.symbolName,
          capturedAt: input.snapshot.serverTime,
          availableAt: new Date(this.now()).toISOString(),
          tickSize: input.snapshot.metadata.tickSize,
        });
        await this.store.finish(id, { ...result, response: plan }, null);
        this.nextEvaluationAt = 0;
      })
      .catch(async (error: unknown) => {
        const reason =
          error instanceof Error &&
          /^(AI|SCENARIO)_[A-Z0-9_:]{1,120}$/.test(error.message)
            ? error.message
            : "SCENARIO_REFRESH_FAILED";
        this.report(reason);
        await this.store.finish(
          id,
          null,
          reason,
          error instanceof ProviderFailure ? error.telemetry : undefined,
        );
      })
      .catch(() => this.report("SCENARIO_JOURNAL_UNAVAILABLE"))
      .finally(() => {
        this.task = null;
      });
    return "SCENARIO_REFRESH_STARTED";
  }
  analyze(
    request: Parameters<ModelProvider["analyze"]>[0],
  ): ReturnType<ModelProvider["analyze"]> {
    const p = this.prepared;
    this.prepared = null;
    if (
      p === null ||
      p.analysisId !== request.analysisId ||
      time(p.response.valid_until) <= this.now()
    )
      return Promise.reject(new Error("SCENARIO_PREPARED_DECISION_MISSING"));
    return Promise.resolve({
      response: p.response,
      rawResponse: JSON.stringify(p.response),
      promptArtifact: this.artifact,
      latencyMs: 0,
      retryCount: 0,
      contextPlanId: p.id,
    });
  }
}
