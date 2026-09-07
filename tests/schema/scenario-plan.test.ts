import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";

const validate = new ModelResponseValidator("schemas/scenario-plan-1.0.json");
const fixture = JSON.parse(
  readFileSync("tests/fixtures/scenario/manual-levels-synthetic.json", "utf8"),
) as { plan: Record<string, unknown> };
describe("scenario-only output schema", () => {
  it("requires both scenario directions and exact two-target ladders", () => {
    expect(validate.parse(JSON.stringify(fixture.plan)).accepted).toBe(true);
    expect(
      validate.parse(
        JSON.stringify({ ...fixture.plan, recovery_targets: ["4416"] }),
      ).accepted,
    ).toBe(false);
    expect(
      validate.parse(
        JSON.stringify({ ...fixture.plan, extension_targets: null }),
      ).accepted,
    ).toBe(false);
  });
  it("forbids execution, risk and model-selected validity policy fields", () => {
    for (const key of [
      "volume",
      "risk_percent",
      "mode",
      "stop_loss",
      "expiry_seconds",
      "decision",
      "api_key",
    ])
      expect(
        validate.parse(JSON.stringify({ ...fixture.plan, [key]: "fixture" }))
          .accepted,
      ).toBe(false);
  });
  it("rejects extra nested fields and unbounded model prose", () => {
    expect(
      validate.parse(
        JSON.stringify({
          ...fixture.plan,
          decision_zone: { lower: "4400", upper: "4406", notes: "text" },
        }),
      ).accepted,
    ).toBe(false);
    expect(
      validate.parse(
        JSON.stringify({ ...fixture.plan, symbol: "x".repeat(10000) }),
      ).accepted,
    ).toBe(false);
  });
});
