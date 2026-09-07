/** Executable research lifecycle. Deliberately has no broker, HTTP or database mutation imports. */
import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import type {
  Candle,
  Quote,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { decimal, isTickAligned } from "../../risk-engine/src/decimal.js";
import { oneWayCommission } from "../../risk-engine/src/commission.js";
import { admitEntry, type ScenarioRiskContext } from "./admission.js";
import {
  SCENARIO_POLICY,
  time,
  validateCandle,
  validatePlan,
  type ScenarioPlan,
} from "./plan.js";
import { confirmedEntry, invalidated, type ScenarioEntry } from "./rules.js";

export type ReplayEvent = { readonly id: string; readonly at: string } & (
  | { readonly type: "candle"; readonly candle: Candle }
  | {
      readonly type: "quote";
      readonly quote: Quote;
      readonly risk: ScenarioRiskContext | null;
    }
);

export interface ReplayInput {
  readonly label: "SYNTHETIC" | "RECORDED";
  readonly plan: ScenarioPlan;
  readonly availableAt: string;
  readonly metadata: SymbolMetadata;
  readonly events: readonly ReplayEvent[];
}

export interface ExecutionAssumptions {
  readonly latencyMs: number;
  readonly entrySlippageTicks: number;
  readonly exitSlippageTicks: number;
  readonly stopLimitRangeTicks: number;
}
export const BASE_EXECUTION: ExecutionAssumptions = Object.freeze({
  latencyMs: 500,
  entrySlippageTicks: 2,
  exitSlippageTicks: 5,
  stopLimitRangeTicks: 5,
});

interface Pending {
  entry: ScenarioEntry;
  volume: string;
  expires: number;
}
interface Position {
  entry: ScenarioEntry;
  volume: string;
  fill: string;
  opened: number;
  exitReason: string | null;
  exitAt: number | null;
}
export interface LifecycleEvent {
  at: string;
  outcome: string;
  reasons: readonly string[];
  scenario: string | null;
}
export interface ClosedTrade {
  side: "BUY" | "SELL";
  entry: string;
  exit: string;
  volume: string;
  openedAt: string;
  closedAt: string;
  reason: string;
  gross: string;
  fees: string;
  net: string;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class ScenarioReplay {
  readonly plan: ScenarioPlan;
  readonly lifecycle: LifecycleEvent[] = [];
  readonly trades: ClosedTrade[] = [];
  readonly input: Omit<ReplayInput, "events">;
  private readonly seen = new Map<string, string>();
  private readonly journal: ReplayEvent[] = [];
  private lastAt = -1;
  private lastQuoteAt: number | null = null;
  private lastSource = -1;
  private lastQuoteFingerprint: string | null = null;
  private previous: Candle | null = null;
  private candidate: { entry: ScenarioEntry; ready: number } | null = null;
  private pending: Pending | null = null;
  private position: Position | null = null;
  private consumed = false;
  private censored = false;
  private halted = false;
  private equityAdjustment = new Decimal(0);
  constructor(
    input: Omit<ReplayInput, "events">,
    readonly execution = BASE_EXECUTION,
  ) {
    if (!["SYNTHETIC", "RECORDED"].includes(input.label))
      throw new Error("SCENARIO_DATA_LABEL_REQUIRED");
    for (const [key, value] of Object.entries(execution)) {
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > (key === "latencyMs" ? 10_000 : 100)
      )
        throw new Error("SCENARIO_EXECUTION_ASSUMPTION_INVALID");
    }
    this.input = structuredClone(input);
    this.plan = validatePlan(JSON.stringify(input.plan), {
      analysisId: input.plan.analysis_id,
      symbol: input.metadata.symbolName,
      capturedAt: input.plan.captured_at,
      availableAt: input.availableAt,
      tickSize: input.metadata.tickSize,
    });
  }
  private note(
    at: number,
    outcome: string,
    reasons: readonly string[] = [],
    entry?: ScenarioEntry,
  ): void {
    this.lifecycle.push({
      at: new Date(at).toISOString(),
      outcome,
      reasons,
      scenario: entry?.scenario ?? null,
    });
  }
  accept(event: ReplayEvent): void {
    try {
      this.process(structuredClone(event));
    } catch {
      this.halted = true;
      if (this.pending || this.position) this.censored = true;
      this.pending = null;
      this.candidate = null;
      throw new Error("SCENARIO_EVENT_INVALID");
    }
  }
  private process(event: ReplayEvent): void {
    if (
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(event.id) ||
      this.journal.length >= 200_000
    )
      throw new Error("EVENT_ID_OR_COUNT_INVALID");
    const hash = digest(event),
      old = this.seen.get(event.id);
    if (old !== undefined) {
      if (old !== hash) throw new Error("EVENT_CONFLICT");
      return;
    }
    const now = time(event.at);
    if (now < this.lastAt || now < time(this.input.availableAt))
      throw new Error("EVENT_TIME_REGRESSED");
    if (event.type === "candle") {
      const b = event.candle;
      validateCandle(b, now);
      if (now - time(b.endTime) > 3000) throw new Error("LATE_CANDLE");
      if (this.previous && time(b.endTime) <= time(this.previous.endTime))
        throw new Error("CANDLE_REGRESSED");
      if (this.previous && time(b.startTime) !== time(this.previous.endTime))
        this.previous = null;
      const active = this.position?.entry ?? this.pending?.entry;
      if (active && invalidated(active, b.close)) {
        if (this.pending) {
          this.note(now, "CANCELLED", ["SCENARIO_INVALIDATED"], active);
          this.pending = null;
        }
        if (this.position && this.position.exitReason === null) {
          this.position.exitReason = "CONFIRMED_INVALIDATION";
          this.position.exitAt = now + this.execution.latencyMs;
        }
      }
      if (
        !this.halted &&
        !this.consumed &&
        !this.pending &&
        !this.position &&
        this.previous
      ) {
        const entry = confirmedEntry(
          this.plan,
          this.previous,
          b,
          time(this.input.availableAt),
          this.input.metadata.tickSize,
        );
        this.candidate =
          entry === null
            ? null
            : { entry, ready: now + this.execution.latencyMs };
        this.note(
          now,
          entry === null ? "WAITING_FOR_CONFIRMATION" : "CONFIRMED",
          [],
          entry ?? undefined,
        );
      }
      this.previous = b;
    } else if (event.type === "quote") {
      const q = event.quote,
        source = time(q.sourceTime),
        receipt = time(q.receivedAt);
      const bid = decimal(q.bid),
        ask = decimal(q.ask),
        tick = decimal(this.input.metadata.tickSize);
      const fingerprint = digest([source, q.bid, q.ask]);
      if (
        source > receipt ||
        receipt > now ||
        now - source > 3000 ||
        source < this.lastSource ||
        (source === this.lastSource &&
          this.lastQuoteFingerprint !== fingerprint) ||
        bid.lte(0) ||
        ask.lt(bid) ||
        !isTickAligned(bid, tick) ||
        !isTickAligned(ask, tick)
      )
        throw new Error("QUOTE_INVALID");
      if (
        this.lastQuoteAt !== null &&
        now - this.lastQuoteAt > 3000 &&
        (this.pending || this.position)
      ) {
        this.censored = true;
        this.halted = true;
        this.pending = null;
        this.candidate = null;
        this.note(now, "PATH_CENSORED", ["QUOTE_GAP"]);
      }
      this.lastQuoteAt = now;
      this.lastSource = source;
      this.lastQuoteFingerprint = fingerprint;
      if (this.position) this.managePosition(q, now);
      if (this.pending && now >= this.pending.expires) {
        this.note(now, "EXPIRED", [], this.pending.entry);
        this.pending = null;
      }
      if (this.pending) {
        const p = this.pending,
          buy = p.entry.side === "BUY",
          market = buy ? ask : bid;
        if (buy ? market.gte(p.entry.entry) : market.lte(p.entry.entry)) {
          const slipped = market.plus(
            tick.mul(this.execution.entrySlippageTicks).mul(buy ? 1 : -1),
          );
          const edge = decimal(p.entry.entry).plus(
            tick.mul(this.execution.stopLimitRangeTicks).mul(buy ? 1 : -1),
          );
          if (buy ? slipped.gt(edge) : slipped.lt(edge)) {
            this.note(now, "UNFILLED", ["STOP_LIMIT_RANGE_EXCEEDED"], p.entry);
            // A triggered limit order may remain live. Do not invent its later queue fill.
            this.censored = true;
            this.halted = true;
            this.pending = null;
          } else {
            this.position = {
              entry: p.entry,
              volume: p.volume,
              fill: slipped.toFixed(),
              opened: now,
              exitReason: null,
              exitAt: null,
            };
            this.pending = null;
            this.consumed = true;
            this.note(now, "FILLED", [], p.entry);
            this.managePosition(q, now);
          }
        }
      }
      if (
        !this.halted &&
        !this.consumed &&
        !this.pending &&
        !this.position &&
        this.candidate &&
        now >= this.candidate.ready
      ) {
        const candidate = this.candidate;
        this.candidate = null;
        if (
          now >= time(this.plan.valid_until) ||
          now - time(candidate.entry.confirmedAt) >
            SCENARIO_POLICY.pendingLifetimeMs
        )
          this.note(
            now,
            "EXPIRED",
            ["PLAN_OR_CONFIRMATION_EXPIRED"],
            candidate.entry,
          );
        else if (!event.risk)
          this.note(
            now,
            "BLOCKED",
            ["RISK_CONTEXT_UNAVAILABLE"],
            candidate.entry,
          );
        else if (digest(event.risk.metadata) !== digest(this.input.metadata))
          this.note(now, "BLOCKED", ["METADATA_CHANGED"], candidate.entry);
        else {
          const risk = admitEntry(candidate.entry, q, now, event.risk);
          if (!risk.approved || risk.normalizedVolume === null)
            this.note(now, "BLOCKED", risk.reasonCodes, candidate.entry);
          else {
            this.pending = {
              entry: candidate.entry,
              volume: risk.normalizedVolume,
              expires: Math.min(
                time(this.plan.valid_until),
                now + SCENARIO_POLICY.pendingLifetimeMs,
              ),
            };
            this.note(now, "PENDING", [], candidate.entry);
          }
        }
      }
    } else throw new Error("EVENT_TYPE_INVALID");
    this.lastAt = now;
    this.seen.set(event.id, hash);
    this.journal.push(event);
  }
  private managePosition(q: Quote, now: number): void {
    const p = this.position;
    if (!p) return;
    const buy = p.entry.side === "BUY",
      mark = decimal(buy ? q.bid : q.ask);
    const stopHit = buy ? mark.lte(p.entry.stop) : mark.gte(p.entry.stop);
    const targetHit = buy ? mark.gte(p.entry.target) : mark.lte(p.entry.target);
    if (stopHit || targetHit) {
      this.close(q, now, stopHit ? "STRUCTURAL_STOP" : "FIRST_TARGET");
      return;
    }
    if (
      p.exitReason === null &&
      now >= p.opened + SCENARIO_POLICY.maximumHoldingMs
    ) {
      p.exitReason = "MAXIMUM_HOLDING_TIME";
      p.exitAt = now + this.execution.latencyMs;
    }
    if (p.exitAt !== null && now >= p.exitAt)
      this.close(q, now, p.exitReason ?? "EXIT");
  }
  private close(q: Quote, now: number, reason: string): void {
    const p = this.position;
    if (!p) return;
    const m = this.input.metadata,
      direction = p.entry.side === "BUY" ? 1 : -1;
    const price = decimal(direction === 1 ? q.bid : q.ask).minus(
      decimal(m.tickSize).mul(this.execution.exitSlippageTicks).mul(direction),
    );
    const gross = price
      .minus(p.fill)
      .mul(direction)
      .div(m.tickSize)
      .mul(m.tickValue)
      .mul(p.volume);
    const fees = oneWayCommission(m, decimal(p.fill), decimal(p.volume))
      .plus(oneWayCommission(m, price, decimal(p.volume)))
      .plus(gross.abs().mul(m.commission.pnlConversionFeeRate).div(100));
    const net = gross.minus(fees);
    this.trades.push({
      side: p.entry.side,
      entry: p.fill,
      exit: price.toFixed(),
      volume: p.volume,
      openedAt: new Date(p.opened).toISOString(),
      closedAt: new Date(now).toISOString(),
      reason,
      gross: gross.toFixed(),
      fees: fees.toFixed(),
      net: net.toFixed(),
    });
    this.equityAdjustment = this.equityAdjustment.plus(net);
    this.note(now, "CLOSED", [reason], p.entry);
    this.position = null;
  }
  report(): Record<string, unknown> {
    const censored =
      this.halted ||
      this.censored ||
      this.position !== null ||
      this.pending !== null ||
      this.candidate !== null;
    return {
      policy: SCENARIO_POLICY.version,
      label: this.input.label,
      brokerConnected: false,
      economicEvidence:
        this.input.label === "SYNTHETIC"
          ? "SOFTWARE_FIXTURE_ONLY"
          : "UNVALIDATED_RECORDED_REPLAY",
      assumptions: this.execution,
      events: this.journal.length,
      closedTrades: this.trades.length,
      pathCensored: censored,
      halted: this.halted,
      openPosition: this.position !== null,
      pendingOrder: this.pending !== null,
      awaitingAdmission: this.candidate !== null,
      netBeforeModelCosts: censored ? null : this.equityAdjustment.toFixed(),
      modelCosts: null,
      netAfterModelCosts: null,
      lifecycle: this.lifecycle,
      trades: this.trades,
    };
  }
  checkpoint(): string {
    const data = {
      version: 1,
      input: this.input,
      execution: this.execution,
      events: this.journal,
      halted: this.halted,
      censored: this.censored,
    };
    return JSON.stringify({ data, sha256: digest(data) });
  }
  static restore(raw: string): ScenarioReplay {
    if (Buffer.byteLength(raw) > 64_000_000)
      throw new Error("SCENARIO_CHECKPOINT_OVERSIZED");
    const envelope = JSON.parse(raw) as {
      data: {
        version: number;
        input: Omit<ReplayInput, "events">;
        execution: ExecutionAssumptions;
        events: ReplayEvent[];
        halted: boolean;
        censored: boolean;
      };
      sha256: string;
    };
    if (
      envelope.data.version !== 1 ||
      typeof envelope.data.halted !== "boolean" ||
      typeof envelope.data.censored !== "boolean" ||
      digest(envelope.data) !== envelope.sha256
    )
      throw new Error("SCENARIO_CHECKPOINT_INVALID");
    const replay = new ScenarioReplay(
      envelope.data.input,
      envelope.data.execution,
    );
    for (const event of envelope.data.events) replay.accept(event);
    replay.halted ||= envelope.data.halted;
    replay.censored ||= envelope.data.censored;
    if (replay.halted) {
      // A rejected event is deliberately absent from the replay journal. Its
      // durable latch must still invalidate any reconstructed pending intent.
      replay.pending = null;
      replay.candidate = null;
    }
    return replay;
  }
}
