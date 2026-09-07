import "dotenv/config";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createPool } from "../packages/database/src/index.js";

const release = process.argv[2];
const output = process.argv[3];
if (!release || !output || !/^[a-zA-Z0-9._-]{1,120}$/.test(release))
  throw new Error("EVALUATION_RELEASE_OUTPUT_REQUIRED");
const pool = createPool({ connectionString: process.env.DATABASE_URL ?? "" });
try {
  await pool.query("SET default_transaction_read_only=on");
  const rows = await pool.query<{
    created: Date;
    available: Date;
    expires: Date;
    legs: unknown;
  }>(
    `SELECT ar.analysis_time AS created,min(o.submitted_at) AS available,og.expires_at AS expires,
      jsonb_agg(jsonb_build_object('side',CASE WHEN o.side='BUY' THEN 1 ELSE -1 END,
      'entry',o.entry_price::text,'tp',abs(o.take_profit-o.entry_price)::text,
      'sl',abs(o.entry_price-o.stop_loss)::text) ORDER BY o.side) AS legs
     FROM order_groups og JOIN orders o ON o.order_group_id=og.id
     JOIN analysis_runs ar ON ar.id=og.analysis_id JOIN accounts a ON a.id=ar.account_id
     JOIN symbols s ON s.id=ar.symbol_id JOIN strategy_versions sv ON sv.id=ar.strategy_version_id
     WHERE sv.version=$1 AND a.provider_account_key_hash=$2 AND s.name=$3 AND og.mode='demo'
       AND o.submitted_at IS NOT NULL
     GROUP BY og.id,ar.analysis_time ORDER BY ar.analysis_time LIMIT 10000`,
    [
      release,
      createHash("sha256")
        .update(process.env.ACCOUNT_KEY ?? "unconfigured")
        .digest("hex"),
      process.env.TRADING_SYMBOL ?? "XAUUSD",
    ],
  );
  const plans = rows.rows.filter((row) => row.available < row.expires);
  writeFileSync(output, JSON.stringify(plans, null, 2) + "\n", { mode: 0o600 });
  console.log(
    JSON.stringify({
      label: "DEMO_SUBMITTED_OPPORTUNITIES_ONLY",
      plans: plans.length,
    }),
  );
} catch {
  console.error("EVALUATION_EXPORT_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
