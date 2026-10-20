import { describe, expect, it } from "vitest";
import {
  buildQuickTpCandidate,
  type QuickTpCandidateInput,
} from "../../packages/strategy-candidates/src/quick-tp.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
function input(): QuickTpCandidateInput {
  return {
    response: response(),
    metadata: metadata(),
    now: "2026-09-01T00:00:02Z",
    availableAt: "2026-09-01T00:00:01Z",
    quote: {
      bid: "4443.4",
      ask: "4443.6",
      sourceTime: "2026-09-01T00:00:01.5Z",
      receivedAt: "2026-09-01T00:00:01.7Z",
    },
    atr: "3",
    maximumStopDistance: "10",
    volumes: { buy: "100", sell: "200" },
  };
}
describe("cost-covered broker TP candidate", () => {
  it("preserves breakout entries and approved quantities while reducing native TP", () => {
    const value = input(),
      before = structuredClone(value);
    const result = buildQuickTpCandidate(value);
    expect(result).toMatchObject({
      accepted: true,
      authority: "RESEARCH_ONLY",
    });
    expect(result.response?.buy_stop.entry_price).toBe("4444");
    expect(result.response?.sell_stop.entry_price).toBe("4443");
    expect(result.response?.buy_stop.stop_loss).toBe("4436.5");
    expect(result.response?.sell_stop.stop_loss).toBe("4450.5");
    expect(Number(result.response?.buy_stop.take_profit)).toBeLessThan(4450);
    expect(Number(result.response?.sell_stop.take_profit)).toBeGreaterThan(
      4437,
    );
    expect(result.evidence.map((e) => e.volume)).toEqual(["100", "200"]);
    for (const row of result.evidence)
      expect(Number(row.expected_net_to_fees_ratio)).toBeGreaterThanOrEqual(
        1.5,
      );
    expect(value).toEqual(before);
  });
  it("rounds the ATR stop inward without widening it", () => {
    const value = input();
    Object.assign(value, { atr: "3.003" });
    const result = buildQuickTpCandidate(value);
    expect(result.accepted).toBe(true);
    expect(result.response?.buy_stop.stop_loss).toBe("4436.5");
  });
  it("rejects an unaffordable stop without downsizing or widening", () => {
    expect(
      buildQuickTpCandidate({ ...input(), maximumStopDistance: "7" }),
    ).toMatchObject({
      accepted: false,
      response: null,
      reasonCodes: ["QUICK_TP_STOP_UNAFFORDABLE_OR_INVALID"],
    });
  });
  it.each(["0", "101", "1000001"])("rejects unapproved volume %s", (volume) => {
    expect(
      buildQuickTpCandidate({
        ...input(),
        volumes: { buy: volume, sell: "100" },
      }).accepted,
    ).toBe(false);
  });
  it("rejects costs above the target cap rather than manufacturing a small profit", () => {
    const value = input();
    Object.assign(value, { atr: "0.5" });
    expect(buildQuickTpCandidate(value)).toMatchObject({
      accepted: false,
      response: null,
    });
  });
  it("fails closed on unavailable commission conversion", () => {
    const value = input();
    Object.assign(value.metadata, { quoteToAccountConversionRate: "0" });
    expect(buildQuickTpCandidate(value).accepted).toBe(false);
  });
  it("retains breakout provenance failures and never moves crossed entries", () => {
    const value = input();
    Object.assign(value.quote, { ask: "4445" });
    expect(buildQuickTpCandidate(value).reasonCodes).toContain(
      "BUY_BREAKOUT_LEVEL_CROSSED_OR_INVALID",
    );
  });
  it("rejects broker distance restrictions that cannot fit", () => {
    const value = input();
    Object.assign(value.metadata, { minStopDistance: "8" });
    expect(buildQuickTpCandidate(value).accepted).toBe(false);
  });
  it("keeps a nonterminating reward ratio within decimal boundary precision", () => {
    const value = input();
    Object.assign(value, { atr: "3.008" });
    const result = buildQuickTpCandidate(value);
    expect(result.accepted).toBe(true);
    expect(result.response?.buy_stop.risk_reward_ratio).toMatch(
      /^(0|[1-9][0-9]*)(\.[0-9]{1,10})?$/,
    );
  });

  it("uses exact-volume minimum commissions without resizing an unaffordable candidate", () => {
    const value = input();
    Object.assign(value.metadata.commission, { minimum: "1" });
    expect(buildQuickTpCandidate(value).accepted).toBe(false);
    const independent = { ...value, volumes: { buy: "1000", sell: "1000" } };
    const result = buildQuickTpCandidate(independent);
    expect(result.accepted).toBe(true);
    expect(result.evidence.map((row) => row.volume)).toEqual(["1000", "1000"]);
    expect(value.volumes).toEqual({ buy: "100", sell: "200" });
  });
});
