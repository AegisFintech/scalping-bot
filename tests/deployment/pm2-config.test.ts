import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface Pm2App {
  readonly name: string;
  readonly cwd: string;
  readonly script: string;
  readonly interpreter: string;
  readonly args: readonly string[];
  readonly instances: number;
  readonly autorestart: boolean;
  readonly watch: boolean;
  readonly env: Readonly<Record<string, string>>;
}

interface Pm2Config {
  readonly apps: readonly Pm2App[];
}

const require = createRequire(import.meta.url);
const config = require(path.resolve("ecosystem.config.cjs")) as Pm2Config;

describe("PM2 deployment configuration", () => {
  it("defines one restartable process for every service", () => {
    expect(config.apps.map((app) => app.name)).toEqual([
      "scalper-analytics",
      "scalper-market-data",
      "scalper-ai",
      "scalper-execution",
      "scalper-dashboard",
    ]);
    for (const app of config.apps) {
      expect(app.cwd).toBe(path.resolve("."));
      expect(app.instances).toBe(1);
      expect(app.autorestart).toBe(true);
      expect(app.watch).toBe(false);
      expect(app.interpreter).toBe("none");
      expect(app.script).toBe(process.execPath);
      expect(app.args[0]?.startsWith(path.resolve("."))).toBe(true);
    }
  });

  it("contains no trading enablement or credentials", () => {
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(
      /API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|DATABASE_URL|LIVE_TRADING_ENABLED|TRADING_MODE/,
    );
    expect(config.apps.every((app) => app.env.APP_ENV === "production")).toBe(
      true,
    );
    expect(
      config.apps.every(
        (app) =>
          app.env.STRATEGY_VERSION === "0.1.0-actionable-oco-auto-demo.37",
      ),
    ).toBe(true);
    expect(
      config.apps.every(
        (app) => app.env.CODE_VERSION === "0.1.0-actionable-oco-auto-demo.37",
      ),
    ).toBe(true);
    expect(
      config.apps.every(
        (app) =>
          app.env.AUTOMATIC_ANALYSIS_COMPLETED_LIMIT === "500" &&
          app.env.AUTOMATIC_ANALYSIS_COMPLETED_BASELINE === "0" &&
          app.env.AUTOMATIC_DEMO_CLOSED_TRADE_LIMIT === "100" &&
          app.env.AUTOMATIC_DEMO_CLOSED_TRADE_BASELINE === "0" &&
          app.env.AUTOMATIC_ANALYSIS_START_WINDOW_SECONDS === "10" &&
          app.env.AUTOMATIC_ANALYSIS_STALL_SECONDS === "180" &&
          app.env.ANALYSIS_SCHEDULER_LEAD_MS === "1000" &&
          app.env.MODEL_MINIMUM_CALL_BUDGET_SECONDS === "40" &&
          app.env.MODEL_POST_RESPONSE_RESERVE_SECONDS === "5" &&
          app.env.MODEL_COMPACT_RAW_TAIL_1M === "30" &&
          app.env.MODEL_COMPACT_RAW_TAIL_5M === "18" &&
          app.env.MODEL_COMPACT_RAW_TAIL_15M === "12" &&
          app.env.MAX_ENTRY_DISTANCE_ATR === "2.5" &&
          app.env.MIN_RISK_REWARD_RATIO === "0.5" &&
          app.env.MIN_EXPECTED_NET_TO_FEES_RATIO === "1" &&
          app.env.ORDER_EXPIRY_MIN_SECONDS === "900" &&
          app.env.ORDER_EXPIRY_MAX_SECONDS === "1800" &&
          app.env.PREFERRED_ORDER_EXPIRY_SECONDS === "1500" &&
          app.env.AI_REASONING_EFFORT === "low",
      ),
    ).toBe(true);
  });
});
