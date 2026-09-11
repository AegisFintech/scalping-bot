import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { createPool, migrate } from "../../packages/database/src/index.js";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";
import { normalizeDemoExecution } from "../../apps/execution-service/src/demo-execution.js";
import { PostgresDemoExecutionStore } from "../../apps/execution-service/src/demo-execution-store.js";
import { DemoExecutionRecoveryRunner } from "../../apps/execution-service/src/demo-execution-recovery-runner.js";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const replacement = "DEMO_ORDER_REPLACED_RECONCILIATION_REQUIRED";
type MutableExecution = {
  -readonly [K in keyof BrokerExecution]: BrokerExecution[K];
};
const fixture = async (name: string): Promise<MutableExecution> =>
  JSON.parse(
    await readFile(path.resolve("tests/fixtures/ctrader", name), "utf8"),
  ) as MutableExecution;

function permutations<T>(items: readonly T[]): T[][] {
  return items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, i) => i !== index)).map((tail) => [
          item,
          ...tail,
        ]),
      );
}

type Step = "accepted" | "amended" | "closed" | "peerCancelled";

suite(
  "unattended lifecycle qualification (isolated PostgreSQL, no broker authority)",
  () => {
    const schema = `unattended_${randomUUID().replaceAll("-", "")}`;
    let admin: pg.Pool;
    let pool: pg.Pool;
    beforeAll(async () => {
      admin = createPool({ connectionString: connectionString! });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(connectionString!);
      url.searchParams.set("options", `-csearch_path=${schema}`);
      pool = createPool({ connectionString: url.toString() });
      await migrate(pool, path.resolve("migrations"));
    }, 60_000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });

    async function setup(side: "BUY" | "SELL" = "BUY") {
      const accountId = randomUUID();
      const symbolId = randomUUID();
      const strategyId = randomUUID();
      const analysisId = randomUUID();
      const groupId = randomUUID();
      const requestId = randomUUID();
      const buyClient = `cas-buy-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      const sellClient = `cas-sell-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await pool.query(
        `INSERT INTO accounts (id,provider_account_key_hash,environment,account_type,currency)
       VALUES ($1::uuid,$2,'demo','demo','USD')`,
        [accountId, accountId.replaceAll("-", "")],
      );
      await pool.query(
        `INSERT INTO symbols (id,account_id,provider_symbol_id,name,digits,tick_size,volume_scale,metadata_revision,metadata_at)
       VALUES ($1::uuid,$2,'7','XAUUSD',2,0.01,100,'fixture',now())`,
        [symbolId, accountId],
      );
      await pool.query(
        `INSERT INTO strategy_versions (id,version,code_hash,config_hash,prompt_version,schema_version,feature_version)
       VALUES ($1::uuid,$1::text,'fixture','fixture','system-v1','1.0','1.0')`,
        [strategyId],
      );
      await pool.query(
        `INSERT INTO analysis_runs (id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time)
       VALUES ($1::uuid,$2,$3,$4,'demo','ACCEPTED',now())`,
        [analysisId, accountId, symbolId, strategyId],
      );
      await pool.query(
        `INSERT INTO model_requests (id,analysis_id,request_id,api_style,model,prompt_version,schema_version,
         payload_mode,payload_redacted,payload_sha256,status,requested_at)
       VALUES ($1::uuid,$2,$1::text,'responses','fixture-model','system-v1','1.0','full','{}','fixture','COMPLETED',now())`,
        [requestId, analysisId],
      );
      await pool.query(
        `INSERT INTO model_responses (id,model_request_id,status,parsed_payload,received_at)
       VALUES ($1::uuid,$2,'COMPLETED','{"confidence":{"overall":50},"setup_tags":[],"market_regime":"UNCERTAIN"}',now())`,
        [randomUUID(), requestId],
      );
      await pool.query(
        `INSERT INTO order_groups (id,analysis_id,idempotency_key,mode,state,expires_at)
       VALUES ($1::uuid,$2,$1::text,'demo','ACTIVE',now()+interval '1 hour')`,
        [groupId, analysisId],
      );
      for (const [orderSide, clientId, brokerId] of [
        [side, buyClient, "501"],
        [side === "BUY" ? "SELL" : "BUY", sellClient, "502"],
      ]) {
        await pool.query(
          `INSERT INTO orders (id,account_id,order_group_id,side,order_type,state,client_order_id,
          broker_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,
          requested_volume,normalized_volume,expires_at)
         VALUES ($1::uuid,$2,$3,$4,'STOP','PENDING',$5,$6,true,'ctrader-ai-scalper:fixture',$1::text,2001,1999,2005,100,100,now()+interval '1 hour')`,
          [randomUUID(), accountId, groupId, orderSide, clientId, brokerId],
        );
      }
      const restart = () =>
        new PostgresDemoExecutionStore({ pool, accountId, symbolId });
      const entry = await fixture("demo-order-filled-v1.json");
      entry.order!.clientOrderId = buyClient;
      entry.deal!.volume = "100";
      entry.deal!.filledVolume = "100";
      const close = await fixture("demo-position-closed-v1.json");
      const time = Number(close.deal!.executionTimestamp);
      for (const raw of [entry, close]) {
        (raw.position!.tradeData as Record<string, unknown>).tradeSide =
          side === "BUY" ? 1 : 2;
        (raw.order!.tradeData as Record<string, unknown>).tradeSide =
          raw === entry ? (side === "BUY" ? 1 : 2) : side === "BUY" ? 2 : 1;
        raw.deal!.tradeSide = (
          raw.order!.tradeData as Record<string, unknown>
        ).tradeSide;
      }
      const accepted = structuredClone(close);
      accepted.executionType = 2;
      accepted.deal = null;
      accepted.order!.orderStatus = 1;
      accepted.order!.executedVolume = "0";
      accepted.order!.utcLastUpdateTimestamp = time - 2000;
      accepted.position = structuredClone(entry.position);
      accepted.position!.utcLastUpdateTimestamp = time - 2000;
      const amended = structuredClone(accepted);
      amended.executionType = 4;
      amended.order!.utcLastUpdateTimestamp = time - 1000;
      amended.position!.utcLastUpdateTimestamp = time - 1000;
      const peer = structuredClone(entry);
      peer.executionType = 5;
      peer.deal = null;
      peer.position = null;
      peer.order!.orderId = "502";
      peer.order!.clientOrderId = sellClient;
      peer.order!.orderStatus = 5;
      peer.order!.executedVolume = "0";
      peer.order!.utcLastUpdateTimestamp = time - 3000;
      (peer.order!.tradeData as Record<string, unknown>).tradeSide =
        side === "BUY" ? 2 : 1;
      const rawEvents = {
        accepted,
        amended,
        closed: close,
        peerCancelled: peer,
      };
      const normalize = (raw: BrokerExecution) =>
        normalizeDemoExecution(raw, { symbolId: "7" })!;
      await restart().persist(normalize(entry));
      return {
        accountId,
        symbolId,
        groupId,
        restart,
        normalize,
        rawEvents,
        entry,
        sellClient,
        events: Object.fromEntries(
          Object.entries(rawEvents).map(([key, raw]) => [key, normalize(raw)]),
        ) as Record<Step, ReturnType<typeof normalize>>,
      };
    }

    for (const [index, steps] of permutations<Step>([
      "accepted",
      "amended",
      "closed",
      "peerCancelled",
    ]).entries()) {
      it(`recovers ${steps.join(" → ")} with duplicates and restart boundaries`, async () => {
        const s = await setup(index % 2 === 0 ? "BUY" : "SELL");
        for (const step of steps) {
          const event = s.events[step];
          // New store instances share only the journal; callback arrival order is
          // deliberately different from broker occurrence order.
          await s.restart().persist(event);
          await s.restart().persist(event);
          await s.restart().reconcileTerminalEvidence();
        }
        const result = await s.restart().reconcileTerminalEvidence();
        expect(result).toMatchObject({
          certain: true,
          reasonCodes: [],
          terminalOrderGroupId: s.groupId,
        });
        const rows = await pool.query(
          `SELECT og.state, (SELECT count(*)::int FROM trades t WHERE t.order_group_id=og.id) AS trades,
          (SELECT count(*)::int FROM fills f JOIN positions p ON p.id=f.position_id WHERE p.order_group_id=og.id) AS fills,
          (SELECT count(*)::int FROM broker_execution_events e WHERE e.order_group_id=og.id AND e.reason_codes ? $2
            AND e.resolved_at IS NOT NULL AND e.resolution_event_key IS NOT NULL) AS resolved
         FROM order_groups og WHERE og.id=$1`,
          [s.groupId, replacement],
        );
        expect(rows.rows).toEqual([
          { state: "CLOSED", trades: 1, fills: 2, resolved: 1 },
        ]);
        expect(
          (await s.restart().reconcileTerminalEvidence()).resolvedEventCount,
        ).toBe(0);
      });
    }

    it("recovers after an interrupted storage attempt on the same periodic runner", async () => {
      const s = await setup();
      for (const event of Object.values(s.events))
        await s.restart().persist(event);
      let now = 0;
      let unavailable = true;
      const runner = new DemoExecutionRecoveryRunner({
        intervalMs: 15_000,
        now: () => now,
        recover: async () => {
          if (unavailable) throw new Error("simulated unavailable database");
          return s.restart().reconcileTerminalEvidence();
        },
      });
      expect((await runner.run()).certain).toBe(false);
      expect((await s.restart().readiness()).reasonCodes).toContain(
        replacement,
      );
      unavailable = false;
      now += 15_000;
      const results = await Promise.all([runner.run(), runner.run(true)]);
      expect(results.every((r) => r.certain)).toBe(true);
      expect(runner.attemptCount).toBe(2);
    });

    for (const defect of [
      "wrong-child",
      "newer-amendment",
      "missing-fill",
      "wrong-volume",
      "incomplete-peer",
      "unowned-position",
      "extra-reason",
      "conflict",
      "foreign-symbol",
    ] as const) {
      it(`keeps ${defect} evidence blocked`, async () => {
        const s = await setup();
        const amended = structuredClone(s.rawEvents.amended);
        if (defect === "wrong-child") amended.order!.orderId = "699";
        if (defect === "newer-amendment") {
          amended.order!.utcLastUpdateTimestamp =
            Number(s.rawEvents.closed.deal!.executionTimestamp) + 1;
          // A non-deal contextual position does not authorize a position transition.
        }
        await s.restart().persist(s.normalize(amended));
        await s.restart().persist(s.events.closed);
        if (defect !== "incomplete-peer")
          await s.restart().persist(s.events.peerCancelled);
        if (defect === "missing-fill")
          await pool.query(
            "DELETE FROM fills WHERE position_id IN (SELECT id FROM positions WHERE order_group_id=$1) AND order_id IS NULL",
            [s.groupId],
          );
        if (defect === "wrong-volume")
          await pool.query(
            "UPDATE fills SET volume=99 WHERE position_id IN (SELECT id FROM positions WHERE order_group_id=$1) AND order_id IS NULL",
            [s.groupId],
          );
        if (defect === "unowned-position")
          await pool.query(
            "UPDATE positions SET strategy_owned=false WHERE order_group_id=$1",
            [s.groupId],
          );
        if (defect === "extra-reason")
          await pool.query(
            "UPDATE broker_execution_events SET reason_codes=reason_codes || '[\"DEMO_EXECUTION_STATE_UNKNOWN\"]'::jsonb WHERE order_group_id=$1 AND execution_type=4",
            [s.groupId],
          );
        if (defect === "conflict")
          await pool.query(
            "UPDATE broker_execution_events SET mapping_state='CONFLICT' WHERE order_group_id=$1 AND execution_type=4",
            [s.groupId],
          );
        if (defect === "foreign-symbol") {
          const foreign = await setup();
          await pool.query(
            "UPDATE broker_execution_events SET symbol_id=$2 WHERE order_group_id=$1 AND execution_type=3 AND closing_order=true",
            [s.groupId, foreign.symbolId],
          );
        }
        expect((await s.restart().reconcileTerminalEvidence()).certain).toBe(
          false,
        );
        expect((await s.restart().readiness()).certain).toBe(false);
      });
    }
    it("bounds database lock waiting, rolls back, and recovers after the lock is released", async () => {
      const s = await setup();
      for (const event of Object.values(s.events))
        await s.restart().persist(event);
      const blocker = await pool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${s.accountId}:${s.symbolId}:terminal-evidence`],
        );
        await expect(
          s.restart().reconcileTerminalEvidence(),
        ).rejects.toMatchObject({ code: "55P03" });
        expect((await s.restart().readiness()).reasonCodes).toContain(
          replacement,
        );
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      expect((await s.restart().reconcileTerminalEvidence()).certain).toBe(
        true,
      );
    }, 15_000);

    for (const late of [false, true]) {
      it(`resolves an amended distinct child only after its cancellation (late=${late})`, async () => {
        const s = await setup();
        const amended = structuredClone(s.rawEvents.amended);
        amended.order!.orderId = "605";
        const cancelled = structuredClone(amended);
        cancelled.executionType = 5;
        cancelled.order!.orderStatus = 5;
        cancelled.order!.utcLastUpdateTimestamp =
          Number(s.rawEvents.closed.deal!.executionTimestamp) + 1;
        // A cancellation carries no new open-position state after closure.
        if (!late) await s.restart().persist(s.normalize(amended));
        await s.restart().persist(s.events.closed);
        await s.restart().persist(s.events.peerCancelled);
        if (!late)
          expect((await s.restart().reconcileTerminalEvidence()).certain).toBe(
            false,
          );
        await s.restart().persist(s.normalize(cancelled));
        if (late) await s.restart().persist(s.normalize(amended));
        expect((await s.restart().reconcileTerminalEvidence()).certain).toBe(
          true,
        );
      });
    }
    it("requires both outcomes in a double-filled OCO and resolves each child's own amendment", async () => {
      const s = await setup();
      const entry = structuredClone(s.entry);
      entry.order!.orderId = "502";
      entry.order!.clientOrderId = s.sellClient;
      entry.position!.positionId = "802";
      entry.deal!.orderId = "502";
      entry.deal!.positionId = "802";
      entry.deal!.dealId = "904";
      (entry.order!.tradeData as Record<string, unknown>).tradeSide = 2;
      (entry.position!.tradeData as Record<string, unknown>).tradeSide = 2;
      entry.deal!.tradeSide = 2;
      await s.restart().persist(s.normalize(entry));
      const amendment = structuredClone(s.rawEvents.amended);
      amendment.order!.orderId = "602";
      amendment.position!.positionId = "802";
      await s.restart().persist(s.events.amended);
      await s.restart().persist(s.normalize(amendment));
      await s.restart().persist(s.events.closed);
      expect((await s.restart().reconcileTerminalEvidence()).certain).toBe(
        false,
      );
      const close = structuredClone(s.rawEvents.closed);
      close.order!.orderId = "602";
      close.position!.positionId = "802";
      close.deal!.dealId = "905";
      close.deal!.orderId = "602";
      close.deal!.positionId = "802";
      (close.order!.tradeData as Record<string, unknown>).tradeSide = 1;
      (close.position!.tradeData as Record<string, unknown>).tradeSide = 2;
      close.deal!.tradeSide = 1;
      await s.restart().persist(s.normalize(close));
      const result = await s.restart().reconcileTerminalEvidence();
      expect(result).toMatchObject({ certain: true, resolvedEventCount: 2 });
      expect(result.terminalOrders.map((o) => o.state)).toEqual([
        "FILLED",
        "FILLED",
      ]);
    });
  },
);
