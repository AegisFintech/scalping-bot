import { EntryModeStore } from "../../apps/execution-service/src/entry-mode-store.js";
import {
  ENTRY_MODES,
  entryModeProfile,
  type EntryMode,
} from "../../packages/contracts/src/entry-mode.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { createPool, migrate } from "../../packages/database/src/index.js";
import type { BrokerExecution } from "../../packages/ctrader-client/src/client.js";
import { normalizeDemoExecution } from "../../apps/execution-service/src/demo-execution.js";
import { PostgresDemoExecutionStore } from "../../apps/execution-service/src/demo-execution-store.js";
import { recoverDemoExecutions } from "../../apps/execution-service/src/demo-execution-recovery.js";
import { DemoExecutionRecoveryRunner } from "../../apps/execution-service/src/demo-execution-recovery-runner.js";

import {
  TerminalHistoryAttestor,
  readTerminalGroup,
} from "../../apps/execution-service/src/terminal-history-attestor.js";
import {
  proveTerminalGroup,
  auditLegacyTerminalGroup,
} from "../../apps/execution-service/src/terminal-group-proof.js";

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

    async function setup(
      side: "BUY" | "SELL" = "BUY",
      directional = false,
      persistEntry = true,
      entryProfile?: EntryMode,
    ) {
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
      const entryModes = new EntryModeStore(pool, {
        accountId,
        symbolId,
        mode: "demo",
      });
      let selection;
      if (entryProfile) {
        await entryModes.initialize();
        const current = await entryModes.read();
        selection = await entryModes.select({
          mode: entryProfile,
          expectedRevision: current.revision,
          actor: "fixture",
          reason: "four-mode test",
        });
      }
      const hasContext = directional || entryProfile !== undefined;
      const limitMode = entryProfile
        ? entryModeProfile(entryProfile).limit
        : false;
      const modelSide = limitMode ? (side === "BUY" ? "SELL" : "BUY") : side;
      const upper = modelSide === "BUY" ? "2001" : "2003",
        lower = modelSide === "BUY" ? "1999" : "2001";
      const tx = hasContext ? await pool.connect() : null;
      const writer = tx ?? pool;
      const contextId = hasContext ? randomUUID() : null;
      try {
        if (tx) {
          await tx.query("BEGIN");
          const plan = {
            schema_version: entryProfile
              ? "entry-modes-1.0"
              : "entry-direction-1.0",
            entry_side: modelSide,
            buy_stop: upper,
            sell_stop: lower,
            reason: "synthetic",
            analysis_id: contextId,
            symbol: "XAUUSD",
            captured_at: new Date().toISOString(),
            valid_until: new Date(Date.now() + 300000).toISOString(),
          };
          await tx.query(
            "INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,requested_at,captured_at,valid_until,state,requested_model,tick_size,plan,available_at) VALUES($1,$2,$3,$4,'demo',now(),now(),now()+interval '5 minutes','READY','gpt-6.1-sol','0.01',$5::jsonb,now())",
            [contextId, accountId, symbolId, analysisId, JSON.stringify(plan)],
          );
        }
        await writer.query(
          `INSERT INTO order_groups (id,analysis_id,idempotency_key,mode,state,expires_at,time_in_force,submission_valid_until,context_plan_id,entry_side,execution_mode,mode_revision)
       VALUES ($1::uuid,$2,$1::text,'demo','ACTIVE',CASE WHEN $3::boolean THEN NULL ELSE now()+interval '1 hour' END,CASE WHEN $3::boolean THEN 'GTC' ELSE 'GTD' END,now()+interval '1 hour',$4,$5,$6,$7)`,
          [
            groupId,
            analysisId,
            hasContext,
            contextId,
            directional ? side : null,
            entryProfile ?? null,
            selection?.revision ?? null,
          ],
        );
        const entries = directional
          ? [[side, buyClient, "501"]]
          : [
              [side, buyClient, "501"],
              [side === "BUY" ? "SELL" : "BUY", sellClient, "502"],
            ];
        for (const [orderSide, clientId, brokerId] of entries) {
          await writer.query(
            `INSERT INTO orders (id,account_id,order_group_id,side,order_type,state,client_order_id,
          broker_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,
          requested_volume,normalized_volume,expires_at,time_in_force,submission_valid_until,execution_order_type)
         VALUES ($1::uuid,$2,$3,$4,'STOP','PENDING',$5,$6,true,'ctrader-ai-scalper:fixture',$1::text,$9,1999,2005,100,100,CASE WHEN $7::boolean THEN NULL ELSE now()+interval '1 hour' END,CASE WHEN $7::boolean THEN 'GTC' ELSE 'GTD' END,now()+interval '1 hour',CASE WHEN $7::boolean THEN $8 ELSE NULL END)`,
            [
              randomUUID(),
              accountId,
              groupId,
              orderSide,
              clientId,
              brokerId,
              hasContext,
              limitMode ? "LIMIT" : "STOP_LIMIT",
              entryProfile
                ? (orderSide === "BUY") !== limitMode
                  ? upper
                  : lower
                : "2001",
            ],
          );
        }
        if (tx) await tx.query("COMMIT");
      } catch (error) {
        if (tx) await tx.query("ROLLBACK");
        throw error;
      } finally {
        tx?.release();
      }
      const restart = () =>
        new PostgresDemoExecutionStore({ pool, accountId, symbolId });
      const entry = await fixture("demo-order-filled-v1.json");
      entry.order!.clientOrderId = buyClient;
      if (entryProfile) entry.order!.orderType = limitMode ? 2 : 6;
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
      if (persistEntry) await restart().persist(normalize(entry));
      return {
        accountId,
        symbolId,
        entryModes,
        selection,
        groupId,
        analysisId,
        contextId,
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

    it.each(ENTRY_MODES)(
      "persists exact %s authority and preserves it across selection changes",
      async (mode) => {
        const single = entryModeProfile(mode).single;
        const f = await setup("BUY", single, false, mode);
        const rows = await pool.query(
          "SELECT side,entry_price::text,execution_order_type FROM orders WHERE order_group_id=$1 ORDER BY side",
          [f.groupId],
        );
        expect(rows.rowCount).toBe(single ? 1 : 2);
        expect(
          rows.rows.every(
            (x: { execution_order_type: string }) =>
              x.execution_order_type === entryModeProfile(mode).orderType,
          ),
        ).toBe(true);
        const current = await f.entryModes.read();
        const next = await f.entryModes.select({
          mode: mode === "OCO_LIMIT" ? "SINGLE_STOP_LIMIT" : "OCO_LIMIT",
          expectedRevision: current.revision,
          actor: "fixture",
          reason: "next setup only",
        });
        expect(next.revision).not.toBe(current.revision);
        await pool.query(
          "UPDATE order_groups SET updated_at=now() WHERE id=$1",
          [f.groupId],
        );
        expect(
          (
            await pool.query(
              "SELECT execution_mode,mode_revision FROM order_groups WHERE id=$1",
              [f.groupId],
            )
          ).rows[0],
        ).toMatchObject({
          execution_mode: mode,
          mode_revision: current.revision,
        });
        await expect(
          f.entryModes.select({
            mode,
            expectedRevision: current.revision,
            actor: "fixture",
            reason: "stale browser",
          }),
        ).rejects.toThrow("ENTRY_MODE_CHANGED_REFRESH");
        await expect(
          pool.query(
            "UPDATE orders SET entry_price=entry_price+1 WHERE order_group_id=$1",
            [f.groupId],
          ),
        ).rejects.toThrow("ENTRY_MODE_ORDER_INVALID");
        await expect(
          pool.query("DELETE FROM orders WHERE order_group_id=$1", [f.groupId]),
        ).rejects.toThrow("ENTRY_MODE_CARDINALITY_INVALID");

        await expect(
          pool.query(
            "UPDATE order_groups SET execution_mode=CASE WHEN execution_mode='SINGLE_LIMIT' THEN 'OCO_LIMIT' ELSE 'SINGLE_LIMIT' END WHERE id=$1",
            [f.groupId],
          ),
        ).rejects.toThrow();
        await expect(
          pool.query("DELETE FROM entry_mode_settings WHERE account_id=$1", [
            f.accountId,
          ]),
        ).rejects.toThrow("ENTRY_MODE_DELETE_FORBIDDEN");
        await expect(
          pool.query(
            "UPDATE entry_mode_changes SET actor='rewrite' WHERE revision=$1",
            [current.revision],
          ),
        ).rejects.toThrow("ENTRY_MODE_HISTORY_IMMUTABLE");
      },
    );
    it("rejects stale mode authority at the transactional intent boundary", async () => {
      const f = await setup("BUY", true, false, "SINGLE_STOP_LIMIT");
      const current = await f.entryModes.read();
      await f.entryModes.select({
        mode: "OCO_LIMIT",
        expectedRevision: current.revision,
        actor: "fixture",
        reason: "changed during evaluation",
      });
      await expect(
        pool.query(
          `INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,time_in_force,submission_valid_until,context_plan_id,entry_side,execution_mode,mode_revision) VALUES($1::uuid,$2,$1::text,'demo','INTENT_RECORDED','GTC',now()+interval '1 minute',$3,'BUY','SINGLE_STOP_LIMIT',$4)`,
          [randomUUID(), f.analysisId, f.contextId, current.revision],
        ),
      ).rejects.toThrow("ENTRY_MODE_CHANGED_REFRESH");
    });
    it.each([
      { side: "BUY", profile: undefined },
      { side: "SELL", profile: undefined },
      { side: "BUY", profile: "SINGLE_STOP_LIMIT" },
      { side: "SELL", profile: "SINGLE_STOP_LIMIT" },
      { side: "BUY", profile: "SINGLE_LIMIT" },
      { side: "SELL", profile: "SINGLE_LIMIT" },
    ] as const)(
      "recovers a true single $side $profile group with exact terminal evidence and no manufactured peer",
      async ({ side, profile }) => {
        for (const sequence of permutations<Step>([
          "accepted",
          "amended",
          "closed",
        ])) {
          const s = await setup(side, true, true, profile);
          for (const step of sequence)
            await s.restart().persist(s.events[step]);
          const evidence = await s.restart().reconcileTerminalEvidence();
          expect(evidence.certain).toBe(true);
          expect(evidence.terminalOrders).toHaveLength(1);
          const snapshot = await readTerminalGroup(pool, s.groupId);
          const now = new Date(Date.parse(s.events.closed.occurredAt) + 10000),
            receivedAt = now.toISOString();
          const history = {
            orders: {
              orders: [s.entry.order!, s.rawEvents.closed.order!],
              hasMore: false,
              receivedAt,
            },
            deals: {
              deals: [s.entry.deal!, s.rawEvents.closed.deal!],
              hasMore: false,
              receivedAt,
            },
            reconciliation: { orders: [], positions: [], receivedAt },
          };
          expect(
            proveTerminalGroup(snapshot, history, "7", now).reason,
          ).toBeNull();
          expect(
            proveTerminalGroup(
              { ...snapshot, group: { ...snapshot.group, entrySide: null } },
              history,
              "7",
              now,
            ).reason,
          ).not.toBeNull();
          expect(
            proveTerminalGroup(
              { ...snapshot, orders: [...snapshot.orders, ...snapshot.orders] },
              history,
              "7",
              now,
            ).reason,
          ).not.toBeNull();
          expect((await s.restart().reconcileTerminalEvidence()).certain).toBe(
            true,
          );
        }
      },
    );
    it("directional authority cannot add a peer, change sides/levels, omit its one order or erase the marker", async () => {
      const s = await setup("BUY", true, false);
      for (const sql of [
        "UPDATE orders SET side='SELL' WHERE order_group_id=$1",
        "UPDATE orders SET entry_price=entry_price+1 WHERE order_group_id=$1",
        "UPDATE order_groups SET entry_side=NULL WHERE id=$1",
        "DELETE FROM orders WHERE order_group_id=$1",
      ]) {
        await expect(pool.query(sql, [s.groupId])).rejects.toThrow();
      }
      await expect(
        pool.query(
          "INSERT INTO orders(id,account_id,order_group_id,side,order_type,state,client_order_id,broker_order_id,strategy_owned,strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,normalized_volume,expires_at,time_in_force,submission_valid_until,execution_order_type) SELECT gen_random_uuid(),account_id,order_group_id,'SELL','STOP','INTENT',client_order_id||'-peer',NULL,true,strategy_label,idempotency_key||'-peer',1999,2001,1997,100,100,NULL,'GTC',submission_valid_until,'STOP_LIMIT' FROM orders WHERE order_group_id=$1",
          [s.groupId],
        ),
      ).rejects.toThrow("DIRECTIONAL_ORDER_SIDE_OR_LEVEL_INVALID");
      expect(
        (
          await pool.query(
            "SELECT count(*)::integer AS n FROM orders WHERE order_group_id=$1",
            [s.groupId],
          )
        ).rows[0],
      ).toMatchObject({ n: 1 });
    });

    async function attestationFixture() {
      const s = await setup();
      await s.restart().persist(s.events.accepted);
      await s.restart().persist(s.events.amended);
      await s.restart().persist(s.events.peerCancelled);
      await s.restart().persist(s.events.closed);
      const changed = structuredClone(s.rawEvents.closed);
      changed.position!.takeProfit = 2007;
      await s.restart().persist(s.normalize(changed), "BROKER_CALLBACK");
      const now = new Date(Date.parse(s.events.closed.occurredAt) + 10_000);
      const receivedAt = now.toISOString();
      const history = {
        orders: {
          orders: [
            s.entry.order!,
            s.rawEvents.peerCancelled.order!,
            s.rawEvents.closed.order!,
          ],
          hasMore: false,
          receivedAt,
        },
        deals: {
          deals: [s.entry.deal!, s.rawEvents.closed.deal!],
          hasMore: false,
          receivedAt,
        },
        reconciliation: { orders: [], positions: [], receivedAt },
      };
      const calls: string[] = [];
      const broker = {
        orderHistoryRaw: vi.fn(() => {
          calls.push("orders");
          return Promise.resolve(history.orders);
        }),
        dealHistoryRaw: vi.fn(() => {
          calls.push("deals");
          return Promise.resolve(history.deals);
        }),
        reconcileRaw: vi.fn(() => {
          calls.push("reconcile");
          return Promise.resolve(history.reconciliation);
        }),
      };
      const attestor = () =>
        new TerminalHistoryAttestor({
          pool,
          accountId: s.accountId,
          symbolId: s.symbolId,
          brokerSymbol: "7",
          client: broker,
          now: () => now,
        });
      const snapshot = () => readTerminalGroup(pool, s.groupId);
      return { ...s, history, now, calls, broker, attestor, snapshot };
    }

    it("attests a truly locally unsent peer with complete filled-leg history across restart", async () => {
      const s = await attestationFixture();
      // Construct the alternative synthetic scenario; no broker peer ever existed.
      await pool.query(
        "DELETE FROM broker_execution_events WHERE order_group_id=$1 AND client_order_id=$2",
        [s.groupId, s.sellClient],
      );
      await pool.query(
        "UPDATE orders SET broker_order_id=NULL,broker_updated_at=NULL,submitted_at=NULL,state='REJECTED',filled_volume=0 WHERE client_order_id=$1",
        [s.sellClient],
      );
      s.history.orders.orders = s.history.orders.orders.filter(
        (o) => o.clientOrderId !== s.sellClient,
      );
      await pool.query(
        `INSERT INTO local_unsent_entry_proofs(order_id,order_group_id,account_id,symbol_id,client_order_id,reason_code,source_updated_at,recorded_at)
        SELECT id,order_group_id,account_id,$2,client_order_id,'DEMO_PEER_WITHHELD_BEFORE_DISPATCH',$3,$3 FROM orders WHERE client_order_id=$1`,
        [s.sellClient, s.symbolId, s.events.closed.occurredAt],
      );
      const snapshot = await s.snapshot();
      expect(
        proveTerminalGroup(snapshot, s.history, "7", s.now).reason,
      ).toBeNull();
      const missing = structuredClone(snapshot);
      const peer = missing.orders.find((o) => o.clientId === s.sellClient)!;
      delete (peer as { localUnsent?: unknown }).localUnsent;
      expect(
        proveTerminalGroup(missing, s.history, "7", s.now).reason,
      ).not.toBeNull();
      const contradict = structuredClone(s.history);
      contradict.orders.orders.push(s.rawEvents.peerCancelled.order!);
      expect(proveTerminalGroup(snapshot, contradict, "7", s.now).reason).toBe(
        "DEMO_TERMINAL_LOCAL_UNSENT_PROOF_INVALID",
      );
      await s.attestor().run();
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: true,
        terminalOrderGroupId: s.groupId,
      });
      expect(
        (await s.restart().reconcileTerminalEvidence()).terminalOrders,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            brokerOrderId: null,
            state: "REJECTED",
            filledVolume: "0",
          }),
        ]),
      );
      await pool.query(
        "UPDATE orders SET submitted_at=now() WHERE client_order_id=$1",
        [s.sellClient],
      );
      expect(
        proveTerminalGroup(await s.snapshot(), s.history, "7", s.now).reason,
      ).not.toBeNull();
    });

    it("reconciles an exact full manual market close but preserves missing outcome blocks", async () => {
      const s = await setup();
      await s.restart().persist(s.events.peerCancelled);
      const closed = structuredClone(s.rawEvents.closed);
      closed.order!.orderType = 1;
      await s.restart().persist(s.normalize(closed));
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: true,
        terminalOrderGroupId: s.groupId,
      });
      const uncertain = await setup();
      await uncertain.restart().persist(uncertain.events.accepted);
      await uncertain.restart().persist(uncertain.events.peerCancelled);
      expect(
        (await uncertain.restart().reconcileTerminalEvidence()).certain,
      ).toBe(false);
    });

    it("recovers a manual close with a non-bot client ID and resolves its retained acknowledgement", async () => {
      const f = await setup();
      await f.restart().persist(f.events.peerCancelled);
      const ack = structuredClone(f.rawEvents.accepted);
      ack.order!.orderType = 1;
      ack.order!.clientOrderId = "external-ui-close";
      expect((await f.restart().persist(f.normalize(ack))).certain).toBe(false);
      const close = structuredClone(f.rawEvents.closed);
      close.order!.orderType = 1;
      close.order!.clientOrderId = "external-ui-close";
      close.position!.price = 0;
      expect((await f.restart().persist(f.normalize(close))).certain).toBe(
        true,
      );
      expect((await f.restart().readiness()).certain).toBe(true);
      expect((await f.restart().reconcileTerminalEvidence()).certain).toBe(
        true,
      );
      const rows = await pool.query<{ n: number }>(
        "SELECT count(*)::int n FROM position_close_deals WHERE account_id=$1",
        [f.accountId],
      );
      expect(rows.rows[0]!.n).toBe(1);
      await f.restart().persist(f.normalize(close));
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int n FROM trades WHERE order_group_id=$1",
            [f.groupId],
          )
        ).rows[0]!.n,
      ).toBe(1);
    });

    it("records partial manual outcomes, retains remaining exposure, then aggregates one exact net close across restarts", async () => {
      const f = await setup();
      await f.restart().persist(f.events.peerCancelled);
      const leg = (
        volume: string,
        remaining: string,
        id: string,
        offset: number,
        gross: string,
        fee: string,
      ) => {
        const raw = structuredClone(f.rawEvents.closed);
        raw.order!.orderType = 1;
        raw.order!.clientOrderId = "external-ui-" + id;
        raw.order!.orderId = id;
        raw.order!.executedVolume = volume;
        (raw.order!.tradeData as Record<string, unknown>).volume = volume;
        raw.deal!.dealId = id;
        raw.deal!.orderId = id;
        raw.deal!.filledVolume = volume;
        raw.deal!.commission = fee;
        const d = raw.deal!.closePositionDetail as Record<string, unknown>;
        Object.assign(d, {
          closedVolume: volume,
          grossProfit: gross,
          commission: fee,
          swap: "0",
          pnlConversionFee: "0",
        });
        const at = Number(raw.deal!.executionTimestamp) + offset;
        raw.deal!.executionTimestamp = at;
        raw.order!.utcLastUpdateTimestamp = at;
        raw.position!.utcLastUpdateTimestamp = at;
        raw.position!.positionStatus = remaining === "0" ? 2 : 1;
        raw.position!.price = remaining === "0" ? 0 : f.entry.position!.price;
        const pd = raw.position!.tradeData as Record<string, unknown>;
        pd.volume = remaining;
        if (remaining === "0") pd.closeTimestamp = at;
        else delete pd.closeTimestamp;
        return raw;
      };
      const first = f.normalize(leg("40", "60", "710", -2000, "400", "-10"));
      expect((await f.restart().persist(first)).reasonCodes).toContain(
        "DEMO_PARTIAL_CLOSE_RECONCILIATION_REQUIRED",
      );
      expect(
        (
          await pool.query(
            "SELECT state,volume::text FROM positions WHERE order_group_id=$1",
            [f.groupId],
          )
        ).rows[0],
      ).toMatchObject({ state: "OPEN", volume: "60.0000000000" });
      expect(
        (
          await pool.query<{ n: number }>(
            "SELECT count(*)::int n FROM trades WHERE order_group_id=$1",
            [f.groupId],
          )
        ).rows[0]!.n,
      ).toBe(0);
      await f.restart().persist(first);
      const last = f.normalize(leg("60", "0", "711", 0, "600", "-20"));
      expect((await f.restart().persist(last)).certain).toBe(true);
      expect((await f.restart().readiness()).certain).toBe(true);
      expect((await f.restart().reconcileTerminalEvidence()).certain).toBe(
        true,
      );
      expect(
        (
          await pool.query(
            "SELECT realized_pnl::text,fees::text FROM trades WHERE order_group_id=$1",
            [f.groupId],
          )
        ).rows,
      ).toEqual([{ realized_pnl: "9.7000000000", fees: "-0.3000000000" }]);
      const closeRows = await pool.query<{ n: number }>(
        "SELECT count(*)::int n FROM position_close_deals WHERE account_id=$1",
        [f.accountId],
      );
      expect(closeRows.rows[0]!.n).toBe(2);
      await expect(
        pool.query(
          "UPDATE position_close_deals SET gross_profit=0 WHERE account_id=$1",
          [f.accountId],
        ),
      ).rejects.toThrow("POSITION_CLOSE_DEAL_IMMUTABLE");
    });

    it.each(["volume", "entry", "ownership", "bot_client", "time"])(
      "rejects contradictory manual close evidence: %s",
      async (fault) => {
        const f = await setup();
        await f.restart().persist(f.events.peerCancelled);
        const raw = structuredClone(f.rawEvents.closed);
        raw.order!.orderType = 1;
        raw.order!.clientOrderId = "external-ui-close";
        if (fault === "volume")
          (
            raw.deal!.closePositionDetail as Record<string, unknown>
          ).closedVolume = "99";
        if (fault === "entry")
          (
            raw.deal!.closePositionDetail as Record<string, unknown>
          ).entryPrice = 123;
        if (fault === "ownership")
          await pool.query(
            "UPDATE positions SET strategy_owned=false WHERE order_group_id=$1",
            [f.groupId],
          );
        if (fault === "bot_client")
          raw.order!.clientOrderId = "cas-unclaimed-close";
        if (fault === "time")
          (raw.position!.tradeData as Record<string, unknown>).openTimestamp =
            1;
        expect((await f.restart().persist(f.normalize(raw))).certain).toBe(
          false,
        );
        expect(
          (
            await pool.query<{ n: number }>(
              "SELECT count(*)::int n FROM trades WHERE order_group_id=$1",
              [f.groupId],
            )
          ).rows[0]!.n,
        ).toBe(0);
        expect(
          (
            await pool.query<{ n: number }>(
              "SELECT count(*)::int n FROM position_close_deals WHERE account_id=$1",
              [f.accountId],
            )
          ).rows[0]!.n,
        ).toBe(0);
      },
    );

    it("recovers a missed external market close from broker history without resetting or duplicating outcomes", async () => {
      const f = await setup();
      await f.restart().persist(f.events.peerCancelled);
      const close = structuredClone(f.rawEvents.closed);
      close.order!.orderType = 1;
      close.order!.clientOrderId = "external-ui-history";
      const receivedAt = new Date(
        Number(close.deal!.executionTimestamp) + 1000,
      ).toISOString();
      const client = {
        orderHistoryRaw: vi.fn(() =>
          Promise.resolve({
            orders: [
              f.entry.order!,
              f.rawEvents.peerCancelled.order!,
              close.order!,
            ],
            hasMore: false,
            receivedAt,
          }),
        ),
        dealHistoryRaw: vi.fn(() =>
          Promise.resolve({
            deals: [f.entry.deal!, close.deal!],
            hasMore: false,
            receivedAt,
          }),
        ),
        reconcileRaw: vi.fn(() =>
          Promise.resolve({
            positions: [],
            orders: [],
            receivedAt,
          }),
        ),
      };
      const run = () =>
        recoverDemoExecutions({
          pool,
          accountId: f.accountId,
          symbolId: f.symbolId,
          client,
          store: f.restart(),
          normalizer: { symbolId: "7" },
          now: () => new Date(receivedAt),
        });
      expect((await run()).certain).toBe(true);
      expect((await run()).certain).toBe(true);
      expect(client.dealHistoryRaw).toHaveBeenCalledTimes(1);
      const count = await pool.query<{ n: number }>(
        "SELECT count(*)::int n FROM trades WHERE order_group_id=$1",
        [f.groupId],
      );
      expect(count.rows[0]!.n).toBe(1);
      expect((await f.restart().readiness()).certain).toBe(true);
    });

    it("attests the complete group serially and resolves a retained context-only conflict across restarts", async () => {
      const s = await attestationFixture();
      expect(
        proveTerminalGroup(await s.snapshot(), s.history, "7", s.now).reason,
      ).toBeNull();
      await s.attestor().run();
      expect(s.calls).toEqual(["orders", "deals", "reconcile"]);
      const attempts = await pool.query<{
        status: string;
        reason_code: string | null;
      }>(
        "SELECT status,reason_code FROM broker_terminal_history_attempts WHERE order_group_id=$1",
        [s.groupId],
      );
      expect(attempts.rows).toEqual([
        { status: "VERIFIED", reason_code: null },
      ]);
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: true,
        resolvedEventCount: 2,
        terminalOrderGroupId: s.groupId,
      });
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: true,
        resolvedEventCount: 0,
        terminalOrderGroupId: s.groupId,
      });
      await s.attestor().run();
      expect(s.calls).toHaveLength(3);
      const row = await pool.query<{
        normalized_payload: unknown;
        mapping_state: string;
        resolution_event_key: string;
      }>(
        "SELECT normalized_payload,mapping_state,resolution_event_key FROM broker_execution_events WHERE account_id=$1 AND broker_event_key=$2",
        [s.accountId, s.events.closed.eventKey],
      );
      expect(row.rows[0]).toMatchObject({
        normalized_payload: s.events.closed,
        mapping_state: "CONFLICT",
      });
      expect(row.rows[0]?.resolution_event_key).toMatch(/^history:/);
    });

    it.each([
      "missing_variant",
      "fee",
      "extra_deal",
      "peer",
      "stale",
      "truncated",
      "missing_entry_cost",
      "missing_peer_volume",
      "entry_order_volume",
    ])(
      "rejects incomplete or conflicting group evidence: %s",
      async (fault) => {
        const s = await attestationFixture();
        if (fault === "missing_variant")
          await pool.query(
            "DELETE FROM broker_execution_event_variants WHERE event_id IN (SELECT id FROM broker_execution_events WHERE account_id=$1)",
            [s.accountId],
          );
        if (fault === "fee")
          await pool.query(
            "UPDATE trades SET fees=fees-1 WHERE order_group_id=$1",
            [s.groupId],
          );
        if (fault === "extra_deal")
          s.history.deals.deals.push({ ...s.entry.deal!, dealId: "999" });
        if (fault === "entry_order_volume")
          (
            s.history.orders.orders[0]!.tradeData as Record<string, unknown>
          ).volume = "200";
        if (fault === "peer") s.history.orders.orders[1]!.orderStatus = 1;
        if (fault === "stale")
          s.history.reconciliation.receivedAt = new Date(
            s.now.getTime() - 31_000,
          ).toISOString();
        if (fault === "truncated") s.history.deals.hasMore = true;
        if (fault === "missing_entry_cost")
          delete s.history.deals.deals[0]!.commission;
        if (fault === "missing_peer_volume")
          delete s.history.orders.orders[1]!.executedVolume;
        expect(
          proveTerminalGroup(await s.snapshot(), s.history, "7", s.now).reason,
        ).not.toBeNull();
        await s.attestor().run();
        expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
          certain: false,
          resolvedEventCount: 0,
        });
      },
    );

    it("invalidates verified history after a new variant and does not reuse a stale proof", async () => {
      const s = await attestationFixture();
      await s.attestor().run();
      const changed = structuredClone(s.rawEvents.closed);
      changed.position!.takeProfit = 2008;
      await s.restart().persist(s.normalize(changed), "BROKER_CALLBACK");
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: false,
        resolvedEventCount: 0,
      });
    });

    it("retains a bounded failed attempt on broker error and blocks immediate retries", async () => {
      const s = await attestationFixture();
      s.broker.orderHistoryRaw.mockRejectedValueOnce(
        new Error("private broker diagnostic"),
      );
      await s.attestor().run();
      await s.attestor().run();
      expect(s.broker.orderHistoryRaw).toHaveBeenCalledTimes(1);
      expect(s.broker.dealHistoryRaw).not.toHaveBeenCalled();
      const attempts = await pool.query<{
        status: string;
        reason_code: string;
      }>(
        "SELECT status,reason_code FROM broker_terminal_history_attempts WHERE order_group_id=$1",
        [s.groupId],
      );
      expect(attempts.rows).toEqual([
        { status: "FAILED", reason_code: "DEMO_TERMINAL_HISTORY_FETCH_FAILED" },
      ]);
    });

    it("rejects local mutation during the history request", async () => {
      const s = await attestationFixture();
      s.broker.reconcileRaw.mockImplementationOnce(async () => {
        await pool.query(
          "UPDATE trades SET fees=fees-1 WHERE order_group_id=$1",
          [s.groupId],
        );
        return s.history.reconciliation;
      });
      await s.attestor().run();
      const attempts = await pool.query<{
        status: string;
        reason_code: string;
      }>(
        "SELECT status,reason_code FROM broker_terminal_history_attempts WHERE order_group_id=$1",
        [s.groupId],
      );
      expect(attempts.rows).toEqual([
        {
          status: "FAILED",
          reason_code: "DEMO_TERMINAL_HISTORY_SOURCE_CHANGED",
        },
      ]);
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: false,
        resolvedEventCount: 0,
      });
    });

    it("rejects an attestation from an unrecognized verifier version", async () => {
      const s = await attestationFixture();
      await s.attestor().run();
      await pool.query(
        "UPDATE broker_terminal_history_attempts SET verifier_version='future-verifier' WHERE order_group_id=$1",
        [s.groupId],
      );
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: false,
        resolvedEventCount: 0,
      });
    });

    it("audits legacy financial completeness without creating recovery authority", async () => {
      const s = await attestationFixture();
      await pool.query(
        "DELETE FROM broker_execution_event_variants WHERE event_id IN (SELECT id FROM broker_execution_events WHERE account_id=$1)",
        [s.accountId],
      );
      const snapshot = await s.snapshot();
      expect(
        auditLegacyTerminalGroup(snapshot, s.history, "7", s.now),
      ).toMatchObject({
        decision: "HOLD",
        brokerAuthority: false,
        financialEvidenceComplete: true,
        legacyGapIsOnlyFailedCheck: true,
        reason: "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED",
      });
      expect(
        proveTerminalGroup(snapshot, s.history, "7", s.now).eventHashes,
      ).toEqual({});
      const entryConflict = structuredClone(snapshot);
      const entry = entryConflict.events.find((e) => !e.payload.closingOrder)!;
      Object.assign(entry, {
        mapping: "CONFLICT",
        reasons: ["DEMO_BROKER_EVENT_KEY_CONFLICT"],
        resolved: true,
      });
      expect(
        auditLegacyTerminalGroup(entryConflict, s.history, "7", s.now),
      ).toMatchObject({
        decision: "HOLD",
        brokerAuthority: false,
        financialEvidenceComplete: false,
        reason: "DEMO_TERMINAL_ADDITIONAL_UNCERTAINTY",
      });
      await s.attestor().run();
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: false,
        resolvedEventCount: 0,
      });
      await pool.query(
        "UPDATE trades SET fees=fees-1 WHERE order_group_id=$1",
        [s.groupId],
      );
      expect(
        auditLegacyTerminalGroup(await s.snapshot(), s.history, "7", s.now),
      ).toMatchObject({
        decision: "HOLD",
        brokerAuthority: false,
        financialEvidenceComplete: false,
      });
    });

    it("can read a pre-variant financial snapshot without using it for automatic recovery", async () => {
      const s = await attestationFixture();
      const snapshot = await readTerminalGroup(pool, s.groupId, false);
      expect(snapshot.variants).toEqual([]);
      expect(proveTerminalGroup(snapshot, s.history, "7", s.now).reason).toBe(
        "DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED",
      );
    });

    it("retains closing variants with provenance across duplicates and restarts without self-resolving", async () => {
      const s = await setup();
      await s.restart().persist(s.events.peerCancelled);
      await s.restart().persist(s.events.closed);
      const raw = structuredClone(s.rawEvents.closed);
      raw.position!.takeProfit = 2007;
      const changed = s.normalize(raw);
      for (let i = 0; i < 2; i++)
        await expect(
          s.restart().persist(changed, "BROKER_CALLBACK"),
        ).resolves.toMatchObject({ certain: false });
      await s.restart().persist(changed, "HISTORY_RECONSTRUCTION");
      const variants = await pool.query(
        `SELECT v.payload_hash, v.normalized_payload, v.evidence_source
         FROM broker_execution_event_variants v JOIN broker_execution_events e ON e.id=v.event_id
         WHERE e.account_id=$1 ORDER BY v.evidence_source`,
        [s.accountId],
      );
      expect(variants.rows).toEqual([
        {
          payload_hash: changed.payloadHash,
          normalized_payload: changed,
          evidence_source: "BROKER_CALLBACK",
        },
        {
          payload_hash: changed.payloadHash,
          normalized_payload: changed,
          evidence_source: "HISTORY_RECONSTRUCTION",
        },
        {
          payload_hash: s.events.closed.payloadHash,
          normalized_payload: s.events.closed,
          evidence_source: "ORIGINAL_JOURNAL",
        },
      ]);
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: false,
        resolvedEventCount: 0,
      });
      const original = await pool.query(
        `SELECT payload_hash, normalized_payload, resolved_at FROM broker_execution_events
         WHERE account_id=$1 AND broker_event_key=$2`,
        [s.accountId, changed.eventKey],
      );
      expect(original.rows[0]).toEqual({
        payload_hash: s.events.closed.payloadHash,
        normalized_payload: s.events.closed,
        resolved_at: null,
      });
    });

    it("preserves additional conflict reasons and rolls back variant storage failures", async () => {
      const s = await setup();
      await pool.query(
        `UPDATE broker_execution_events SET reason_codes=$2::jsonb
         WHERE account_id=$1 AND broker_event_key=$3`,
        [
          s.accountId,
          JSON.stringify([replacement]),
          s.normalize(s.entry).eventKey,
        ],
      );
      const raw = structuredClone(s.entry);
      raw.position!.takeProfit = 2007;
      const changed = s.normalize(raw);
      await expect(
        s.restart().persist(changed, "INVALID" as never),
      ).rejects.toThrow();
      const before = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM broker_execution_event_variants v
         JOIN broker_execution_events e ON e.id=v.event_id WHERE e.account_id=$1`,
        [s.accountId],
      );
      expect(before.rows[0]?.count).toBe(0);
      await s.restart().persist(changed, "BROKER_CALLBACK");
      await s.restart().persist(s.events.closed);
      await s.restart().persist(s.events.peerCancelled);
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: false,
      });
      const row = await pool.query<{ reason_codes: string[] }>(
        `SELECT reason_codes FROM broker_execution_events WHERE account_id=$1 AND broker_event_key=$2`,
        [s.accountId, changed.eventKey],
      );
      expect(row.rows[0]?.reason_codes).toEqual([
        replacement,
        "DEMO_BROKER_EVENT_KEY_CONFLICT",
      ]);
    });

    it("reopens a resolved marker only for a new variant and preserves its prior proof", async () => {
      const s = await setup();
      await s.restart().persist(s.events.peerCancelled);
      await s.restart().persist(s.events.closed);
      const raw = structuredClone(s.entry);
      raw.position!.takeProfit = 2007;
      const first = s.normalize(raw);
      await s.restart().persist(first, "BROKER_CALLBACK");
      expect(await s.restart().reconcileTerminalEvidence()).toMatchObject({
        certain: true,
      });
      await s.restart().persist(first, "BROKER_CALLBACK");
      expect(await s.restart().readiness()).toMatchObject({ certain: true });
      raw.position!.takeProfit = 2008;
      const next = s.normalize(raw);
      await s.restart().persist(next, "BROKER_CALLBACK");
      expect(await s.restart().readiness()).toMatchObject({ certain: false });
      const retained = await pool.query<{
        original_resolution_event_key: string | null;
        was_resolved: boolean;
      }>(
        `SELECT v.original_resolution_event_key, v.original_resolved_at IS NOT NULL AS was_resolved
         FROM broker_execution_event_variants v JOIN broker_execution_events e ON e.id=v.event_id
         WHERE e.account_id=$1 AND v.payload_hash=$2`,
        [s.accountId, next.payloadHash],
      );
      expect(retained.rows).toEqual([
        {
          original_resolution_event_key: s.events.closed.eventKey,
          was_resolved: true,
        },
      ]);
    });

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
