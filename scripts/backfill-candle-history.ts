import "dotenv/config";
import { writeFileSync } from "node:fs";
import { CTraderClient } from "../packages/ctrader-client/src/client.js";
import { CTraderTokenManager } from "../packages/ctrader-client/src/token-manager.js";
import { SecureTokenFileStore } from "../packages/ctrader-client/src/token-store.js";
import type { Candle, Timeframe } from "../packages/contracts/src/index.js";

// Read-only research backfill of completed candle history for variant
// screening. It never places, amends or cancels orders, and it writes only a
// local artifact file. Order commands are additionally disabled on the client.

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  const value = process.argv[index + 1] ?? fallback;
  if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(value))
    throw new Error("BACKFILL_ARGUMENT_INVALID");
  return value;
}

const output = flag("output", "");
if (output === "") throw new Error("BACKFILL_OUTPUT_REQUIRED");
const weeks = Number(flag("weeks", "6"));
if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > 52)
  throw new Error("BACKFILL_WEEKS_INVALID");
const timeframe = flag("timeframe", "M1") as Timeframe;
if (!["M1", "M5", "M15"].includes(timeframe))
  throw new Error("BACKFILL_TIMEFRAME_INVALID");
const periodMs =
  timeframe === "M1" ? 60_000 : timeframe === "M5" ? 300_000 : 900_000;

const clientId = process.env.CTRADER_CLIENT_ID ?? "";
const clientSecret = process.env.CTRADER_CLIENT_SECRET ?? "";
if (clientId === "" || clientSecret === "")
  throw new Error("BACKFILL_CREDENTIALS_MISSING");

const tokenStore = new SecureTokenFileStore(
  process.env.CTRADER_TOKEN_STATE_FILE ?? ".runtime/ctrader-token-state.json",
);
const stored = await tokenStore.read();
const tokenManager = new CTraderTokenManager({
  clientId,
  clientSecret,
  tokenUrl:
    process.env.CTRADER_TOKEN_URL ?? "https://openapi.ctrader.com/apps/token",
  accessToken: stored?.accessToken ?? process.env.CTRADER_ACCESS_TOKEN ?? "",
  refreshToken: stored?.refreshToken ?? process.env.CTRADER_REFRESH_TOKEN ?? "",
  ...(stored !== null
    ? { accessTokenExpiresAt: stored.expiresAt }
    : process.env.CTRADER_ACCESS_TOKEN_EXPIRES_AT === undefined ||
        process.env.CTRADER_ACCESS_TOKEN_EXPIRES_AT === ""
      ? {}
      : {
          accessTokenExpiresAt: new Date(
            process.env.CTRADER_ACCESS_TOKEN_EXPIRES_AT,
          ),
        }),
  onRefresh: (tokens) => tokenStore.write(tokens),
  refreshCoordinator: (refreshToken, refresh) =>
    tokenStore.coordinateRefresh(refreshToken, refresh),
});

const connectionMode =
  process.env.CTRADER_CONNECTION_MODE === "live" ? "live" : "demo";
const client = new CTraderClient({
  clientId,
  clientSecret,
  ...(process.env.ACCOUNT_ID === undefined || process.env.ACCOUNT_ID === ""
    ? {}
    : { accountId: process.env.ACCOUNT_ID }),
  connectionMode,
  allowOrderCommands: false,
  tokenManager,
  transportOptions: {
    host:
      process.env.CTRADER_API_HOST ??
      (connectionMode === "live"
        ? "live.ctraderapi.com"
        : "demo.ctraderapi.com"),
    port: Number(process.env.CTRADER_API_PORT ?? 5036),
    requestTimeoutMs: 10_000,
    reconnectMinMs: 1_000,
    reconnectMaxMs: 30_000,
  },
});

const symbolName = process.env.TRADING_SYMBOL ?? "XAUUSD";
const collected = new Map<number, Candle>();
let oldestSeen: number | null = null;
let retentionLimited = false;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  await client.connect();
  const metadata = await client.discoverSymbol(symbolName);
  // One read-only quote primes the spot feed and the server clock; no order
  // command is possible on this client (allowOrderCommands: false).
  await client.getQuote(metadata.symbolId);
  const nowMs = Date.parse(await client.getServerTime());
  const horizonMs = nowMs - weeks * 7 * 24 * 3_600_000;
  let upper = nowMs;
  for (let page = 0; page < 400; page += 1) {
    let batch: readonly Candle[];
    try {
      batch = await client.getCompletedCandles(
        metadata.symbolId,
        timeframe,
        5_000,
        upper,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "CTRADER_COMPLETED_CANDLES_INSUFFICIENT"
      ) {
        retentionLimited = true;
        break;
      }
      throw error;
    }
    const first = batch[0];
    if (first === undefined) break;
    for (const candle of batch) {
      const start = Date.parse(candle.startTime);
      if (oldestSeen === null || start < oldestSeen) oldestSeen = start;
      collected.set(start, candle);
    }
    const nextUpper = Date.parse(first.startTime) - 1;
    if (nextUpper <= horizonMs || nextUpper >= upper) break;
    upper = nextUpper;
    await sleep(250);
  }
  const candles = [...collected.values()].sort(
    (left, right) => Date.parse(left.startTime) - Date.parse(right.startTime),
  );
  const artifact = {
    label: "CANDLE_HISTORY_BACKFILL_V1",
    symbol: symbolName,
    timeframe,
    generated_at: new Date().toISOString(),
    retention_limited: retentionLimited,
    candle_count: candles.length,
    oldest: candles[0]?.startTime ?? null,
    newest: candles[candles.length - 1]?.startTime ?? null,
    candles,
  };
  writeFileSync(output, JSON.stringify(artifact) + "\n", { mode: 0o600 });
  console.log(
    JSON.stringify({
      label: "CANDLE_HISTORY_BACKFILL_DONE",
      candles: candles.length,
      oldest: artifact.oldest,
      newest: artifact.newest,
      retention_limited: retentionLimited,
      page_size_ms: periodMs,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "BACKFILL_FAILED");
  process.exitCode = 1;
} finally {
  await client.disconnect().catch(() => undefined);
}
