import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
import type { AiAnalysisResult } from "../../packages/ai-client/src/client.js";
import { usageTelemetry } from "../../packages/ai-client/src/telemetry.js";
import {
  entryPriceBounds,
  checkEntryPrices,
} from "../../packages/scenario-engine/src/entry-prices.js";
import {
  bindEntryPrices,
  type EntryPairPlan,
} from "../../packages/scenario-engine/src/entry-plan.js";
import {
  ENTRY_PAIR_PROMPT,
  type EntryPlannerInput,
} from "../../packages/scenario-engine/src/entry-planner.js";
import {
  ReusableScenarioModel,
  type ContextStore,
  type StoredContext,
} from "../../apps/execution-service/src/scenario-context.js";
import type { ReplayInput } from "../../packages/scenario-engine/src/replay.js";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/scenario/manual-levels-synthetic.json", "utf8"),
) as ReplayInput;
const base = Date.parse("2026-09-11T00:00:00Z");
const iso = (now = base) => new Date(now).toISOString();
const checks = {
  maxQuoteAgeMs: 3000,
  maxMetadataAgeMs: 86400000,
  minimumPoints: null,
};
function snapshot(
  now = base,
  bid = "4355.23",
  ask = "4355.32",
): MarketSnapshot {
  return {
    serverTime: iso(now),
    capturedAt: iso(now),
    observedSkewMs: 0,
    quote: { bid, ask, sourceTime: iso(now), receivedAt: iso(now) },
    metadata: {
      ...fixture.metadata,
      minStopDistance: "0",
      metadataTime: iso(now),
    },
    candles: [],
  } as unknown as MarketSnapshot;
}
function plan(
  buy = "4351",
  sell = "4349.44",
  id = fixture.plan.analysis_id,
  now = base,
) {
  return bindEntryPrices(JSON.stringify({ buy_stop: buy, sell_stop: sell }), {
    analysisId: id,
    symbol: "XAUUSD",
    capturedAt: iso(now),
    tickSize: "0.01",
  });
}
function response(p: EntryPairPlan): AiAnalysisResult<EntryPairPlan> {
  return {
    model: "deepseek-v4-pro/u5W",
    response: p,
    rawResponse: JSON.stringify(p),
    latencyMs: 10,
    retryCount: 0,
    promptArtifact: {
      version: ENTRY_PAIR_PROMPT.version,
      content: "fixture",
      sha256: "a".repeat(64),
    },
    telemetry: {
      requestedModel: "deepseek-v4-pro/u5W",
      returnedModel: "deepseek-v4-pro",
      inputProfile: "structured",
      requestBytes: 100,
      responseBytes: 100,
      ...usageTelemetry({}),
    },
  };
}
function request(now = base) {
  return {
    snapshot: snapshot(now),
    chart: null,
    payload: {
      analysis_id: fixture.plan.analysis_id,
      server_time: iso(now),
      performance: {},
      execution_constraints: {
        tick_size: "0.01",
        current_bid: "4355.23",
        current_ask: "4355.32",
        minimum_fee_buffered_take_profit_distance: "0.53",
        minimum_stop_distance: "0.01",
        maximum_stop_distance: "20",
        preferred_expires_at: iso(now + 180000),
        order_expiry_min_seconds: 60,
        order_expiry_max_seconds: 180,
      },
    },
  };
}
function memory(now: () => number, initial: EntryPairPlan | null = plan()) {
  const rows: StoredContext[] = initial
    ? [
        {
          id: initial.analysis_id,
          requestedModel: "deepseek-v4-pro/u5W",
          state: "READY",
          requestedAt: iso(),
          capturedAt: iso(),
          validUntil: iso(base + 300000),
          availableAt: iso(),
          tickSize: "0.01",
          plan: initial,
          consumed: false,
          reason: null,
          retiredAt: null,
          refreshAfterEntryContextId: null,
        },
      ]
    : [];
  const store = {
    latest: vi.fn<ContextStore["latest"]>(() =>
      Promise.resolve(rows.at(-1) ?? null),
    ),
    claim: vi.fn<ContextStore["claim"]>((i) => {
      const previous = rows.at(-1);
      if (
        previous &&
        (!i.afterEntryContextId ||
          previous.id !== i.afterEntryContextId ||
          previous.retiredAt == null ||
          previous.refreshAfterEntryContextId != null)
      )
        return Promise.resolve(false);
      rows.push({
        id: i.id,
        requestedModel: "deepseek-v4-pro/u5W",
        state: "REQUESTING",
        requestedAt: iso(now()),
        capturedAt: i.capturedAt,
        validUntil: iso(now() + 300000),
        availableAt: null,
        tickSize: i.tickSize,
        plan: null,
        consumed: false,
        reason: null,
        retiredAt: null,
        refreshAfterEntryContextId: i.afterEntryContextId ?? null,
      });
      return Promise.resolve(true);
    }),
    finish: vi.fn<ContextStore["finish"]>((id, r, reason) => {
      const row = rows.find((x) => x.id === id)!;
      Object.assign(row, {
        state: r ? "READY" : "FAILED",
        plan: r?.response ?? null,
        reason,
        availableAt: r ? iso(now()) : null,
      });
      return Promise.resolve();
    }),
    retireEntries: vi.fn<NonNullable<ContextStore["retireEntries"]>>(
      (id, e) => {
        const row = rows.find((x) => x.id === id)!;
        if (row.consumed) return Promise.resolve(false);
        row.retiredAt = e.observedAt;
        return Promise.resolve(true);
      },
    ),
  } satisfies ContextStore;
  return { store, rows };
}

describe("entry recovery (synthetic, no broker authority)", () => {
  it("supplies tick-rounded executable limits with a guidance-only movement buffer", () => {
    expect(entryPriceBounds(snapshot().quote, "0.01", "0")).toEqual({
      minimum_entry_distance: "0.01",
      buy_stop_minimum: "4355.33",
      sell_stop_maximum: "4355.22",
      movement_buffer: "0.09",
      preferred_buy_stop_minimum: "4355.42",
      preferred_sell_stop_maximum: "4355.13",
    });
    expect(
      checkEntryPrices(
        plan("4355.33", "4355.22"),
        snapshot(),
        "LOCAL_REUSE",
        base,
        checks,
      ),
    ).toBeNull();
  });
  it.each([
    ["4351", "4349.44", "BUY_ENTRY_TOO_CLOSE"],
    ["4356", "4356", "SELL_ENTRY_TOO_CLOSE"],
  ])("proves the actual wrong-side %s / %s pair", (buy, sell, reason) => {
    expect(
      checkEntryPrices(plan(buy, sell), snapshot(), "LOCAL_REUSE", base, checks)
        ?.reasonCodes,
    ).toEqual([reason]);
  });
  it.each(["sourceTime", "receivedAt"] as const)(
    "never retires from stale or future %s",
    (key) => {
      for (const offset of [-3001, 1]) {
        const s = snapshot();
        const changed = {
          ...s,
          quote: { ...s.quote, [key]: iso(base + offset) },
        };
        expect(() =>
          checkEntryPrices(plan(), changed, "LOCAL_REUSE", base, checks),
        ).toThrow("SCENARIO_ENTRY_CHECK_DATA_INVALID");
      }
    },
  );
  it("rejects changed symbol, expired plan, crossed quote and corrupt tick without replacement", () => {
    expect(() =>
      checkEntryPrices(
        plan(),
        {
          ...snapshot(),
          metadata: { ...snapshot().metadata, symbolName: "OTHER" },
        },
        "LOCAL_REUSE",
        base,
        checks,
      ),
    ).toThrow();
    expect(() =>
      checkEntryPrices(
        plan(),
        snapshot(base + 300000),
        "LOCAL_REUSE",
        base + 300000,
        checks,
      ),
    ).toThrow();
    expect(() =>
      checkEntryPrices(
        plan(),
        snapshot(base, "4356", "4355"),
        "LOCAL_REUSE",
        base,
        checks,
      ),
    ).toThrow();
    expect(() =>
      checkEntryPrices(
        plan("4355.33"),
        {
          ...snapshot(),
          metadata: { ...snapshot().metadata, tickSize: "0.1" },
        },
        "LOCAL_REUSE",
        base,
        checks,
      ),
    ).toThrow();
  });
  it("retires once, immediately requests fresh prices and never rearms the retired map", async () => {
    let now = base;
    const { store, rows } = memory(() => now);
    const generate = vi.fn((i: EntryPlannerInput) =>
      Promise.resolve(response(plan("4356", "4354", i.analysisId, now))),
    );
    const model = new ReusableScenarioModel(
      store,
      { generate },
      () => now,
      () => {},
      true,
    );
    expect(await model.prepare(request())).toBe(
      "SCENARIO_ENTRY_REFRESH_STARTED",
    );
    await model.settled();
    expect(store.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        afterEntryContextId: fixture.plan.analysis_id,
      }),
    );
    expect(rows[0]?.plan).toEqual(plan());
    expect(rows[0]?.retiredAt).toBe(iso());
    now += 1000;
    const restarted = new ReusableScenarioModel(
      store,
      { generate },
      () => now,
      () => {},
      true,
    );
    expect(await restarted.prepare(request(now))).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated invalid replacements across restarts without repeated rejection loops", async () => {
    let now = base;
    const { store, rows } = memory(() => now);
    const generate = vi.fn((i: EntryPlannerInput) =>
      Promise.resolve(response(plan("4351", "4349", i.analysisId, now))),
    );
    const model = new ReusableScenarioModel(
      store,
      { generate },
      () => now,
      () => {},
      true,
    );
    await model.prepare(request());
    await model.settled();
    now += 1000;
    for (let n = 0; n < 20; n++) {
      expect(
        await new ReusableScenarioModel(
          store,
          { generate },
          () => now,
          () => {},
          true,
        ).prepare(request(now)),
      ).toBe("SCENARIO_ENTRY_REFRESH_BACKOFF");
      now += 1000;
    }
    expect(generate).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.retiredAt).not.toBeNull();
    expect(store.retireEntries).toHaveBeenCalledTimes(2);
  });
  it("checks a response on return using a new quote, preserving its successful provider record", async () => {
    const { store, rows } = memory(() => base, null);
    const generate = vi.fn((i: EntryPlannerInput) =>
      Promise.resolve(response(plan("4356", "4354", i.analysisId))),
    );
    const latest = vi.fn(() =>
      Promise.resolve(snapshot(base, "4356.1", "4356.2")),
    );
    const model = new ReusableScenarioModel(
      store,
      { generate },
      () => base,
      () => {},
      true,
      { ...checks, snapshot: latest },
    );
    await model.prepare(request());
    await model.settled();
    expect(rows[0]).toMatchObject({
      state: "READY",
      retiredAt: iso(),
      reason: null,
    });
    expect(store.finish).toHaveBeenCalledTimes(1);
    expect(store.retireEntries).toHaveBeenCalledWith(
      rows[0]!.id,
      expect.objectContaining({
        phase: "PROVIDER_RETURN",
        reasonCodes: ["BUY_ENTRY_TOO_CLOSE"],
      }),
    );
  });
  it("does not turn an unavailable return quote into a provider failure or refresh exception", async () => {
    const { store, rows } = memory(() => base, null);
    const report = vi.fn();
    const model = new ReusableScenarioModel(
      store,
      {
        generate: (i) =>
          Promise.resolve(response(plan("4356", "4354", i.analysisId))),
      },
      () => base,
      report,
      true,
      {
        ...checks,
        snapshot: () => Promise.reject(Error("unavailable")),
      },
    );
    await model.prepare(request());
    await model.settled();
    expect(rows[0]).toMatchObject({ state: "READY", retiredAt: null });
    expect(store.finish).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("SCENARIO_ENTRY_RECHECK_UNAVAILABLE");
  });
  it.each(["AI_PROVIDER_TIMEOUT", "SCENARIO_ORCHESTRATOR_UNAVAILABLE"])(
    "retains durable backoff after replacement %s",
    async (reason) => {
      let now = base;
      const { store, rows } = memory(() => now);
      const generate = vi.fn(() => Promise.reject(Error(reason)));
      const model = new ReusableScenarioModel(
        store,
        { generate },
        () => now,
        () => {},
        true,
      );
      await model.prepare(request());
      await model.settled();
      now += 60000;
      expect(
        await new ReusableScenarioModel(
          store,
          { generate },
          () => now,
          () => {},
          true,
        ).prepare(request(now)),
      ).toBe("SCENARIO_REFRESH_PENDING");
      expect(rows[1]?.state).toBe("FAILED");
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );
  it("cannot retire a consumed pair and never calls the provider after retirement storage failure", async () => {
    const { store, rows } = memory(() => base);
    rows[0]!.consumed = true;
    const generate = vi.fn();
    const model = new ReusableScenarioModel(
      store,
      { generate },
      () => base,
      () => {},
      true,
    );
    expect(
      await model.retireEntries(rows[0]!.id, snapshot(), "PRE_PLACEMENT"),
    ).toBe(false);
    expect(await model.prepare(request())).toBe("SCENARIO_MAP_CONSUMED");
    expect(store.retireEntries).not.toHaveBeenCalled();
    rows[0]!.consumed = false;
    store.retireEntries.mockRejectedValue(Error("journal unavailable"));
    await expect(model.prepare(request())).rejects.toThrow(
      "journal unavailable",
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
