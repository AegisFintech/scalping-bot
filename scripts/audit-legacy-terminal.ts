/** Read-only DEMO audit. No migration, resolution, order or accounting writes. */
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { Decimal } from "decimal.js";
import { createPool } from "../packages/database/src/index.js";
import { CTraderClient } from "../packages/ctrader-client/src/client.js";
import { CTraderTokenManager } from "../packages/ctrader-client/src/token-manager.js";
import { SecureTokenFileStore } from "../packages/ctrader-client/src/token-store.js";
import { readTerminalGroup } from "../apps/execution-service/src/terminal-history-attestor.js";
import { auditLegacyTerminalGroup } from "../apps/execution-service/src/terminal-group-proof.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let phase = "preflight";
async function main(): Promise<void> {
  const args = parseArgs({
    options: { output: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  if (!args.values.output) throw new Error("AUDIT_OUTPUT_REQUIRED");
  config({
    quiet: true,
    ...(process.env.DOTENV_CONFIG_PATH
      ? { path: process.env.DOTENV_CONFIG_PATH }
      : {}),
  });
  const env = process.env;
  if (env.TRADING_MODE !== "demo" || !env.ACCOUNT_KEY || !env.DATABASE_URL)
    throw new Error("AUDIT_EXPLICIT_DEMO_SCOPE_REQUIRED");
  const tokens = await new SecureTokenFileStore(
    env.CTRADER_TOKEN_STATE_FILE ?? ".runtime/ctrader-token-state.json",
  ).read();
  if (!tokens || tokens.expiresAt.getTime() - Date.now() < 300_000)
    throw new Error("AUDIT_FRESH_EXISTING_TOKEN_REQUIRED");
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    poolMax: 1,
    poolMin: 0,
  });
  let broker: CTraderClient | null = null;
  try {
    phase = "database";
    const db = await pool.connect();
    let context: { id: string; broker_symbol: string } | undefined;
    let snapshot;
    let variantTablePresent = false;
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await db.query("SET LOCAL statement_timeout='15s'");
      const rows = await db.query<{ id: string; broker_symbol: string }>(
        `SELECT DISTINCT og.id, s.provider_symbol_id AS broker_symbol
         FROM order_groups og JOIN analysis_runs ar ON ar.id=og.analysis_id
         JOIN accounts a ON a.id=ar.account_id JOIN symbols s ON s.id=ar.symbol_id
         JOIN broker_execution_events e ON e.order_group_id=og.id
         WHERE a.provider='ctrader' AND a.environment='demo' AND a.account_type='demo'
           AND a.provider_account_key_hash=$1 AND s.name='XAUUSD'
           AND og.mode='demo' AND og.state='CLOSED' AND e.resolved_at IS NULL
           AND e.mapping_state='CONFLICT' AND e.reason_codes='["DEMO_BROKER_EVENT_KEY_CONFLICT"]'::jsonb
           AND e.closing_order=true AND e.execution_type=3 AND e.broker_order_type=4 LIMIT 2`,
        [digest(env.ACCOUNT_KEY)],
      );
      if (rows.rows.length !== 1) throw new Error("AUDIT_SCOPE_AMBIGUOUS");
      context = rows.rows[0]!;
      variantTablePresent =
        (
          await db.query<{ present: boolean }>(
            "SELECT to_regclass('broker_execution_event_variants') IS NOT NULL AS present",
          )
        ).rows[0]?.present === true;
      snapshot = await readTerminalGroup(db, context.id, variantTablePresent);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    const initialHash = digest(JSON.stringify(snapshot));
    const oldest = Math.min(
      ...snapshot.events.map((e) => Date.parse(e.payload.occurredAt)),
    );
    const now = new Date();
    if (
      !Number.isFinite(oldest) ||
      oldest > now.getTime() ||
      now.getTime() - oldest > 7 * 86_400_000
    )
      throw new Error("AUDIT_HISTORY_WINDOW_INVALID");
    phase = "broker";
    broker = new CTraderClient({
      clientId: env.CTRADER_CLIENT_ID ?? "",
      clientSecret: env.CTRADER_CLIENT_SECRET ?? "",
      ...(env.ACCOUNT_ID ? { accountId: env.ACCOUNT_ID } : {}),
      connectionMode: "demo",
      allowOrderCommands: false,
      tokenManager: new CTraderTokenManager({
        clientId: env.CTRADER_CLIENT_ID ?? "",
        clientSecret: env.CTRADER_CLIENT_SECRET ?? "",
        tokenUrl: "https://openapi.ctrader.com/apps/token",
        accessToken: tokens.accessToken,
        refreshToken: "",
        accessTokenExpiresAt: tokens.expiresAt,
      }),
      transportOptions: {
        host: env.CTRADER_API_HOST ?? "demo.ctraderapi.com",
        port: Number(env.CTRADER_API_PORT ?? 5036),
        requestTimeoutMs: 10_000,
        reconnectMinMs: 1000,
        reconnectMaxMs: 30000,
      },
    });
    await broker.connect();
    if (env.ACCOUNT_ID && broker.accountId !== env.ACCOUNT_ID)
      throw new Error("AUDIT_BROKER_SCOPE_CHANGED");
    const from = new Date(Math.max(0, oldest - 300_000));
    const orders = await broker.orderHistoryRaw(from, now);
    const deals = await broker.dealHistoryRaw(from, now, 1000);
    const reconciliation = await broker.reconcileRaw();
    const history = { orders, deals, reconciliation };
    if (Buffer.byteLength(JSON.stringify(history)) > 4_000_000)
      throw new Error("AUDIT_HISTORY_OVERSIZED");
    phase = "proof";
    const result = auditLegacyTerminalGroup(
      snapshot,
      history,
      context.broker_symbol,
      new Date(),
    );
    const finalDb = await pool.connect();
    try {
      await finalDb.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await finalDb.query("SET LOCAL statement_timeout='15s'");
      const present =
        (
          await finalDb.query<{ present: boolean }>(
            "SELECT to_regclass('broker_execution_event_variants') IS NOT NULL AS present",
          )
        ).rows[0]?.present === true;
      const current = await readTerminalGroup(finalDb, context.id, present);
      if (digest(JSON.stringify(current)) !== initialHash)
        throw new Error("AUDIT_LOCAL_STATE_CHANGED");
      await finalDb.query("COMMIT");
    } catch (error) {
      await finalDb.query("ROLLBACK");
      throw error;
    } finally {
      finalDb.release();
    }
    const report = {
      label: "READ_ONLY_LEGACY_TERMINAL_AUDIT_V1",
      generatedAt: new Date().toISOString(),
      ...result,
      variantTablePresent,
      localSnapshotSha256: initialHash,
      historySha256: digest(JSON.stringify(history)),
      verifierSha256: digest(
        await readFile(
          new URL(
            "../apps/execution-service/src/terminal-group-proof.ts",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      counts: {
        entries: snapshot.orders.length,
        positions: snapshot.positions.length,
        trades: snapshot.trades.length,
        retainedVariants: snapshot.variants.length,
        openBrokerOrders: reconciliation.orders.length,
        openBrokerPositions: reconciliation.positions.length,
      },
      journalNetPnl: snapshot.trades
        .reduce((sum, t) => sum.plus(t.pnl), new Decimal(0))
        .toString(),
      journalSignedFees: snapshot.trades
        .reduce((sum, t) => sum.plus(t.fees), new Decimal(0))
        .toString(),
      privateEvidence: { snapshot, history },
    };
    phase = "report";
    const output = path.resolve(args.values.output);
    const file = await open(output, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(report));
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(path.dirname(output), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    console.log(
      JSON.stringify({
        status: "AUDIT_RECORDED",
        ...result,
        counts: report.counts,
        journalNetPnl: report.journalNetPnl,
        journalSignedFees: report.journalSignedFees,
      }),
    );
  } finally {
    await broker?.disconnect();
    await pool.end();
  }
}
main().catch((error: unknown) => {
  const reason =
    error instanceof Error &&
    /^(AUDIT_[A-Z_]+|CTRADER_TOKEN_STORE_[A-Z_]+)$/.test(error.message)
      ? error.message
      : "AUDIT_DEPENDENCY_FAILURE";
  console.error(
    JSON.stringify({ status: "LEGACY_AUDIT_FAILED", phase, reason }),
  );
  process.exitCode = 1;
});
