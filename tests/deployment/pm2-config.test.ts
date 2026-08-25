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
          app.env.STRATEGY_VERSION === "0.1.0-actionable-oco-auto-demo.22",
      ),
    ).toBe(true);
    expect(
      config.apps.every(
        (app) => app.env.CODE_VERSION === "0.1.0-actionable-oco-auto-demo.22",
      ),
    ).toBe(true);
  });
});
