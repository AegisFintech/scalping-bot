import { readFileSync, lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import catalogue from "../../../packages/config/src/demo-trial-catalogue.json" with { type: "json" };
import { DEMO_TRIAL_STRATEGY_VERSION } from "../../../packages/config/src/policy.js";
import {
  catalogueSha256,
  profiles,
  profileSha256,
  trialBindingSchema,
  type TrialBinding,
} from "../../../packages/strategy-candidates/src/demo-trial.js";
import { contextScopeLock } from "./entry-recovery-store.js";

/** Order-independent, finite allocation controller inside the one existing executor. */
export class DemoTrials {
  private current: TrialBinding | null = null;
  private observed = false;
  private verifiedAt = 0;
  private task: Promise<void> | null = null;
  private error: string | null = "DEMO_TRIAL_INITIALIZING";
  constructor(
    private readonly pool: pg.Pool,
    private readonly scope: {
      accountId: string;
      symbolId: string;
      mode: string;
      strategyVersionId: string;
    },
    private readonly sourceSha256: string,
    private readonly sessionOpen: () => Promise<boolean>,
    private readonly safeToSwitch: () => Promise<boolean>,
    private readonly now = Date.now,
  ) {
    if (scope.mode !== "demo" || !/^[a-f0-9]{64}$/.test(sourceSha256))
      throw new Error("DEMO_TRIAL_SCOPE_INVALID");
  }
  binding = (): TrialBinding => {
    if (
      !this.current ||
      this.error ||
      this.now() - this.verifiedAt > 30000 ||
      this.now() < Date.parse(this.current.startsAt)
    )
      throw new Error(this.error ?? "DEMO_TRIAL_NOT_READY");
    return this.current;
  };
  async settled(): Promise<void> {
    await this.task;
  }
  async check(): Promise<void> {
    await this.tick();
    this.binding();
  }
  tick(): Promise<void> {
    this.task ??= this.advance()
      .catch(() => {
        this.current = null;
        this.error = "DEMO_TRIAL_RECONCILIATION_REQUIRED";
        this.observed = false;
      })
      .finally(() => {
        this.task = null;
      });
    return this.task;
  }
  private async advance(): Promise<void> {
    const open = await this.sessionOpen();
    const client = await this.pool.connect();
    let switchNeeded = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [contextScopeLock(this.scope)],
      );
      const args = [this.scope.accountId, this.scope.symbolId, this.scope.mode];
      const mode = await client.query<{ revision: string; entry_mode: string }>(
        "SELECT revision,entry_mode FROM entry_mode_settings WHERE account_id=$1 AND symbol_id=$2 AND environment=$3 FOR UPDATE",
        args,
      );
      if (mode.rows[0]?.entry_mode !== "SINGLE_STOP_LIMIT")
        throw new Error("DEMO_TRIAL_MODE_INVALID");
      const result = await client.query<Row>(
        `SELECT t.*,clock_timestamp() AS now,
        (SELECT count(DISTINCT p.id)::int FROM trades tr JOIN positions p ON p.id=tr.position_id AND p.state='CLOSED' JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id) AS closes
        FROM demo_trial_heads h JOIN demo_trials t ON t.id=h.trial_id WHERE h.account_id=$1 AND h.symbol_id=$2 AND h.mode=$3 FOR UPDATE OF h,t`,
        args,
      );
      let row = result.rows[0];
      if (row) {
        if (
          row.source_sha256 !== this.sourceSha256 ||
          row.catalogue_sha256 !== catalogueSha256 ||
          row.strategy_version_id !== this.scope.strategyVersionId ||
          row.mode_revision !== mode.rows[0].revision
        )
          throw new Error("DEMO_TRIAL_SOURCE_DRIFT");
        const elapsed = trialOpenCredit(
          row.observed_at.getTime(),
          row.now.getTime(),
          row.starts_at.getTime(),
          this.observed &&
            row.state === "ACTIVE" &&
            open &&
            row.last_session_open,
        );
        if (!this.observed)
          await client.query(
            "INSERT INTO demo_trial_events(trial_id,kind,details) VALUES($1,'CONTROLLER_RESUMED',jsonb_build_object('creditedGapMilliseconds',0))",
            [row.id],
          );
        const total = Number(row.market_open_ms) + elapsed;
        const draining =
          row.state !== "ACTIVE" || total >= 3600000 || row.closes >= 20;
        await client.query(
          "UPDATE demo_trials SET observed_at=clock_timestamp(),last_session_open=$2,market_open_ms=$3,state=$4 WHERE id=$1",
          [row.id, open, total, draining ? "DRAINING" : "ACTIVE"],
        );
        row = {
          ...row,
          market_open_ms: String(total),
          state: draining ? "DRAINING" : "ACTIVE",
        };
        if (draining) {
          this.current = null;
          this.error = "DEMO_TRIAL_DRAINING";
          const terminal = await client.query<{ ok: boolean }>(
            "SELECT demo_trial_can_complete($1) AS ok",
            [row.id],
          );
          switchNeeded = terminal.rows[0]?.ok === true;
        }
      } else {
        switchNeeded = true;
        this.current = null;
      }
      // Reconciliation may use the same pool; never hold DB locks across broker IO.
      await client.query("COMMIT");
      if (switchNeeded && (await this.safeToSwitch())) {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout='5s'");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [contextScopeLock(this.scope)],
        );
        const m = await client.query<{ revision: string; entry_mode: string }>(
          "SELECT revision,entry_mode FROM entry_mode_settings WHERE account_id=$1 AND symbol_id=$2 AND environment=$3 FOR UPDATE",
          args,
        );
        if (
          m.rows[0]?.revision !== mode.rows[0].revision ||
          m.rows[0]?.entry_mode !== "SINGLE_STOP_LIMIT"
        )
          throw new Error("DEMO_TRIAL_MODE_CHANGED");
        const h = await client.query<{ trial_id: string }>(
          "SELECT trial_id FROM demo_trial_heads WHERE account_id=$1 AND symbol_id=$2 AND mode=$3 FOR UPDATE",
          args,
        );
        if ((h.rows[0]?.trial_id ?? null) !== (row?.id ?? null)) {
          await client.query("ROLLBACK");
          this.current = null;
          return;
        }
        const blocked = await client.query<{ blocked: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id WHERE a.account_id=$1 AND a.symbol_id=$2 AND g.mode=$3 AND g.state NOT IN('CLOSED','EXPIRED','FAILED')) OR EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.account_id=$1 AND e.symbol_id=$2 AND e.resolved_at IS NULL AND(e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0)) AS blocked`,
          args,
        );
        if (blocked.rows[0]?.blocked !== false) {
          await client.query("ROLLBACK");
          return;
        }
        if (row)
          await client.query(
            "UPDATE demo_trials SET state='COMPLETED',completed_at=clock_timestamp(),retirement_reason='ALLOCATION_COMPLETE',observed_at=clock_timestamp() WHERE id=$1 AND state='DRAINING'",
            [row.id],
          );
        const ordinal = row ? (row.ordinal + 1) % 13 : 0,
          cycle = row ? row.cycle + (ordinal === 0 ? 1 : 0) : 0;
        const profile = profiles.find(
          (p) => p.id === trialSlot(cycle, ordinal),
        )!;
        const id = randomUUID();
        const created = await client.query<Row>(
          `INSERT INTO demo_trials(id,account_id,symbol_id,mode,strategy_version_id,source_sha256,catalogue_sha256,profile_id,profile_sha256,cycle,ordinal,registered_at,starts_at,mode_revision,state)
         VALUES($1,$2,$3,'demo',$4,$5,$6,$7,$8,$9,$10,clock_timestamp(),clock_timestamp()+interval '1 second',$11,'ACTIVE') RETURNING *`,
          [
            id,
            this.scope.accountId,
            this.scope.symbolId,
            this.scope.strategyVersionId,
            this.sourceSha256,
            catalogueSha256,
            profile.id,
            profileSha256(profile),
            cycle,
            ordinal,
            m.rows[0].revision,
          ],
        );
        await client.query(
          "INSERT INTO demo_trial_heads(account_id,symbol_id,mode,trial_id) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,symbol_id,mode) DO UPDATE SET trial_id=EXCLUDED.trial_id",
          [...args, id],
        );
        await client.query("COMMIT");
        row = created.rows[0]!;
      }
      if (row?.state === "ACTIVE") {
        this.current = trialBindingSchema.parse({
          trialId: row.id,
          profileId: row.profile_id,
          profileSha256: row.profile_sha256,
          catalogueSha256: row.catalogue_sha256,
          strategyVersion: DEMO_TRIAL_STRATEGY_VERSION,
          sourceSha256: row.source_sha256,
          registeredAt: row.registered_at.toISOString(),
          startsAt: row.starts_at.toISOString(),
        });
        this.error = null;
      } else {
        this.current = null;
        this.error = "DEMO_TRIAL_DRAINING";
      }
      this.verifiedAt = this.now();
      this.observed = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async summary() {
    const rows = await this.pool.query<{
      cycle: number;
      ordinal: number;
      [key: string]: unknown;
    }>(
      `SELECT t.id,t.profile_id,t.profile_sha256,t.catalogue_sha256,t.source_sha256,t.cycle,t.ordinal,t.registered_at,t.starts_at,t.state,t.market_open_ms,t.observed_at,t.completed_at,t.retirement_reason,p.definition,
      (SELECT e.details->'review' FROM demo_trial_events e WHERE e.trial_id=t.id AND e.kind='COMPLETED' ORDER BY e.sequence DESC LIMIT 1) AS review,
      (SELECT count(*)::int FROM demo_trial_contexts dc WHERE dc.trial_id=t.id) AS proposals,
      (SELECT count(*)::int FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=t.id AND c.requested_model<>'local-range-v1') AS provider_claims,
      (SELECT count(*)::int FROM demo_trial_contexts dc JOIN scenario_contexts c ON c.id=dc.context_id WHERE dc.trial_id=t.id AND c.plan->>'schema_version'='entry-wait-1.0') AS waits,
      (SELECT count(*)::int FROM fills f JOIN orders o ON o.id=f.order_id JOIN order_groups g ON g.id=o.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id) AS entry_fill_events,
      (SELECT count(DISTINCT p.id)::int FROM trades tr JOIN positions p ON p.id=tr.position_id AND p.state='CLOSED' JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id) AS closes,
      (SELECT sum(tr.realized_pnl)::text FROM trades tr JOIN order_groups g ON g.id=tr.order_group_id JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id WHERE dc.trial_id=t.id) AS realized_net
      FROM demo_trials t JOIN demo_trial_profiles p ON p.catalogue_sha256=t.catalogue_sha256 AND p.profile_id=t.profile_id WHERE t.account_id=$1 AND t.symbol_id=$2 AND t.mode=$3 ORDER BY t.cycle DESC,t.ordinal DESC LIMIT 26`,
      [this.scope.accountId, this.scope.symbolId, this.scope.mode],
    );
    return {
      schemaVersion: "demo-trial-status-1.0",
      observedAt: new Date(this.now()).toISOString(),
      controllerVerifiedAt: this.verifiedAt
        ? new Date(this.verifiedAt).toISOString()
        : null,
      reason: this.error,
      experimental: true,
      nextProfileId: rows.rows[0]
        ? trialSlot(
            Number(rows.rows[0].cycle) +
              (Number(rows.rows[0].ordinal) === 12 ? 1 : 0),
            (Number(rows.rows[0].ordinal) + 1) % 13,
          )
        : trialSlot(0, 0),
      nextAction:
        this.error === "DEMO_TRIAL_DRAINING"
          ? "WAIT_FOR_TERMINAL_PROOF_THEN_REGISTER_NEXT"
          : this.error || !this.current
            ? "WAIT_FOR_CONTROLLER_OR_RECONCILIATION"
            : "EVALUATE_FRESH_OPPORTUNITIES",
      netIncludesSignedFees: true,
      actualFutureCosts: null,
      trials: rows.rows,
    };
  }
}
type Row = {
  id: string;
  state: string;
  source_sha256: string;
  catalogue_sha256: string;
  profile_id: string;
  profile_sha256: string;
  strategy_version_id: string;
  mode_revision: string;
  cycle: number;
  ordinal: number;
  market_open_ms: string;
  last_session_open: boolean;
  observed_at: Date;
  now: Date;
  registered_at: Date;
  starts_at: Date;
  closes: number;
};
/** Only consecutive verified-open observations; downtime and oversized gaps count zero. */
export function trialOpenCredit(
  previous: number,
  now: number,
  start: number,
  bothOpen: boolean,
): number {
  const delta = now - Math.max(previous, start);
  return bothOpen && delta > 0 && now - previous <= 30000 ? delta : 0;
}
export function trialSlot(cycle: number, ordinal: number): string {
  if (
    !Number.isSafeInteger(cycle) ||
    cycle < 0 ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= 13
  )
    throw new Error("DEMO_TRIAL_SLOT_INVALID");
  let offset = 0;
  for (const b of catalogue.batches) {
    if (ordinal < offset + b.profiles.length)
      return b.profiles[
        (ordinal - offset + (b.id === "ENTRY" ? 1 - (cycle % 2) : 1)) %
          b.profiles.length
      ]!;
    offset += b.profiles.length;
  }
  throw new Error("DEMO_TRIAL_SLOT_INVALID");
}

/** Release source pin, distinct from the registry's opaque CODE_VERSION hash. */
export function demoTrialSource(path = "release-manifest.json"): string {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== 0 ||
    (stat.mode & 0o022) !== 0
  )
    throw new Error("DEMO_TRIAL_RELEASE_MANIFEST_INVALID");
  const value = JSON.parse(readFileSync(path, "utf8")) as {
    sourceSha256?: unknown;
  };
  if (
    typeof value.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceSha256)
  )
    throw new Error("DEMO_TRIAL_RELEASE_SOURCE_INVALID");
  return value.sourceSha256;
}
