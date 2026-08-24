import { randomUUID } from "node:crypto";
import path from "node:path";

import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  createPool,
  databaseConnectionString,
  migrate,
} from "../../packages/database/src/index.js";
import { DailyRiskStore } from "../../apps/execution-service/src/daily-risk-store.js";

const connectionString = process.env.TEST_DATABASE_URL;
const databaseTest =
  connectionString === undefined || connectionString === "" ? it.skip : it;

describe("PostgreSQL migrations integration", () => {
  databaseTest("applies all migrations in an isolated schema", async () => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({
      connectionString: databaseConnectionString(connectionString as string),
      ssl: { rejectUnauthorized: true },
    });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString as string);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const isolated = createPool({
      connectionString: url.toString(),
      sslMode: "require",
    });
    try {
      expect(await migrate(isolated, path.resolve("migrations"))).toEqual([
        "0001",
        "0002",
        "0003",
        "0004",
        "0005",
      ]);
      const column = await isolated.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'symbols' AND column_name = 'volume_scale'
         ) AS exists`,
        [schema],
      );
      expect(column.rows[0]?.exists).toBe(true);
      const netFlows = await isolated.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'daily_risk_state'
             AND column_name = 'net_flows'
         ) AS exists`,
        [schema],
      );
      expect(netFlows.rows[0]?.exists).toBe(true);
      await isolated.query(
        `INSERT INTO accounts
          (id, provider, provider_account_key_hash, environment, account_type, currency)
         VALUES ($1, 'paper', $2, 'paper', 'paper', 'USD')`,
        [randomUUID(), "a".repeat(64)],
      );
      const demoAccountId = randomUUID();
      await isolated.query(
        `INSERT INTO accounts
          (id, provider, provider_account_key_hash, environment, account_type, currency)
         VALUES ($1, 'ctrader', $2, 'demo', 'demo', 'USD')`,
        [demoAccountId, "b".repeat(64)],
      );
      const risk = new DailyRiskStore(isolated);
      const baselineInput = {
        accountId: demoAccountId,
        account: {
          reconciledAt: "2026-08-24T01:00:00.000Z",
          certain: true,
          equity: "10005",
          balance: "10005",
          availableMargin: "10005",
          relevantPositionCount: 0,
          relevantPendingOrderCount: 0,
          hasPartialFill: false,
          hasCancellationPending: false,
          reasonCodes: [],
        },
        timezone: "UTC",
        netFlows: "5",
        brokerDealCount: 0,
        brokerPositionCount: 0,
        brokerOrderCount: 0,
        externalFlowOperationCount: 1,
        actor: "integration-test",
        reason: "verify reconciled one-time initialization",
        instanceId: "test-instance",
        environment: "test",
        tradingMode: "demo" as const,
        accountKey: "test-demo-pseudonym",
        symbol: "XAUUSD",
        now: new Date("2026-08-24T01:00:00.000Z"),
      };
      await expect(
        risk.initializeReconciledBaseline(baselineInput),
      ).resolves.toEqual({
        tradingDay: "2026-08-24",
        timezone: "UTC",
      });
      const persisted = await isolated.query<{ baseline_equity: string }>(
        `SELECT baseline_equity::text FROM daily_risk_state
         WHERE account_id = $1`,
        [demoAccountId],
      );
      expect(persisted.rows[0]?.baseline_equity).toBe("10000.0000000000");
      await expect(
        risk.initializeReconciledBaseline(baselineInput),
      ).rejects.toThrow("DAILY_RISK_BASELINE_ALREADY_EXISTS");
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
