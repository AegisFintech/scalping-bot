import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import type { ExecutionGateway } from "../../packages/contracts/src/index.js";
import { OrderMaintenance } from "../../apps/execution-service/src/order-maintenance.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPool, migrate } from "../../packages/database/src/index.js";
import {
  recoverPredispatchIncident,
  type BrokerObservation,
} from "../../apps/execution-service/src/predispatch-incident-store.js";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("historical pre-dispatch recovery", () => {
  const schema = `predispatch_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Pool, pool: pg.Pool;
  const strategy = randomUUID();
  const receipt = () =>
    readFile(path.resolve("tests/fixtures/predispatch-incident-receipt.json"));
  const activation = () =>
    readFile(
      path.resolve("tests/fixtures/predispatch-activation-receipt.json"),
    );
  const broker = (anchorEventId: string): BrokerObservation => {
    const now = new Date().toISOString();
    return {
      from: "2026-10-28T23:11:11.329Z",
      until: now,
      observedAt: now,
      orders: 0,
      deals: 0,
      ordersHasMore: false,
      dealsHasMore: false,
      openOrders: 0,
      openPositions: 0,
      digest: "a".repeat(64),
      accountBound: true,
      anchorDigest: "b".repeat(64),
      anchorEventId,
    };
  };
  beforeAll(async () => {
    admin = createPool({ connectionString: url! });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(url!);
    scoped.searchParams.set("options", `-csearch_path=${schema}`);
    pool = createPool({ connectionString: scoped.toString() });
    await migrate(pool, path.resolve("migrations"));
    await pool.query(
      "INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,schema_version,feature_version) VALUES($1,'0.8.0-model-scalp.1-codex.1','fixture','fixture','entry-scalp-v1','2.1','1.1')",
      [strategy],
    );
  }, 60000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
  async function fixture(intentGroupMismatch = false) {
    const account = randomUUID(),
      symbol = randomUUID(),
      analysis = randomUUID(),
      context = randomUUID(),
      group = randomUUID(),
      order = randomUUID(),
      revision = randomUUID(),
      actor = randomUUID();
    await pool.query(
      "INSERT INTO accounts(id,provider,provider_account_key_hash,environment,account_type,currency) VALUES($1,'ctrader',$2,'demo','demo','USD')",
      [account, randomUUID().replaceAll("-", "")],
    );
    await pool.query(
      "INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,volume_scale,metadata_revision,metadata_at) VALUES($1,$2,'7','XAUUSD',2,0.01,0.01,'fixture',now())",
      [symbol, account],
    );
    await pool.query(
      "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','REJECTED','2026-10-28T23:16:08Z')",
      [analysis, account, symbol, strategy],
    );
    const captured = "2026-10-28T23:15:51.558Z",
      expiry = "2026-10-28T23:17:51.558Z";
    const plan = {
      schema_version: "entry-scalp-1.0",
      analysis_id: context,
      captured_at: captured,
      valid_until: expiry,
      pending_seconds: 120,
      entry_side: "BUY",
      buy_stop: "4002",
      stop_loss: "3995",
      take_profit: "4002.4",
    };
    await pool.query(
      "INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,valid_until,available_at,completed_at,state,requested_model,tick_size,plan) VALUES($1,$2,$3,$4,'demo',$5,$5,$6,$5,$5,'READY','gpt-6.1-sol','0.01',$7::jsonb)",
      [
        context,
        account,
        symbol,
        analysis,
        captured,
        expiry,
        JSON.stringify(plan),
      ],
    );
    await pool.query(
      "INSERT INTO entry_mode_settings(account_id,symbol_id,environment,entry_mode,revision,actor,reason) VALUES($1,$2,'demo','SINGLE_STOP_LIMIT',$3,'fixture','fixture')",
      [account, symbol, revision],
    );
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("ALTER TABLE order_groups DISABLE TRIGGER USER");
      await setup.query(
        "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until,context_plan_id,entry_side,execution_mode,mode_revision,created_at,cancellation_reason) VALUES($1::uuid,$2,$1::uuid::text,'demo','RECONCILIATION_REQUIRED',$3,'GTD',$3,$4,'BUY','SINGLE_STOP_LIMIT',$5,'2026-10-28T23:16:11.329147Z','ANALYSIS_EXPIRED')",
        [group, analysis, expiry, context, revision],
      );
      await setup.query("ALTER TABLE order_groups ENABLE TRIGGER USER");
      await setup.query(
        "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,filled_volume,expires_at,time_in_force,submission_valid_until,execution_order_type) VALUES($1::uuid,$2,$3,'BUY','STOP','CANCEL_PENDING',$1::uuid::text,true,'fixture',$1::uuid::text,4002,3995,4002.4,100,100,0,$4,'GTD',$4,'STOP_LIMIT')",
        [order, account, group, expiry],
      );
      await setup.query("COMMIT");
    } catch (e) {
      await setup.query("ROLLBACK");
      throw e;
    } finally {
      setup.release();
    }
    const anchorAnalysis = randomUUID(),
      anchorGroup = randomUUID(),
      anchorOrder = randomUUID(),
      anchorEvent = randomUUID();
    await pool.query(
      "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','ACCEPTED','2026-10-28T03:20:00Z')",
      [anchorAnalysis, account, symbol, strategy],
    );
    const prior = await pool.connect();
    try {
      await prior.query("BEGIN");
      await prior.query("ALTER TABLE order_groups DISABLE TRIGGER USER");
      await prior.query("ALTER TABLE orders DISABLE TRIGGER USER");
      await prior.query(
        "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until) VALUES($1::uuid,$2,$1::uuid::text,'demo','FAILED','2026-10-28T03:25:00Z','GTD','2026-10-28T03:25:00Z')",
        [anchorGroup, anchorAnalysis],
      );
      await prior.query(
        "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,broker_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,filled_volume,expires_at,time_in_force,submission_valid_until,execution_order_type) VALUES($1::uuid,$2,$3,'BUY','STOP','CANCELLED',$1::uuid::text,$1::uuid::text,true,'fixture',$1::uuid::text,4002,3995,4002.4,100,100,0,'2026-10-28T03:25:00Z','GTD','2026-10-28T03:25:00Z','STOP_LIMIT')",
        [anchorOrder, account, anchorGroup],
      );
      await prior.query("ALTER TABLE order_groups ENABLE TRIGGER USER");
      await prior.query("ALTER TABLE orders ENABLE TRIGGER USER");
      await prior.query("COMMIT");
    } catch (e) {
      await prior.query("ROLLBACK");
      throw e;
    } finally {
      prior.release();
    }
    await pool.query(
      "INSERT INTO broker_execution_events(id,account_id,symbol_id,order_group_id,order_id,broker_event_key,payload_hash,schema_version,execution_type,client_order_id,broker_order_id,mapping_state,reason_codes,normalized_payload,occurred_at,received_at) VALUES($1::uuid,$2,$3,$4,$5::uuid,$1::uuid::text,$6,'1.0',2,$5::uuid::text,$5::uuid::text,'MAPPED','[]','{}','2026-10-28T03:20:44.533Z','2026-10-28T03:20:44.533Z')",
      [anchorEvent, account, symbol, anchorGroup, anchorOrder, "a".repeat(64)],
    );
    const command = {
      side: "BUY",
      execution_order_type: "STOP_LIMIT",
      time_in_force: "GTD",
      entry_price: "4002",
      stop_loss: "3995",
      take_profit: "4002.4",
      normalized_volume: "100",
      expires_at: expiry,
      submission_valid_until: expiry,
    };
    const insertAudit =
      "INSERT INTO audit_events(id,occurred_at,severity,service,instance_id,environment,trading_mode,analysis_id,event_name,outcome,reason_code,details) VALUES($1,$2,'info','execution-service','fixture','production','demo',$3,$4,$5,$6,$7::jsonb)";
    await pool.query(insertAudit, [
      randomUUID(),
      "2026-10-28T23:16:11.370947Z",
      analysis,
      "risk_intent_persisted",
      "accepted",
      null,
      JSON.stringify({
        order_group_id: intentGroupMismatch ? randomUUID() : group,
        execution_mode: "SINGLE_STOP_LIMIT",
        mode_revision: revision,
        commands: [command],
      }),
    ]);
    await pool.query(insertAudit, [
      randomUUID(),
      "2026-10-28T23:16:11.375624Z",
      analysis,
      "analysis_transition",
      "rejected",
      "DEMO_DIRECTIONAL_COMMAND_INVALID",
      "{}",
    ]);
    await pool.query(
      "INSERT INTO runtime_controls(id,control_key,scope,enabled,actor,reason) VALUES($1,'PAUSE_NEW_ANALYSES',$2,true,$3,'fixture')",
      [randomUUID(), actor, actor],
    );
    return { account, symbol, group, order, actor, anchorEvent };
  }
  it("records a local proof and resolves only the exact incident without fabricating broker events", async () => {
    const f = await fixture();
    await recoverPredispatchIncident({
      pool,
      accountId: f.account,
      symbolId: f.symbol,
      scope: f.actor,
      pauseActor: f.actor,
      receiptBytes: await receipt(),
      activationBytes: await activation(),
      executionStopped: () => true,
      observeBroker: () => broker(f.anchorEvent),
    });
    const r = await pool.query(
      "SELECT g.state group_state,g.cancellation_reason,o.state order_state,(SELECT count(*)::int FROM predispatch_recovery_evidence WHERE order_id=o.id) proofs,(SELECT count(*)::int FROM broker_execution_events WHERE order_id=o.id) events FROM order_groups g JOIN orders o ON o.order_group_id=g.id WHERE g.id=$1",
      [f.group],
    );
    expect(r.rows[0]).toEqual({
      group_state: "FAILED",
      cancellation_reason: "LOCAL_PRE_DISPATCH_REJECTION",
      order_state: "REJECTED",
      proofs: 1,
      events: 0,
    });
    await expect(
      pool.query(
        "DELETE FROM predispatch_recovery_evidence WHERE order_id=$1",
        [f.order],
      ),
    ).rejects.toThrow("PREDISPATCH_RECOVERY_EVIDENCE_IMMUTABLE");
    await expect(
      pool.query("TRUNCATE predispatch_recovery_evidence"),
    ).rejects.toThrow("PREDISPATCH_RECOVERY_EVIDENCE_IMMUTABLE");
    await expect(
      recoverPredispatchIncident({
        pool,
        accountId: f.account,
        symbolId: f.symbol,
        scope: f.actor,
        pauseActor: f.actor,
        receiptBytes: await receipt(),
        activationBytes: await activation(),
        executionStopped: () => true,
        observeBroker: () => broker(f.anchorEvent),
      }),
    ).rejects.toThrow();
  });
  it("recovers after the real shutdown maintenance records its cancellation reason", async () => {
    const f = await fixture();
    const gateway = {
      cancelStrategyOrder: () => Promise.reject(new Error("unsubmitted")),
      reconcile: () =>
        Promise.resolve({
          certain: false,
          orders: [],
          relevantPositionCount: 0,
        }),
    } as unknown as ExecutionGateway;
    const maintenance = new OrderMaintenance(pool, gateway, "XAUUSD", {
      accountId: f.account,
      symbolId: f.symbol,
    });
    await expect(
      maintenance.cancelAll("SERVICE_SHUTDOWN", true),
    ).rejects.toThrow("ORDER_MAINTENANCE_RECONCILIATION_REQUIRED");
    const stopped = await pool.query(
      "SELECT state,cancellation_reason FROM order_groups WHERE id=$1",
      [f.group],
    );
    expect(stopped.rows[0]).toEqual({
      state: "RECONCILIATION_REQUIRED",
      cancellation_reason: "SERVICE_SHUTDOWN",
    });
    await recoverPredispatchIncident({
      pool,
      accountId: f.account,
      symbolId: f.symbol,
      scope: f.actor,
      pauseActor: f.actor,
      receiptBytes: await receipt(),
      activationBytes: await activation(),
      executionStopped: () => true,
      observeBroker: () => broker(f.anchorEvent),
    });
    const proof = await pool.query(
      "SELECT prior_cancellation_reason FROM predispatch_recovery_evidence WHERE order_id=$1",
      [f.order],
    );
    expect(proof.rows[0]).toEqual({
      prior_cancellation_reason: "SERVICE_SHUTDOWN",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM broker_execution_events WHERE order_id=$1",
          [f.order],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  });
  it.each([
    "pagination",
    "open-position",
    "broker-changed",
    "anchor-missing",
    "process-changed",
    "pause-missing",
    "receipt-tampered",
    "activation-tampered",
    "intent-group-mismatch",
  ] as const)("rolls back on %s", async (failure) => {
    const f = await fixture(failure === "intent-group-mismatch");
    let calls = 0;
    if (failure === "pause-missing")
      await pool.query(
        "UPDATE runtime_controls SET enabled=false WHERE scope=$1",
        [f.actor],
      );
    const observation = broker(f.anchorEvent);
    if (failure === "pagination") observation.ordersHasMore = true;
    if (failure === "open-position") observation.openPositions = 1;
    if (failure === "anchor-missing") observation.anchorEventId = randomUUID();
    let brokerCalls = 0;
    const receiptBytes = await receipt();
    const activationBytes = await activation();
    if (failure === "activation-tampered")
      activationBytes[activationBytes.length - 1] = 32;
    if (failure === "receipt-tampered")
      receiptBytes[receiptBytes.length - 1] = 32;
    await expect(
      recoverPredispatchIncident({
        pool,
        accountId: f.account,
        symbolId: f.symbol,
        scope: f.actor,
        pauseActor: f.actor,
        receiptBytes,
        activationBytes,
        executionStopped: () =>
          failure === "process-changed" ? ++calls === 1 : true,
        observeBroker: () => {
          if (failure === "broker-changed" && ++brokerCalls === 2)
            return { ...observation, openOrders: 1 };
          return observation;
        },
      }),
    ).rejects.toThrow();
    const r = await pool.query(
      "SELECT g.state group_state,o.state order_state,(SELECT count(*)::int FROM predispatch_recovery_evidence WHERE order_id=o.id) proofs FROM order_groups g JOIN orders o ON o.order_group_id=g.id WHERE g.id=$1",
      [f.group],
    );
    expect(r.rows[0]).toEqual({
      group_state: "RECONCILIATION_REQUIRED",
      order_state: "CANCEL_PENDING",
      proofs: 0,
    });
  });
  it("rejects evidence that ages during the final supervisor check", async () => {
    const f = await fixture();
    const observation = broker(f.anchorEvent);
    const now = Date.now();
    let checks = 0;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await expect(
        recoverPredispatchIncident({
          pool,
          accountId: f.account,
          symbolId: f.symbol,
          scope: f.actor,
          pauseActor: f.actor,
          receiptBytes: await receipt(),
          activationBytes: await activation(),
          executionStopped: () => {
            if (++checks === 2) clock.mockReturnValue(now + 16_000);
            return true;
          },
          observeBroker: () => observation,
        }),
      ).rejects.toThrow("PREDISPATCH_INCIDENT_BROKER_STALE");
    } finally {
      clock.mockRestore();
    }
    expect(checks).toBe(2);
    const r = await pool.query(
      "SELECT g.state group_state,o.state order_state,(SELECT count(*)::int FROM predispatch_recovery_evidence WHERE order_id=o.id) proofs FROM order_groups g JOIN orders o ON o.order_group_id=g.id WHERE g.id=$1",
      [f.group],
    );
    expect(r.rows[0]).toEqual({
      group_state: "RECONCILIATION_REQUIRED",
      order_state: "CANCEL_PENDING",
      proofs: 0,
    });
  });
  it("rolls back the proof and order update if the group update fails", async () => {
    const f = await fixture();
    await pool.query(
      "CREATE FUNCTION fail_test_group_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_GROUP_FAILURE'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_test_group_update BEFORE UPDATE ON order_groups FOR EACH ROW EXECUTE FUNCTION fail_test_group_update()",
    );
    try {
      await expect(
        recoverPredispatchIncident({
          pool,
          accountId: f.account,
          symbolId: f.symbol,
          scope: f.actor,
          pauseActor: f.actor,
          receiptBytes: await receipt(),
          activationBytes: await activation(),
          executionStopped: () => true,
          observeBroker: () => broker(f.anchorEvent),
        }),
      ).rejects.toThrow("TEST_GROUP_FAILURE");
    } finally {
      await pool.query("DROP TRIGGER fail_test_group_update ON order_groups");
      await pool.query("DROP FUNCTION fail_test_group_update()");
    }
    const r = await pool.query(
      "SELECT g.state group_state,o.state order_state,(SELECT count(*)::int FROM predispatch_recovery_evidence WHERE order_id=o.id) proofs FROM order_groups g JOIN orders o ON o.order_group_id=g.id WHERE g.id=$1",
      [f.group],
    );
    expect(r.rows[0]).toEqual({
      group_state: "RECONCILIATION_REQUIRED",
      order_state: "CANCEL_PENDING",
      proofs: 0,
    });
  });
  it("rolls back if the final write outlives broker freshness", async () => {
    const f = await fixture();
    const observation = broker(f.anchorEvent);
    const now = Date.now();
    let wroteGroup = false;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const delayed = {
      connect: async () => {
        const real = await pool.connect();
        return new Proxy(real, {
          get(target, key) {
            if (key === "query")
              return async (...args: unknown[]) => {
                const result: unknown = await Reflect.apply(
                  target.query.bind(target),
                  target,
                  args,
                );
                if (
                  typeof args[0] === "string" &&
                  args[0].startsWith("UPDATE order_groups")
                ) {
                  wroteGroup = true;
                  clock.mockReturnValue(now + 16_000);
                }
                return result;
              };
            if (key === "release") return target.release.bind(target);
            return Reflect.get(target, key) as unknown;
          },
        });
      },
    } as unknown as pg.Pool;
    try {
      await expect(
        recoverPredispatchIncident({
          pool: delayed,
          accountId: f.account,
          symbolId: f.symbol,
          scope: f.actor,
          pauseActor: f.actor,
          receiptBytes: await receipt(),
          activationBytes: await activation(),
          executionStopped: () => true,
          observeBroker: () => observation,
        }),
      ).rejects.toThrow("PREDISPATCH_INCIDENT_BROKER_STALE");
    } finally {
      clock.mockRestore();
    }
    expect(wroteGroup).toBe(true);
    const r = await pool.query(
      "SELECT g.state group_state,o.state order_state,(SELECT count(*)::int FROM predispatch_recovery_evidence WHERE order_id=o.id) proofs FROM order_groups g JOIN orders o ON o.order_group_id=g.id WHERE g.id=$1",
      [f.group],
    );
    expect(r.rows[0]).toEqual({
      group_state: "RECONCILIATION_REQUIRED",
      order_state: "CANCEL_PENDING",
      proofs: 0,
    });
  });
  it("reports an unknown outcome if the commit reply is lost and never repeats recovery", async () => {
    const f = await fixture();
    const wrapped = {
      connect: async () => {
        const real = await pool.connect();
        return new Proxy(real, {
          get(target, key) {
            if (key === "query")
              return (...args: unknown[]) => {
                if (args[0] === "COMMIT")
                  return target.query("COMMIT").then(() => {
                    throw new Error("reply lost");
                  });
                const query = target.query.bind(target);
                return Reflect.apply(query, target, args) as unknown;
              };
            if (key === "release") return target.release.bind(target);
            return Reflect.get(target, key) as unknown;
          },
        });
      },
    } as unknown as pg.Pool;
    const input = {
      accountId: f.account,
      symbolId: f.symbol,
      scope: f.actor,
      pauseActor: f.actor,
      receiptBytes: await receipt(),
      activationBytes: await activation(),
      executionStopped: () => true,
      observeBroker: () => broker(f.anchorEvent),
    };
    await expect(
      recoverPredispatchIncident({ ...input, pool: wrapped }),
    ).rejects.toThrow("PREDISPATCH_COMMIT_OUTCOME_UNKNOWN");
    const r = await pool.query(
      "SELECT g.state group_state,o.state order_state,(SELECT count(*)::int FROM predispatch_recovery_evidence WHERE order_id=o.id) proofs FROM order_groups g JOIN orders o ON o.order_group_id=g.id WHERE g.id=$1",
      [f.group],
    );
    expect(r.rows[0]).toEqual({
      group_state: "FAILED",
      order_state: "REJECTED",
      proofs: 1,
    });
    let calls = 0;
    await expect(
      recoverPredispatchIncident({
        ...input,
        pool,
        observeBroker: () => {
          calls++;
          return broker(f.anchorEvent);
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
