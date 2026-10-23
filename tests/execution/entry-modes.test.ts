import { ModelResponseValidator } from "../../packages/risk-engine/src/model-validator.js";
import { entryModeStatus } from "../../packages/contracts/src/entry-mode.js";
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ENTRY_MODES,
  entryModeProfile,
} from "../../packages/contracts/src/entry-mode.js";
import {
  EntryModeCoordinator,
  entryModeModel,
} from "../../apps/execution-service/src/entry-mode-coordinator.js";
import type {
  ModelProvider,
  CycleResult,
} from "../../apps/execution-service/src/coordinator.js";
import type { MarketSnapshot } from "../../packages/contracts/src/index.js";
import { response, metadata } from "../helpers/breakout-candidate.js";
import { evidenceDemoTransform } from "../../packages/strategy-candidates/src/evidence-demo.js";
import { bindModeDecision } from "../../packages/scenario-engine/src/mode-entry.js";
import { validateEntryDecision } from "../../packages/scenario-engine/src/entry-decision.js";
const request = {
  analysisId: randomUUID(),
  symbol: "XAUUSD",
  payload: {},
  chart: null,
  timeoutMs: 1000,
};
const artifact = {
  version: "entry-modes-execution-v1" as const,
  content: "fixture",
  sha256: "a".repeat(64),
};
describe("one bot, four operator entry profiles", () => {
  it.each(ENTRY_MODES)(
    "preserves exact range and native distance in %s",
    async (mode) => {
      for (const side of ["BUY", "SELL"] as const) {
        const original = response(),
          selection = { mode, revision: randomUUID() };
        const provider: ModelProvider = {
          circuitOpen: false,
          analyze: () =>
            Promise.resolve({
              response: original,
              entrySide: side,
              rawResponse: "original provider direction",
              promptArtifact: artifact,
            }),
        };
        const result = await entryModeModel(provider, selection).analyze(
            request,
          ),
          profile = entryModeProfile(mode);
        expect(result.rawResponse).toBe("original provider direction");
        expect(result.entrySide).toBe(
          profile.single
            ? profile.limit
              ? side === "BUY"
                ? "SELL"
                : "BUY"
              : side
            : undefined,
        );
        expect(result.response.buy_stop.entry_price).toBe(
          profile.limit
            ? original.sell_stop.entry_price
            : original.buy_stop.entry_price,
        );
        expect(result.response.sell_stop.entry_price).toBe(
          profile.limit
            ? original.buy_stop.entry_price
            : original.sell_stop.entry_price,
        );
        const native = evidenceDemoTransform({
          snapshot: { metadata: metadata() } as MarketSnapshot,
          response: result.response,
          maximumStopDistance: "100",
          reverseLimit: profile.limit,
        });
        expect(native.accepted).toBe(true);
        expect(native.response?.buy_stop.risk_reward_ratio).toBe("1");
        expect(Number(native.response!.buy_stop.stop_loss)).toBeLessThan(
          Number(native.response!.buy_stop.entry_price),
        );
        expect(Number(native.response!.sell_stop.stop_loss)).toBeGreaterThan(
          Number(native.response!.sell_stop.entry_price),
        );
        expect(original.setup_tags).not.toContain(`OPERATOR_${mode}`);
      }
    },
  );
  it("binds mode-neutral ranges and WAIT without inventing order authority", () => {
    const ctx = {
      analysisId: request.analysisId,
      symbol: "XAUUSD",
      capturedAt: "2026-10-23T01:00:02Z",
      tickSize: "0.01",
      observedM1End: "2026-10-23T01:00:00Z",
    };
    const plan = bindModeDecision(
      JSON.stringify({
        decision: "BUY",
        reason: "fixture",
        upper_breakout: "4002",
        lower_breakout: "3999",
      }),
      ctx,
    );
    expect(plan.schema_version).toBe("entry-modes-1.0");
    expect(
      validateEntryDecision(JSON.stringify(plan), {
        ...ctx,
        availableAt: "2026-10-23T01:00:10Z",
      }),
    ).toEqual(plan);
    expect(
      bindModeDecision(
        JSON.stringify({
          decision: "WAIT",
          reason: "fixture",
          upper_breakout: null,
          lower_breakout: null,
        }),
        ctx,
      ).schema_version,
    ).toBe("entry-wait-1.0");
    expect(() =>
      validateEntryDecision(JSON.stringify({ ...plan, entry_side: "BOTH" }), {
        ...ctx,
        availableAt: ctx.capturedAt,
      }),
    ).toThrow();
  });
  it("serializes all profiles and reads the current durable selection for each cycle", async () => {
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    let current = {
      mode: "OCO_LIMIT" as (typeof ENTRY_MODES)[number],
      revision: randomUUID(),
    };
    const calls: string[] = [];
    const outcome = {
      analysisId: randomUUID(),
      outcome: "DEFERRED",
      reasonCodes: [],
      placement: null,
    } as CycleResult;
    const runner = new EntryModeCoordinator(
      { read: () => Promise.resolve(current) },
      (selection) => ({
        runOnce: async () => {
          calls.push(selection.mode);
          await done;
          return outcome;
        },
      }),
    );
    const first = runner.runOnce();
    await Promise.resolve();
    await expect(runner.runOnce()).rejects.toThrow(
      "ANALYSIS_CYCLE_ALREADY_RUNNING",
    );
    current = { mode: "SINGLE_STOP_LIMIT", revision: randomUUID() };
    release();
    await first;
    await runner.runOnce();
    expect(calls).toEqual(["OCO_LIMIT", "SINGLE_STOP_LIMIT"]);
  });
  it("never falls back when selection storage is unavailable", async () => {
    const create = vi.fn();
    const runner = new EntryModeCoordinator(
      { read: () => Promise.reject(new Error("DB_UNAVAILABLE")) },
      create,
    );
    await expect(runner.runOnce()).rejects.toThrow("DB_UNAVAILABLE");
    expect(create).not.toHaveBeenCalled();
  });
});

it("queues modes through an active setup, restarts only unsent analysis, and never assumes flat", () => {
  const selected = { mode: "SINGLE_LIMIT" as const, revision: randomUUID() },
    old = { mode: "OCO_STOP_LIMIT" as const, revision: randomUUID() };
  expect(
    entryModeStatus(
      selected,
      { status: "ACTIVE", executionMode: "OCO_STOP_LIMIT" },
      old,
    ).phase,
  ).toBe("QUEUED");
  expect(entryModeStatus(selected, { status: "NONE" }, old).phase).toBe(
    "RESTARTING",
  );
  expect(
    entryModeStatus(selected, { status: "LATEST_TERMINAL" }, null).phase,
  ).toBe("READY");
  expect(entryModeStatus(selected, { status: "UNAVAILABLE" }, null).phase).toBe(
    "UNVERIFIED",
  );
});

it("keeps schemas bound to approved profile and range authority", () => {
  const selection = new ModelResponseValidator(
      "schemas/entry-mode-selection-1.0.json",
    ),
    ranges = new ModelResponseValidator("schemas/entry-modes-context-1.0.json");
  for (const mode of ENTRY_MODES)
    expect(
      selection.parse(JSON.stringify({ mode, revision: randomUUID() }))
        .accepted,
    ).toBe(true);
  expect(
    selection.parse(JSON.stringify({ mode: "ANY", revision: randomUUID() }))
      .accepted,
  ).toBe(false);
  const plan = bindModeDecision(
    JSON.stringify({
      decision: "SELL",
      reason: "fixture",
      upper_breakout: "4002",
      lower_breakout: "3999",
    }),
    {
      analysisId: request.analysisId,
      symbol: "XAUUSD",
      capturedAt: "2026-10-23T01:00:02Z",
      tickSize: "0.01",
      observedM1End: "2026-10-23T01:00:00Z",
    },
  );
  expect(ranges.parse(JSON.stringify(plan)).accepted).toBe(true);
  expect(
    ranges.parse(JSON.stringify({ ...plan, entry_side: "BOTH" })).accepted,
  ).toBe(false);
});
