import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { executionRiskPolicy } from "../../packages/config/src/policy.js";

const validate = new Ajv2020({ strict: true }).compile(
  JSON.parse(readFileSync("schemas/risk-policy-1.0.json", "utf8")) as AnySchema,
);

it("reports explicit demo loss-policy authority while preserving historical contracts", () => {
  for (const mode of [
    "demo",
    "paper",
    "shadow",
    "live",
    "replay",
    "backtest",
  ] as const) {
    const policy = executionRiskPolicy(mode);
    expect(validate(policy)).toBe(true);
    expect(policy.lossLimitsEnforced).toBe(mode !== "demo");
    expect(
      validate({ ...policy, lossLimitsEnforced: !policy.lossLimitsEnforced }),
    ).toBe(false);
  }
  expect(
    validate({
      version: "market-stop-v1",
      setupRiskPercent: "1",
      dailyLossLimitPercent: "5",
      drawdownLimitPercent: "5",
    }),
  ).toBe(true);
});

it("rejects missing demo authority, unknown policy, changed percentages and extra fields", () => {
  const policy = executionRiskPolicy("demo");
  for (const patch of [
    { mode: undefined },
    { lossLimitsEnforced: undefined },
    { version: "unknown" },
    { version: "market-stop-v1" },
    { mode: "live" },
    { setupRiskPercent: "2" },
    { setupRiskPercent: 1 },
    { dailyLossLimitPercent: "NaN" },
    { override: true },
  ])
    expect(validate({ ...policy, ...patch })).toBe(false);
});
