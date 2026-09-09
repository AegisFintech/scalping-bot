import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ReusableScenarioModel,
  type ContextStore,
  type StoredContext,
} from "../../apps/execution-service/src/scenario-context.js";
import { evaluateScenarioExecutionWindow } from "../../apps/execution-service/src/automatic-analysis-schedule.js";
import { scenarioOco } from "../../packages/scenario-engine/src/oco.js";
import { validateSemantics } from "../../packages/risk-engine/src/model-validator.js";
import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
import type { ReplayInput } from "../../packages/scenario-engine/src/replay.js";
import type { ScenarioPlanner } from "../../packages/scenario-engine/src/planner.js";
import { analysisChart } from "../helpers/analysis-chart.js";
import { usageTelemetry } from "../../packages/ai-client/src/telemetry.js";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/scenario/manual-levels-synthetic.json", "utf8"),
) as ReplayInput;
const base = Date.parse(fixture.plan.captured_at);
const at = (s: number) => new Date(base + s * 1000).toISOString();
function payload() {
  return {
    analysis_id: "00000000-0000-4000-8000-000000000075",
    server_time: at(40),
    performance: {},
    execution_constraints: {
      tick_size: "0.01",
      current_bid: "4404.95",
      current_ask: "4405.05",
      buy_preferred_entry_minimum: "4405.5",
      buy_entry_maximum: "4415",
      sell_preferred_entry_maximum: "4404.5",
      sell_entry_minimum: "4395",
      minimum_fee_buffered_take_profit_distance: "0.20",
      minimum_stop_distance: "0.40",
      maximum_stop_distance: "5",
      preferred_expires_at: at(100),
      order_expiry_min_seconds: 60,
      order_expiry_max_seconds: 180,
    },
  };
}
function input() {
  return {
    snapshot: {
      serverTime: at(0),
      metadata: fixture.metadata,
      candles: [],
    } as unknown as MarketSnapshot,
    chart: analysisChart(),
    payload: payload(),
  };
}
function memory(): ContextStore & { row: StoredContext | null } {
  return {
    row: null,
    latest() {
      return Promise.resolve(this.row);
    },
    claim(i) {
      if (this.row) return Promise.resolve(false);
      this.row = {
        id: i.id,
        requestedModel: "deepseek-v4-pro/u5W",
        state: "REQUESTING",
        requestedAt: at(0),
        capturedAt: i.capturedAt,
        validUntil: at(300),
        availableAt: null,
        tickSize: i.tickSize,
        plan: null,
        consumed: false,
        reason: null,
      };
      return Promise.resolve(true);
    },
    finish(_id, result, reason) {
      if (!this.row) throw new Error("missing");
      this.row = {
        ...this.row,
        state: result ? "READY" : "FAILED",
        availableAt: result ? at(40) : null,
        plan: result?.response ?? null,
        reason,
      };
      return Promise.resolve();
    },
  };
}
function stored(): StoredContext {
  return {
    id: fixture.plan.analysis_id,
    requestedModel: "deepseek-v4-pro/u5W",
    state: "READY",
    requestedAt: at(0),
    capturedAt: at(0),
    validUntil: at(300),
    availableAt: at(30),
    tickSize: "0.01",
    plan: fixture.plan,
    consumed: false,
    reason: null,
  };
}
describe("reusable production context (synthetic contract tests, not strategy evidence)", () => {
  it.each([
    [40, 220, 220],
    [200, 380, 300],
    [240, 420, 300],
  ])(
    "bounds a longer expiry by the original map at %s seconds",
    (now, preferred, expected) => {
      const p = payload();
      p.server_time = at(now);
      p.execution_constraints.preferred_expires_at = at(preferred);
      const response = scenarioOco(fixture.plan, p);
      expect(response.valid_until).toBe(at(expected));
      expect(response.buy_stop.expires_at).toBe(at(expected));
      expect(response.sell_stop.expires_at).toBe(at(expected));
      expect(
        validateSemantics(response, {
          analysisId: response.analysis_id,
          symbol: "XAUUSD",
          now: new Date(at(now)),
          expiryReferenceTime: new Date(at(now)),
          quote: {
            bid: "4404.95",
            ask: "4405.05",
            sourceTime: at(now),
            receivedAt: at(now),
          },
          metadata: fixture.metadata,
          atr: "5",
          minRiskRewardRatio: "0.5",
          minExpirySeconds: 60,
          maxExpirySeconds: 180,
          maxStopDistanceAtr: "3",
          maxEntryDistanceAtr: "2.5",
          maxQuoteAgeMs: 3000,
        }).reasonCodes,
      ).toEqual([]);
    },
  );
  it("waits if map capping would leave less than the minimum lifetime", () => {
    const p = payload();
    p.server_time = at(241);
    p.execution_constraints.preferred_expires_at = at(421);
    expect(() => scenarioOco(fixture.plan, p)).toThrow("SCENARIO_WAIT_REFRESH");
  });
  it.each([
    { order_expiry_min_seconds: 0 },
    { order_expiry_max_seconds: 59 },
    { order_expiry_max_seconds: Number.NaN },
    { order_expiry_min_seconds: undefined },
    { preferred_expires_at: at(201) },
    { preferred_expires_at: at(380.001) },
  ])("rejects invalid expiry before capping: %j", (patch) => {
    const p = payload();
    p.server_time = at(200);
    p.execution_constraints.preferred_expires_at = at(380);
    Object.assign(p.execution_constraints, patch);
    expect(() => scenarioOco(fixture.plan, p)).toThrow(
      "SCENARIO_EXECUTION_CONSTRAINT_INVALID",
    );
  });
  it.each(["gpt-6-astra/u64", "gpt-5.6-sol/u40"])(
    "does not reuse %s after restart or bypass its paid-request cooldown",
    async (requestedModel) => {
      const store = memory();
      store.row = { ...stored(), requestedModel };
      const generate = vi.fn();
      const model = new ReusableScenarioModel(
        store,
        { generate },
        () => base + 40_000,
      );
      expect(await model.prepare(input())).toBe("SCENARIO_REFRESH_PENDING");
      expect(generate).not.toHaveBeenCalled();
      await expect(
        model.analyze({
          analysisId: String(payload().analysis_id),
          symbol: "XAUUSD",
          payload: payload(),
          chart: analysisChart(),
          timeoutMs: 5000,
        }),
      ).rejects.toThrow("SCENARIO_PREPARED_DECISION_MISSING");
    },
  );
  it("projects real performance-context diagnostics into the strict execution contract", () => {
    const p = payload();
    Object.assign(p.performance, {
      performance_adjustment: {
        applied: true,
        confidence_delta: -5,
        reason_codes: ["UNDERPERFORMANCE"],
        effective_sample_size: 23.5,
        minimum_sample_size: 20,
        decay: "0.97",
      },
    });
    expect(scenarioOco(fixture.plan, p).performance_adjustment).toEqual({
      applied: true,
      confidence_delta: -5,
      reason_codes: ["UNDERPERFORMANCE"],
    });
    Object.assign(p.performance, {
      performance_adjustment: {
        applied: true,
        confidence_delta: "invalid",
        reason_codes: ["UNDERPERFORMANCE"],
        effective_sample_size: 23.5,
      },
    });
    expect(() => scenarioOco(fixture.plan, p)).toThrow(
      "SCENARIO_DERIVED_SCHEMA_INVALID",
    );
  });
  it("derives tick-aligned two-sided proposals passing unchanged semantic guards", () => {
    const response = scenarioOco(fixture.plan, payload());
    expect(response.buy_stop.entry_price).toBe("4410.01");
    expect(response.sell_stop.entry_price).toBe("4399.99");
    expect(
      validateSemantics(response, {
        analysisId: response.analysis_id,
        symbol: "XAUUSD",
        now: new Date(at(40)),
        expiryReferenceTime: new Date(at(40)),
        quote: {
          bid: "4404.95",
          ask: "4405.05",
          sourceTime: at(40),
          receivedAt: at(40),
        },
        metadata: fixture.metadata,
        atr: "5",
        minRiskRewardRatio: "0.5",
        minExpirySeconds: 60,
        maxExpirySeconds: 120,
        maxStopDistanceAtr: "3",
        maxEntryDistanceAtr: "2.5",
        maxQuoteAgeMs: 3000,
      }).reasonCodes,
    ).toEqual([]);
  });
  it.each([
    [{ current_ask: "4410" }, "SCENARIO_WAIT_PRICE_RETURN"],
    [{ current_bid: "4399" }, "SCENARIO_WAIT_PRICE_RETURN"],
    [{ buy_entry_maximum: "4409" }, "SCENARIO_WAIT_ENTRY_DISTANCE"],
    [{ maximum_stop_distance: "0.39" }, "SCENARIO_WAIT_NET_REWARD"],
    [
      { preferred_expires_at: at(301) },
      "SCENARIO_EXECUTION_CONSTRAINT_INVALID",
    ],
    [{ tick_size: "bad" }, "INVALID_DECIMAL"],
  ])("never chases price or weakens geometry for %j", (patch, reason) => {
    const p = payload();
    Object.assign(p.execution_constraints, patch);
    expect(() => scenarioOco(fixture.plan, p)).toThrow(reason);
  });
  it("uses the actual first downside target rather than the intermediate extension trigger", () => {
    // Observed level spacing, translated to the synthetic fixture's price range.
    // Old code rejects 4399.99 - 0.54 < 4399.50 although 4397.60 is the target.
    const plan = {
      ...fixture.plan,
      extension_below: "4399.50",
      extension_targets: ["4397.60", "4394.00"] as const,
    };
    const p = payload();
    Object.assign(p.execution_constraints, {
      minimum_fee_buffered_take_profit_distance: "0.54",
      minimum_stop_distance: "1.08",
    });
    const response = scenarioOco(plan, p);
    expect(response.sell_stop).toMatchObject({
      entry_price: "4399.99",
      take_profit: "4399.45",
      stop_loss: "4401.07",
      risk_reward_ratio: "0.5",
    });
    expect(
      validateSemantics(response, {
        analysisId: response.analysis_id,
        symbol: "XAUUSD",
        now: new Date(at(40)),
        expiryReferenceTime: new Date(at(40)),
        quote: {
          bid: "4404.95",
          ask: "4405.05",
          sourceTime: at(40),
          receivedAt: at(40),
        },
        metadata: fixture.metadata,
        atr: "5",
        minRiskRewardRatio: "0.5",
        minExpirySeconds: 60,
        maxExpirySeconds: 120,
        maxStopDistanceAtr: "3",
        maxEntryDistanceAtr: "2.5",
        maxQuoteAgeMs: 3000,
      }).reasonCodes,
    ).toEqual([]);
    // Reject if paying costs would require pushing TP beyond the actual target.
    expect(() =>
      scenarioOco({ ...plan, extension_targets: ["4399.46", "4394.00"] }, p),
    ).toThrow("SCENARIO_WAIT_NET_REWARD");
  });
  it("never substitutes the second downside target when the first cannot cover costs", () => {
    const plan = {
      ...fixture.plan,
      extension_below: "4399.90",
      extension_targets: ["4399.85", "4390.00"] as const,
    };
    expect(() => scenarioOco(plan, payload())).toThrow(
      "SCENARIO_WAIT_NET_REWARD",
    );
  });
  it("returns promptly during paid inference, deduplicates refresh and reuses after completion", async () => {
    const store = memory();
    let release!: (r: Awaited<ReturnType<ScenarioPlanner["generate"]>>) => void;
    const pending = new Promise<
      Awaited<ReturnType<ScenarioPlanner["generate"]>>
    >((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(() => pending);
    let now = base;
    const model = new ReusableScenarioModel(store, { generate }, () => now);
    expect(await model.prepare(input())).toBe("SCENARIO_REFRESH_STARTED");
    expect(model.canEvaluate).toBe(false);
    expect(await model.prepare(input())).toBe("SCENARIO_REFRESH_PENDING");
    expect(generate).toHaveBeenCalledTimes(1);
    now = base + 40_000;
    const plan = { ...fixture.plan, analysis_id: store.row!.id };
    release({
      model: "deepseek-v4-pro/u5W",
      response: plan,
      rawResponse: JSON.stringify(plan),
      promptArtifact: {
        version: "scenario-v3",
        content: "test",
        sha256: "a".repeat(64),
      },
      latencyMs: 40_000,
      retryCount: 0,
      telemetry: {
        requestedModel: "deepseek-v4-pro/u5W",
        returnedModel: "deepseek-v4-pro",
        inputProfile: "chart",
        requestBytes: 100,
        responseBytes: 100,
        ...usageTelemetry({}),
      },
    });
    await model.settled();
    expect(await model.prepare(input())).toBeNull();
    const response = await model.analyze({
      analysisId: payload().analysis_id,
      symbol: "XAUUSD",
      payload: payload(),
      chart: analysisChart(),
      timeoutMs: 1000,
    });
    expect(response.contextPlanId).toBe(plan.analysis_id);
    expect(response.telemetry).toBeUndefined();
    expect(response.latencyMs).toBe(0);
    await expect(
      model.analyze({
        analysisId: payload().analysis_id,
        symbol: "XAUUSD",
        payload: payload(),
        chart: analysisChart(),
        timeoutMs: 1000,
      }),
    ).rejects.toThrow("SCENARIO_PREPARED_DECISION_MISSING");
  });
  it("survives restart without repeating a paid request or rearming a consumed map", async () => {
    const store = memory();
    store.row = { ...stored(), consumed: true };
    const generate = vi.fn();
    const model = new ReusableScenarioModel(
      store,
      { generate },
      () => base + 40_000,
    );
    expect(await model.prepare(input())).toBe("SCENARIO_MAP_CONSUMED");
    expect(generate).not.toHaveBeenCalled();
    store.row = {
      ...stored(),
      state: "REQUESTING",
      plan: null,
      availableAt: null,
      consumed: false,
    };
    expect(
      await new ReusableScenarioModel(
        store,
        { generate },
        () => base + 80_000,
      ).prepare(input()),
    ).toBe("SCENARIO_REFRESH_PENDING");
    expect(generate).not.toHaveBeenCalled();
  });
  it("records provider failure, redacts errors and applies durable cooldown", async () => {
    const store = memory();
    const reasons: string[] = [];
    const model = new ReusableScenarioModel(
      store,
      {
        generate: vi
          .fn()
          .mockRejectedValue(new Error("private endpoint and credentials")),
      },
      () => base,
      (reason) => reasons.push(reason),
    );
    await model.prepare(input());
    await model.settled();
    expect(store.row?.state).toBe("FAILED");
    expect(reasons).toEqual(["SCENARIO_REFRESH_FAILED"]);
    expect(model.canEvaluate).toBe(false);
  });
  it("rechecks a proven local circuit failure after one minute, including after restart", async () => {
    const store = memory();
    let now = base;
    const generate = vi.fn().mockRejectedValue(new Error("AI_CIRCUIT_OPEN"));
    const model = new ReusableScenarioModel(store, { generate }, () => now);
    await model.prepare(input());
    await model.settled();
    expect(store.row?.reason).toBe("AI_CIRCUIT_OPEN");
    now = base + 59_999;
    expect(model.canEvaluate).toBe(false);
    const claim = vi.spyOn(store, "claim");
    const restarted = new ReusableScenarioModel(store, { generate }, () => now);
    expect(await restarted.prepare(input())).toBe("SCENARIO_REFRESH_PENDING");
    expect(claim).not.toHaveBeenCalled();
    now = base + 60_000;
    expect(model.canEvaluate).toBe(true);
    // The durable store still owns admission; local eligibility cannot bypass it.
    expect(await restarted.prepare(input())).toBe(
      "SCENARIO_REFRESH_ALREADY_CLAIMED",
    );
    expect(claim).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each(["AI_PROVIDER_TIMEOUT", "SCENARIO_ORCHESTRATOR_UNAVAILABLE", null])(
    "preserves five-minute restart cooldown when provider acceptance is unknown: %s",
    async (reason) => {
      const store = memory();
      store.row = {
        ...stored(),
        state: "FAILED",
        plan: null,
        availableAt: null,
        reason,
      };
      const generate = vi.fn();
      const claim = vi.spyOn(store, "claim");
      const model = new ReusableScenarioModel(
        store,
        { generate },
        () => base + 60_000,
      );
      expect(await model.prepare(input())).toBe("SCENARIO_REFRESH_PENDING");
      expect(generate).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    },
  );
  it("fails closed for tampered durable maps, changed ticks or unavailable journal", async () => {
    const store = memory();
    store.row = stored();
    const model = new ReusableScenarioModel(
      store,
      { generate: vi.fn() },
      () => base + 40_000,
    );
    store.row = { ...stored(), tickSize: "0.1" };
    await expect(model.prepare(input())).rejects.toThrow(
      "SCENARIO_CONTEXT_METADATA_CHANGED",
    );
    store.row = {
      ...stored(),
      plan: { ...fixture.plan, valid_until: at(360) },
    };
    await expect(model.prepare(input())).rejects.toThrow(
      "SCENARIO_IDENTITY_OR_VALIDITY_INVALID",
    );
    store.latest = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(model.prepare(input())).rejects.toThrow(
      "database unavailable",
    );
  });
  it("uses broker five-second windows and reserves candle rollover", () => {
    expect(evaluateScenarioExecutionWindow(at(24))).toEqual({
      allowed: true,
      intervalStart: at(20),
      reasonCodes: [],
    });
    expect(evaluateScenarioExecutionWindow(at(57)).allowed).toBe(false);
    expect(evaluateScenarioExecutionWindow("bad").allowed).toBe(false);
  });
});

describe("post-close request lifecycle", () => {
  it("uses a durable post-close claim immediately, without reusing the consumed map", async () => {
    const store = memory();
    store.row = { ...stored(), consumed: true, closedAt: at(35) };
    const claim = vi.spyOn(store, "claim").mockResolvedValue(false);
    const generate = vi.fn();
    const model = new ReusableScenarioModel(
      store,
      { generate },
      () => base + 40000,
    );
    expect(await model.prepare(input())).toBe(
      "SCENARIO_REFRESH_ALREADY_CLAIMED",
    );
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ afterContextId: fixture.plan.analysis_id }),
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([null, at(41)])(
    "does not infer a completed trade from consumed or future state %s",
    async (closedAt) => {
      const store = memory();
      store.row = { ...stored(), consumed: true, closedAt };
      const claim = vi.spyOn(store, "claim");
      const model = new ReusableScenarioModel(
        store,
        { generate: vi.fn() },
        () => base + 40000,
      );
      expect(await model.prepare(input())).toBe("SCENARIO_MAP_CONSUMED");
      expect(claim).not.toHaveBeenCalled();
    },
  );
});
