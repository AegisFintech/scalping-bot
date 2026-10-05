import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";

const ajv = new Ajv2020({ strict: true });
const addFormats = formatsModule.default as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);
const schema = (name: string) =>
  JSON.parse(readFileSync(`schemas/${name}.json`, "utf8")) as AnySchema;
ajv.addSchema(
  schema("paired-replay-input-1.0"),
  "https://scalper.local/schemas/paired-replay-input-1.0.json",
);
const validate = ajv.compile(schema("forward-study-1.0"));
const daily = ajv.compile(schema("forward-daily-1.0"));
const study = {
  label: "PROSPECTIVE_CONDITIONAL_STUDY_V1",
  registered_at: "2026-10-02T03:00:00.000Z",
  start: "2026-10-02T04:00:00.000Z",
  until: "2026-11-01T04:00:00.000Z",
  release: "0.3.0-fade-limit.3",
  days: 30,
  window_ms: 86400000,
  settlement_delay_ms: 600000,
  candidates: [
    "approved_entries",
    "model_levels",
    "tp_original",
    "tp_0_75",
    "tp_1_25",
  ],
  source_sha256: "a".repeat(64),
  decision: "HOLD",
  broker_authority: false,
};
it("describes the frozen registration and refuses tuning or authority", () => {
  expect(validate(study)).toBe(true);
  for (const patch of [
    { days: 7 },
    { decision: "PROMOTE" },
    { broker_authority: true },
    { risk: "2" },
    { candidates: [] },
    { source_sha256: "bad" },
  ]) {
    expect(validate({ ...study, ...patch })).toBe(false);
  }
});
it("requires provenance and null hypothetical economics in daily reports", () => {
  const body = {
    label: "PROSPECTIVE_CONDITIONAL_DAILY_V1",
    study_sha256: "a".repeat(64),
    window_index: 0,
    from: study.start,
    until: "2026-10-03T04:00:00.000Z",
    observed_at: "2026-10-03T04:15:00.000Z",
    elapsed_ms: 1000,
    decision: "HOLD",
    broker_authority: false,
    production_changed: false,
    counterfactual_net_pnl: null,
    limitations: ["a", "b", "c", "d", "e"],
    evidence: {
      input: {
        label: "PAIRED_REPLAY_INPUT_V1",
        release: study.release,
        from: study.start,
        until: "2026-10-03T04:00:00.000Z",
        cohort: "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
        economics: null,
        setups: [],
      },
      actual_closed_trades: {},
      conditional_replay: {},
    },
  };
  expect(daily({ body, sha256: "b".repeat(64) })).toBe(true);
  expect(
    daily({
      body: { ...body, counterfactual_net_pnl: "100" },
      sha256: "b".repeat(64),
    }),
  ).toBe(false);
  expect(
    daily({
      body: { ...body, broker_authority: true },
      sha256: "b".repeat(64),
    }),
  ).toBe(false);
});
