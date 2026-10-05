import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  learningObservation,
  summarizeLearning,
  learningWindow,
  type LearningRow,
} from "../../packages/evaluation/src/demo-learning.js";
import { ENTRY_PAIR_PROMPT } from "../../packages/scenario-engine/src/entry-planner.js";

function row(extra: Partial<LearningRow> = {}): LearningRow {
  return {
    direction: "LONG",
    opened_at: "2026-10-01T00:00:00.000Z",
    closed_at: "2026-10-01T00:01:00.000Z",
    net: "8",
    fees: "-2",
    risk_budget: "20",
    model_level: "4200",
    effective_entry: "4201",
    ema_alignment: "BULLISH",
    close_evidence: [
      {
        gross: "10",
        swap: "0",
        commission: "-2",
        conversion: "0",
        order_type: 4,
      },
    ],
    ...extra,
  };
}

describe("observational demo learning", () => {
  it("requires an explicit supported release and real UTC calendar window", () => {
    const args = [
      "0.3.0-fade-limit.3",
      "2026-09-25T01:00:00Z",
      "2026-10-02T01:00:00.123Z",
    ];
    expect(learningWindow(args).release).toBe(args[0]);
    for (const bad of [
      [],
      [...args, "extra"],
      ["unknown", ...args.slice(1)],
      [args[0]!, "2026-02-30T00:00:00Z", args[2]!],
      [args[0]!, args[2]!, args[1]!],
      [args[0]!, args[1]!, args[1]!],
    ]) {
      expect(() => learningWindow(bad)).toThrow("LEARNING_WINDOW_INVALID");
    }
  });
  it("counts signed costs once and labels the risk allocation honestly", () => {
    expect(learningObservation(row())).toMatchObject({
      netPnl: "8",
      grossPnl: "10",
      signedCosts: "-2",
      approvedLegBudget: "20",
      netOverApprovedLegBudget: "0.4",
      entryDisplacement: "1",
      holdingSeconds: 60,
      exitMechanism: "NATIVE_PROTECTION",
      closeEvidenceStatus: "MATCHED",
    });
  });
  it("preserves positive swap and does not infer TP from profitable protection", () => {
    const result = learningObservation(
      row({
        net: "2950.56",
        fees: "28.96",
        close_evidence: [
          {
            gross: "2921.6",
            swap: "71.56",
            commission: "-42.6",
            conversion: "0",
            order_type: 4,
          },
        ],
      }),
    );
    expect(result.costComponents?.swap).toBe("71.56");
    expect(result.closeEvidenceStatus).toBe("MATCHED");
    expect(result.exitMechanism).toBe("NATIVE_PROTECTION");
  });
  it("does not manufacture missing risk, conditions, entry or close evidence", () => {
    expect(
      learningObservation(
        row({
          risk_budget: null,
          ema_alignment: null,
          model_level: null,
          close_evidence: [],
        }),
      ),
    ).toMatchObject({
      netOverApprovedLegBudget: null,
      entryEmaAlignment: "UNKNOWN",
      entryDisplacement: null,
      costComponents: null,
      exitMechanism: "UNKNOWN",
      closeEvidenceStatus: "MISSING",
    });
  });
  it("withholds conflicting and incomplete terminal costs", () => {
    expect(learningObservation(row({ net: "9" })).costComponents).toBeNull();
    expect(
      learningObservation(
        row({
          close_evidence: [row().close_evidence[0]!, row().close_evidence[0]!],
        }),
      ).closeEvidenceStatus,
    ).toBe("AMBIGUOUS_OR_MISMATCHED");
    expect(
      learningObservation(
        row({
          close_evidence: [
            {
              gross: null,
              swap: "0",
              commission: "-2",
              conversion: "0",
              order_type: 4,
            },
          ],
        }),
      ).costComponents,
    ).toBeNull();
  });
  it("summarizes numerically, includes starting-zero drawdown and isolates one outlier", () => {
    const result = summarizeLearning([
      row({ net: "100", closed_at: "2026-10-01T00:03:00Z" }),
      row({ net: "-20", closed_at: "2026-10-01T00:02:00Z" }),
      row({ net: "9" }),
    ]);
    expect(result).toMatchObject({
      trades: 3,
      wins: 2,
      netPnl: "89",
      signedCosts: "-6",
      grossPnl: "95",
      largestWinner: "100",
      netExcludingLargestWinner: "-11",
      profitFactor: "5.45",
      closedTradeDrawdown: "20",
    });
    expect(summarizeLearning([])).toMatchObject({
      trades: 0,
      profitFactor: null,
      meanNetPnl: null,
    });
  });
  it.each(["NaN", "Infinity", "1e3", "0.12345678901"])(
    "rejects invalid money %s",
    (net) => {
      expect(() => learningObservation(row({ net }))).toThrow(
        "LEARNING_DECIMAL_INVALID",
      );
    },
  );
  it("rejects inverted time and nonpositive risk without changing trading state", () => {
    expect(() => learningObservation(row({ closed_at: "bad" }))).toThrow(
      "LEARNING_TIME_INVALID",
    );
    expect(() => learningObservation(row({ risk_budget: "0" }))).toThrow(
      "LEARNING_RISK_BUDGET_INVALID",
    );
    expect(() => learningObservation(row({ effective_entry: "-1" }))).toThrow(
      "LEARNING_ENTRY_INVALID",
    );
  });
  it("keeps candidate guidance isolated from production dispatch", () => {
    const candidate = readFileSync(
      "prompts/research/entry-guidance-candidate-v1.md",
      "utf8",
    );
    expect(ENTRY_PAIR_PROMPT.path).toBe("prompts/entry-pair-v4.md");
    expect(ENTRY_PAIR_PROMPT.version).toBe("entry-pair-v4");
    expect(candidate).toContain("Do not omit either price");
    expect(candidate).toContain("completed candles");
    expect(candidate).toContain("not change SL, TP, volume");
    expect(candidate).toContain("quote-adjacent");
  });
});
