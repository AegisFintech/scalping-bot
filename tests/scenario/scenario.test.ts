import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Candle, Quote } from "../../packages/contracts/src/index.js";
import { ScenarioPlanner } from "../../packages/scenario-engine/src/planner.js";
import {
  validatePlan,
  type ScenarioPlan,
} from "../../packages/scenario-engine/src/plan.js";
import {
  admitEntry,
  type ScenarioRiskContext,
} from "../../packages/scenario-engine/src/admission.js";
import { confirmedEntry } from "../../packages/scenario-engine/src/rules.js";
import {
  BASE_EXECUTION,
  ScenarioReplay,
  type ReplayInput,
  type ReplayEvent,
} from "../../packages/scenario-engine/src/replay.js";
import { analysisChart } from "../helpers/analysis-chart.js";

function fixture(): ReplayInput {
  return JSON.parse(
    readFileSync(
      "tests/fixtures/scenario/manual-levels-synthetic.json",
      "utf8",
    ),
  ) as ReplayInput;
}
const base = Date.parse("2026-09-07T00:00:00Z");
const at = (s: number): string => new Date(base + s * 1000).toISOString();
function candle(end: number, values: Partial<Candle> = {}): Candle {
  return {
    startTime: at(end - 60),
    endTime: at(end),
    open: "4410.5",
    high: "4411",
    low: "4410.1",
    close: "4410.8",
    volume: null,
    complete: true,
    qualityFlags: [],
    ...values,
  };
}
function quote(s: number, bid: string, ask: string): ReplayEvent {
  return {
    id: `quote-${s}`,
    type: "quote",
    at: at(s),
    quote: { bid, ask, sourceTime: at(s), receivedAt: at(s) },
    risk: null,
  };
}
function parse(plan: ScenarioPlan): ScenarioPlan {
  return validatePlan(JSON.stringify(plan), {
    analysisId: fixture().plan.analysis_id,
    symbol: "XAUUSD",
    capturedAt: at(0),
    availableAt: at(1),
    tickSize: "0.01",
  });
}
function risk(): { context: ScenarioRiskContext; q: Quote } {
  const e = fixture().events[2];
  if (!e || e.type !== "quote" || !e.risk) throw new Error("fixture");
  return { context: structuredClone(e.risk), q: e.quote };
}
function entry() {
  const f = fixture(),
    a = f.events[0],
    b = f.events[1];
  if (a?.type !== "candle" || b?.type !== "candle") throw new Error("fixture");
  const result = confirmedEntry(f.plan, a.candle, b.candle, base, "0.01");
  if (!result) throw new Error("fixture");
  return result;
}

describe("chart scenario contract", () => {
  it("represents the operator example without model sizing or exit authority", () => {
    expect(parse(fixture().plan).recovery_targets).toEqual(["4416", "4422"]);
    expect(() =>
      parse({ ...fixture().plan, volume: "10" } as ScenarioPlan),
    ).toThrow("MODEL_SCHEMA_INVALID");
  });
  it.each([
    { valid_until: at(301) },
    { recovery_targets: ["4416", "4415"] },
    { extension_below: "4401" },
    { recovery_above: "4410.001" },
    { decision_zone: { lower: "4400", upper: "4400" } },
    { analysis_id: "00000000-0000-4000-8000-000000000099" },
    { captured_at: at(1) },
  ])(
    "rejects invalid identity, geometry, precision or extended validity %j",
    (patch) => {
      expect(() =>
        parse({ ...fixture().plan, ...patch } as ScenarioPlan),
      ).toThrow();
    },
  );
  it("retains duplicate JSON key rejection for the new schema", () => {
    const raw = JSON.stringify(fixture().plan).replace(
      '"symbol":"XAUUSD"',
      '"symbol":"XAUUSD","symbol":"XAUUSD"',
    );
    expect(() =>
      validatePlan(raw, {
        analysisId: fixture().plan.analysis_id,
        symbol: "XAUUSD",
        capturedAt: at(0),
        availableAt: at(1),
        tickSize: "0.01",
      }),
    ).toThrow("MODEL_JSON_DUPLICATE_KEYS");
  });
  it("requires two post-arrival closes for a hold and never places inside the decision zone", () => {
    expect(
      confirmedEntry(fixture().plan, candle(60), candle(120), base, "0.01")
        ?.scenario,
    ).toBe("RECOVERY_HOLD");
    expect(
      confirmedEntry(fixture().plan, candle(60), candle(120), base + 1, "0.01"),
    ).toBeNull();
    const neutral = { open: "4403", high: "4405", low: "4401", close: "4404" };
    expect(
      confirmedEntry(
        fixture().plan,
        candle(60, neutral),
        candle(120, neutral),
        base,
        "0.01",
      ),
    ).toBeNull();
  });
  it("requires a prior break before a failed reclaim and distinguishes decline extension", () => {
    const down = candle(60, {
      open: "4399",
      high: "4400",
      low: "4398",
      close: "4399",
    });
    const retest = candle(120, {
      open: "4399",
      high: "4400.2",
      low: "4398.7",
      close: "4399.6",
    });
    expect(
      confirmedEntry(fixture().plan, down, retest, base, "0.01"),
    ).toMatchObject({
      scenario: "FAILED_RECLAIM",
      target: "4396",
      stop: "4400.21",
    });
    expect(
      confirmedEntry(fixture().plan, candle(60), retest, base, "0.01"),
    ).toBeNull();
    const lower = {
      open: "4395.5",
      high: "4396",
      low: "4394.9",
      close: "4395",
    };
    expect(
      confirmedEntry(
        fixture().plan,
        candle(60, lower),
        candle(120, lower),
        base,
        "0.01",
      ),
    ).toMatchObject({ scenario: "DECLINE_EXTENSION", target: "4392" });
  });
});

describe("scenario admission reuses fixed money management", () => {
  it("sizes on structural stops inside the previous half-setup risk ceiling", () => {
    const { context, q } = risk();
    const decision = admitEntry(entry(), q, base + 120500, context);
    expect(decision.approved).toBe(true);
    expect(Number(decision.maximumLoss)).toBeLessThanOrEqual(5);
    expect(Number(decision.normalizedVolume)).toBeGreaterThanOrEqual(1);
  });
  it.each([
    "floor",
    "minimum",
    "uncertain",
    "exposure",
    "stale",
    "spread",
    "partial",
    "disabled",
    "history",
    "drawdown",
  ])("blocks %s without increasing risk", (kind) => {
    const { context, q } = risk();
    let c = context;
    let current = q;
    if (kind === "floor") c = { ...c, equityFloor: "1000001" };
    if (kind === "minimum") c = { ...c, remainingDailyBudget: "0.01" };
    if (kind === "uncertain")
      c = { ...c, account: { ...c.account, certain: false } };
    if (kind === "exposure")
      c = { ...c, account: { ...c.account, relevantPositionCount: 1 } };
    if (kind === "partial")
      c = { ...c, account: { ...c.account, hasPartialFill: true } };
    if (kind === "stale")
      c = { ...c, account: { ...c.account, reconciledAt: at(0) } };
    if (kind === "spread") current = { ...q, ask: "4411.50" };
    if (kind === "disabled") c = { ...c, entryAllowed: false };
    if (kind === "history") c = { ...c, spreadSamples: 0 };
    if (kind === "drawdown") c = { ...c, riskMultiplier: "0" };
    expect(admitEntry(entry(), current, base + 120500, c).approved).toBe(false);
  });
  it("rejects passed entries, bad precision and targets inside the broker minimum", () => {
    const { context, q } = risk();
    expect(
      admitEntry(
        entry(),
        { ...q, bid: "4411.21", ask: "4411.26" },
        base + 120500,
        context,
      ).reasonCodes,
    ).toContain("SCENARIO_ENTRY_ALREADY_PASSED");
    expect(
      admitEntry({ ...entry(), entry: "4411.211" }, q, base + 120500, context)
        .approved,
    ).toBe(false);
    expect(
      admitEntry(
        { ...entry(), stop: "4410.21", target: "4411.96" },
        { ...q, bid: "4410.16", ask: "4410.21" },
        base + 120500,
        { ...context, metadata: { ...context.metadata, minStopDistance: "1" } },
      ).reasonCodes,
    ).toContain("SCENARIO_EXIT_GEOMETRY_INVALID");
  });
  it("rejects nonfinite observation time and invalid spread sample evidence", () => {
    const { context, q } = risk();
    expect(admitEntry(entry(), q, NaN, context).approved).toBe(false);
    expect(
      admitEntry(entry(), q, base + 120500, {
        ...context,
        spreadSamples: Infinity,
      }).approved,
    ).toBe(false);
  });
});

describe("automatic research lifecycle", () => {
  it("confirms, submits, fills and closes at first target without another model call", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.forEach((e) => r.accept(e));
    expect(r.lifecycle.map((e) => e.outcome)).toEqual([
      "CONFIRMED",
      "PENDING",
      "FILLED",
      "CLOSED",
    ]);
    expect(r.trades[0]).toMatchObject({
      reason: "FIRST_TARGET",
      entry: "4411.23",
      exit: "4415.95",
    });
    expect(r.report()).toMatchObject({
      label: "SYNTHETIC",
      closedTrades: 1,
      pathCensored: false,
      brokerConnected: false,
      netAfterModelCosts: null,
    });
  });
  it("closes adverse gaps at the observed executable price, not the ideal stop", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.slice(0, 4).forEach((e) => r.accept(e));
    r.accept(quote(121, "4408", "4408.05"));
    expect(r.trades[0]).toMatchObject({
      reason: "STRUCTURAL_STOP",
      exit: "4407.95",
    });
    expect(Number(r.trades[0]?.net)).toBeLessThan(-5);
  });
  it("waits for a fresh quote to execute confirmed invalidation independently of AI", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.slice(0, 4).forEach((e) => r.accept(e));
    for (let s = 123; s <= 180; s += 3)
      r.accept(quote(s, "4411.30", "4411.35"));
    r.accept({
      id: "invalidating-close",
      type: "candle",
      at: at(180),
      candle: candle(180, {
        open: "4411",
        high: "4412",
        low: "4409.9",
        close: "4410",
      }),
    });
    r.accept(quote(180.5, "4410.5", "4410.55"));
    expect(r.trades[0]?.reason).toBe("CONFIRMED_INVALIDATION");
  });
  it("automatically exits on maximum holding time even when the plan has expired", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.slice(0, 4).forEach((e) => r.accept(e));
    for (let s = 123; s <= 723; s += 3)
      r.accept(quote(s, "4411.30", "4411.35"));
    r.accept(quote(723.5, "4411.30", "4411.35"));
    expect(r.trades[0]?.reason).toBe("MAXIMUM_HOLDING_TIME");
  });
  it("censors unknown stop-limit queue fills and quote gaps", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.slice(0, 3).forEach((e) => r.accept(e));
    r.accept(quote(120.75, "4412", "4412.05"));
    expect(r.report()).toMatchObject({
      pathCensored: true,
      halted: true,
      netBeforeModelCosts: null,
    });
    const gap = new ScenarioReplay(f);
    f.events.slice(0, 4).forEach((e) => gap.accept(e));
    gap.accept(quote(130, "4416", "4416.05"));
    expect(gap.report()).toMatchObject({
      pathCensored: true,
      netBeforeModelCosts: null,
    });
  });
  it("does not duplicate fills across replay recovery and duplicate delivery", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.slice(0, 4).forEach((e) => r.accept(e));
    const restored = ScenarioReplay.restore(r.checkpoint());
    f.events.forEach((e) => restored.accept(e));
    const complete = new ScenarioReplay(f);
    f.events.forEach((e) => complete.accept(e));
    expect(restored.report()).toEqual(complete.report());
    expect(() =>
      ScenarioReplay.restore(
        r.checkpoint().replace('"SYNTHETIC"', '"RECORDED"'),
      ),
    ).toThrow("SCENARIO_CHECKPOINT_INVALID");
  });
  it("rejects conflicting events, forming candles and future quotes; latches survive recovery", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    r.accept(f.events[0]!);
    expect(() => r.accept({ ...f.events[0]!, at: at(61) })).toThrow(
      "SCENARIO_EVENT_INVALID",
    );
    expect(ScenarioReplay.restore(r.checkpoint()).report()).toMatchObject({
      halted: true,
      pathCensored: true,
      netBeforeModelCosts: null,
    });
    const forming = new ScenarioReplay(f);
    expect(() =>
      forming.accept({
        id: "forming",
        type: "candle",
        at: at(60),
        candle: candle(60, { complete: false }),
      }),
    ).toThrow();
    const future = quote(120, "4411", "4411.05");
    if (future.type !== "quote") throw new Error("fixture");
    expect(() =>
      new ScenarioReplay(f).accept({
        ...future,
        quote: { ...future.quote, sourceTime: at(121) },
      }),
    ).toThrow();
    const stale = new ScenarioReplay(f);
    expect(() =>
      stale.accept({
        ...future,
        quote: {
          ...future.quote,
          sourceTime: at(116.9),
          receivedAt: at(117),
        },
      }),
    ).toThrow();
    expect(stale.report()).toMatchObject({
      halted: true,
      pathCensored: true,
      netBeforeModelCosts: null,
    });
  });
  it("uses latency rather than backdating a fill onto a confirmation candle", () => {
    const f = fixture(),
      r = new ScenarioReplay(f, { ...BASE_EXECUTION, latencyMs: 1500 });
    f.events.forEach((e) => r.accept(e));
    expect(r.report().closedTrades).toBe(0);
  });
  it("never resurrects a pending entry after a rejected event and checkpoint recovery", () => {
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.slice(0, 3).forEach((e) => r.accept(e));
    const bad = quote(120.6, "4411", "4411.05");
    if (bad.type !== "quote") throw new Error("fixture");
    expect(() =>
      r.accept({ ...bad, quote: { ...bad.quote, sourceTime: at(121) } }),
    ).toThrow();
    const restored = ScenarioReplay.restore(r.checkpoint());
    expect(restored.report()).toEqual(r.report());
    restored.accept(quote(121, "4411.16", "4411.21"));
    expect(restored.report()).toMatchObject({
      openPosition: false,
      pendingOrder: false,
      halted: true,
    });
  });
});

describe("bounded scenario provider adapter", () => {
  function input() {
    const chart = analysisChart();
    const end = at(0);
    return {
      analysisId: fixture().plan.analysis_id,
      symbol: "XAUUSD",
      capturedAt: end,
      tickSize: "0.01",
      chart: { ...chart, latestEndTimes: { M1: end, M5: end, M15: end } },
      candles: (
        [
          ["M1", 60],
          ["M5", 300],
          ["M15", 900],
        ] as const
      ).map(([timeframe, seconds]) => ({
        timeframe,
        candles: [{ ...candle(0), startTime: at(-seconds) }],
      })),
    };
  }
  it("uses exact requested model, chart, separate schema and records returned identity", async () => {
    let request: Record<string, unknown> = {};
    const fetchImpl = vi.fn<typeof fetch>((_url, options) => {
      if (typeof options?.body !== "string") throw new Error("fixture-body");
      request = JSON.parse(options.body) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: "gpt-6-astra",
            output_text: JSON.stringify(fixture().plan),
          }),
        ),
      );
    });
    const planner = new ScenarioPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => base,
    });
    const result = await planner.generate(input());
    expect(request.model).toBe("gpt-6-astra/u64");
    expect(JSON.stringify(request)).toContain("input_image");
    expect(request.text).toMatchObject({
      format: { name: "chart_scenario_1_0", strict: true },
    });
    expect(result.telemetry.returnedModel).toBe("gpt-6-astra");
    expect(result.telemetry.costAmount).toBeNull();
  });
  it("does not send future/forming or mismatched chart data to the provider", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const planner = new ScenarioPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => base,
    });
    const x = input();
    x.candles[0]!.candles[0]!.complete = false;
    await expect(planner.generate(x)).rejects.toThrow(
      "SCENARIO_CANDLE_INVALID",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds failures and does not let provider failure prevent independent exits", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("private provider text", { status: 503 })),
    );
    const planner = new ScenarioPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => base,
    });
    for (let i = 0; i < 3; i++)
      await expect(planner.generate(input())).rejects.toThrow(
        "AI_HTTP_ERROR:503",
      );
    await expect(planner.generate(input())).rejects.toThrow("AI_CIRCUIT_OPEN");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.forEach((e) => r.accept(e));
    expect(r.trades).toHaveLength(1);
  });
  it("keeps exits running while inference is unresolved and bounds concurrent requests", async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const planner = new ScenarioPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => base,
    });
    const pending = planner.generate(input());
    await expect(planner.generate(input())).rejects.toThrow(
      "AI_REQUEST_ALREADY_IN_FLIGHT",
    );
    const f = fixture(),
      r = new ScenarioReplay(f);
    f.events.forEach((e) => r.accept(e));
    expect(r.trades[0]?.reason).toBe("FIRST_TARGET");
    finish!(
      new Response(
        JSON.stringify({
          model: "gpt-6-astra",
          output_text: JSON.stringify(f.plan),
        }),
      ),
    );
    await expect(pending).resolves.toMatchObject({
      response: { schema_version: "scenario-1.0" },
    });
  });
  it("redacts transport errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("https://private.example/secret")),
    );
    const planner = new ScenarioPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => base,
    });
    await expect(planner.generate(input())).rejects.toThrow(
      "SCENARIO_PROVIDER_UNAVAILABLE",
    );
  });
  it("accepts only explicitly marked historical session gaps, without reusing them for confirmation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            model: "gpt-6-astra",
            output_text: JSON.stringify(fixture().plan),
          }),
        ),
      ),
    );
    const planner = new ScenarioPlanner({
      baseUrl: "https://example.com/v1",
      apiKey: "fixture",
      fetchImpl,
      now: () => base,
    });
    const x = input();
    x.candles[0]!.candles = [
      candle(-180),
      { ...candle(0), qualityFlags: ["BROKER_SESSION_GAP_BEFORE"] },
    ];
    // The chart may show a suffix of the historical series, with the same end.
    await expect(planner.generate(x)).resolves.toMatchObject({
      response: { schema_version: "scenario-1.0" },
    });
    x.candles[0]!.candles[1]!.qualityFlags = [];
    await expect(planner.generate(x)).rejects.toThrow("SCENARIO_CANDLE_GAP");
  });
});
