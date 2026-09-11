import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { redactString } from "../../../packages/logging/src/index.js";
import type pg from "pg";
import type {
  EntryRetirementEvidence,
  MarketSnapshot,
} from "../../../packages/contracts/src/index.js";
import {
  checkEntryPrices,
  entryMinimumDistance,
} from "../../../packages/scenario-engine/src/entry-prices.js";
import {
  contextScopeLock,
  entryReplacementProof,
  retireEntryContext,
} from "./entry-recovery-store.js";
import { FIXED_DEFAULTS } from "../../../packages/config/src/policy.js";
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
import {
  ENTRY_PAIR_PROMPT,
  entryProviderPayload,
  type EntryPlannerInput,
} from "../../../packages/scenario-engine/src/entry-planner.js";
import {
  validateEntryPlan,
  type EntryPairPlan,
} from "../../../packages/scenario-engine/src/entry-plan.js";
type ContextPlan = ScenarioPlan | EntryPairPlan;
type Planner = {
  generate(input: EntryPlannerInput): Promise<AiAnalysisResult<ContextPlan>>;
};
import {
  isLocalCircuitRejection,
  SCENARIO_REQUEST_POLICY,
} from "../../../packages/scenario-engine/src/request-policy.js";

/** Same proof is used for discovery and the locked dispatch claim. Aliases: c, g. */
const zeroFillTerminalProof = `
  g.state='FAILED' AND g.cancellation_reason IN ('OCO_PEER_UNFILLED_TERMINAL','DEMO_BROKER_ZERO_FILL_CANCELLED')
  AND g.updated_at<=clock_timestamp() AND g.mode=c.mode
  AND EXISTS(SELECT 1 FROM analysis_runs a WHERE a.id=g.analysis_id AND a.account_id=c.account_id AND a.symbol_id=c.symbol_id)
  AND (SELECT count(*) FROM orders o WHERE o.order_group_id=g.id)=2
  AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id AND (
    o.account_id<>c.account_id OR NOT o.strategy_owned OR o.broker_order_id IS NULL
    OR o.state NOT IN ('CANCELLED','EXPIRED','REJECTED') OR o.filled_volume<>0
    OR NOT EXISTS(SELECT 1 FROM broker_execution_events e
      WHERE e.order_id=o.id AND e.account_id=c.account_id AND e.symbol_id=c.symbol_id
        AND e.broker_order_id=o.broker_order_id AND e.mapping_state='MAPPED'
        AND e.execution_type IN (5,6,7) AND jsonb_array_length(e.reason_codes)=0
        AND e.normalized_payload->'order'->>'state'=o.state
        AND e.normalized_payload->'order'->>'filledVolume'='0')))
  AND NOT EXISTS(SELECT 1 FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.order_group_id=g.id)
  AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id)
  AND NOT EXISTS(SELECT 1 FROM trades t WHERE t.order_group_id=g.id)
  AND NOT EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.account_id=c.account_id AND e.symbol_id=c.symbol_id
    AND e.resolved_at IS NULL AND (e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0))`;

export interface StoredContext {
  id: string;
  requestedModel: string;
  state: "REQUESTING" | "READY" | "FAILED";
  requestedAt: string;
  capturedAt: string;
  validUntil: string;
  availableAt: string | null;
  tickSize: string;
  plan: ContextPlan | null;
  consumed: boolean;
  retiredAt?: string | null;
  refreshAfterEntryContextId?: string | null;
  /** Fully reconciled, durably closed setup; permits one fresh analysis. */
  closedAt?: string | null;
  /** Both owned orders broker-confirmed terminal with explicit zero-fill evidence. */
  zeroFillTerminalAt?: string | null;
  reason: string | null;
}
export interface ContextStore {
  retireEntries?(
    id: string,
    evidence: EntryRetirementEvidence,
  ): Promise<boolean>;
  latest(): Promise<StoredContext | null>;
  claim(input: {
    id: string;
    sourceAnalysisId: string;
    capturedAt: string;
    tickSize: string;
    afterContextId?: string;
    afterEntryContextId?: string;
    providerEvidence?: {
      requestText: string;
      promptContent: string;
      promptVersion: string;
    };
  }): Promise<boolean>;
  finish(
    id: string,
    result: AiAnalysisResult<ContextPlan> | null,
    reason: string | null,
    telemetry?: unknown,
    rejectedResponse?: string,
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
  retireEntries(
    id: string,
    evidence: EntryRetirementEvidence,
  ): Promise<boolean> {
    return retireEntryContext(this.pool, this.scope, id, evidence);
  }
  async summary() {
    const result = await this.pool.query(
      `SELECT c.state,c.requested_at,c.valid_until,c.duration_ms,c.reason,c.requested_model,
      c.telemetry->>'returnedModel' AS returned_model,
      (SELECT r.recorded_at FROM context_entry_retirements r WHERE r.context_id=c.id) AS retired_at,
      (SELECT r.evidence->'reasonCodes' FROM context_entry_retirements r WHERE r.context_id=c.id) AS entry_retirement_reasons,
      c.refresh_after_entry_context_id IS NOT NULL AS entry_replacement,
      EXISTS(SELECT 1 FROM order_groups g WHERE g.context_plan_id=c.id) AS consumed,
      (SELECT count(*)::int FROM scenario_contexts x WHERE x.account_id=c.account_id AND x.symbol_id=c.symbol_id AND x.mode=c.mode AND x.requested_at>=clock_timestamp()-interval '24 hours') AS calls_24h
      FROM scenario_contexts c WHERE c.account_id=$1 AND c.symbol_id=$2 AND c.mode=$3 ORDER BY c.requested_at DESC LIMIT 1`,
      [this.scope.accountId, this.scope.symbolId, this.scope.mode],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }
  async latest(): Promise<StoredContext | null> {
    const result = await this.pool.query(
      `SELECT c.id,c.state,c.reason,c.requested_model,c.requested_at,c.captured_at,c.valid_until,c.available_at,c.tick_size,c.plan,c.refresh_after_entry_context_id,
      (SELECT r.recorded_at FROM context_entry_retirements r WHERE r.context_id=c.id) AS retired_at,
      EXISTS(SELECT 1 FROM order_groups g WHERE g.context_plan_id=c.id) AS consumed,
      (SELECT max(t.closed_at) FROM order_groups g JOIN trades t ON t.order_group_id=g.id
       WHERE g.context_plan_id=c.id AND g.state='CLOSED'
         AND EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id AND p.state='CLOSED')
         AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id AND p.state<>'CLOSED')
         AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id AND o.state NOT IN ('FILLED','CANCELLED','EXPIRED','REJECTED'))) AS closed_at,
      (SELECT max(g.updated_at) FROM order_groups g WHERE g.context_plan_id=c.id AND ${zeroFillTerminalProof}) AS zero_fill_terminal_at
      FROM scenario_contexts c WHERE account_id=$1 AND symbol_id=$2 AND mode=$3 ORDER BY requested_at DESC LIMIT 1`,
      [this.scope.accountId, this.scope.symbolId, this.scope.mode],
    );
    const r = result.rows[0] as
      | {
          id: string;
          requested_model: string;
          state: StoredContext["state"];
          requested_at: Date;
          captured_at: Date;
          valid_until: Date;
          available_at: Date | null;
          tick_size: string;
          plan: ContextPlan | null;
          consumed: boolean;
          retired_at: Date | null;
          refresh_after_entry_context_id: string | null;
          closed_at: Date | null;
          zero_fill_terminal_at: Date | null;
          reason: string | null;
        }
      | undefined;
    return r === undefined
      ? null
      : {
          id: r.id,
          requestedModel: r.requested_model,
          state: r.state,
          requestedAt: r.requested_at.toISOString(),
          capturedAt: r.captured_at.toISOString(),
          validUntil: r.valid_until.toISOString(),
          availableAt: r.available_at?.toISOString() ?? null,
          tickSize: r.tick_size,
          plan: r.plan,
          consumed: r.consumed,
          retiredAt: r.retired_at?.toISOString() ?? null,
          refreshAfterEntryContextId: r.refresh_after_entry_context_id,
          closedAt: r.closed_at?.toISOString() ?? null,
          zeroFillTerminalAt: r.zero_fill_terminal_at?.toISOString() ?? null,
          reason: r.reason,
        };
  }
  async claim(input: {
    id: string;
    sourceAnalysisId: string;
    capturedAt: string;
    tickSize: string;
    afterContextId?: string;
    afterEntryContextId?: string;
    providerEvidence?: {
      requestText: string;
      promptContent: string;
      promptVersion: string;
    };
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Cross-process single-flight; only proven terminal setups get one early request.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [contextScopeLock(this.scope)],
      );
      const result = await client.query(
        `INSERT INTO scenario_contexts
        (id,account_id,symbol_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,source_analysis_id,refresh_after_context_id,refresh_after_entry_context_id)
        SELECT $1,$2,$3,$4,clock_timestamp(),$5::timestamptz,$5::timestamptz+interval '5 minutes','REQUESTING',$8,$6,$7,$9::uuid,$10::uuid
        WHERE NOT EXISTS(SELECT 1 FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id
          WHERE a.account_id=$2 AND a.symbol_id=$3 AND g.mode=$4
          AND g.state NOT IN ('CLOSED','EXPIRED','FAILED'))
        AND (($9::uuid IS NULL AND $10::uuid IS NULL AND NOT EXISTS(SELECT 1 FROM scenario_contexts WHERE account_id=$2 AND symbol_id=$3 AND mode=$4
          AND requested_at > clock_timestamp()-interval '5 minutes'
          AND NOT (state='FAILED' AND reason IS NOT DISTINCT FROM 'AI_CIRCUIT_OPEN'))
        AND NOT EXISTS(SELECT 1 FROM scenario_contexts WHERE account_id=$2 AND symbol_id=$3 AND mode=$4
          AND requested_at > clock_timestamp()-interval '1 minute'))
        OR ($9::uuid IS NOT NULL AND $10::uuid IS NULL AND EXISTS(
          SELECT 1 FROM scenario_contexts c JOIN order_groups g ON g.context_plan_id=c.id
          WHERE c.id=$9 AND c.account_id=$2 AND c.symbol_id=$3 AND c.mode=$4
            AND c.state='READY'
            AND NOT EXISTS(SELECT 1 FROM scenario_contexts newer WHERE newer.account_id=$2 AND newer.symbol_id=$3 AND newer.mode=$4 AND newer.requested_at>c.requested_at)
            AND NOT EXISTS(SELECT 1 FROM scenario_contexts used WHERE used.refresh_after_context_id=c.id)
            AND ((g.state='CLOSED'
            AND EXISTS(SELECT 1 FROM trades t WHERE t.order_group_id=g.id AND t.closed_at<=clock_timestamp())
            AND EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id AND p.state='CLOSED')
            AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id AND (p.state<>'CLOSED' OR NOT EXISTS(SELECT 1 FROM trades t WHERE t.position_id=p.id AND t.order_group_id=g.id)))
            AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id AND o.state NOT IN ('FILLED','CANCELLED','EXPIRED','REJECTED')))
            OR (${zeroFillTerminalProof}))
        )) OR ($9::uuid IS NULL AND $10::uuid IS NOT NULL AND EXISTS(
          SELECT 1 FROM scenario_contexts c WHERE c.id=$10 AND c.account_id=$2 AND c.symbol_id=$3 AND c.mode=$4
            AND ${entryReplacementProof}
        ))) RETURNING id`,
        [
          input.id,
          this.scope.accountId,
          this.scope.symbolId,
          this.scope.mode,
          input.capturedAt,
          input.tickSize,
          input.sourceAnalysisId,
          FIXED_DEFAULTS.AI_MODEL,
          input.afterContextId ?? null,
          input.afterEntryContextId ?? null,
        ],
      );
      if (result.rowCount === 1 && input.providerEvidence !== undefined) {
        const evidence = input.providerEvidence;
        await client.query(
          `INSERT INTO provider_prompt_artifacts(content,version) VALUES ($1,$2)
          ON CONFLICT(content_sha256) DO NOTHING`,
          [evidence.promptContent, evidence.promptVersion],
        );
        await client.query(
          `INSERT INTO context_provider_evidence(context_id,prompt_sha256,request_text)
          VALUES ($1,encode(sha256(convert_to($2,'UTF8')),'hex'),$3)`,
          [input.id, evidence.promptContent, evidence.requestText],
        );
      }
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
    result: AiAnalysisResult<ContextPlan> | null,
    reason: string | null,
    telemetry?: unknown,
    rejectedResponse?: string,
  ): Promise<void> {
    const usage = result?.telemetry ?? telemetry;
    const parsed =
      usage === undefined ? null : providerTelemetrySchema.parse(usage);
    if (
      (parsed !== null && parsed.requestedModel !== FIXED_DEFAULTS.AI_MODEL) ||
      (result !== null && result.model !== FIXED_DEFAULTS.AI_MODEL)
    )
      throw new Error("SCENARIO_PROVIDER_IDENTITY_MISMATCH");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
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
      if (updated.rowCount !== 1)
        throw new Error("SCENARIO_COMPLETION_MISSING");
      await client.query(
        `UPDATE context_provider_evidence SET response_text=$2 WHERE context_id=$1`,
        [
          id,
          result === null
            ? rejectedResponse === undefined
              ? null
              : redactString(rejectedResponse)
            : redactString(result.rawResponse),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
  private readonly providerPrompt: string | null;
  constructor(
    private readonly store: ContextStore,
    private readonly planner: Planner,
    private readonly now = Date.now,
    private readonly report: (reason: string) => void = () => {},
    private readonly entryOnly = false,
    private readonly entryChecks?: {
      snapshot(): Promise<MarketSnapshot>;
      maxQuoteAgeMs: number;
      maxMetadataAgeMs: number;
      minimumPoints: string | null;
    },
  ) {
    this.providerPrompt = entryOnly
      ? readFileSync(ENTRY_PAIR_PROMPT.path, "utf8").trim()
      : null;
    const content = readFileSync(
      entryOnly
        ? "prompts/entry-pair-execution-v1.md"
        : "prompts/scenario-execution-v2.md",
      "utf8",
    ).trim();
    this.artifact = {
      version: entryOnly
        ? ("entry-pair-execution-v1" as const)
        : ("scenario-execution-v2" as const),
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }
  private get priceCheckOptions() {
    return (
      this.entryChecks ?? {
        maxQuoteAgeMs: 3000,
        maxMetadataAgeMs: 86400000,
        minimumPoints: null,
      }
    );
  }
  async retireEntries(
    contextId: string,
    snapshot: MarketSnapshot,
    phase: EntryRetirementEvidence["phase"],
  ): Promise<boolean> {
    const row = await this.store.latest();
    if (
      !this.entryOnly ||
      row?.id !== contextId ||
      row.state !== "READY" ||
      row.consumed ||
      row.plan?.schema_version !== "entry-pair-1.0"
    )
      return false;
    if (row.retiredAt != null) return true;
    if (
      row.availableAt === null ||
      row.tickSize !== snapshot.metadata.tickSize ||
      time(row.availableAt) > this.now()
    )
      throw new Error("SCENARIO_CONTEXT_METADATA_CHANGED");
    const plan = validateEntryPlan(JSON.stringify(row.plan), {
      analysisId: row.id,
      symbol: snapshot.metadata.symbolName,
      capturedAt: row.capturedAt,
      availableAt: row.availableAt,
      tickSize: row.tickSize,
    });
    const evidence = checkEntryPrices(
      plan,
      snapshot,
      phase,
      this.now(),
      this.priceCheckOptions,
    );
    if (evidence === null) return false;
    if (this.store.retireEntries === undefined)
      throw new Error("SCENARIO_ENTRY_RECOVERY_UNAVAILABLE");
    const retired = await this.store.retireEntries(contextId, evidence);
    if (retired) this.nextEvaluationAt = 0;
    return retired;
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
    let existing = await this.store.latest();
    const now = this.now();
    if (
      this.entryOnly &&
      existing?.state === "READY" &&
      !existing.consumed &&
      existing.retiredAt == null &&
      existing.requestedModel === FIXED_DEFAULTS.AI_MODEL &&
      existing.plan?.schema_version === "entry-pair-1.0" &&
      time(existing.validUntil) >= now + 65_000
    ) {
      if (
        existing.tickSize !== input.snapshot.metadata.tickSize ||
        existing.availableAt === null
      )
        throw new Error("SCENARIO_CONTEXT_METADATA_CHANGED");
      const plan = validateEntryPlan(JSON.stringify(existing.plan), {
        analysisId: existing.id,
        symbol: input.snapshot.metadata.symbolName,
        capturedAt: existing.capturedAt,
        availableAt: existing.availableAt,
        tickSize: existing.tickSize,
      });
      const evidence = checkEntryPrices(
        plan,
        input.snapshot,
        "LOCAL_REUSE",
        now,
        this.priceCheckOptions,
      );
      if (evidence !== null) {
        if (this.store.retireEntries === undefined)
          throw new Error("SCENARIO_ENTRY_RECOVERY_UNAVAILABLE");
        if (!(await this.store.retireEntries(existing.id, evidence)))
          return "SCENARIO_ENTRY_RECONCILIATION_REQUIRED";
        existing = { ...existing, retiredAt: evidence.observedAt };
      }
    }
    if (
      existing !== null &&
      existing.state === "READY" &&
      existing.requestedModel === FIXED_DEFAULTS.AI_MODEL &&
      !existing.consumed &&
      existing.retiredAt == null &&
      (!this.entryOnly || existing.plan?.schema_version === "entry-pair-1.0") &&
      time(existing.validUntil) >= now + 65_000
    ) {
      if (
        existing.availableAt === null ||
        existing.tickSize !== input.snapshot.metadata.tickSize
      )
        throw new Error("SCENARIO_CONTEXT_METADATA_CHANGED");
      const plan = (this.entryOnly ? validateEntryPlan : validatePlan)(
        JSON.stringify(existing.plan),
        {
          analysisId: existing.id,
          symbol: input.snapshot.metadata.symbolName,
          capturedAt: existing.capturedAt,
          availableAt: existing.availableAt,
          tickSize: existing.tickSize,
        },
      );
      if (time(existing.availableAt) > now)
        throw new Error("SCENARIO_CONTEXT_TIME_REGRESSION");
      try {
        const response = scenarioOco(
          plan,
          input.payload,
          input.snapshot.metadata,
        );
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
    const afterTerminal =
      existing?.state === "READY" &&
      existing.consumed &&
      [existing.closedAt, existing.zeroFillTerminalAt].some(
        (at) => at != null && time(at) <= now,
      );
    const afterEntry =
      this.entryOnly &&
      existing?.state === "READY" &&
      !existing.consumed &&
      existing.retiredAt != null &&
      existing.refreshAfterEntryContextId == null &&
      now <
        time(existing.requestedAt) +
          SCENARIO_REQUEST_POLICY.dispatchCooldownMs &&
      existing.requestedModel === FIXED_DEFAULTS.AI_MODEL;
    const due =
      afterTerminal || afterEntry
        ? 0
        : existing === null
          ? 0
          : time(existing.requestedAt) +
            (isLocalCircuitRejection(existing.state, existing.reason)
              ? SCENARIO_REQUEST_POLICY.localCircuitRecheckMs
              : SCENARIO_REQUEST_POLICY.dispatchCooldownMs);
    if (now < due || this.task !== null) {
      // Poll consumed setup evidence locally so a newly completed setup does
      // not remain hidden behind a cached five-minute provider cooldown.
      this.nextEvaluationAt =
        this.task === null
          ? existing?.consumed
            ? Math.min(due, now + 5_000)
            : due
          : now + 5_000;
      return existing?.retiredAt != null
        ? "SCENARIO_ENTRY_REFRESH_BACKOFF"
        : existing?.consumed
          ? "SCENARIO_MAP_CONSUMED"
          : "SCENARIO_REFRESH_PENDING";
    }
    if (!this.entryOnly && input.chart === null)
      throw new Error("SCENARIO_CHART_MISSING");
    const id = randomUUID();
    const plannerInput: EntryPlannerInput = {
      analysisId: id,
      symbol: input.snapshot.metadata.symbolName,
      capturedAt: input.snapshot.serverTime,
      tickSize: input.snapshot.metadata.tickSize,
      candles: input.snapshot.candles,
      chart: input.chart,
      quote: input.snapshot.quote,
      minimumStopDistance: entryMinimumDistance(
        input.snapshot.metadata,
        this.priceCheckOptions.minimumPoints,
      ),
      ...(this.entryOnly && input.chart === null
        ? { schemaVersion: "2.0" as const }
        : {}),
    };
    if (
      !(await this.store.claim({
        id,
        sourceAnalysisId: String(input.payload.analysis_id),
        capturedAt: input.snapshot.serverTime,
        tickSize: input.snapshot.metadata.tickSize,
        ...(this.entryOnly
          ? {
              providerEvidence: {
                requestText: JSON.stringify(entryProviderPayload(plannerInput)),
                promptContent: this.providerPrompt!,
                promptVersion: ENTRY_PAIR_PROMPT.version,
              },
            }
          : {}),
        ...(afterTerminal && existing !== null
          ? { afterContextId: existing.id }
          : afterEntry && existing !== null
            ? { afterEntryContextId: existing.id }
            : {}),
      }))
    ) {
      this.nextEvaluationAt = now + 10_000;
      return "SCENARIO_REFRESH_ALREADY_CLAIMED";
    }
    this.nextEvaluationAt = now + SCENARIO_REQUEST_POLICY.dispatchCooldownMs;
    this.task = this.planner
      .generate(plannerInput)
      .then(async (result) => {
        // Validate again at the trust boundary before granting local execution access.
        const plan = (this.entryOnly ? validateEntryPlan : validatePlan)(
          this.entryOnly ? JSON.stringify(result.response) : result.rawResponse,
          {
            analysisId: id,
            symbol: input.snapshot.metadata.symbolName,
            capturedAt: input.snapshot.serverTime,
            availableAt: new Date(this.now()).toISOString(),
            tickSize: input.snapshot.metadata.tickSize,
          },
        );
        await this.store.finish(id, { ...result, response: plan }, null);
        // A read failure must not rewrite a proven provider completion as a failed dispatch.
        if (this.entryOnly && this.entryChecks !== undefined) {
          try {
            await this.retireEntries(
              id,
              await this.entryChecks.snapshot(),
              "PROVIDER_RETURN",
            );
          } catch {
            this.report("SCENARIO_ENTRY_RECHECK_UNAVAILABLE");
          }
        }
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
          error instanceof ProviderFailure ? error.rawResponse : undefined,
        );
        if (isLocalCircuitRejection("FAILED", reason))
          this.nextEvaluationAt =
            now + SCENARIO_REQUEST_POLICY.localCircuitRecheckMs;
      })
      .catch(() => this.report("SCENARIO_JOURNAL_UNAVAILABLE"))
      .finally(() => {
        this.task = null;
      });
    return afterEntry
      ? "SCENARIO_ENTRY_REFRESH_STARTED"
      : "SCENARIO_REFRESH_STARTED";
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
