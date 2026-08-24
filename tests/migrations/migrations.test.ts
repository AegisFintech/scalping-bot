import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { migrationFiles } from "../../packages/database/src/index.js";

const requiredTables = [
  "accounts",
  "symbols",
  "candle_snapshots",
  "candles",
  "indicator_snapshots",
  "order_book_snapshots",
  "order_book_levels",
  "analysis_runs",
  "model_requests",
  "model_responses",
  "validation_results",
  "risk_decisions",
  "order_groups",
  "orders",
  "fills",
  "positions",
  "trades",
  "session_statistics",
  "setup_statistics",
  "daily_risk_state",
  "service_health",
  "server_metrics",
  "audit_events",
  "runtime_controls",
  "strategy_versions",
  "broker_execution_events",
];

describe("migrations", () => {
  it("are ordered and contain every required normalized table", async () => {
    const directory = path.resolve("migrations");
    expect(await migrationFiles(directory)).toEqual([
      "0001_initial.sql",
      "0002_dashboard_views.sql",
      "0003_symbol_volume_scale.sql",
      "0004_daily_risk_net_flows.sql",
      "0005_paper_account_identity.sql",
      "0006_ctrader_demo_execution_events.sql",
    ]);
    const sql = (
      await Promise.all(
        (await migrationFiles(directory)).map((file) =>
          readFile(path.join(directory, file), "utf8"),
        ),
      )
    ).join("\n");
    for (const table of requiredTables)
      expect(sql).toContain(`CREATE TABLE ${table}`);
  });

  it("contains no unreviewed destructive statements", async () => {
    const files = await migrationFiles(path.resolve("migrations"));
    for (const file of files) {
      const sql = await readFile(path.resolve("migrations", file), "utf8");
      expect(sql).not.toMatch(
        /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i,
      );
    }
  });
});
