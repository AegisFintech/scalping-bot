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
      strategy = randomUUID();
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

    async function fixture(local = false) {
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
        strategyVersionId: strategy,
      };
      const modes = new EntryModeStore(pool, scope);
      await modes.initialize();
      let safe = true,
        open: "OPEN" | "CLOSED" | "UNAVAILABLE" = "OPEN";
      const controller = new DemoTrials(
        pool,
        scope,
        "b".repeat(64),
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
        [analysis, accountId, symbolId, strategy],
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
      const raw = JSON.stringify({
        decision: "BUY",
        reason: "Synthetic recorded lifecycle",
        entry_price: "4002.01",
        take_profit: "4003.01",
        stop_loss: "3999",
        pending_seconds: 180,
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
        DEMO_TRIAL_STRATEGY_VERSION,
      );
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',clock_timestamp())",
          [analysis, x.scope.accountId, x.scope.symbolId, strategy],
        );
        await c.query(
          "INSERT INTO scenario_contexts(id,account_id,symbol_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,source_analysis_id) VALUES($1,$2,$3,'demo',clock_timestamp(),$4::timestamptz,$4::timestamptz+interval '5 minutes','REQUESTING','local-range-v1','0.01',$5)",
          [contextId, x.scope.accountId, x.scope.symbolId, captured, analysis],
        );
        await c.query(
          "INSERT INTO provider_prompt_artifacts(content,version) VALUES($1,$2) ON CONFLICT(content_sha256) DO NOTHING",
          [artifact.content, artifact.version],
        );
        await c.query(
          "INSERT INTO context_provider_evidence(context_id,prompt_sha256,request_text) VALUES($1,$2,$3)",
          [
            contextId,
            artifact.sha256,
            JSON.stringify({
              tick_size: "0.01",
              candles: [{ timeframe: "M1", rows }],
            }),
          ],
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
        strategyVersionId: strategy,
        mode: "demo",
        apiStyle: "responses",
        model: "gpt-6.1-sol",
        promptVersion: "demo-trial-execution-v1",
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
          version: "demo-trial-execution-v1",
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
          "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until,context_plan_id,entry_side,execution_mode,mode_revision) VALUES($1::uuid,$2,$1::text,'demo','INTENT_RECORDED',$3,'GTD',$3,$4,'BUY','SINGLE_STOP_LIMIT',$5)",
          [group, analysis, plan.valid_until, contextId, revision],
        );
        await intent.query(
          "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,filled_volume,expires_at,time_in_force,submission_valid_until,execution_order_type,broker_order_id,entry_range_points) VALUES($1::uuid,$2,$3,'BUY','STOP','PENDING',$1::text,true,$4,$1::text,4002.01,3999,4003.01,100,100,0,$5,'GTD',$5,'STOP_LIMIT',$6,30)",
          [
            order,
            x.scope.accountId,
            group,
            `ctrader-ai-scalper:${DEMO_TRIAL_STRATEGY_VERSION}`,
            plan.valid_until,
            brokerOrder,
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
        brokerOrderType: 6,
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
          entryPrice: "4002.01",
          stopLoss: "3999",
          takeProfit: "4003.01",
          openedAt: opened,
          closedAt: null,
          updatedAt: opened,
        },
        fill: {
          brokerFillId: "3" + n,
          brokerOrderId: brokerOrder,
          brokerPositionId: brokerPosition,
          price: "4002.01",
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
              price: "4003.01",
              commission: "-0.02",
              occurredAt: at,
            },
            closeDetail: {
              entryPrice: "4002.01",
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
