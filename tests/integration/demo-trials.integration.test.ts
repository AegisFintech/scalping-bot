import {
  trendProfiles,
  trendCatalogueSha256,
} from "../../packages/strategy-candidates/src/trend-retest-profile.js";
import { entryProviderPayload } from "../../packages/scenario-engine/src/entry-planner.js";
import { trendInput } from "../helpers/trend-input.js";
import { trendRetestGeometry } from "../../packages/strategy-candidates/src/trend-retest.js";
import {
  TREND_RETEST_VERSION,
  TREND_PREDECESSOR_SOURCE,
  TREND_CLOCK_PREDECESSOR_SOURCE,
} from "../../packages/config/src/trend-retest-policy.js";
import { spawnSync } from "node:child_process";
import { MAX_PERSISTED_CANDLE_TAILS } from "../../apps/execution-service/src/decision-storage.js";
import { createHash } from "node:crypto";
import { PostgresDemoExecutionStore } from "../../apps/execution-service/src/demo-execution-store.js";
import { PostgresDecisionTrail } from "../../apps/execution-service/src/postgres-trail.js";
import { response } from "../helpers/breakout-candidate.js";
import { bindScalpDecision } from "../../packages/scenario-engine/src/scalp-entry.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { DemoTrials } from "../../apps/execution-service/src/demo-trials.js";
import { EntryModeStore } from "../../apps/execution-service/src/entry-mode-store.js";
import { PostgresContextStore } from "../../apps/execution-service/src/scenario-context.js";
import {
  catalogueSha256,
  profiles,
  profileSha256,
  trialPrompt,
} from "../../packages/strategy-candidates/src/demo-trial.js";
import { DEMO_TRIAL_STRATEGY_VERSION } from "../../packages/config/src/policy.js";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "registered demo trial authority (isolated database, no broker)",
  () => {
    let admin: pg.Pool, pool: pg.Pool;
    let tradeCounter = 0;
    const schema = `trials_${randomUUID().replaceAll("-", "")}`,
      strategy = randomUUID(),
      trendStrategy = randomUUID();
    beforeAll(async () => {
      admin = createPool({ connectionString: url! });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const u = new URL(url!);
      u.searchParams.set("options", `-csearch_path=${schema}`);
      pool = createPool({ connectionString: u.toString() });
      await migrate(pool, path.resolve("migrations"));
      await pool.query(
        "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1,$2,'fixture','fixture','demo-trial-execution-v1','2.1','1.1')",
        [strategy, DEMO_TRIAL_STRATEGY_VERSION],
      );
      await pool.query(
        "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1,$2,'fixture','fixture','trend-retest-execution-v1','2.1','1.1')",
        [trendStrategy, TREND_RETEST_VERSION],
      );
    }, 60000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    it("scorecard skips proof calls for absent groups without hiding the trial", async () => {
      const x = await fixture(true);
      const key = "scorecard-no-groups-fixture";
      await pool.query(
        "UPDATE accounts SET provider_account_key_hash=$1 WHERE id=$2",
        [createHash("sha256").update(key).digest("hex"), x.scope.accountId],
      );
      const original = (
        await pool.query<{ definition: string }>(
          "SELECT pg_get_functiondef('demo_trial_closed_group(uuid)'::regprocedure) AS definition",
        )
      ).rows[0]!.definition;
      try {
        await pool.query(`CREATE OR REPLACE FUNCTION demo_trial_closed_group(target uuid)
          RETURNS boolean LANGUAGE plpgsql STABLE AS $$ BEGIN
          IF target IS NULL THEN RAISE EXCEPTION 'UNNECESSARY_NULL_PROOF'; END IF;
          RETURN false; END $$`);
        const scoped = new URL(url!);
        scoped.searchParams.set("options", `-csearch_path=${schema}`);
        const check = spawnSync(
          ".venv/bin/python",
          [
            "-c",
            `
from datetime import UTC, datetime
import os, psycopg
from python.operations.demo_scorecards import load
connect = psycopg.connect
class SlowCursor(psycopg.Cursor):
    def execute(self, query, *args, **kwargs):
        if os.getenv("FORCE_CENSUS_TIMEOUT") == "1" and isinstance(query, str) and "WITH selected AS" in query:
            return super().execute("SELECT pg_sleep(2)")
        return super().execute(query, *args, **kwargs)
def isolated(*args, **kwargs):
    assert "statement_timeout=1500" in kwargs["options"]
    assert "default_transaction_read_only=on" in kwargs["options"]
    kwargs["options"] += " -c search_path=" + os.environ["TEST_SCORECARD_SCHEMA"]
    kwargs["cursor_factory"] = SlowCursor
    return connect(*args, **kwargs)
psycopg.connect = isolated
value = load(datetime.now(UTC))
assert value is not None, "scorecard unavailable"
assert len(value["trialOutcomes"]) == 1
assert value["trialOutcomes"][0]["groups"] == 0
assert value["trialOutcomes"][0]["provenClosedGroups"] == 0
assert value["trialOutcomesReadState"] == "ready"
os.environ["FORCE_CENSUS_TIMEOUT"] = "1"
partial = load(datetime.now(UTC))
assert partial is not None, "optional census timeout hid daily accounting"
assert partial["recordedNet"] == value["recordedNet"]
assert partial["trialOutcomesReadState"] == "unavailable"
assert partial["trialOutcomes"] == []
`,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              DATABASE_URL: scoped.toString(),
              ACCOUNT_KEY: key,
              TEST_SCORECARD_SCHEMA: schema,
              TRADING_MODE: "demo",
            },
          },
        );
        expect(check.status, check.stderr).toBe(0);
      } finally {
        await pool.query(original);
      }
    });

    it("registers a future trend allocation with matching mode and typed status", async () => {
      const x = await fixture(false, true);
      await expect(x.controller.check()).rejects.toThrow(
        "DEMO_TRIAL_NOT_READY",
      );
      const status = await x.controller.summary();
      expect(status.schemaVersion).toBe("demo-trial-status-1.1");
      expect(status.trials).toHaveLength(1);
      expect(status.trials[0]).toMatchObject({
        profile_id: "TREND_BREAKOUT",
        ordinal: 0,
        cycle: 0,
      });
      const typed = spawnSync(
        ".venv/bin/python",
        [
          "-c",
          "import sys;from python.research.demo_trial_status import status_reader;status_reader.validate_json(sys.stdin.buffer.read())",
        ],
        { encoding: "utf8", input: JSON.stringify(status) },
      );
      expect(typed.status, typed.stderr).toBe(0);
    });

    it("hands over only the pinned predecessor after fresh safe reconciliation", async () => {
      const x = await fixture(false, false, TREND_PREDECESSOR_SOURCE);
      await expect(x.controller.check()).rejects.toThrow(
        "DEMO_TRIAL_NOT_READY",
      );
      let safe = false;
      const next = new DemoTrials(
        pool,
        {
          ...x.scope,
          strategyVersionId: trendStrategy,
          strategyVersion: TREND_RETEST_VERSION,
        },
        "c".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(safe),
      );
      await expect(next.check()).rejects.toThrow();
      expect((await next.summary()).trials).toHaveLength(1);
      safe = true;
      await expect(next.check()).rejects.toThrow();
      const status = await next.summary();
      expect(status.trials).toHaveLength(2);
      expect(status.trials[0]).toMatchObject({
        source_sha256: "c".repeat(64),
        ordinal: 0,
        cycle: 1,
        profile_id: "TREND_CONFIRMED",
      });
      expect(status.trials[1]).toMatchObject({
        state: "COMPLETED",
        retirement_reason: "SOURCE_HANDOVER",
        source_sha256: TREND_PREDECESSOR_SOURCE,
      });
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM demo_trial_events WHERE trial_id=$1 AND kind='SOURCE_HANDOVER_REQUESTED'",
            [status.trials[1]!.id],
          )
        ).rows[0]!.n,
      ).toBe(1);
    });

    it("hands over the exact trend clock predecessor only after safe reconciliation", async () => {
      const x = await fixture(false, true, TREND_CLOCK_PREDECESSOR_SOURCE);
      await expect(x.controller.check()).rejects.toThrow(
        "DEMO_TRIAL_NOT_READY",
      );
      let safe = false;
      const next = new DemoTrials(
        pool,
        x.scope,
        "c".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(safe),
      );
      await expect(next.check()).rejects.toThrow();
      expect((await next.summary()).trials).toHaveLength(1);
      safe = true;
      await expect(next.check()).rejects.toThrow();
      const status = await next.summary();
      expect(status.trials).toHaveLength(2);
      expect(status.trials[0]).toMatchObject({
        source_sha256: "c".repeat(64),
        cycle: 1,
      });
      expect(status.trials[1]).toMatchObject({
        state: "COMPLETED",
        retirement_reason: "SOURCE_HANDOVER",
        source_sha256: TREND_CLOCK_PREDECESSOR_SOURCE,
      });
    });

    it("refuses unregistered trend source drift without retiring its allocation", async () => {
      const x = await fixture(false, true);
      await expect(x.controller.check()).rejects.toThrow(
        "DEMO_TRIAL_NOT_READY",
      );
      const next = new DemoTrials(
        pool,
        x.scope,
        "c".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(true),
      );
      await expect(next.check()).rejects.toThrow();
      const status = await next.summary();
      expect(status.trials).toHaveLength(1);
      expect(status.reason).toBe("DEMO_TRIAL_SOURCE_DRIFT");
      expect(status.trials[0]!.state).toBe("ACTIVE");
    });

    it("refuses an unregistered predecessor source without retiring it", async () => {
      const x = await fixture();
      await expect(x.controller.check()).rejects.toThrow(
        "DEMO_TRIAL_NOT_READY",
      );
      const next = new DemoTrials(
        pool,
        {
          ...x.scope,
          strategyVersionId: trendStrategy,
          strategyVersion: TREND_RETEST_VERSION,
        },
        "c".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(true),
      );
      await expect(next.check()).rejects.toThrow();
      const status = await next.summary();
      expect(status.trials).toHaveLength(1);
      expect(status.reason).toBe("DEMO_TRIAL_SOURCE_DRIFT");
      expect(status.trials[0]!.state).toBe("ACTIVE");
    });

    it("enforces the same completed-candle structural prices in SQL", async () => {
      const input = trendInput();
      const context = {
        captured_at: input.capturedAt,
        tick_size: input.tickSize,
        candles: input.candles.map((f) => ({
          timeframe: f.timeframe,
          rows: f.candles.map((c) => [
            c.startTime,
            c.endTime,
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume,
            c.complete,
            c.qualityFlags,
          ]),
        })),
      };
      for (const style of [
        "BREAKOUT",
        "CONFIRMED_BREAKOUT",
        "RETEST_LIMIT",
      ] as const) {
        const geometry = trendRetestGeometry(input, style);
        if (geometry.decision === "WAIT") throw new Error(geometry.reason);
        const plan = {
          entry_side: geometry.decision,
          buy_stop: geometry.entryPrice,
          stop_loss: geometry.stopLoss,
          take_profit: geometry.takeProfit,
        };
        await pool.query(
          "SELECT validate_trend_geometry($1::jsonb,$2::jsonb,$3)",
          [plan, context, style],
        );
        await expect(
          pool.query("SELECT validate_trend_geometry($1::jsonb,$2::jsonb,$3)", [
            { ...plan, buy_stop: "4001.99" },
            context,
            style,
          ]),
        ).rejects.toThrow("TREND_GEOMETRY_MISMATCH");
      }
      const bad = structuredClone(context);
      bad.candles[0]!.rows.at(-1)![7] = false;
      await expect(
        pool.query(
          "SELECT validate_trend_geometry($1::jsonb,$2::jsonb,'RETEST_LIMIT')",
          [{}, bad],
        ),
      ).rejects.toThrow("TREND_HISTORY_INVALID");
    });

    it("rejects a successor whose source differs from its handover receipt", async () => {
      const x = await fixture(false, false, TREND_PREDECESSOR_SOURCE);
      await x.controller.tick();
      const old = (await x.controller.summary()).trials[0]!;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO demo_trial_events(trial_id,kind,details) VALUES($1,'SOURCE_HANDOVER_REQUESTED',$2)",
          [
            old.id,
            {
              fromSourceSha256: TREND_PREDECESSOR_SOURCE,
              toSourceSha256: "c".repeat(64),
              toStrategyVersion: TREND_RETEST_VERSION,
              toCatalogueSha256:
                "287a992ca3bdba0dc97d0364f0692ed5f0630194d38ca49088c572d9a2bade9f",
            },
          ],
        );
        await client.query(
          "UPDATE demo_trials SET state='DRAINING',retirement_reason='SOURCE_HANDOVER' WHERE id=$1",
          [old.id],
        );
        await client.query(
          "UPDATE demo_trials SET state='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",
          [old.id],
        );
        const next = randomUUID();
        await client.query(
          `INSERT INTO demo_trials(id,account_id,symbol_id,mode,strategy_version_id,source_sha256,catalogue_sha256,profile_id,profile_sha256,cycle,ordinal,starts_at,mode_revision,state)
          SELECT $1,t.account_id,t.symbol_id,t.mode,$2,$3,p.catalogue_sha256,p.profile_id,p.profile_sha256,t.cycle+1,0,clock_timestamp()+interval '1 second',t.mode_revision,'ACTIVE'
          FROM demo_trials t CROSS JOIN demo_trial_profiles p WHERE t.id=$4 AND p.profile_id='TREND_CONFIRMED'`,
          [next, trendStrategy, "d".repeat(64), old.id],
        );
        await expect(
          client.query(
            "UPDATE demo_trial_heads SET trial_id=$1 WHERE trial_id=$2",
            [next, old.id],
          ),
        ).rejects.toThrow("DEMO_TRIAL_HANDOVER_TARGET_INVALID");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it.each([0, 1, 3])(
      "records the complete structural profile lifecycle (slot %s)",
      async (ordinal) => {
        const x = await fixture(false, true);
        const profile = trendProfiles[ordinal === 3 ? 2 : ordinal]!;
        const id = randomUUID(),
          revision = randomUUID();
        await pool.query(
          "UPDATE entry_mode_settings SET entry_mode=$3,revision=$4 WHERE account_id=$1 AND symbol_id=$2",
          [
            x.scope.accountId,
            x.scope.symbolId,
            ordinal === 3 ? "SINGLE_LIMIT" : "SINGLE_STOP_LIMIT",
            revision,
          ],
        );
        await pool.query(
          `INSERT INTO demo_trials(id,account_id,symbol_id,mode,strategy_version_id,source_sha256,catalogue_sha256,profile_id,profile_sha256,cycle,ordinal,starts_at,mode_revision,state)
        VALUES($1,$2,$3,'demo',$4,$5,$6,$7,$8,0,$9,clock_timestamp()+interval '10 milliseconds',$10,'ACTIVE')`,
          [
            id,
            x.scope.accountId,
            x.scope.symbolId,
            trendStrategy,
            "b".repeat(64),
            trendCatalogueSha256,
            profile.id,
            profileSha256(profile),
            ordinal,
            revision,
          ],
        );
        await pool.query(
          "INSERT INTO demo_trial_heads VALUES($1,$2,'demo',$3)",
          [x.scope.accountId, x.scope.symbolId, id],
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        await x.controller.check();
        await completedTrade(x);
        const row = (await x.controller.summary()).trials[0]!;
        expect(row.closes).toBe(1);
        expect(row.entry_fill_events).toBe(1);
      },
    );

    async function fixture(
      local = false,
      trend = false,
      source = "b".repeat(64),
    ) {
      const accountId = randomUUID(),
        symbolId = randomUUID(),
        analysis = randomUUID();
      await pool.query(
        "INSERT INTO accounts(id,provider,provider_account_key_hash,environment,account_type,currency) VALUES($1,'ctrader',$2,'demo','demo','USD')",
        [accountId, randomUUID().replaceAll("-", "")],
      );
      await pool.query(
        "INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,volume_scale,metadata_revision,metadata_at) VALUES($1,$2,'7','XAUUSD',2,0.01,100,'fixture',now())",
        [symbolId, accountId],
      );
      const scope = {
        accountId,
        symbolId,
        mode: "demo",
        strategyVersionId: trend ? trendStrategy : strategy,
        ...(trend ? { strategyVersion: TREND_RETEST_VERSION } : {}),
      };
      const modes = new EntryModeStore(pool, scope);
      await modes.initialize();
      let safe = true,
        open: "OPEN" | "CLOSED" | "UNAVAILABLE" = "OPEN";
      const controller = new DemoTrials(
        pool,
        scope,
        source,
        () => Promise.resolve(open),
        () => Promise.resolve(safe),
      );
      if (local) {
        const profile = profiles[1]!,
          id = randomUUID(),
          revision = (await modes.read()).revision;
        await pool.query(
          "INSERT INTO demo_trials(id,account_id,symbol_id,mode,strategy_version_id,source_sha256,catalogue_sha256,profile_id,profile_sha256,cycle,ordinal,starts_at,mode_revision,state) VALUES($1,$2,$3,'demo',$4,$5,$6,$7,$8,0,0,clock_timestamp()+interval '10 milliseconds',$9,'ACTIVE')",
          [
            id,
            accountId,
            symbolId,
            strategy,
            "b".repeat(64),
            catalogueSha256,
            profile.id,
            profileSha256(profile),
            revision,
          ],
        );
        await pool.query(
          "INSERT INTO demo_trial_heads VALUES($1,$2,'demo',$3)",
          [accountId, symbolId, id],
        );
      }
      await pool.query(
        "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',now())",
        [analysis, accountId, symbolId, scope.strategyVersionId],
      );
      return {
        scope,
        analysis,
        controller,
        setSafe: (v: boolean) => {
          safe = v;
        },
        setUnavailable: () => {
          open = "UNAVAILABLE";
        },
        setOpen: (v: boolean) => {
          open = v ? "OPEN" : "CLOSED";
        },
      };
    }
    async function completedTrade(
      x: Awaited<ReturnType<typeof fixture>>,
      lastOpen = false,
    ) {
      const binding = x.controller.binding(),
        artifact = trialPrompt(binding),
        contextId = randomUUID(),
        analysis = randomUUID(),
        group = randomUUID(),
        order = randomUUID();
      const captured = new Date().toISOString(),
        end = Math.floor(Date.parse(captured) / 60000) * 60000;
      const rows = Array.from({ length: 5 }, (_, i) => [
        new Date(end - (5 - i) * 60000).toISOString(),
        new Date(end - (4 - i) * 60000).toISOString(),
        "4000",
        "4002",
        "3999",
        "4001",
        null,
        true,
        [],
      ]);
      const trend = binding.strategyVersion === TREND_RETEST_VERSION;
      const profile = trendProfiles.find((p) => p.id === binding.profileId);
      const structural = trendInput();
      const shift =
        end - Math.floor(Date.parse(structural.capturedAt) / 60000) * 60000;
      structural.capturedAt = captured;
      for (const frame of structural.candles)
        for (const bar of frame.candles)
          Object.assign(bar, {
            startTime: new Date(
              Date.parse(bar.startTime) + shift,
            ).toISOString(),
            endTime: new Date(Date.parse(bar.endTime) + shift).toISOString(),
          });
      Object.assign(structural.quote!, {
        sourceTime: captured,
        receivedAt: captured,
      });
      const geometry = trend
        ? trendRetestGeometry(structural, profile!.entryStyle)
        : null;
      if (geometry?.decision === "WAIT") throw new Error(geometry.reason);
      const entryPrice = geometry?.entryPrice ?? "4002.01",
        stopLoss = geometry?.stopLoss ?? "3999",
        takeProfit = geometry?.takeProfit ?? "4003.01";
      const executionPrompt = trend
        ? "trend-retest-execution-v1"
        : "demo-trial-execution-v1";
      const orderType =
        profile?.entryStyle === "RETEST_LIMIT" ? "LIMIT" : "STOP_LIMIT";
      const requestContext = trend
        ? {
            captured_at: captured,
            tick_size: "0.01",
            candles: structural.candles.map((f) => ({
              timeframe: f.timeframe,
              rows: f.candles.map((c) => [
                c.startTime,
                c.endTime,
                c.open,
                c.high,
                c.low,
                c.close,
                c.volume,
                c.complete,
                c.qualityFlags,
              ]),
            })),
          }
        : { tick_size: "0.01", candles: [{ timeframe: "M1", rows }] };
      const raw = JSON.stringify({
        decision: "BUY",
        reason: "Synthetic recorded lifecycle",
        entry_price: entryPrice,
        take_profit: takeProfit,
        stop_loss: stopLoss,
        pending_seconds: trend ? 60 : 180,
      });
      const plan = bindScalpDecision(
        raw,
        {
          analysisId: contextId,
          symbol: "XAUUSD",
          capturedAt: captured,
          tickSize: "0.01",
          observedM1End: new Date(end).toISOString(),
        },
        binding.strategyVersion,
      );
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',clock_timestamp())",
          [
            analysis,
            x.scope.accountId,
            x.scope.symbolId,
            x.scope.strategyVersionId,
          ],
        );
        await c.query(
          "INSERT INTO scenario_contexts(id,account_id,symbol_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,source_analysis_id) VALUES($1,$2,$3,'demo',clock_timestamp(),$4::timestamptz,$4::timestamptz+interval '5 minutes','REQUESTING',$6,'0.01',$5)",
          [
            contextId,
            x.scope.accountId,
            x.scope.symbolId,
            captured,
            analysis,
            trend ? "gpt-6.1-sol" : "local-range-v1",
          ],
        );
        await c.query(
          "INSERT INTO provider_prompt_artifacts(content,version) VALUES($1,$2) ON CONFLICT(content_sha256) DO NOTHING",
          [artifact.content, artifact.version],
        );
        await c.query(
          "INSERT INTO context_provider_evidence(context_id,prompt_sha256,request_text) VALUES($1,$2,$3)",
          [contextId, artifact.sha256, JSON.stringify(requestContext)],
        );
        await c.query(
          "INSERT INTO demo_trial_contexts(context_id,trial_id) VALUES($1,$2)",
          [contextId, binding.trialId],
        );
        await c.query(
          "UPDATE scenario_contexts SET state='READY',plan=$2::jsonb,valid_until=$3,available_at=clock_timestamp(),completed_at=clock_timestamp() WHERE id=$1",
          [contextId, JSON.stringify(plan), plan.valid_until],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      const r = response();
      Object.assign(r, {
        analysis_id: analysis,
        valid_until: plan.valid_until,
      });
      const trail = new PostgresDecisionTrail({
        pool,
        accountId: x.scope.accountId,
        symbolId: x.scope.symbolId,
        strategyVersionId: x.scope.strategyVersionId,
        mode: "demo",
        apiStyle: "responses",
        model: "gpt-6.1-sol",
        promptVersion: executionPrompt,
        schemaVersion: "2.1",
        payloadMode: "compact",
        instanceId: "fixture",
        environment: "test",
        persistedCandleTails: MAX_PERSISTED_CANDLE_TAILS,
      });
      const content = "Synthetic local execution fixture";
      await trail.model(
        analysis,
        {},
        r,
        JSON.stringify(r),
        {
          version: executionPrompt,
          content,
          sha256: createHash("sha256").update(content).digest("hex"),
        },
        { latencyMs: 0, retryCount: 0, contextPlanId: contextId },
      );
      const revision = (
        await pool.query<{ mode_revision: string }>(
          "SELECT mode_revision FROM demo_trials WHERE id=$1",
          [binding.trialId],
        )
      ).rows[0]!.mode_revision;
      const n = String(100000 + ++tradeCounter),
        brokerOrder = "1" + n,
        brokerPosition = "2" + n;
      const intent = await pool.connect();
      try {
        await intent.query("BEGIN");
        await intent.query(
          "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until,context_plan_id,entry_side,execution_mode,mode_revision) VALUES($1::uuid,$2,$1::text,'demo','INTENT_RECORDED',$3,'GTD',$3,$4,'BUY',$6,$5)",
          [
            group,
            analysis,
            plan.valid_until,
            contextId,
            revision,
            orderType === "LIMIT" ? "SINGLE_LIMIT" : "SINGLE_STOP_LIMIT",
          ],
        );
        await intent.query(
          "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,filled_volume,expires_at,time_in_force,submission_valid_until,execution_order_type,broker_order_id,entry_range_points) VALUES($1::uuid,$2,$3,'BUY','STOP','PENDING',$1::text,true,$4,$1::text,$7,$8,$9,100,100,0,$5,'GTD',$5,$10,$6,$11)",
          [
            order,
            x.scope.accountId,
            group,
            `ctrader-ai-scalper:${binding.strategyVersion}`,
            plan.valid_until,
            brokerOrder,
            entryPrice,
            stopLoss,
            takeProfit,
            orderType,
            orderType === "LIMIT" ? null : 30,
          ],
        );
        await intent.query("COMMIT");
      } catch (e) {
        await intent.query("ROLLBACK");
        throw e;
      } finally {
        intent.release();
      }
      const recorder = new PostgresDemoExecutionStore({
        pool,
        accountId: x.scope.accountId,
        symbolId: x.scope.symbolId,
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
      const opened = new Date().toISOString(),
        key = randomUUID();
      const entry = {
        schemaVersion: "1.1" as const,
        eventKey: key,
        payloadHash: createHash("sha256").update(key).digest("hex"),
        executionType: 3,
        clientOrderId: order,
        brokerOrderId: brokerOrder,
        brokerPositionId: brokerPosition,
        brokerFillId: "3" + n,
        brokerOrderType: orderType === "LIMIT" ? 2 : 6,
        closingOrder: false,
        order: {
          clientOrderId: order,
          brokerOrderId: brokerOrder,
          state: "FILLED" as const,
          filledVolume: "100",
          updatedAt: opened,
          reasonCode: null,
        },
        position: {
          brokerPositionId: brokerPosition,
          side: "BUY" as const,
          state: "OPEN" as const,
          volume: "100",
          entryPrice,
          stopLoss,
          takeProfit,
          openedAt: opened,
          closedAt: null,
          updatedAt: opened,
        },
        fill: {
          brokerFillId: "3" + n,
          brokerOrderId: brokerOrder,
          brokerPositionId: brokerPosition,
          price: entryPrice,
          volume: "100",
          commission: "-0.01",
          occurredAt: opened,
        },
        closeDetail: null,
        occurredAt: opened,
        receivedAt: opened,
        errorCode: null,
      };
      expect(await recorder.persist(entry)).toMatchObject({ certain: true });
      expect(
        (
          await pool.query<{ ok: boolean }>(
            "SELECT demo_trial_can_complete($1) ok",
            [binding.trialId],
          )
        ).rows[0]?.ok,
      ).toBe(false);
      const close = async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const at = new Date().toISOString(),
          k = randomUUID(),
          closeOrder = "4" + n,
          deal = "5" + n;
        expect(
          await recorder.persist({
            ...entry,
            eventKey: k,
            payloadHash: createHash("sha256").update(k).digest("hex"),
            clientOrderId: null,
            brokerOrderId: closeOrder,
            brokerFillId: deal,
            brokerOrderType: 1,
            closingOrder: true,
            order: {
              clientOrderId: "",
              brokerOrderId: closeOrder,
              state: "FILLED",
              filledVolume: "100",
              updatedAt: at,
              reasonCode: null,
            },
            position: {
              ...entry.position,
              state: "CLOSED",
              volume: "0",
              closedAt: at,
              updatedAt: at,
            },
            fill: {
              ...entry.fill,
              brokerFillId: deal,
              brokerOrderId: closeOrder,
              price: takeProfit,
              commission: "-0.02",
              occurredAt: at,
            },
            closeDetail: {
              entryPrice,
              grossProfit: "10",
              swap: "0",
              commission: "-0.02",
              pnlConversionFee: "0",
              balance: "10000",
              closedVolume: "100",
              quoteToDepositConversionRate: "1",
              balanceVersion: null,
            },
            occurredAt: at,
            receivedAt: at,
          }),
        ).toMatchObject({ certain: true });
        expect(
          (
            await pool.query<{ ok: boolean }>(
              "SELECT demo_trial_closed_group($1) ok",
              [group],
            )
          ).rows[0]?.ok,
        ).toBe(true);
      };
      if (!lastOpen) await close();
      return { close };
    }
    it("drains at20 proven synthetic closes, preserves open exposure, advances and resumes without replay", async () => {
      const x = await fixture(true);
      await new Promise((r) => setTimeout(r, 20));
      await x.controller.tick();
      const first = x.controller.binding();
      for (let i = 0; i < 19; i++) await completedTrade(x);
      const last = await completedTrade(x, true);
      await x.controller.tick();
      expect(x.controller.binding().trialId).toBe(first.trialId);
      await last.close();
      x.setSafe(false);
      await x.controller.tick();
      expect(() => x.controller.binding()).toThrow("DRAINING");
      const progress = (
        await pool.query<{ market_open_ms: string }>(
          "SELECT market_open_ms FROM demo_trials WHERE id=$1",
          [first.trialId],
        )
      ).rows[0]!.market_open_ms;
      await x.controller.tick();
      expect(
        (
          await pool.query<{ market_open_ms: string }>(
            "SELECT market_open_ms FROM demo_trials WHERE id=$1",
            [first.trialId],
          )
        ).rows[0]?.market_open_ms,
      ).toBe(progress);
      x.setSafe(true);
      await x.controller.tick();
      const summary = await x.controller.summary();
      const check = spawnSync(
        ".venv/bin/python",
        [
          "-c",
          "import sys;from python.research.demo_trial_status import TrialStatus;TrialStatus.model_validate_json(sys.stdin.buffer.read())",
        ],
        { input: JSON.stringify(summary), encoding: "utf8" },
      );
      expect(check.status, check.stderr).toBe(0);
      const rows = summary.trials;
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        state: "COMPLETED",
        closes: 20,
        entry_fill_events: 20,
        realized_net: "199.6000000000",
        review: {
          interpretation: "POSITIVE_OBSERVED_NET_UNQUALIFIED",
          closedPositions: 20,
          nextProfileId: "ENTRY_RANGE_5",
        },
      });
      await new Promise((r) => setTimeout(r, 1050));
      const restarted = new DemoTrials(
        pool,
        x.scope,
        "b".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(true),
      );
      await restarted.tick();
      expect(restarted.binding().profileId).toBe("ENTRY_RANGE_5");
      expect(restarted.binding().trialId).not.toBe(first.trialId);
    });
    it("durably records unknown-session intervals and recovery without inventing clock credit", async () => {
      const x = await fixture(true);
      await new Promise((r) => setTimeout(r, 20));
      await x.controller.tick();
      const id = x.controller.binding().trialId;
      const before = (await x.controller.summary()).trials[0]!;
      x.setUnavailable();
      await x.controller.tick();
      const unavailable = (await x.controller.summary()).trials[0]!;
      expect(unavailable.market_open_ms).toBe(before.market_open_ms);
      expect(unavailable.session_state).toBe("UNAVAILABLE");
      expect(unavailable.last_clock_receipt).toMatchObject({
        reason: "SESSION_UNAVAILABLE_STARTED",
        creditedMilliseconds: 0,
      });
      await x.controller.tick();
      expect((await x.controller.summary()).trials[0]?.clock_receipts).toBe(
        unavailable.clock_receipts,
      );
      const restart = new DemoTrials(
        pool,
        x.scope,
        "b".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(true),
      );
      await restart.tick();
      expect(restart.binding().trialId).toBe(id);
      expect(
        (await restart.summary()).trials[0]?.last_clock_receipt,
      ).toMatchObject({
        reason: "CONTROLLER_RESUMED",
        creditedMilliseconds: 0,
      });
    });
    it("registers future, resumes exact head across restart and serializes duplicates", async () => {
      const x = await fixture();
      const restarted = new DemoTrials(
        pool,
        x.scope,
        "b".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(true),
      );
      await Promise.all([x.controller.tick(), restarted.tick()]);
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM demo_trials WHERE account_id=$1",
            [x.scope.accountId],
          )
        ).rows[0]?.n,
      ).toBe(1);
      await new Promise((r) => setTimeout(r, 1050));
      await restarted.tick();
      const b = restarted.binding();
      await x.controller.tick();
      expect(x.controller.binding()).toEqual(b);
      const row = (
        await pool.query<{ registered_at: Date; starts_at: Date }>(
          "SELECT registered_at,starts_at FROM demo_trials WHERE id=$1",
          [b.trialId],
        )
      ).rows[0]!;
      expect(row.starts_at > row.registered_at).toBe(true);
      expect((await restarted.summary()).trials[0]).toMatchObject({
        entry_fill_events: 0,
        closes: 0,
        realized_net: null,
      });
    });
    it("withholds registration on uncertain reconciliation and rejects source drift", async () => {
      const x = await fixture();
      x.setSafe(false);
      await x.controller.tick();
      expect(() => x.controller.binding()).toThrow();
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int n FROM demo_trials WHERE account_id=$1",
            [x.scope.accountId],
          )
        ).rows[0]?.n,
      ).toBe(0);
      x.setSafe(true);
      await x.controller.tick();
      const changed = new DemoTrials(
        pool,
        x.scope,
        "c".repeat(64),
        () => Promise.resolve("OPEN"),
        () => Promise.resolve(true),
      );
      await changed.tick();
      expect(() => changed.binding()).toThrow("RECONCILIATION_REQUIRED");
    });
    it("does not permit early drain, clock inflation, definition edits or history deletion", async () => {
      const x = await fixture(true);
      await new Promise((r) => setTimeout(r, 20));
      await x.controller.tick();
      const b = x.controller.binding();
      for (const sql of [
        "UPDATE demo_trials SET state='DRAINING' WHERE id=$1",
        "UPDATE demo_trials SET market_open_ms=3600000 WHERE id=$1",
        "UPDATE demo_trials SET profile_id='TP_040' WHERE id=$1",
        "DELETE FROM demo_trials WHERE id=$1",
      ]) {
        await expect(pool.query(sql, [b.trialId])).rejects.toThrow();
      }
      await expect(
        pool.query(
          "UPDATE demo_trial_profiles SET definition=definition||'{\"pendingSeconds\":999}'::jsonb",
        ),
      ).rejects.toThrow("IMMUTABLE");
    });
    it.each(["contiguous", "short", "session_gap"] as const)(
      "retains exact %s input at the frozen database claim boundary without granting orders",
      async (kind) => {
        const x = await fixture(false, true);
        await x.controller.tick();
        await new Promise((resolve) => setTimeout(resolve, 1050));
        await x.controller.tick();
        const b = x.controller.binding(),
          artifact = trialPrompt(b);
        const input = trendInput();
        const captured = new Date().toISOString(),
          shift =
            Math.floor(Date.parse(captured) / 60000) * 60000 -
            Math.floor(Date.parse(input.capturedAt) / 60000) * 60000;
        input.capturedAt = captured;
        for (const frame of input.candles)
          for (const bar of frame.candles)
            Object.assign(bar, {
              startTime: new Date(
                Date.parse(bar.startTime) + shift,
              ).toISOString(),
              endTime: new Date(Date.parse(bar.endTime) + shift).toISOString(),
            });
        Object.assign(input.quote!, {
          sourceTime: captured,
          receivedAt: captured,
        });
        const frame = input.candles[2]!;
        if (kind === "short")
          Object.assign(frame, { candles: frame.candles.slice(-5) });
        if (kind === "session_gap") {
          for (const bar of frame.candles.slice(0, 6)) {
            Object.assign(bar, {
              startTime: new Date(
                Date.parse(bar.startTime) - 900_000,
              ).toISOString(),
              endTime: new Date(
                Date.parse(bar.endTime) - 900_000,
              ).toISOString(),
            });
          }
          Object.assign(frame.candles[6]!, {
            qualityFlags: ["BROKER_SESSION_GAP_BEFORE"],
          });
        }
        const before = JSON.stringify(input),
          requestText = JSON.stringify(entryProviderPayload(input));
        const id = randomUUID();
        const store = new PostgresContextStore(pool, {
          ...x.scope,
          trial: () => b,
        });
        expect(
          await store.claim({
            id,
            sourceAnalysisId: x.analysis,
            capturedAt: input.capturedAt,
            tickSize: input.tickSize,
            experiment: b,
            providerEvidence: {
              promptContent: artifact.content,
              promptVersion: artifact.version,
              requestText,
            },
          }),
        ).toBe(true);
        const saved = (
          await pool.query<{ request_text: string; request_sha256: string }>(
            "SELECT request_text,request_sha256 FROM context_provider_evidence WHERE context_id=$1",
            [id],
          )
        ).rows[0]!;
        expect(saved.request_text).toBe(requestText);
        expect(saved.request_sha256).toBe(
          createHash("sha256").update(requestText).digest("hex"),
        );
        expect(JSON.stringify(input)).toBe(before);
        expect((await store.latest())?.state).toBe("REQUESTING");
        expect(
          (
            await pool.query<{ n: string }>(
              "SELECT count(*) AS n FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id WHERE ar.account_id=$1",
              [x.scope.accountId],
            )
          ).rows[0]?.n,
        ).toBe("0");
      },
    );
    it("atomically binds exact prompt/profile before claim and preserves local identity", async () => {
      const x = await fixture(true);
      await new Promise((r) => setTimeout(r, 20));
      await x.controller.tick();
      const b = x.controller.binding();
      const store = new PostgresContextStore(pool, {
        ...x.scope,
        trial: () => b,
      });
      const artifact = trialPrompt(b);
      const claim = {
        id: randomUUID(),
        sourceAnalysisId: x.analysis,
        capturedAt: new Date().toISOString(),
        tickSize: "0.01",
        experiment: b,
        providerEvidence: {
          promptContent: artifact.content,
          promptVersion: artifact.version,
          requestText: '{"candles":[]}',
        },
      };
      await expect(
        store.claim({
          ...claim,
          experiment: { ...b, profileId: "ENTRY_CODEX" },
        }),
      ).rejects.toThrow();
      expect(await store.claim(claim)).toBe(true);
      const c = await store.latest();
      expect(c?.requestedModel).toBe("local-range-v1");
      expect((await store.summary())?.calls_24h).toBe(0);
      // Stored row is bound by database registration, not caller-supplied profile metadata.
      expect(
        (
          await pool.query<{ trial_id: string }>(
            "SELECT trial_id FROM demo_trial_contexts WHERE context_id=$1",
            [claim.id],
          )
        ).rows[0]?.trial_id,
      ).toBe(b.trialId);
      await expect(
        store.finish(claim.id, null, null, {
          requestedModel: "gpt-6.1-sol",
          returnedModel: null,
          inputProfile: "structured",
          requestBytes: 0,
          responseBytes: 0,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costAmount: null,
          costCurrency: null,
          costSource: "unavailable",
        }),
      ).rejects.toThrow("IDENTITY");
    });
    it("rejects an unregistered .10 claim and mismatched prompt binding", async () => {
      const x = await fixture(true);
      await new Promise((r) => setTimeout(r, 20));
      await x.controller.tick();
      const b = x.controller.binding(),
        artifact = trialPrompt(b);
      const store = new PostgresContextStore(pool, {
        ...x.scope,
        trial: () => b,
      });
      const claim = {
        id: randomUUID(),
        sourceAnalysisId: x.analysis,
        capturedAt: new Date().toISOString(),
        tickSize: "0.01",
        experiment: b,
        providerEvidence: {
          promptContent: artifact.content,
          promptVersion: artifact.version,
          requestText: '{"candles":[]}',
        },
      };
      await expect(
        store.claim({
          ...claim,
          providerEvidence: {
            ...claim.providerEvidence,
            promptContent: artifact.content.replace(
              b.sourceSha256,
              "c".repeat(64),
            ),
          },
        }),
      ).rejects.toThrow("LINK_INVALID");
      const { experiment: _binding, ...unbound } = claim;
      void _binding;
      await expect(
        new PostgresContextStore(pool, x.scope).claim(unbound),
      ).rejects.toThrow();
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int n FROM scenario_contexts WHERE account_id=$1",
            [x.scope.accountId],
          )
        ).rows[0]?.n,
      ).toBe(0);
    });
  },
);
