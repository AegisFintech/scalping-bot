import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import {
  OPERATOR_KEYS,
  resolveRuntimeEnvironment,
} from "../../packages/config/src/policy.js";

function check(content: string, args: readonly string[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "scalper-config-"));
  const file = path.join(directory, ".env");
  try {
    writeFileSync(file, content, { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/check-config.ts", file, ...args],
      { encoding: "utf8" },
    );
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      unchanged: readFileSync(file, "utf8") === content,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("concise environment and read-only preflight", () => {
  it("keeps the template concise, stopped and explicit about the exact model", () => {
    const template = parse(readFileSync(".env.sample"));
    expect(Object.keys(template).sort()).toEqual([...OPERATOR_KEYS].sort());
    expect(Object.keys(template)).toHaveLength(21);
    expect(template.AI_MODEL).toBe("gpt-6-astra/u64");
    expect(template).toMatchObject({
      TRADING_MODE: "paper",
      EMERGENCY_STOP: "true",
      AUTOMATIC_ANALYSIS_ENABLED: "false",
      DEMO_TRADING_ENABLED: "false",
    });
    expect(resolveRuntimeEnvironment(template)).toMatchObject({
      CTRADER_API_HOST: "demo.ctraderapi.com",
      CTRADER_API_PORT: "5036",
      LIVE_TRADING_ENABLED: "false",
    });
  });
  it("reports actual file counts separately from the normal template without exposing credentials", () => {
    const result = check(
      "AI_MODEL=gpt-6-astra/u64\nAI_API_KEY=fixture-private-value\nGH_PAT=fixture-delivery-value\n",
      ["--startup"],
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      valid: true,
      scope: "execution_configuration",
      normalSettings: 21,
      fileSettings: 3,
      requestedModel: "gpt-6-astra/u64",
    });
    expect(result.output).not.toContain("fixture-");
    expect(result.unchanged).toBe(true);
  });
  it("starts authorized demo without an absolute floor and reports ignored legacy floors", () => {
    const content =
      "TRADING_MODE=demo\nDEMO_TRADING_ENABLED=true\nDEMO_TRADING_ACKNOWLEDGEMENT=I_UNDERSTAND_DEMO_ORDERS_USE_A_BROKER_DEMO_ACCOUNT\nMAX_POSITION_NOTIONAL=1000\nACCOUNT_EQUITY_FLOOR=\n";
    expect(check(content).status).toBe(0);
    const result = check(content, ["--startup"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      valid: true,
      obsoleteSettings: [
        "ACCOUNT_EQUITY_FLOOR:ignored; remove this obsolete setting",
      ],
    });
    expect(result.unchanged).toBe(true);
  });
  it("rejects cached legacy model overrides and unknown options without echoing values", () => {
    const result = check(
      "AI_MODEL=fixture-private-value\nAI_API_KEY=fixture-secret\n",
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("CONFIG_POLICY_CONFLICT:AI_MODEL");
    expect(result.output).not.toContain("fixture-");
    expect(result.unchanged).toBe(true);
    expect(check("", ["--unknown"]).status).toBe(1);
  });
});
