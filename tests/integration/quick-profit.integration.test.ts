import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createPool } from "../../packages/database/src/index.js";
import { PostgresPositionProtection } from "../../apps/execution-service/src/postgres-position-protection.js";
import { CODEX_STRATEGY_VERSION } from "../../packages/config/src/policy.js";
import type { ProtectionPosition } from "../../apps/execution-service/src/position-protection.js";
import type { ProfitExitEvidence } from "../../apps/execution-service/src/quick-profit-exit.js";
const url = process.env.TEST_DATABASE_URL;
const test = url ? it : it.skip;
test("profit-close SQL claim is scoped, fresh, complete and durable across instances", async () => {
  const admin = createPool({ connectionString: url! });
  const schema = `profit_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const conn = new URL(url!);
  conn.searchParams.set("options", `-csearch_path=${schema}`);
  const pool = createPool({
    connectionString: conn.toString(),
    sslMode: "require",
  });
  const p = randomUUID(),
    a = randomUUID(),
    s = randomUUID(),
    g = randomUUID(),
    ar = randomUUID(),
    sv = randomUUID();
  const at = "2026-10-26T07:00:00Z";
  try {
    await pool.query(`CREATE TABLE positions(id uuid,broker_position_id text,account_id uuid,symbol_id uuid,order_group_id uuid,state text,volume numeric,entry_price numeric,strategy_owned boolean,side text);
 CREATE TABLE order_groups(id uuid,analysis_id uuid,mode text);
 CREATE TABLE analysis_runs(id uuid,strategy_version_id uuid);
 CREATE TABLE strategy_versions(id uuid,version text);
 CREATE TABLE orders(order_group_id uuid,side text,state text,strategy_owned boolean,filled_volume numeric);
 CREATE TABLE position_close_deals(position_id uuid);
 CREATE TABLE broker_execution_events(account_id uuid,symbol_id uuid,resolved_at timestamptz,reason_codes jsonb);
 CREATE TABLE position_protection(position_id uuid PRIMARY KEY,status text,stop_loss numeric,take_profit numeric,expected_stop_loss numeric,expected_take_profit numeric,observed_at timestamptz,reason_code text,close_requested_at timestamptz,close_volume numeric,command_at timestamptz,updated_at timestamptz);
 CREATE TABLE position_protection_events(id uuid,position_id uuid,kind text,details jsonb);`);
    await pool.query("INSERT INTO strategy_versions VALUES($1,$2)", [
      sv,
      CODEX_STRATEGY_VERSION,
    ]);
    await pool.query("INSERT INTO analysis_runs VALUES($1,$2)", [ar, sv]);
    await pool.query("INSERT INTO order_groups VALUES($1,$2,'demo')", [g, ar]);
    await pool.query(
      "INSERT INTO positions VALUES($1,'801',$2,$3,$4,'OPEN',100,4000,true,'BUY')",
      [p, a, s, g],
    );
    await pool.query(
      "INSERT INTO orders VALUES($1,'BUY','FILLED',true,100),($1,'SELL','CANCELLED',true,0)",
      [g],
    );
    const position: ProtectionPosition = {
      id: p,
      brokerPositionId: "801",
      side: "BUY",
      volume: "100.0000000000",
      entryPrice: "4000",
      orderEntry: "4000",
      orderStopLoss: "3993",
      orderTakeProfit: "4000.4",
      label: "ctrader-ai-scalper:test",
      repairAttempts: 0,
      commandAt: null,
      closeRequestedAt: null,
      strategyVersion: CODEX_STRATEGY_VERSION,
      entryCommission: "-0.12",
    };
    const evidence: ProfitExitEvidence = {
      policy: "quick-profit-exit-v1",
      quote: { bid: "4000.4", ask: "4000.5", sourceTime: at, receivedAt: at },
      metadataTime: at,
      entry: "4000",
      volume: "100",
      gross: "0.4",
      entryCommission: "-0.12",
      modeledExitCommission: "-0.12",
      swap: "0",
      conversionReserve: "0",
      executionReserve: "0.05",
      modeledNet: "0.11",
      requiredNet: "0.05",
      guaranteedProceeds: false,
    };
    const store = new PostgresPositionProtection({
      pool,
      accountId: a,
      symbolId: s,
    });
    await store.exclusive(async (session) => {
      await session.observe(position, {
        schemaVersion: "1.0",
        status: "CLOSE_REQUIRED",
        stopLoss: "3993",
        takeProfit: "4000.4",
        expectedStopLoss: "3993",
        expectedTakeProfit: "4000.4",
        observedAt: at,
        reasonCode: "QUICK_PROFIT_EXIT_COST_COVERED",
      });
      expect(await session.claimClose(position, at, "100")).toBe(false); // SL is present; missing-SL authority stays separate.
      expect(
        await session.claimProfitClose!(
          position,
          "2026-10-26T07:00:02Z",
          evidence,
        ),
      ).toBe(false);
      expect(
        await session.claimProfitClose!(position, at, {
          ...evidence,
          volume: "99",
        }),
      ).toBe(false);
      expect(
        await session.claimProfitClose!(
          { ...position, strategyVersion: "old" },
          at,
          evidence,
        ),
      ).toBe(false);
      await new PostgresPositionProtection({
        pool,
        accountId: randomUUID(),
        symbolId: s,
      }).exclusive(async (other) => {
        expect(await other.claimProfitClose!(position, at, evidence)).toBe(
          false,
        );
      });
      await pool.query("UPDATE positions SET volume=99");
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
      await pool.query("UPDATE positions SET volume=100");
      await pool.query("UPDATE order_groups SET mode='live'");
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
      await pool.query("UPDATE order_groups SET mode='demo'");
      await pool.query("UPDATE orders SET state='PENDING' WHERE side='SELL'");
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
      await pool.query("UPDATE orders SET state='CANCELLED' WHERE side='SELL'");
      await pool.query("INSERT INTO position_close_deals VALUES($1)", [p]);
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
      await pool.query("DELETE FROM position_close_deals");
      await pool.query(
        "INSERT INTO broker_execution_events VALUES($1,$2,NULL,'[\"UNRESOLVED\"]')",
        [a, s],
      );
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
      await pool.query("UPDATE broker_execution_events SET resolved_at=$1", [
        at,
      ]);
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        true,
      );
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
    });
    await new PostgresPositionProtection({
      pool,
      accountId: a,
      symbolId: s,
    }).exclusive(async (session) => {
      expect(await session.claimProfitClose!(position, at, evidence)).toBe(
        false,
      );
    });
    const result = await pool.query<{
      details: { evidence: { guaranteedProceeds: boolean } };
    }>(
      "SELECT details FROM position_protection_events WHERE kind='CLOSE_CLAIM'",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.details.evidence.guaranteedProceeds).toBe(false);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
