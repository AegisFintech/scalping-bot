import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import type {
  MarketSnapshot,
  ModelResponse,
} from "../../contracts/src/index.js";
import type { TechnicalContextRequestV11 } from "../../contracts/src/technical-context.js";
import { technicalContextRequest } from "../../market-data-client/src/technical-collector.js";
import { boundedResponseText } from "../../ai-client/src/telemetry.js";
import { ModelResponseValidator } from "../../risk-engine/src/model-validator.js";
import {
  canonical,
  decimal,
  isTickAligned,
  oneWayCommission,
} from "../../risk-engine/src/index.js";

export interface ScalpCandidate {
  readonly setup: "TREND_PULLBACK" | "SWEEP_RECLAIM" | "COMPRESSION_BREAKOUT";
  readonly side: "BUY" | "SELL";
  readonly order_type: "LIMIT" | "STOP_LIMIT";
  readonly entry: string;
  readonly invalidation: string;
  readonly target: string;
  readonly source_available_at: string;
  readonly admission_until: string;
}
export interface ScalpScanReport {
  readonly schemaVersion: "scalp-scan-report-1.0";
  readonly execution_authority: false;
  readonly promotion: "HOLD";
  readonly input_sha256: string;
  readonly observed_at: string;
  readonly status: "OCO_CANDIDATE" | "NO_PAIR" | "REJECTED";
  readonly reasons: readonly string[];
  readonly candidates: readonly ScalpCandidate[];
  readonly pair: readonly [number, number] | null;
}
export interface ScalpScanRequest {
  readonly schemaVersion: "scalp-scan-request-1.0";
  readonly source: TechnicalContextRequestV11;
  readonly round_trip_cost_price: string | null;
}
const requestSchema = new ModelResponseValidator<ScalpScanRequest>(
  "schemas/scalp-scan-request-1.0.json",
);
const responseSchema = new ModelResponseValidator<ScalpScanReport>(
  "schemas/scalp-scan-report-1.0.json",
);

export function modeledScalpCost(
  snapshot: MarketSnapshot,
  atr: string,
): string {
  const m = snapshot.metadata;
  const volume = decimal(m.minVolume),
    tick = decimal(m.tickSize);
  const perPrice = decimal(m.tickValue).mul(volume).div(tick);
  const conversion = decimal(m.commission.pnlConversionFeeRate);
  if (perPrice.lte(0) || conversion.gte(100))
    throw new Error("SCALP_COSTS_UNAVAILABLE");
  // Minimum-volume commission floors over-reserve per-unit costs at larger
  // quantities. Final exact-volume fee/risk checks remain independent.
  return canonical(
    oneWayCommission(
      m,
      decimal(snapshot.quote.ask).plus(decimal(atr).mul(3)),
      volume,
    )
      .mul(2)
      .div(perPrice)
      .plus(tick.mul(95))
      .plus(decimal(atr).mul("1.5").mul(conversion).div(100))
      // Service boundaries permit ten decimals. Round the reserve upward,
      // never truncate a repeating/long commission distance optimistically.
      .toDecimalPlaces(10, Decimal.ROUND_UP),
  );
}

/** Bounded loopback computation; never a broker/provider request. */
export class CompressionDemoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("SCALP_LOOPBACK_REQUIRED");
  }
  async scan(
    snapshot: MarketSnapshot,
    atr: string,
  ): Promise<{ report: ScalpScanReport; modeledCost: string }> {
    const modeledCost = modeledScalpCost(snapshot, atr);
    const request: ScalpScanRequest = {
      schemaVersion: "scalp-scan-request-1.0",
      source: technicalContextRequest(snapshot),
      round_trip_cost_price: modeledCost,
    };
    const raw = JSON.stringify(request);
    if (!requestSchema.parse(raw).accepted)
      throw new Error("SCALP_REQUEST_INVALID");
    const response = await this.fetchImpl(
      new URL("/v1/scalp-scan", this.baseUrl),
      {
        method: "POST",
        body: raw,
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(2000),
      },
    );
    if (
      !response.ok ||
      response.headers.get("x-scalp-request-sha256") !==
        createHash("sha256").update(raw).digest("hex")
    )
      throw new Error("SCALP_HTTP_PROVENANCE_INVALID");
    const parsed = responseSchema.parse(
      await boundedResponseText(response, 128_000),
    );
    if (
      !parsed.accepted ||
      parsed.response === null ||
      Date.parse(parsed.response.observed_at) !==
        Date.parse(snapshot.capturedAt)
    )
      throw new Error("SCALP_RESPONSE_INVALID");
    return { report: parsed.response, modeledCost };
  }
}

/** Explicit operator-authorized DEMO adopter. Research output itself has no authority. */
export function compressionDemoTransform(input: {
  snapshot: MarketSnapshot;
  response: ModelResponse;
  atr: string;
  maximumStopDistance: string;
  report: ScalpScanReport;
  modeledCost: string;
}) {
  const reject = (code: string) => ({
    accepted: false,
    response: null,
    reasonCodes: [code],
    details: { code, scanner: input.report },
  });
  try {
    const { report, snapshot } = input;
    if (
      report.status !== "OCO_CANDIDATE" ||
      report.pair === null ||
      report.pair[0] === report.pair[1]
    )
      return reject("SCALP_NO_QUALIFIED_PAIR");
    const now = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(now) || Date.parse(report.observed_at) !== now)
      return reject("SCALP_SNAPSHOT_MISMATCH");
    const result = structuredClone(input.response);
    const atr = decimal(input.atr),
      tick = decimal(snapshot.metadata.tickSize),
      pip = decimal(snapshot.metadata.pipSize);
    if (atr.lte(0) || pip.lte(0) || tick.lte(0))
      return reject("SCALP_GEOMETRY_INVALID");
    const cost = decimal(input.modeledCost).plus(
      decimal(snapshot.quote.ask).minus(decimal(snapshot.quote.bid)),
    );
    for (const [index, side, leg] of [
      [report.pair[0], "BUY", result.buy_stop],
      [report.pair[1], "SELL", result.sell_stop],
    ] as const) {
      const candidate = report.candidates[index];
      if (
        candidate === undefined ||
        candidate.setup !== "COMPRESSION_BREAKOUT" ||
        candidate.order_type !== "STOP_LIMIT" ||
        candidate.side !== side
      )
        return reject("SCALP_PAIR_INVALID");
      const available = Date.parse(candidate.source_available_at),
        until = Date.parse(candidate.admission_until);
      if (
        !Number.isFinite(available) ||
        !Number.isFinite(until) ||
        available > now ||
        now >= until ||
        until - available > 120000 ||
        until - now > 60000
      )
        return reject("SCALP_ADMISSION_INVALID");
      const entry = decimal(leg.entry_price),
        boundary = decimal(candidate.entry),
        stop = decimal(candidate.invalidation);
      if (
        ![entry, boundary, stop].every((p) => p.gt(0) && isTickAligned(p, tick))
      )
        return reject("SCALP_GEOMETRY_INVALID");
      // Preserve BOTH actual Codex prices. No clamping, discarded model levels,
      // quote-adjacent substitution or silent fallback to the old strategy.
      const outward =
        side === "BUY" ? entry.minus(boundary) : boundary.minus(entry);
      if (outward.lt(0) || outward.gt(atr.mul("0.25")))
        return reject("SCALP_CODEX_STRUCTURE_MISMATCH");
      const risk = side === "BUY" ? entry.minus(stop) : stop.minus(entry);
      if (
        risk.lt(
          Decimal.max(tick.mul(5), decimal(snapshot.metadata.minStopDistance)),
        ) ||
        risk.gt(
          Decimal.min(atr.mul("1.5"), decimal(input.maximumStopDistance)),
        ) ||
        risk.lt(cost.mul(3))
      )
        return reject("SCALP_STOP_OR_COST_UNAFFORDABLE");
      const reward = risk.div(pip).ceil().mul(pip);
      const target = side === "BUY" ? entry.plus(reward) : entry.minus(reward);
      if (target.lte(0) || !isTickAligned(target, tick))
        return reject("SCALP_GEOMETRY_INVALID");
      Object.assign(leg, {
        stop_loss: canonical(stop),
        invalidation_price: canonical(stop),
        take_profit: canonical(target),
        risk_reward_ratio: canonical(
          reward.div(risk).toDecimalPlaces(10, Decimal.ROUND_DOWN),
        ),
      });
    }
    Object.assign(result.technical_map, {
      upside_targets: [result.buy_stop.take_profit],
      downside_targets: [result.sell_stop.take_profit],
    });
    Object.assign(result, {
      setup_tags: [...result.setup_tags, "COMPRESSION_SCALP_DEMO_OCO"],
    });
    return {
      accepted: true,
      response: result,
      reasonCodes: [],
      details: {
        code: "COMPRESSION_SCALP_DEMO",
        scanner: report,
        modeled_cost_price: input.modeledCost,
        model_entries_preserved: true,
      },
    };
  } catch {
    return reject("SCALP_GEOMETRY_INVALID");
  }
}
