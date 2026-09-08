import { describe, expect, it } from "vitest";
import { datedEvaluationPlans } from "../../packages/scenario-engine/src/export-lifetime.js";
const row = {
  available: new Date("2026-09-08T12:00:00Z"),
  expires: new Date("2026-09-08T12:03:00Z"),
  time_in_force: "GTD" as const,
};
describe("evaluation lifetime compatibility", () => {
  it("preserves dated plans and excludes submissions after their deadline", () => {
    expect(
      datedEvaluationPlans([row, { ...row, available: row.expires }]),
    ).toEqual([row]);
  });
  it("rejects GTC explicitly rather than silently exporting an empty performance cohort", () => {
    expect(() =>
      datedEvaluationPlans([{ ...row, time_in_force: "GTC", expires: null }]),
    ).toThrow("EVALUATION_GTC_NOT_SUPPORTED");
  });
  it.each([null, new Date("invalid")])(
    "rejects invalid dated expiry %s",
    (expires) => {
      expect(() => datedEvaluationPlans([{ ...row, expires }])).toThrow(
        "EVALUATION_LIFETIME_INVALID",
      );
    },
  );
});
