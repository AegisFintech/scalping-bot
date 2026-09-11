import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { PostgresContextStore } from "../../apps/execution-service/src/scenario-context.js";
import { bindEntryPrices } from "../../packages/scenario-engine/src/entry-plan.js";
import type { EntryRetirementEvidence } from "../../packages/contracts/src/index.js";
import { usageTelemetry } from "../../packages/ai-client/src/telemetry.js";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite(
  "entry replacement claims (isolated PostgreSQL, no broker authority)",
  () => {
    const schema = `entry_recovery_${randomUUID().replaceAll("-", "")}`;
    let admin: pg.Pool;
    let pool: pg.Pool;
    beforeAll(async () => {
      admin = createPool({ connectionString: connectionString! });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(connectionString!);
      url.searchParams.set("options", `-csearch_path=${schema}`);
      pool = createPool({ connectionString: url.toString() });
      await migrate(pool, path.resolve("migrations"));
    }, 60000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function setup() {
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
        "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1::uuid,$1::text,'fixture','fixture','entry-pair-v3','2.1','1.0')",
        [strategyId],
      );
      await pool.query(
        "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',now())",
        [analysisId, accountId, symbolId, strategyId],
      );
      const scope = { accountId, symbolId, mode: "demo" };
      const store = new PostgresContextStore(pool, scope);
      const claim = (afterEntryContextId?: string) => ({
        id: randomUUID(),
        sourceAnalysisId: analysisId,
        capturedAt: new Date().toISOString(),
        tickSize: "0.01",
        ...(afterEntryContextId ? { afterEntryContextId } : {}),
        providerEvidence: {
          requestText: '{"candles":[]}',
          promptContent: "entry recovery fixture",
          promptVersion: "entry-pair-v3",
        },
      });
      async function finish(id: string) {
        const row = (
          await pool.query(
            "SELECT captured_at FROM scenario_contexts WHERE id=$1",
            [id],
          )
        ).rows[0] as { captured_at: Date };
        const plan = bindEntryPrices(
          '{"buy_stop":"4351","sell_stop":"4349.44"}',
          {
            analysisId: id,
            symbol: "XAUUSD",
            capturedAt: row.captured_at.toISOString(),
            tickSize: "0.01",
          },
        );
        await store.finish(
          id,
          {
            model: "deepseek-v4-pro/u5W",
            response: plan,
            rawResponse: JSON.stringify(plan),
            latencyMs: 1,
            retryCount: 0,
            promptArtifact: {
              version: "entry-pair-v3",
              content: "fixture",
              sha256: "a".repeat(64),
            },
            telemetry: {
              requestedModel: "deepseek-v4-pro/u5W",
              returnedModel: "deepseek-v4-pro",
              inputProfile: "structured",
              requestBytes: 100,
              responseBytes: 100,
              ...usageTelemetry({}),
            },
          },
          null,
        );
      }
      function evidence(): EntryRetirementEvidence {
        const at = new Date().toISOString();
        return {
          schemaVersion: "1.0",
          phase: "LOCAL_REUSE",
          observedAt: at,
          quote: {
            bid: "4355.23",
            ask: "4355.32",
            sourceTime: at,
            receivedAt: at,
          },
          tickSize: "0.01",
          minimumEntryDistance: "0.01",
          buyStop: "4351",
          sellStop: "4349.44",
          reasonCodes: ["BUY_ENTRY_TOO_CLOSE"],
        };
      }
      const root = claim();
      expect(await store.claim(root)).toBe(true);
      await finish(root.id);
      const intent = async (contextId: string | null = root.id) =>
        pool.query(
          "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,context_plan_id) VALUES($1::uuid,$2,$1::text,'demo','INTENT_RECORDED',now()+interval '3 minutes',$3)",
          [randomUUID(), analysisId, contextId],
        );
      return {
        store,
        scope,
        root,
        claim,
        finish,
        evidence,
        intent,
        analysisId,
      };
    }
    it("allows exactly one immediate replacement across concurrent processes and restarts", async () => {
      const x = await setup();
      const original = (
        await pool.query(
          "SELECT plan,telemetry FROM scenario_contexts WHERE id=$1",
          [x.root.id],
        )
      ).rows;
      expect(await x.store.retireEntries(x.root.id, x.evidence())).toBe(true);
      const results = await Promise.all([
        x.store.claim(x.claim(x.root.id)),
        new PostgresContextStore(pool, x.scope).claim(x.claim(x.root.id)),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const child = await new PostgresContextStore(pool, x.scope).latest();
      expect(child?.refreshAfterEntryContextId).toBe(x.root.id);
      await x.finish(child!.id);
      expect(await x.store.retireEntries(child!.id, x.evidence())).toBe(true);
      expect(
        await new PostgresContextStore(pool, x.scope).claim(x.claim(child!.id)),
      ).toBe(false);
      expect(await x.store.claim(x.claim())).toBe(false);
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
      expect(
        (
          await pool.query(
            "SELECT plan,telemetry FROM scenario_contexts WHERE id=$1",
            [x.root.id],
          )
        ).rows,
      ).toEqual(original);
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM scenario_contexts WHERE account_id=$1",
            [x.scope.accountId],
          )
        ).rows[0]?.n,
      ).toBe(2);
    });
    it("keeps the first retirement evidence on duplicate observations", async () => {
      const x = await setup();
      const first = x.evidence();
      expect(await x.store.retireEntries(x.root.id, first)).toBe(true);
      expect(
        await x.store.retireEntries(x.root.id, {
          ...x.evidence(),
          phase: "PRE_PLACEMENT",
        }),
      ).toBe(true);
      expect(
        (
          await pool.query<{ evidence: EntryRetirementEvidence }>(
            "SELECT evidence FROM context_entry_retirements WHERE context_id=$1",
            [x.root.id],
          )
        ).rows[0]?.evidence,
      ).toEqual(first);
    });
    it("never retires or refreshes a consumed pair, including uncertain intent", async () => {
      const x = await setup();
      await x.intent();
      expect(await x.store.retireEntries(x.root.id, x.evidence())).toBe(false);
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
      await expect(
        pool.query(
          "INSERT INTO context_entry_retirements(context_id,evidence) VALUES($1,$2)",
          [x.root.id, JSON.stringify(x.evidence())],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    });
    it("prevents an older worker from placing a retired map", async () => {
      const x = await setup();
      await x.store.retireEntries(x.root.id, x.evidence());
      await expect(x.intent()).rejects.toMatchObject({ code: "P0001" });
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM order_groups WHERE analysis_id=$1",
            [x.analysisId],
          )
        ).rows[0]?.n,
      ).toBe(0);
    });
    it("serializes retirement against an intent already holding the context row", async () => {
      const x = await setup();
      const client = await pool.connect();
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM scenario_contexts WHERE id=$1 FOR UPDATE",
        [x.root.id],
      );
      const retirement = x.store.retireEntries(x.root.id, x.evidence());
      try {
        await client.query(
          "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,context_plan_id) VALUES($1::uuid,$2,$1::text,'demo','INTENT_RECORDED',now()+interval '3 minutes',$3)",
          [randomUUID(), x.analysisId, x.root.id],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      expect(await retirement).toBe(false);
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
    });
    it.each(["REQUESTING", "FAILED_TIMEOUT", "FAILED_UNKNOWN"])(
      "cannot bypass another recent %s provider outcome",
      async (kind) => {
        const x = await setup();
        await x.store.retireEntries(x.root.id, x.evidence());
        await pool.query(
          `INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,reason)
      SELECT $1,account_id,symbol_id,source_analysis_id,mode,requested_at-interval '1 second',captured_at-interval '1 second',valid_until-interval '1 second',$3,requested_model,tick_size,$4 FROM scenario_contexts WHERE id=$2`,
          [
            randomUUID(),
            x.root.id,
            kind === "REQUESTING" ? "REQUESTING" : "FAILED",
            kind === "FAILED_TIMEOUT" ? "AI_PROVIDER_TIMEOUT" : null,
          ],
        );
        expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
      },
    );
    it("retains the full cooldown when the immediate replacement times out", async () => {
      const x = await setup();
      await x.store.retireEntries(x.root.id, x.evidence());
      const child = x.claim(x.root.id);
      expect(await x.store.claim(child)).toBe(true);
      await x.store.finish(child.id, null, "AI_PROVIDER_TIMEOUT");
      expect(
        await new PostgresContextStore(pool, x.scope).claim(x.claim()),
      ).toBe(false);
      expect(await x.store.claim(x.claim(child.id))).toBe(false);
    });
    it("blocks a replacement when another group is active or a newer request exists", async () => {
      const x = await setup();
      await x.store.retireEntries(x.root.id, x.evidence());
      await x.intent(null);
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
    });
    it.each([
      "wrong-account",
      "wrong-symbol",
      "wrong-mode",
      "wrong-price",
      "wrong-tick",
    ])("rejects %s retirement evidence", async (kind) => {
      const x = await setup();
      const scope = { ...x.scope };
      const e = x.evidence();
      if (kind === "wrong-account") scope.accountId = randomUUID();
      if (kind === "wrong-symbol") scope.symbolId = randomUUID();
      if (kind === "wrong-mode") scope.mode = "shadow";
      expect(
        await new PostgresContextStore(pool, scope).retireEntries(x.root.id, {
          ...e,
          ...(kind === "wrong-price" ? { buyStop: "4350" } : {}),
          ...(kind === "wrong-tick" ? { tickSize: "0.001" } : {}),
        }),
      ).toBe(false);
    });
    it.each([
      "stale",
      "future",
      "extra-reason",
      "no-price-failure",
      "invalid-schema",
    ])("does not create an exception for %s evidence", async (kind) => {
      const x = await setup();
      const e = x.evidence();
      const patch =
        kind === "stale"
          ? { observedAt: new Date(Date.now() - 4000).toISOString() }
          : kind === "future"
            ? { observedAt: new Date(Date.now() + 4000).toISOString() }
            : kind === "extra-reason"
              ? { reasonCodes: ["BUY_ENTRY_TOO_CLOSE", "QUOTE_STALE"] }
              : kind === "no-price-failure"
                ? { buyStop: "4356" }
                : { schemaVersion: "other" };
      await expect(
        x.store.retireEntries(x.root.id, {
          ...e,
          ...patch,
        } as EntryRetirementEvidence),
      ).rejects.toThrow("SCENARIO_ENTRY_RETIREMENT_INVALID");
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
    });
    it("returns to ordinary admission after cooldown without chaining old retirement", async () => {
      const x = await setup();
      await x.store.retireEntries(x.root.id, x.evidence());
      await pool.query(
        "UPDATE scenario_contexts SET requested_at=requested_at-interval '6 minutes' WHERE id=$1",
        [x.root.id],
      );
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
      expect(await x.store.claim(x.claim())).toBe(true);
      expect((await x.store.latest())?.refreshAfterEntryContextId).toBeNull();
    });
    it("does not grant an exception solely because a plan is readable or a request failed", async () => {
      const x = await setup();
      expect(await x.store.claim(x.claim(x.root.id))).toBe(false);
      await pool.query(
        "UPDATE scenario_contexts SET state='FAILED',available_at=NULL,plan=NULL,reason='AI_PROVIDER_TIMEOUT' WHERE id=$1",
        [x.root.id],
      );
      expect(await x.store.retireEntries(x.root.id, x.evidence())).toBe(false);
    });
  },
);
