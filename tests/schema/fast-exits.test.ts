import { readFileSync } from "node:fs";
import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { expect, it } from "vitest";
import {
  fastExitWindow,
  FAST_EXIT_RELEASE,
} from "../../packages/evaluation/src/fast-exit-input.js";
const ajv = new Ajv2020({ strict: true });
(formatsModule.default as unknown as (instance: Ajv2020) => Ajv2020)(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("schemas/fast-exit-input-1.0.json", "utf8"),
  ) as AnySchema,
);
it("requires exact new research identity and preserves missing evidence", () => {
  const value = {
    label: "FAST_EXIT_INPUT_V1",
    release: FAST_EXIT_RELEASE,
    from: "2026-10-19T00:00:00Z",
    until: "2026-10-20T00:00:00Z",
    cohort: "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
    economics: null,
    setups: [
      {
        created: "2026-10-19T01:00:00Z",
        captured: null,
        available: null,
        valid_until: null,
        submission_valid_until: null,
        tick_size: "0.01",
        model_buy: null,
        model_sell: null,
        model_schema: null,
        legs: [
          {
            side: "BUY",
            accepted: null,
            entry: "100",
            sl: "2",
            tp: "1.6",
            volume: "100",
            budget: null,
            equity: null,
            order_type: "LIMIT",
            tif: "GTC",
            fill: null,
            fill_count: 0,
            cancelled_at: null,
            fee_evidence: [],
          },
        ],
      },
    ],
  };
  expect(validate(value)).toBe(true);
  expect(validate({ ...value, economics: { fees: 0 } })).toBe(false);
  expect(validate({ ...value, release: "0.3.0-fade-limit.3" })).toBe(false);
  expect(validate({ ...value, accountId: "forbidden" })).toBe(false);
});
it("accepts only exact release and strict UTC window arguments", () => {
  expect(
    fastExitWindow([
      FAST_EXIT_RELEASE,
      "2026-10-19T00:00:00Z",
      "2026-10-20T00:00:00Z",
    ]).release,
  ).toBe(FAST_EXIT_RELEASE);
  expect(() =>
    fastExitWindow(["unknown", "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z"]),
  ).toThrow();
  expect(() =>
    fastExitWindow([
      FAST_EXIT_RELEASE,
      "2026-10-21T00:00:00Z",
      "2026-10-20T00:00:00Z",
    ]),
  ).toThrow();
});
