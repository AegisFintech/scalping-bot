import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { PostgresDecisionTrail } from "../../apps/execution-service/src/postgres-trail.js";
import type { GatewayOrder } from "../../packages/contracts/src/index.js";
const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite("session-denied order intents (isolated PostgreSQL)", () => {
  const schema = `session_gate_${randomUUID().replaceAll("-", "")}`;
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
      analysisId = randomUUID(),
      groupId = randomUUID();
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
      "INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time) VALUES($1,$2,$3,$4,'demo','VALIDATING',now())",
      [analysisId, accountId, symbolId, strategyId],
    );
    await pool.query(
      "INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at) VALUES($1::uuid,$2,$1::text,'demo','INTENT_RECORDED',now()+interval '3 minutes')",
      [groupId, analysisId],
    );
    const orders: GatewayOrder[] = [];
    for (const side of ["BUY", "SELL"]) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,expires_at) VALUES($1::uuid,$2,$3,$4,'STOP','INTENT',$1::text,'fixture',$1::text,2000,1999,2001,100,100,now()+interval '3 minutes')",
        [id, accountId, groupId, side],
      );
      orders.push({
        clientOrderId: id,
        brokerOrderId: null,
        state: "REJECTED",
        filledVolume: "0",
        updatedAt: new Date().toISOString(),
        reasonCode: "MARKET_SESSION_CLOSED",
      });
    }
    const opts = {
      pool,
      accountId,
      symbolId,
      strategyVersionId: strategyId,
      mode: "demo" as const,
      apiStyle: "responses" as const,
      model: "deepseek-v4-pro/u5W",
      promptVersion: "entry-pair-execution-v1" as const,
      schemaVersion: "2.1" as const,
      payloadMode: "compact" as const,
      instanceId: "fixture",
      environment: "test",
      persistedCandleTails: { M1: 5, M5: 5, M15: 5 },
    };
    return {
      analysisId,
      groupId,
      orders,
      trail: new PostgresDecisionTrail(opts),
      opts,
    };
  }
  it("persists unsent rejections as terminal with no submission or fabricated broker event across restart", async () => {
    const x = await setup();
    const result = {
      orderGroupId: x.groupId,
      idempotentReplay: false,
      orders: x.orders,
    };
    await x.trail.placement(x.analysisId, result);
    await new PostgresDecisionTrail(x.opts).placement(x.analysisId, {
      ...result,
      idempotentReplay: true,
    });
    const rows = await pool.query<{
      state: string;
      submitted_at: Date | null;
      broker_order_id: string | null;
    }>(
      "SELECT state,submitted_at,broker_order_id FROM orders WHERE order_group_id=$1",
      [x.groupId],
    );
    expect(
      rows.rows.every(
        (row) =>
          row.state === "REJECTED" &&
          row.submitted_at === null &&
          row.broker_order_id === null,
      ),
    ).toBe(true);
    expect(
      (
        await pool.query<{ state: string }>(
          "SELECT state FROM order_groups WHERE id=$1",
          [x.groupId],
        )
      ).rows[0]?.state,
    ).toBe("FAILED");
    expect(
      (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM broker_execution_events WHERE account_id=$1",
          [x.opts.accountId],
        )
      ).rows[0]?.n,
    ).toBe(0);
    const audit = await pool.query<{
      outcome: string;
      reason_code: string;
      details: { orders: { locally_unsent: boolean }[] };
    }>(
      "SELECT outcome,reason_code,details FROM audit_events WHERE analysis_id=$1 AND event_name='oco_placement_completed'",
      [x.analysisId],
    );
    expect(
      audit.rows.every(
        (row) =>
          row.outcome === "rejected" &&
          row.reason_code === "MARKET_SESSION_CLOSED" &&
          row.details.orders.every((o) => o.locally_unsent),
      ),
    ).toBe(true);
  });
  it("terminates a cancelled first leg and a locally unsent second leg without leaving an active group", async () => {
    const x = await setup();
    x.orders[0] = {
      ...x.orders[0]!,
      state: "CANCELLED",
      brokerOrderId: "101",
      reasonCode: null,
    };
    await x.trail.placement(x.analysisId, {
      orderGroupId: x.groupId,
      idempotentReplay: false,
      orders: x.orders,
    });
    expect(
      (
        await pool.query<{ state: string }>(
          "SELECT state FROM order_groups WHERE id=$1",
          [x.groupId],
        )
      ).rows[0]?.state,
    ).toBe("FAILED");
    const rows = await pool.query<{ submitted_at: Date | null }>(
      "SELECT submitted_at FROM orders WHERE client_order_id=$1",
      [x.orders[1]!.clientOrderId],
    );
    expect(rows.rows[0]?.submitted_at).toBe(null);
  });
  it.each(["broker", "filled"] as const)(
    "rejects contradictory %s evidence transactionally",
    async (kind) => {
      const x = await setup();
      x.orders[1] = {
        ...x.orders[1]!,
        ...(kind === "broker"
          ? { brokerOrderId: "101" }
          : { filledVolume: "1" }),
      };
      await expect(
        x.trail.placement(x.analysisId, {
          orderGroupId: x.groupId,
          idempotentReplay: false,
          orders: x.orders,
        }),
      ).rejects.toThrow("TRAIL_LOCAL_SESSION_REJECTION_INVALID");
      expect(
        (
          await pool.query<{ state: string }>(
            "SELECT state FROM orders WHERE order_group_id=$1",
            [x.groupId],
          )
        ).rows.every((row) => row.state === "INTENT"),
      ).toBe(true);
    },
  );
  it("never overwrites an existing broker acknowledgement with a local denial", async () => {
    const x = await setup();
    await pool.query(
      "UPDATE orders SET state='PENDING',broker_order_id='101',submitted_at=now() WHERE client_order_id=$1",
      [x.orders[0]!.clientOrderId],
    );
    await expect(
      x.trail.placement(x.analysisId, {
        orderGroupId: x.groupId,
        idempotentReplay: false,
        orders: x.orders,
      }),
    ).rejects.toThrow("TRAIL_PLACEMENT_EVIDENCE_CONFLICT");
    expect(
      (
        await pool.query<{ state: string }>(
          "SELECT state FROM orders WHERE client_order_id=$1",
          [x.orders[0]!.clientOrderId],
        )
      ).rows[0]?.state,
    ).toBe("PENDING");
  });
});
