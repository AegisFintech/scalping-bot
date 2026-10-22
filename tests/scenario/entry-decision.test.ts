import { describe, expect, it } from "vitest";
import {
  bindEntryDecision,
  validateEntryDecision,
  entryDecisionSchema,
} from "../../packages/scenario-engine/src/entry-decision.js";
const context = {
  analysisId: "00000000-0000-4000-8000-000000000001",
  symbol: "XAUUSD",
  capturedAt: "2026-10-22T01:00:02Z",
  tickSize: "0.01",
  observedM1End: "2026-10-22T01:00:00Z",
  availableAt: "2026-10-22T01:00:12Z",
};
describe("explicit Codex abstention", () => {
  it("binds WAIT to local identity and completed M1 without invented entries", () => {
    const plan = bindEntryDecision(
      JSON.stringify({
        decision: "WAIT",
        reason: "Conflicting structure",
        buy_stop: null,
        sell_stop: null,
      }),
      context,
    );
    expect(plan.schema_version).toBe("entry-wait-1.0");
    expect(validateEntryDecision(JSON.stringify(plan), context)).toEqual(plan);
    expect(plan).not.toHaveProperty("buy_stop");
  });
  it("preserves both executable OCO prices", () => {
    expect(
      bindEntryDecision(
        JSON.stringify({
          decision: "OCO",
          reason: "Box boundaries",
          buy_stop: "4002",
          sell_stop: "3998",
        }),
        context,
      ),
    ).toMatchObject({
      schema_version: "entry-pair-1.0",
      buy_stop: "4002",
      sell_stop: "3998",
    });
  });
  it.each([
    { decision: "WAIT", reason: "wait", buy_stop: "4002", sell_stop: null },
    { decision: "OCO", reason: "trade", buy_stop: null, sell_stop: "3998" },
    { decision: "WAIT", reason: "", buy_stop: null, sell_stop: null },
    { decision: "OCO", reason: "trade", buy_stop: "0", sell_stop: "3998" },
  ])("rejects conflicting/missing fields", (v) =>
    expect(entryDecisionSchema.safeParse(v).success).toBe(false),
  );
  it("rejects stale, future, mismatched and injected WAIT context", () => {
    const p = bindEntryDecision(
      JSON.stringify({
        decision: "WAIT",
        reason: "wait",
        buy_stop: null,
        sell_stop: null,
      }),
      context,
    );
    for (const change of [
      { observed_m1_end: "2026-10-22T01:01:00Z" },
      { observed_m1_end: "2026-10-22T00:50:00Z" },
      { analysis_id: "other" },
      { buy_stop: "4002" },
    ])
      expect(() =>
        validateEntryDecision(JSON.stringify({ ...p, ...change }), context),
      ).toThrow();
  });
});

it("rejects duplicate decision fields rather than using the last value", () => {
  expect(() =>
    bindEntryDecision(
      '{"decision":"WAIT","decision":"OCO","reason":"box","buy_stop":"4002","sell_stop":"3998"}',
      context,
    ),
  ).toThrow("AI_ENTRY_DECISION_AMBIGUOUS");
});
