import "dotenv/config";

import { Decimal } from "decimal.js";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL_REQUIRED");
const marketPort = process.env.MARKET_DATA_PORT ?? "8081";
const release = process.env.REPLAY_STRATEGY_VERSION ?? ".39";
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
});

try {
  const trades = await pool.query<{
    side: "BUY" | "SELL";
    entry_price: string;
    opening_volume: string;
    opened_at: Date;
    closed_at: Date;
    fees: string;
    volume_scale: string;
  }>(
    `SELECT p.side, p.entry_price::text, opening_fill.volume::text AS opening_volume,
            p.opened_at, t.closed_at, t.fees::text, s.volume_scale::text
     FROM trades t
     JOIN positions p ON p.id = t.position_id
     JOIN order_groups og ON og.id = t.order_group_id
     JOIN analysis_runs ar ON ar.id = og.analysis_id
     JOIN symbols s ON s.id = ar.symbol_id
     JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
     JOIN LATERAL (
       SELECT f.volume
       FROM fills f
       WHERE f.position_id = p.id
       ORDER BY f.occurred_at, f.id
       LIMIT 1
     ) opening_fill ON true
     WHERE og.mode = 'demo' AND sv.version LIKE $1
     ORDER BY p.opened_at`,
    [`%${release}`],
  );
  const response = await fetch(`http://127.0.0.1:${marketPort}/v1/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol: process.env.TRADING_SYMBOL ?? "XAUUSD",
      counts: { M1: 1200, M5: 1, M15: 1 },
      depth: 1,
    }),
  });
  if (!response.ok) throw new Error(`MARKET_SNAPSHOT_${response.status}`);
  const snapshot = (await response.json()) as {
    candles: Array<{
      timeframe: string;
      candles: Array<{
        startTime: string;
        endTime: string;
        high: string;
        low: string;
      }>;
    }>;
  };
  const candles = snapshot.candles.find(
    (candidate) => candidate.timeframe === "M1",
  )?.candles;
  if (candles === undefined || candles.length === 0)
    throw new Error("M1_CANDLES_REQUIRED");

  const results = [];
  for (const takeProfit of ["0.53", "0.60", "0.70", "0.80", "1.00"]) {
    for (const ratio of ["1", "1.5", "2"]) {
      const tp = new Decimal(takeProfit);
      const sl = tp.mul(ratio);
      let wins = 0;
      let losses = 0;
      let open = 0;
      let fillBarUnresolved = 0;
      let sameBarAmbiguities = 0;
      let net = new Decimal(0);
      for (const trade of trades.rows) {
        const entry = new Decimal(trade.entry_price);
        const openedAt = trade.opened_at.getTime();
        const firstCompleteBar = Math.ceil(openedAt / 60_000) * 60_000;
        if (trade.closed_at.getTime() < firstCompleteBar) {
          fillBarUnresolved += 1;
          continue;
        }
        const eligible = candles.filter(
          (candle) =>
            Date.parse(candle.startTime) >= firstCompleteBar &&
            Date.parse(candle.startTime) < openedAt + 60 * 60 * 1000,
        );
        let outcome: "WIN" | "LOSS" | "OPEN" = "OPEN";
        for (const candle of eligible) {
          const high = new Decimal(candle.high);
          const low = new Decimal(candle.low);
          const stop =
            trade.side === "BUY"
              ? low.lte(entry.minus(sl))
              : high.gte(entry.plus(sl));
          const target =
            trade.side === "BUY"
              ? high.gte(entry.plus(tp))
              : low.lte(entry.minus(tp));
          if (stop || target) {
            outcome = stop ? "LOSS" : "WIN";
            if (stop && target) sameBarAmbiguities += 1;
            break;
          }
        }
        const units = new Decimal(trade.opening_volume).mul(trade.volume_scale);
        const fee = new Decimal(trade.fees).abs();
        if (outcome === "WIN") {
          wins += 1;
          net = net.plus(tp.mul(units).minus(fee));
        } else if (outcome === "LOSS") {
          losses += 1;
          net = net.minus(sl.mul(units).plus(fee));
        } else {
          open += 1;
        }
      }
      results.push({
        takeProfit: tp.toFixed(2),
        stopLoss: sl.toFixed(2),
        stopLossToTakeProfitRatio: ratio,
        wins,
        losses,
        open,
        fillBarUnresolved,
        sameBarAmbiguities,
        feeInclusiveNet: net.toFixed(4),
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        label: "CONSERVATIVE_COMPLETED_M1_REPLAY_NOT_PROFITABILITY_EVIDENCE",
        release,
        trades: trades.rowCount,
        candleStart: candles[0]?.startTime,
        candleEnd: candles.at(-1)?.endTime,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
