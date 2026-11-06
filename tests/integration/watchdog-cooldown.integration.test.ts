import { randomUUID } from "node:crypto";
import path from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { PostgresAutomaticAnalysisWatchdog } from "../../apps/execution-service/src/automatic-analysis-watchdog.js";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  "watchdog loss cooldown (isolated Postgres)",
  () => {
    let admin: pg.Pool, pool: pg.Pool;
    const schema = `cooldown_${randomUUID().replaceAll("-", "")}`;
    const strategy = randomUUID();
    const now = new Date("2026-08-31T01:00:00Z");
    const observation = {
      automaticAnalysisEnabled: true,
      paused: false,
      managedSetupActive: false,
      now,
    };
    beforeAll(async () => {
      admin = createPool({ connectionString: url! });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const isolated = new URL(url!);
      isolated.searchParams.set("options", `-csearch_path=${schema}`);
      pool = createPool({ connectionString: isolated.toString() });
      await migrate(pool, path.resolve("migrations"));
      await pool.query(
        `INSERT INTO strategy_versions
      (id, version, code_hash, config_hash, prompt_version, schema_version, feature_version)
      VALUES ($1, 'watchdog-fixture', 'fixture', 'fixture', 'fixture', '2.1', '1.1')`,
        [strategy],
      );
    }, 60_000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
    });
    async function fixture() {
      const accountId = randomUUID(),
        symbolId = randomUUID();
      await pool.query(
        `INSERT INTO accounts
      (id, provider, provider_account_key_hash, environment, account_type, currency)
      VALUES ($1, 'ctrader', $2, 'demo', 'demo', 'USD')`,
        [accountId, randomUUID().replaceAll("-", "").repeat(2)],
      );
      await pool.query(
        `INSERT INTO symbols
      (id, account_id, provider_symbol_id, name, digits, tick_size, tick_value, contract_size,
       min_volume, max_volume, volume_step, min_stop_distance, metadata_revision, metadata_at, volume_scale)
      VALUES ($1,$2,'7','XAUUSD',2,0.01,0.01,100,1,100000,1,0,'fixture',$3,0.01)`,
        [symbolId, accountId, now],
      );
      await pool.query(
        `INSERT INTO spread_observations
      (id,account_id,symbol_id,source_minute,source_time,received_at,server_time,bid,ask,spread,created_at)
      VALUES ($1,$2,$3,floor(extract(epoch FROM $4::timestamptz)/60)::bigint,$4,$4,$4,4000,4000.1,0.1,$4)`,
        [randomUUID(), accountId, symbolId, now],
      );
      const options = {
        pool,
        accountId,
        symbolId,
        strategyVersionId: strategy,
        strategyVersion: "watchdog-fixture",
        symbol: "XAUUSD",
        accountKey: "fixture",
        instanceId: "fixture",
        environment: "test",
        mode: "demo",
        serviceStartedAt: new Date("2026-08-31T00:50:00Z"),
        stallAfterMs: 180_000,
        lossCooldown: { streakLosses: 3, streakPauseMinutes: 60 },
      };
      return {
        options,
        watchdog: new PostgresAutomaticAnalysisWatchdog(options),
      };
    }
    async function close(
      accountId: string,
      symbolId: string,
      pnl: string,
      at: string,
    ) {
      const analysis = randomUUID(),
        group = randomUUID();
      await pool.query(
        `INSERT INTO analysis_runs
      (id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time)
      VALUES ($1,$2,$3,$4,'demo','EXPIRED',$5)`,
        [analysis, accountId, symbolId, strategy, at],
      );
      await pool.query(
        `INSERT INTO order_groups
      (id,analysis_id,idempotency_key,mode,state,expires_at,created_at,updated_at)
      VALUES ($1,$2,$4,'demo','CLOSED',$3,$3,$3)`,
        [group, analysis, at, group],
      );
      await pool.query(
        `INSERT INTO trades
      (id,order_group_id,mode,direction,market_regime,confidence_bucket,realized_pnl,opened_at,closed_at,
       model_version,prompt_version,schema_version,strategy_version)
      VALUES ($1,$2,'demo','LONG','UNCERTAIN','fixture',$3,$4,$4,'fixture','fixture','2.1','watchdog-fixture')`,
        [randomUUID(), group, pnl, at],
      );
    }
    it("reads the exact account-wide streak, counts zero and does not mark a cooldown as resumed", async () => {
      const x = await fixture(),
        other = await fixture();
      const secondSymbol = randomUUID();
      await pool.query(
        `INSERT INTO symbols (id, account_id, provider_symbol_id, name, digits, tick_size, tick_value, contract_size, min_volume, max_volume, volume_step, min_stop_distance, metadata_revision, metadata_at, volume_scale) VALUES ($1,$2,'8','OTHER',2,0.01,0.01,100,1,100000,1,0,'fixture',$3,0.01)`,
        [secondSymbol, x.options.accountId, now],
      );
      await close(
        x.options.accountId,
        secondSymbol,
        "-10",
        "2026-08-31T00:10:00Z",
      );
      await close(
        x.options.accountId,
        x.options.symbolId,
        "-10",
        "2026-08-31T00:20:00Z",
      );
      await close(
        x.options.accountId,
        x.options.symbolId,
        "0",
        "2026-08-31T00:30:00Z",
      );
      await close(
        other.options.accountId,
        other.options.symbolId,
        "100",
        "2026-08-31T00:59:00Z",
      );
      await expect(x.watchdog.observe(observation)).resolves.toMatchObject({
        state: "WAITING_FOR_COOLDOWN",
        reasonCodes: ["LOSS_STREAK_PAUSE_ACTIVE"],
        lossCooldown: {
          checkedAt: now.toISOString(),
          until: "2026-08-31T01:30:00.000Z",
        },
      });
      const audit = await pool.query(
        `SELECT event_name FROM audit_events WHERE account_key='fixture'`,
      );
      expect(audit.rows).toEqual([]);
      await close(
        x.options.accountId,
        x.options.symbolId,
        "1",
        "2026-08-31T00:40:00Z",
      );
      await expect(x.watchdog.snapshot(observation)).resolves.toMatchObject({
        state: "STALLED",
      });
      expect(
        (
          await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM orders",
          )
        ).rows[0]?.count,
      ).toBe(0);
    });
    it("does not invent a streak from too few losses or use another account's losses", async () => {
      const x = await fixture(),
        other = await fixture();
      for (const at of ["00:10", "00:20", "00:30"]) {
        await close(
          other.options.accountId,
          other.options.symbolId,
          "-1",
          `2026-08-31T${at}:00Z`,
        );
      }
      await close(
        x.options.accountId,
        x.options.symbolId,
        "-1",
        "2026-08-31T00:40:00Z",
      );
      await expect(x.watchdog.snapshot(observation)).resolves.toMatchObject({
        state: "STALLED",
      });
    });
    it("resumes stall detection after expiry and preserves failures instead of claiming a wait", async () => {
      const x = await fixture();
      for (const at of ["23:10", "23:20", "23:30"]) {
        await close(
          x.options.accountId,
          x.options.symbolId,
          "-1",
          `2026-08-30T${at}:00Z`,
        );
      }
      await expect(x.watchdog.snapshot(observation)).resolves.toMatchObject({
        state: "STALLED",
      });
      await pool.query("ALTER TABLE trades RENAME TO unavailable_trades");
      try {
        await expect(x.watchdog.snapshot(observation)).rejects.toThrow(
          /trades/,
        );
      } finally {
        await pool.query("ALTER TABLE unavailable_trades RENAME TO trades");
      }
    });
  },
);
