import { createHash } from "node:crypto";
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
  "spread_observations",
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
  "observability_outbox",
  "runtime_controls",
  "strategy_versions",
  "broker_execution_events",
  "automatic_analysis_intervals",
];
const directory = path.resolve("migrations");

describe("migrations", () => {
  it("preserves historically applied migration bytes", async () => {
    const expected = new Map([
      [
        "0001_initial.sql",
        "bf2cc9b1a9bcb7753dc0ed0a9040947c4e105a617ac8f5753038db81563a29f6",
      ],
      [
        "0002_dashboard_views.sql",
        "cb4713734ca1c89f597b46603f256fecd88a71db83145a7bdfeeb0f89f44e119",
      ],
    ]);
    for (const [file, checksum] of expected) {
      const contents = await readFile(path.join(directory, file));
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        checksum,
      );
    }
  });

  it("are ordered and contain every required normalized table", async () => {
    expect(await migrationFiles(directory)).toEqual([
      "0001_initial.sql",
      "0002_dashboard_views.sql",
      "0003_symbol_volume_scale.sql",
      "0004_daily_risk_net_flows.sql",
      "0005_paper_account_identity.sql",
      "0006_ctrader_demo_execution_events.sql",
      "0007_spread_observations.sql",
      "0008_observability_outbox.sql",
      "0009_model_prompt_artifacts.sql",
      "0010_automatic_analysis_intervals.sql",
      "0011_ctrader_closing_order_evidence.sql",
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
