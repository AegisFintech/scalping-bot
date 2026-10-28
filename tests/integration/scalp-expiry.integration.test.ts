import type { ExecutionGateway } from "../../packages/contracts/src/index.js";
import { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import { PostgresDemoExecutionStore } from "../../apps/execution-service/src/demo-execution-store.js";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { PostgresContextStore } from "../../apps/execution-service/src/scenario-context.js";
import { EntryModeStore } from "../../apps/execution-service/src/entry-mode-store.js";
import { bindScalpDecision } from "../../packages/scenario-engine/src/scalp-entry.js";
import {
  CODEX_STRATEGY_VERSION,
  CODEX_ENTRY_MODEL,
} from "../../packages/config/src/policy.js";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "single scalp GTD authority and durable refresh (no broker)",
  () => {
    const schema = `scalp_${randomUUID().replaceAll("-", "")}`;
    let admin: pg.Pool, pool: pg.Pool;
    const strategy = randomUUID();
    beforeAll(async () => {
      admin = createPool({ connectionString: url! });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const scoped = new URL(url!);
      scoped.searchParams.set("options", `-csearch_path=${schema}`);
      pool = createPool({ connectionString: scoped.toString() });
      await migrate(pool, path.resolve("migrations"));
      await pool.query(
        "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1,$2,'fixture','fixture','entry-scalp-execution-v1','2.1','1.1')",
        [strategy, CODEX_STRATEGY_VERSION],
      );
    }, 60000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function fixture() {
      const account = randomUUID(),
        symbol = randomUUID(),
        analysis = randomUUID(),
        id = randomUUID();
      await pool.query(
        "INSERT INTO accounts(id,provider,provider_account_key_hash,environment,account_type,currency) VALUES($1,'ctrader',$2,'demo','demo','USD')",
        [account, randomUUID().replaceAll("-", "")],
      );
      await pool.query(
        "INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,volume_scale,metadata_revision,metadata_at) VALUES($1,$2,'7','XAUUSD',2,0.01,0.01,'fixture',now())",
        [symbol, account],
      );
      await pool.query(
        "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',now())",
        [analysis, account, symbol, strategy],
      );
      const scope = { accountId: account, symbolId: symbol, mode: "demo" };
      const store = new PostgresContextStore(pool, scope),
        modes = new EntryModeStore(pool, scope);
      await modes.initialize();
      const selection = await modes.readForAdmission();
      const captured = new Date().toISOString();
      const plan = bindScalpDecision(
        JSON.stringify({
          decision: "BUY",
          reason: "Fixture trend",
          entry_price: "4002",
          take_profit: "4002.4",
          stop_loss: "3995",
          pending_seconds: 120,
        }),
        {
          analysisId: id,
          symbol: "XAUUSD",
          capturedAt: captured,
          tickSize: "0.01",
          observedM1End: new Date(
            Math.floor(Date.parse(captured) / 60000) * 60000,
          ).toISOString(),
        },
      );
      if (plan.schema_version !== "entry-scalp-1.0")
        throw Error("SCALP_REQUIRED");
      const evidence = {
        promptContent: "scalp fixture",
        promptVersion: "entry-scalp-v1",
        requestText: "{}",
      };
      expect(
        await store.claim({
          id,
          sourceAnalysisId: analysis,
          capturedAt: captured,
          tickSize: "0.01",
          providerEvidence: evidence,
        }),
      ).toBe(true);
      await store.finish(
        id,
        {
          response: plan,
          rawResponse: "{}",
          latencyMs: 1,
          retryCount: 0,
          model: CODEX_ENTRY_MODEL,
          promptArtifact: {
            version: "entry-scalp-v1",
            content: evidence.promptContent,
            sha256: createHash("sha256")
              .update(evidence.promptContent)
              .digest("hex"),
          },
          telemetry: {
            requestedModel: CODEX_ENTRY_MODEL,
            returnedModel: null,
            inputProfile: "structured",
            requestBytes: 2,
            responseBytes: 2,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            costAmount: null,
            costCurrency: null,
            costSource: "unavailable",
          },
        },
        null,
      );
      const claim = () => ({
        id: randomUUID(),
        sourceAnalysisId: analysis,
        capturedAt: new Date().toISOString(),
        tickSize: "0.01",
        afterContextId: id,
        providerEvidence: evidence,
      });
      const group = randomUUID(),
        order = randomUUID();
      async function intent(
        mode = "SINGLE_STOP_LIMIT",
        tif = "GTD",
        target = "4002.4",
        side = "BUY",
      ) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until,context_plan_id,entry_side,execution_mode,mode_revision) VALUES($1::uuid,$2::uuid,$1::text,'demo','INTENT_RECORDED',$3,$4,$3,$5,$6,$7,$8)",
            [
              group,
              analysis,
              plan.valid_until,
              tif,
              id,
              side,
              mode,
              selection.revision,
            ],
          );
          await client.query(
            "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,filled_volume,expires_at,time_in_force,submission_valid_until,execution_order_type,broker_order_id) VALUES($1::uuid,$2,$3,$4,'STOP','PENDING',$1::text,true,'fixture',$1::text,4002,3995,$5,100,100,0,$6,$7,$6,'STOP_LIMIT','entry-fixture')",
            [order, account, group, side, target, plan.valid_until, tif],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      let openedAt: string | null = null;
      async function observe(partial: boolean, volume = "0") {
        const key = randomUUID(),
          timestamp = new Date().toISOString();
        if (partial) openedAt = timestamp;
        return new PostgresDemoExecutionStore({
          pool,
          accountId: account,
          symbolId: symbol,
        }).persist({
          schemaVersion: "1.1",
          eventKey: key,
          payloadHash: createHash("sha256").update(key).digest("hex"),
          executionType: partial ? 11 : 6,
          clientOrderId: order,
          brokerOrderId: "entry-fixture",
          brokerPositionId: volume === "0" ? null : "position-fixture",
          brokerFillId: partial ? "fill-fixture" : null,
          brokerOrderType: 6,
          closingOrder: false,
          order: {
            clientOrderId: order,
            brokerOrderId: "entry-fixture",
            state: partial ? "PARTIALLY_FILLED" : "EXPIRED",
            filledVolume: volume,
            updatedAt: timestamp,
            reasonCode: null,
          },
          position:
            volume === "0"
              ? null
              : {
                  brokerPositionId: "position-fixture",
                  side: "BUY",
                  state: "OPEN",
                  volume,
                  entryPrice: "4002",
                  stopLoss: "3995",
                  takeProfit: "4002.4",
                  openedAt,
                  closedAt: null,
                  updatedAt: timestamp,
                },
          fill: partial
            ? {
                brokerFillId: "fill-fixture",
                brokerOrderId: "entry-fixture",
                brokerPositionId: "position-fixture",
                price: "4002",
                volume,
                commission: "-0.01",
                occurredAt: timestamp,
              }
            : null,
          closeDetail: null,
          occurredAt: timestamp,
          receivedAt: timestamp,
          errorCode: null,
        });
      }
      async function expire(withEvent = true, volume = "0") {
        if (withEvent) {
          await observe(false, volume);
          return;
        }
        await pool.query("UPDATE orders SET state='EXPIRED' WHERE id=$1", [
          order,
        ]);
        await pool.query(
          "UPDATE order_groups SET state='EXPIRED',cancellation_reason='ANALYSIS_EXPIRED',updated_at=clock_timestamp() WHERE id=$1",
          [group],
        );
      }
      const partial = () => observe(true, "1");
      return {
        account,
        symbol,
        analysis,
        id,
        plan,
        store,
        claim,
        scope,
        intent,
        expire,
        partial,
        order,
        group,
      };
    }
    it("narrows durable context lifetime and creates exactly one protected GTD intent", async () => {
      const x = await fixture();
      await x.intent();
      const row = await pool.query<{ valid_until: Date }>(
        "SELECT valid_until FROM scenario_contexts WHERE id=$1",
        [x.id],
      );
      expect(row.rows[0]!.valid_until.toISOString()).toBe(x.plan.valid_until);
      expect(await x.store.claim(x.claim())).toBe(false);
    });
    it.each([
      ["OCO_STOP_LIMIT", "GTD", "4002.4", "BUY"],
      ["SINGLE_STOP_LIMIT", "GTC", "4002.4", "BUY"],
      ["SINGLE_STOP_LIMIT", "GTD", "4002.5", "BUY"],
      ["SINGLE_STOP_LIMIT", "GTD", "4002.4", "SELL"],
    ])(
      "rejects altered authority %s/%s/%s/%s",
      async (mode, tif, target, side) => {
        const x = await fixture();
        await expect(x.intent(mode, tif, target, side)).rejects.toThrow();
      },
    );
    it("grants one refresh only after exact terminal evidence across restart/concurrency", async () => {
      const missing = await fixture();
      await missing.intent();
      await missing.expire(false);
      expect(await missing.store.claim(missing.claim())).toBe(false);
      const x = await fixture();
      await x.intent();
      await x.expire();
      const group = await pool.query(
        "SELECT state,cancellation_reason FROM order_groups WHERE id=$1",
        [x.group],
      );
      expect(group.rows[0]).toMatchObject({
        state: "EXPIRED",
        cancellation_reason: null,
      });
      const results = await Promise.all([
        x.store.claim(x.claim()),
        new PostgresContextStore(pool, x.scope).claim(x.claim()),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });
    it("withholds refresh when a fill races expiry", async () => {
      const x = await fixture();
      await x.intent();
      await x.partial();
      await x.expire(true, "1");
      const positions = await pool.query<{ state: string; volume: string }>(
        "SELECT state,volume::text FROM positions WHERE order_group_id=$1",
        [x.group],
      );
      expect(positions.rows).toHaveLength(1);
      expect(positions.rows[0]!.state).toBe("OPEN");
      expect(await x.store.claim(x.claim())).toBe(false);
    });
    it("preserves an accepted historical GTC/OCO pair when the new single profile is selected", async () => {
      const x = await fixture(),
        modes = new EntryModeStore(pool, x.scope);
      const original = await modes.read();
      const oldSelection = await modes.select({
        mode: "OCO_STOP_LIMIT",
        expectedRevision: original.revision,
        actor: "fixture",
        reason: "Historical fixture",
      });
      const strategyId = randomUUID(),
        analysisId = randomUUID(),
        contextId = randomUUID(),
        group = randomUUID();
      await pool.query(
        "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1,$2,'fixture','fixture','entry-quick-oco-execution-v4','2.1','1.1')",
        [strategyId, `historical-${strategyId}`],
      );
      await pool.query(
        "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','DEFERRED',now())",
        [analysisId, x.account, x.symbol, strategyId],
      );
      const captured = new Date().toISOString(),
        until = new Date(Date.parse(captured) + 300000).toISOString();
      const plan = {
        schema_version: "entry-modes-1.0",
        analysis_id: contextId,
        symbol: "XAUUSD",
        captured_at: captured,
        valid_until: until,
        buy_stop: "4002",
        sell_stop: "3995",
        entry_side: "BUY",
        reason: "Historical range",
      };
      await pool.query(
        "INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,valid_until,available_at,state,requested_model,tick_size,plan) VALUES($1,$2,$3,$4,'demo',clock_timestamp(),$5,$6,clock_timestamp(),'READY',$7,'0.01',$8::jsonb)",
        [
          contextId,
          x.account,
          x.symbol,
          analysisId,
          captured,
          until,
          CODEX_ENTRY_MODEL,
          JSON.stringify(plan),
        ],
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until,context_plan_id,execution_mode,mode_revision) VALUES($1::uuid,$2,$1::text,'demo','ACTIVE',NULL,'GTC',$3,$4,'OCO_STOP_LIMIT',$5)",
          [group, analysisId, until, contextId, oldSelection.revision],
        );
        for (const [side, entry, stop, target] of [
          ["BUY", "4002", "3995", "4002.4"],
          ["SELL", "3995", "4002", "3994.6"],
        ]) {
          const id = randomUUID();
          await client.query(
            "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,filled_volume,expires_at,time_in_force,submission_valid_until,execution_order_type) VALUES($1::uuid,$2,$3,$4,'STOP','PENDING',$1::text,true,'fixture',$1::text,$5,$6,$7,100,100,0,NULL,'GTC',$8,'STOP_LIMIT')",
            [id, x.account, group, side, entry, stop, target, until],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const selected = await modes.select({
        mode: "SINGLE_STOP_LIMIT",
        expectedRevision: oldSelection.revision,
        actor: "fixture",
        reason: "New scoped release",
      });
      expect(selected.revision).not.toBe(oldSelection.revision);
      const cancel = vi
        .fn()
        .mockRejectedValue(new Error("Unexpected cancellation"));
      await new OrderMaintenance(
        pool,
        { cancel } as unknown as ExecutionGateway,
        "XAUUSD",
        x.scope,
      ).expireAndReconcile();
      expect(cancel).not.toHaveBeenCalled();
      const prior = await pool.query(
        "SELECT execution_mode,mode_revision,time_in_force,expires_at FROM order_groups WHERE id=$1",
        [group],
      );
      expect(prior.rows[0]).toMatchObject({
        execution_mode: "OCO_STOP_LIMIT",
        mode_revision: oldSelection.revision,
        time_in_force: "GTC",
        expires_at: null,
      });
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int n FROM orders WHERE order_group_id=$1 AND state='PENDING' AND time_in_force='GTC' AND expires_at IS NULL",
            [group],
          )
        ).rows[0]!.n,
      ).toBe(2);
    });
  },
);
