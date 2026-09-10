import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { CandleSeries } from "../../contracts/src/index.js";

const recordColumns = `id uuid,timeframe text,start_time timestamptz,end_time timestamptz,
  open numeric(30,10),high numeric(30,10),low numeric(30,10),close numeric(30,10),
  volume numeric(30,10),complete boolean,quality_flags jsonb`;

/** Caller owns the snapshot transaction. Hashing uses typed SQL values in every path. */
export async function storeCandles(
  client: pg.PoolClient,
  snapshotId: string,
  symbolId: string,
  series: readonly CandleSeries[],
): Promise<void> {
  const rows = series.flatMap((group) =>
    group.candles.map((candle) => ({
      id: randomUUID(),
      timeframe: group.timeframe,
      start_time: candle.startTime,
      end_time: candle.endTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      complete: candle.complete,
      quality_flags: candle.qualityFlags,
    })),
  );
  // The trail must also record incomplete snapshots before quality rejection.
  if (rows.length === 0) return;
  const payload = JSON.stringify(rows);
  await client.query(
    `INSERT INTO candle_values
    (symbol_id,timeframe,start_time,end_time,open,high,low,close,volume,complete,quality_flags)
    SELECT $1,timeframe,start_time,end_time,open,high,low,close,volume,complete,quality_flags
    FROM jsonb_to_recordset($2::jsonb) AS x(${recordColumns})
    ON CONFLICT(content_sha256) DO NOTHING`,
    [symbolId, payload],
  );
  await client.query(
    `INSERT INTO candle_references
    (id,snapshot_id,symbol_id,timeframe,start_time,candle_value_id)
    SELECT x.id,$1,$2,x.timeframe,x.start_time,v.id
    FROM jsonb_to_recordset($3::jsonb) AS x(${recordColumns})
    JOIN candle_values v ON v.content_sha256=candle_value_hash(
      $2,x.timeframe,x.start_time,x.end_time,x.open,x.high,x.low,x.close,x.volume,x.complete,x.quality_flags)`,
    [snapshotId, symbolId, payload],
  );
}
