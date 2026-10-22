import { describe, expect, it } from "vitest";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
import { bindEntryDecision } from "../../packages/scenario-engine/src/entry-decision.js";
const wait = {
  decision: "WAIT",
  reason: "Conflicting structure",
  buy_stop: null,
  sell_stop: null,
};
describe("versioned evidence-first wire schemas", () => {
  it.each([
    "codex-entry-request-1.3",
    "codex-entry-request-1.4",
    "codex-entry-response-1.1",
    "entry-decision-provider-1.0",
    "entry-wait-context-1.0",
  ])("compiles %s with the production validator", (name) => {
    expect(
      () => new ModelResponseValidator(`schemas/${name}.json`),
    ).not.toThrow();
  });
  it("validates WAIT without creating entry fields, rejecting injected authority", () => {
    const provider = new ModelResponseValidator(
      "schemas/entry-decision-provider-1.0.json",
    );
    expect(provider.parse(JSON.stringify(wait)).accepted).toBe(true);
    expect(
      provider.parse(JSON.stringify({ ...wait, size: "100" })).accepted,
    ).toBe(false);
    const plan = bindEntryDecision(JSON.stringify(wait), {
      analysisId: "00000000-0000-4000-8000-000000000001",
      symbol: "XAUUSD",
      capturedAt: "2026-10-22T01:00:02Z",
      tickSize: "0.01",
      observedM1End: "2026-10-22T01:00:00Z",
    });
    const stored = new ModelResponseValidator(
      "schemas/entry-wait-context-1.0.json",
    );
    expect(stored.parse(JSON.stringify(plan)).accepted).toBe(true);
    expect(
      stored.parse(JSON.stringify({ ...plan, buy_stop: "4002" })).accepted,
    ).toBe(false);
  });
});
