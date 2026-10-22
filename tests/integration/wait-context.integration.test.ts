import { randomUUID } from "node:crypto";
import path from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { PostgresContextStore } from "../../apps/execution-service/src/scenario-context.js";
import { FIXED_DEFAULTS } from "../../packages/config/src/policy.js";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "durable WAIT reconsideration (no broker)",
  () => {
    let admin: pg.Pool, pool: pg.Pool;
    const schema = `wait_${randomUUID().replaceAll("-", "")}`;
    beforeAll(async () => {
      admin = createPool({ connectionString: url! });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const scoped = new URL(url!);
      scoped.searchParams.set("options", `-csearch_path=${schema}`);
      pool = createPool({ connectionString: scoped.toString() });
      await migrate(pool, path.resolve("migrations"));
    }, 60000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function fixture(age = 70) {
      const accountId = randomUUID(),
        symbolId = randomUUID(),
        strategyId = randomUUID(),
        analysisId = randomUUID();
      await pool.query(
        "INSERT INTO accounts(id,provider_account_key_hash,environment,account_type,currency) VALUES($1,$2,'demo','demo','USD')",
        [accountId, accountId.replaceAll("-", "")],
      );
      await pool.query(
        "INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,volume_scale,metadata_revision,metadata_at) VALUES($1,$2,'7','XAUUSD',2,0.01,100,'fixture',now())",
        [symbolId, accountId],
      );
      await pool.query(
        "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1::uuid,$1::text,'fixture','fixture','entry-pair-v7','2.1','1.0')",
        [strategyId],
      );
      await pool.query(
        "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',now())",
        [analysisId, accountId, symbolId, strategyId],
      );
      const scope = { accountId, symbolId, mode: "demo" },
        store = new PostgresContextStore(pool, scope);
      const prompt = "wait fixture",
        captured = new Date(Date.now() - 100_000).toISOString(),
        id = randomUUID();
      const end = new Date(
        Math.floor(Date.parse(captured) / 60000) * 60000,
      ).toISOString();
      const plan = {
        schema_version: "entry-wait-1.0",
        analysis_id: id,
        symbol: "XAUUSD",
        captured_at: captured,
        valid_until: new Date(Date.parse(captured) + 300000).toISOString(),
        observed_m1_end: end,
        reason: "Wait for clearer structure",
      };
      const claim = (
        m1 = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
        afterWait = true,
      ) => ({
        id: randomUUID(),
        sourceAnalysisId: analysisId,
        capturedAt: new Date().toISOString(),
        tickSize: "0.01",
        completedM1End: m1,
        ...(afterWait ? { afterWaitContextId: id } : {}),
        providerEvidence: {
          promptContent: prompt,
          promptVersion: "entry-pair-v7",
          requestText: '{"candles":[]}',
        },
      });
      expect(
        await store.claim({
          ...claim(undefined, false),
          id,
          capturedAt: captured,
        }),
      ).toBe(true);
      await pool.query(
        "UPDATE scenario_contexts SET requested_at=clock_timestamp()-interval '100 seconds',state='READY',plan=$2::jsonb,available_at=clock_timestamp()-($3::text||' seconds')::interval,completed_at=clock_timestamp()-($3::text||' seconds')::interval WHERE id=$1",
        [id, JSON.stringify(plan), age],
      );
      return { scope, store, claim, id, end, analysisId };
    }
    it("allows exactly one fresh M1 reconsideration across concurrent restarted stores", async () => {
      const x = await fixture();
      const results = await Promise.all([
        x.store.claim(x.claim()),
        new PostgresContextStore(pool, x.scope).claim(x.claim()),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });
    it.each(["too_soon", "same_m1", "prompt", "unknown", "failed", "active"])(
      "withholds: %s",
      async (fault) => {
        const x = await fixture(fault === "too_soon" ? 59 : 70),
          claim = x.claim();
        if (fault === "same_m1") claim.completedM1End = x.end;
        if (fault === "prompt")
          claim.providerEvidence.promptContent = "different prompt";
        if (fault === "unknown" || fault === "failed") {
          await pool.query(
            "INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,reason) VALUES($1,$2,$3,$4,'demo',statement_timestamp()-interval '120 seconds',statement_timestamp()-interval '120 seconds',statement_timestamp()+interval '180 seconds',$5,$6,'0.01',$7)",
            [
              randomUUID(),
              x.scope.accountId,
              x.scope.symbolId,
              x.analysisId,
              fault === "unknown" ? "REQUESTING" : "FAILED",
              FIXED_DEFAULTS.AI_MODEL,
              fault === "unknown" ? null : "SCENARIO_REFRESH_FAILED",
            ],
          );
        }
        if (fault === "active")
          await pool.query(
            "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at) VALUES($1::uuid,$2::uuid,$1::text,'demo','ACTIVE',now()+interval '1 hour')",
            [randomUUID(), x.analysisId],
          );
        expect(await x.store.claim(claim)).toBe(false);
      },
    );
    it("does not inherit a prior successful context's five-minute wait", async () => {
      const x = await fixture();
      await pool.query(
        `INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,plan,available_at)
         VALUES($1,$2,$3,$4,'demo',statement_timestamp()-interval '150 seconds',
           statement_timestamp()-interval '150 seconds',statement_timestamp()+interval '150 seconds',
           'READY',$5,'0.01','{"schema_version":"entry-pair-1.0"}'::jsonb,statement_timestamp()-interval '140 seconds')`,
        [
          randomUUID(),
          x.scope.accountId,
          x.scope.symbolId,
          x.analysisId,
          FIXED_DEFAULTS.AI_MODEL,
        ],
      );
      expect(await x.store.claim(x.claim())).toBe(true);
      const next = await x.store.latest();
      expect(next?.state).toBe("REQUESTING");
      expect(
        (
          await pool.query<{ refresh_after_wait_context_id: string }>(
            "SELECT refresh_after_wait_context_id FROM scenario_contexts WHERE id=$1",
            [next?.id],
          )
        ).rows[0]?.refresh_after_wait_context_id,
      ).toBe(x.id);
    });
    it("database refuses any order intent linked to WAIT", async () => {
      const x = await fixture();
      await expect(
        pool.query(
          "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,context_plan_id) VALUES($1::uuid,$2::uuid,$1::text,'demo','INTENT_RECORDED',now()+interval '1 hour',$3)",
          [randomUUID(), x.analysisId, x.id],
        ),
      ).rejects.toThrow("WAIT_CONTEXT_HAS_NO_EXECUTION_AUTHORITY");
    });
  },
);
