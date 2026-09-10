import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPool, migrate } from "../../packages/database/src/index.js";
import { storeCandles } from "../../packages/database/src/candle-storage.js";
import type { CandleSeries } from "../../packages/contracts/src/index.js";

const configured = process.env.TEST_DATABASE_URL;
const databaseTest = configured ? it : it.skip;

describe("local evidence storage", () => {
  databaseTest(
    "deduplicates candle values without merging snapshot identity or accepting conflicts",
    async () => {
      const schema = `storage_${randomUUID().replaceAll("-", "")}`;
      const admin = createPool({ connectionString: configured! });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const url = new URL(configured!);
      url.searchParams.set("options", `-csearch_path=${schema}`);
      const pool = createPool({ connectionString: url.toString() });
      try {
        await migrate(pool, path.resolve("migrations"));
        const account = randomUUID(),
          symbol = randomUUID();
        await pool.query(
          `INSERT INTO accounts(id,provider,provider_account_key_hash,environment,account_type,currency)
        VALUES ($1,'paper',$2,'paper','paper','USD')`,
          [account, "a".repeat(64)],
        );
        await pool.query(
          `INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,
        metadata_revision,metadata_at,volume_scale) VALUES($1,$2,'fixture','XAUUSD',2,0.01,'fixture',now(),0.01)`,
          [symbol, account],
        );
        const snapshots = [randomUUID(), randomUUID(), randomUUID()];
        for (const [i, id] of snapshots.entries())
          await pool.query(
            `INSERT INTO candle_snapshots
        (id,account_id,symbol_id,analysis_time,server_time,received_at,max_skew_ms,complete)
        VALUES($1,$2,$3,$4,$4,$4,0,true)`,
            [id, account, symbol, new Date(Date.UTC(2026, 8, 10, 0, i))],
          );
        const series: CandleSeries[] = [
          {
            timeframe: "M1",
            candles: [
              {
                startTime: "2026-09-09T23:59:00.000Z",
                endTime: "2026-09-10T00:00:00.000Z",
                open: "4400",
                high: "4402",
                low: "4399",
                close: "4401",
                volume: null,
                complete: true,
                qualityFlags: [],
              },
            ],
          },
        ];
        const client = await pool.connect();
        try {
          for (const id of snapshots.slice(0, 2)) {
            await client.query("BEGIN");
            await storeCandles(client, id, symbol, series);
            await client.query("COMMIT");
          }
          const changed: CandleSeries[] = [
            {
              timeframe: "M1",
              candles: [{ ...series[0]!.candles[0]!, close: "4401.01" }],
            },
          ];
          await client.query("BEGIN");
          await storeCandles(client, snapshots[2]!, symbol, changed);
          await client.query("COMMIT");
          expect(
            (
              await client.query<{ n: number }>(
                "SELECT count(*)::int n FROM candle_values",
              )
            ).rows[0]!.n,
          ).toBe(2);
          expect(
            (
              await client.query<{ n: number }>(
                "SELECT count(*)::int n FROM decision_candles",
              )
            ).rows[0]!.n,
          ).toBe(3);
          expect(
            (
              await client.query<{ n: number }>(
                "SELECT count(DISTINCT received_at)::int n FROM candle_snapshots",
              )
            ).rows[0]!.n,
          ).toBe(3);
          await client.query("BEGIN");
          await expect(
            storeCandles(client, snapshots[0]!, symbol, changed),
          ).rejects.toThrow();
          await client.query("ROLLBACK");
          expect(
            (
              await client.query<{ n: number }>(
                "SELECT count(*)::int n FROM candle_references",
              )
            ).rows[0]!.n,
          ).toBe(3);
          await client.query("BEGIN");
          await expect(
            storeCandles(client, snapshots[0]!, symbol, [
              {
                timeframe: "M1",
                candles: [{ ...series[0]!.candles[0]!, high: "1" }],
              },
            ]),
          ).rejects.toThrow();
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      } finally {
        await pool.end();
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      }
    },
  );
});
