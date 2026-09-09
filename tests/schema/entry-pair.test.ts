import { expect, it } from "vitest";
import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
it("keeps the new provider contract minimal and the local envelope explicit", () => {
  const provider = new ModelResponseValidator(
    "schemas/entry-pair-provider-1.0.json",
  );
  expect(
    provider.parse('{"buy_stop":"4406","sell_stop":"4404"}').accepted,
  ).toBe(true);
  expect(provider.parse('{"buy_stop":"4406"}').accepted).toBe(false);
  const local = new ModelResponseValidator(
    "schemas/entry-pair-context-1.0.json",
  );
  const context = {
    schema_version: "entry-pair-1.0",
    analysis_id: "00000000-0000-4000-8000-000000000086",
    symbol: "XAUUSD",
    captured_at: "2026-09-09T00:00:00Z",
    valid_until: "2026-09-09T00:05:00Z",
    buy_stop: "4406",
    sell_stop: "4404",
  };
  expect(local.parse(JSON.stringify(context)).accepted).toBe(true);
  expect(
    local.parse(JSON.stringify({ ...context, buy_stop: 4406 })).accepted,
  ).toBe(false);
});
