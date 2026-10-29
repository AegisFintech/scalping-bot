/** One audited demo incident. Broker access is read-only; no order is sent. */
import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createPool } from "../packages/database/src/index.js";
import { CTraderClient } from "../packages/ctrader-client/src/client.js";
import { CTraderTokenManager } from "../packages/ctrader-client/src/token-manager.js";
import { SecureTokenFileStore } from "../packages/ctrader-client/src/token-store.js";
import {
  executionIsStopped,
  INCIDENT_ACTIVATION_SHA256,
  INCIDENT_GATEWAY_SHA256,
  INCIDENT_RECEIPT_SHA256,
  INCIDENT_RELEASE_COMMIT,
  INCIDENT_RELEASE_SOURCE,
} from "../apps/execution-service/src/predispatch-incident-proof.js";
import {
  recoverPredispatchIncident,
  type BrokerObservation,
} from "../apps/execution-service/src/predispatch-incident-store.js";
import { brokerAnchorMatches } from "../apps/execution-service/src/predispatch-broker-anchor.js";

const receiptPath =
  "/var/lib/scalper-demo-epoch-314/issue-427-evidence/incident-readonly-20261029.json";
const activationPath =
  "/var/lib/scalper-demo-epoch-314/issue-407-rollout/activation.json";
const oldRelease = "/opt/ctrader-ai-scalper/releases/ack407-main";
const digest = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex");
async function privateEvidence(
  file: string,
  expected: string,
): Promise<Buffer> {
  const st = await lstat(file);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.uid !== 0 ||
    (st.mode & 0o777) !== 0o600 ||
    (await realpath(file)) !== file ||
    st.size > 8192
  )
    throw new Error("PREDISPATCH_RECEIPT_PERMISSIONS_INVALID");
  const data = await readFile(file);
  if (digest(data) !== expected) throw new Error("PREDISPATCH_SOURCE_MISMATCH");
  return data;
}
let phase = "preflight";
async function main() {
  const args = parseArgs({
    options: { "pause-actor": { type: "string" } },
    strict: true,
  });
  const actor = args.values["pause-actor"] ?? "";
  const env = process.env;
  if (
    process.getuid?.() !== 0 ||
    !/^codex-predispatch-[a-f0-9]{32}$/.test(actor) ||
    env.TRADING_MODE !== "demo" ||
    !env.ACCOUNT_KEY ||
    !env.DATABASE_URL ||
    !env.CTRADER_CLIENT_ID ||
    !env.CTRADER_CLIENT_SECRET
  )
    throw new Error("PREDISPATCH_EXECUTION_SCOPE_INVALID");
  const receiptBytes = await privateEvidence(
    receiptPath,
    INCIDENT_RECEIPT_SHA256,
  );
  const activationBytes = await privateEvidence(
    activationPath,
    INCIDENT_ACTIVATION_SHA256,
  );
  const manifest: unknown = JSON.parse(
    await readFile(oldRelease + "/release-manifest.json", "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("commit" in manifest) ||
    !("sourceSha256" in manifest) ||
    manifest.commit !== INCIDENT_RELEASE_COMMIT ||
    manifest.sourceSha256 !== INCIDENT_RELEASE_SOURCE
  )
    throw new Error("PREDISPATCH_SOURCE_MISMATCH");
  if (
    digest(receiptBytes) !== INCIDENT_RECEIPT_SHA256 ||
    digest(
      await readFile(
        oldRelease + "/dist/apps/execution-service/src/demo-gateway.js",
      ),
    ) !== INCIDENT_GATEWAY_SHA256
  )
    throw new Error("PREDISPATCH_SOURCE_MISMATCH");
  const verification = execFileSync(
    "/opt/scalper-node22/bin/node",
    [oldRelease + "/scripts/prepare-release.mjs", "verify", oldRelease],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (verification.trim() !== "RELEASE_VERIFIED")
    throw new Error("PREDISPATCH_SOURCE_MISMATCH");
  const stopped = () => {
    const supervisor: unknown = JSON.parse(
      execFileSync("/usr/bin/pm2", ["jlist"], {
        encoding: "utf8",
        timeout: 15_000,
      }),
    );
    let matchingProcesses = 1;
    try {
      execFileSync(
        "/usr/bin/pgrep",
        ["-f", "[a]pps/execution-service/src/index\\.(js|ts)"],
        { timeout: 15_000 },
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 1
      )
        matchingProcesses = 0;
      else return false;
    }
    return executionIsStopped(supervisor, matchingProcesses);
  };
  if (!stopped()) throw new Error("PREDISPATCH_EXECUTION_NOT_STOPPED");
  const tokens = await new SecureTokenFileStore(
    env.CTRADER_TOKEN_STATE_FILE ?? ".runtime/ctrader-token-state.json",
  ).read();
  if (!tokens || tokens.expiresAt.getTime() - Date.now() < 300_000)
    throw new Error("PREDISPATCH_FRESH_TOKEN_REQUIRED");
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    poolMin: 0,
    poolMax: 1,
  });
  let broker: CTraderClient | null = null;
  let cleanupFailed = false;
  try {
    phase = "scope";
    const scope = await pool.query<{ account_id: string; symbol_id: string }>(
      `SELECT a.id account_id,s.id symbol_id FROM accounts a JOIN symbols s ON s.account_id=a.id
       WHERE a.provider='ctrader' AND a.provider_account_key_hash=$1 AND a.environment='demo'
         AND a.account_type='demo' AND s.name='XAUUSD'`,
      [digest(env.ACCOUNT_KEY)],
    );
    if (scope.rowCount !== 1)
      throw new Error("PREDISPATCH_ACCOUNT_SCOPE_AMBIGUOUS");
    const anchors = await pool.query<{
      event_id: string;
      broker_order_id: string;
      client_order_id: string;
      occurred_at: Date;
      side: "BUY" | "SELL";
      volume: string;
      label: string;
      symbol_id: string;
    }>(
      `SELECT e.id event_id,e.broker_order_id,e.client_order_id,e.occurred_at,o.side,
             o.normalized_volume::text volume,o.strategy_label label,s.provider_symbol_id symbol_id
        FROM broker_execution_events e JOIN orders o ON o.id=e.order_id
        JOIN order_groups g ON g.id=o.order_group_id JOIN analysis_runs a ON a.id=g.analysis_id
        JOIN symbols s ON s.id=a.symbol_id
        WHERE a.account_id=$1 AND a.symbol_id=$2 AND e.account_id=$1 AND e.symbol_id=$2
          AND o.account_id=$1 AND g.mode='demo' AND o.strategy_owned AND e.mapping_state='MAPPED'
          AND e.execution_type=2 AND jsonb_array_length(e.reason_codes)=0
          AND e.broker_order_id=o.broker_order_id AND e.client_order_id=o.client_order_id
          AND e.occurred_at<'2026-10-28T23:16:11.329147Z'::timestamptz
          AND e.occurred_at>clock_timestamp()-interval '6 days'
        ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1`,
      [scope.rows[0]!.account_id, scope.rows[0]!.symbol_id],
    );
    if (anchors.rowCount !== 1)
      throw new Error("PREDISPATCH_BROKER_ANCHOR_MISSING");
    const anchor = anchors.rows[0]!;
    broker = new CTraderClient({
      clientId: env.CTRADER_CLIENT_ID,
      clientSecret: env.CTRADER_CLIENT_SECRET,
      ...(env.ACCOUNT_ID ? { accountId: env.ACCOUNT_ID } : {}),
      connectionMode: "demo",
      allowOrderCommands: false,
      tokenManager: new CTraderTokenManager({
        clientId: env.CTRADER_CLIENT_ID,
        clientSecret: env.CTRADER_CLIENT_SECRET,
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
    phase = "broker";
    await broker.connect();
    if (env.ACCOUNT_ID && broker.accountId !== env.ACCOUNT_ID)
      throw new Error("PREDISPATCH_BROKER_SCOPE_MISMATCH");
    const liveBroker = broker;
    const selectedBrokerAccount = broker.accountId;
    const anchorFrom = new Date(anchor.occurred_at.getTime() - 600_000);
    const anchorUntil = new Date();
    const anchorHistory = await broker.orderHistoryRaw(anchorFrom, anchorUntil);
    if (
      Buffer.byteLength(JSON.stringify(anchorHistory)) > 4_000_000 ||
      !brokerAnchorMatches(
        {
          brokerOrderId: anchor.broker_order_id,
          clientOrderId: anchor.client_order_id,
          symbolId: anchor.symbol_id,
          side: anchor.side,
          volume: anchor.volume,
          label: anchor.label,
        },
        anchorHistory.orders,
        anchorHistory.hasMore,
      )
    )
      throw new Error("PREDISPATCH_BROKER_ANCHOR_INVALID");
    const anchorDigest = digest(
      JSON.stringify({
        eventId: anchor.event_id,
        from: anchorFrom.toISOString(),
        until: anchorUntil.toISOString(),
        history: anchorHistory,
      }),
    );
    const observe = async (): Promise<BrokerObservation> => {
      if (liveBroker.accountId !== selectedBrokerAccount)
        throw new Error("PREDISPATCH_BROKER_SCOPE_MISMATCH");
      const from = new Date("2026-10-28T23:11:11.329Z"),
        until = new Date();
      if (until.getTime() - from.getTime() > 7 * 86_400_000)
        throw new Error("PREDISPATCH_HISTORY_WINDOW_EXCEEDED");
      const orders = await liveBroker.orderHistoryRaw(from, until);
      const deals = await liveBroker.dealHistoryRaw(from, until, 1000);
      const reconciliation = await liveBroker.reconcileRaw();
      if (liveBroker.accountId !== selectedBrokerAccount)
        throw new Error("PREDISPATCH_BROKER_SCOPE_MISMATCH");
      const raw = JSON.stringify({ orders, deals, reconciliation });
      if (Buffer.byteLength(raw) > 4_000_000)
        throw new Error("PREDISPATCH_HISTORY_TOO_LARGE");
      return {
        from: from.toISOString(),
        until: until.toISOString(),
        observedAt: new Date().toISOString(),
        orders: orders.orders.length,
        deals: deals.deals.length,
        ordersHasMore: orders.hasMore,
        dealsHasMore: deals.hasMore,
        openOrders: reconciliation.orders.length,
        openPositions: reconciliation.positions.length,
        digest: digest(raw),
        accountBound: true,
        anchorDigest,
        anchorEventId: anchor.event_id,
      };
    };
    phase = "recovery";
    await recoverPredispatchIncident({
      pool,
      accountId: scope.rows[0]!.account_id,
      symbolId: scope.rows[0]!.symbol_id,
      scope: env.INSTANCE_ID ?? "local-1",
      pauseActor: actor,
      receiptBytes,
      activationBytes,
      executionStopped: stopped,
      observeBroker: observe,
    });
  } finally {
    try {
      await broker?.disconnect();
    } catch {
      cleanupFailed = true;
    }
    try {
      await pool.end();
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed)
    throw new Error("PREDISPATCH_COMMITTED_CLEANUP_UNVERIFIED");
  process.stdout.write(
    JSON.stringify({
      status: "LOCAL_PRE_DISPATCH_REJECTED",
      brokerOrderCommands: 0,
    }) + "\n",
  );
}
main().catch((error: unknown) => {
  const reason =
    error instanceof Error && /^PREDISPATCH_[A-Z_]+$/.test(error.message)
      ? error.message
      : "PREDISPATCH_DEPENDENCY_FAILURE";
  process.stderr.write(
    JSON.stringify({ status: "RECOVERY_FAILED", phase, reason }) + "\n",
  );
  process.exitCode = 1;
});
