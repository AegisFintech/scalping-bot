import { readFileSync } from "node:fs";

import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { Decimal } from "decimal.js";

import type {
  ModelOrderProposal,
  ModelResponse,
  Quote,
  SymbolMetadata,
} from "../../contracts/src/index.js";
import { decimal, isTickAligned } from "./decimal.js";

const MAX_MODEL_RESPONSE_BYTES = 1_048_576;

export interface SchemaResult {
  readonly accepted: boolean;
  readonly response: ModelResponse | null;
  readonly reasonCodes: readonly string[];
  readonly errors: readonly string[];
}

function schemaValidator(schemaPath: string): ValidateFunction<ModelResponse> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const addFormats = formatsModule.default as unknown as (
    instance: Ajv2020,
  ) => Ajv2020;
  addFormats(ajv);
  const parsed: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("MODEL_SCHEMA_NOT_AN_OBJECT");
  }
  return ajv.compile<ModelResponse>(parsed as AnySchema);
}

export class ModelResponseValidator {
  readonly #validate: ValidateFunction<ModelResponse>;

  constructor(schemaPath: string) {
    this.#validate = schemaValidator(schemaPath);
  }

  parse(raw: string): SchemaResult {
    if (Buffer.byteLength(raw, "utf8") > MAX_MODEL_RESPONSE_BYTES) {
      return {
        accepted: false,
        response: null,
        reasonCodes: ["MODEL_RESPONSE_OVERSIZED"],
        errors: [],
      };
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        accepted: false,
        response: null,
        reasonCodes: ["MODEL_JSON_INVALID"],
        errors: [],
      };
    }
    if (hasDuplicateObjectKeys(raw)) {
      return {
        accepted: false,
        response: null,
        reasonCodes: ["MODEL_JSON_DUPLICATE_KEYS"],
        errors: [],
      };
    }
    if (!this.#validate(value)) {
      return {
        accepted: false,
        response: null,
        reasonCodes: ["MODEL_SCHEMA_INVALID"],
        errors: (this.#validate.errors ?? []).slice(0, 32).map(formatError),
      };
    }
    return { accepted: true, response: value, reasonCodes: [], errors: [] };
  }
}

function hasDuplicateObjectKeys(raw: string): boolean {
  let position = 0;
  let duplicate = false;
  const whitespace = (): void => {
    while (/\s/.test(raw[position] ?? "")) position += 1;
  };
  const stringToken = (): string => {
    const start = position;
    position += 1;
    while (position < raw.length) {
      if (raw[position] === "\\") {
        position += 2;
      } else if (raw[position] === '"') {
        position += 1;
        return JSON.parse(raw.slice(start, position)) as string;
      } else {
        position += 1;
      }
    }
    throw new Error("unterminated string");
  };
  const value = (): void => {
    whitespace();
    const character = raw[position];
    if (character === "{") {
      position += 1;
      const keys = new Set<string>();
      whitespace();
      while (raw[position] !== "}") {
        const key = stringToken();
        if (keys.has(key)) duplicate = true;
        keys.add(key);
        whitespace();
        position += 1;
        value();
        whitespace();
        if (raw[position] === ",") {
          position += 1;
          whitespace();
        } else {
          break;
        }
      }
      position += 1;
    } else if (character === "[") {
      position += 1;
      whitespace();
      while (raw[position] !== "]") {
        value();
        whitespace();
        if (raw[position] === ",") {
          position += 1;
          whitespace();
        } else {
          break;
        }
      }
      position += 1;
    } else if (character === '"') {
      stringToken();
    } else {
      while (position < raw.length && !/[\s,}\]]/.test(raw[position] ?? ""))
        position += 1;
    }
  };
  value();
  return duplicate;
}

function formatError(error: ErrorObject): string {
  return `${error.instancePath || "/"}:${error.keyword}`;
}

export interface SemanticContext {
  readonly analysisId: string;
  readonly symbol: string;
  readonly now: Date;
  readonly quote: Quote;
  readonly metadata: SymbolMetadata;
  readonly atr: string;
  readonly minRiskRewardRatio: string;
  readonly minExpirySeconds: number;
  readonly maxExpirySeconds: number;
  readonly maxStopDistanceAtr: string;
  readonly maxQuoteAgeMs: number;
  readonly maxMetadataAgeMs?: number;
  readonly minStopDistancePoints?: string | null;
  readonly generatedAtPastToleranceMs?: number;
  readonly generatedAtFutureToleranceMs?: number;
  readonly expectedPerformanceAdjustment?: {
    readonly applied: boolean;
    readonly confidenceDelta: number;
    readonly reasonCodes: readonly string[];
  };
}

export interface SemanticResult {
  readonly accepted: boolean;
  readonly executable: boolean;
  readonly reasonCodes: readonly string[];
}

function checkLeg(
  side: "BUY" | "SELL",
  proposal: ModelOrderProposal,
  context: SemanticContext,
  reasons: string[],
): void {
  if (!proposal.enabled) return;
  const entry = decimal(proposal.entry_price);
  const trigger = decimal(proposal.trigger_price);
  const stop = decimal(proposal.stop_loss);
  const target = decimal(proposal.take_profit);
  const invalidation = decimal(proposal.invalidation_price);
  const tickSize = decimal(context.metadata.tickSize);
  const minDistance = Decimal.max(
    decimal(context.metadata.minStopDistance),
    tickSize,
    context.minStopDistancePoints === undefined ||
      context.minStopDistancePoints === null
      ? tickSize
      : tickSize.mul(decimal(context.minStopDistancePoints)),
  );
  const bid = decimal(context.quote.bid);
  const ask = decimal(context.quote.ask);
  if (!trigger.eq(entry)) reasons.push(`${side}_TRIGGER_ENTRY_MISMATCH`);
  if (
    ![entry, trigger, stop, target, invalidation].every((price) =>
      isTickAligned(price, tickSize),
    )
  ) {
    reasons.push(`${side}_PRICE_NOT_ON_TICK`);
  }
  const risk = entry.minus(stop).abs();
  const reward = target.minus(entry).abs();
  if (side === "BUY") {
    if (!(stop.lt(entry) && target.gt(entry)))
      reasons.push("BUY_LEVEL_ORDER_INVALID");
    if (entry.lt(ask.plus(minDistance))) reasons.push("BUY_ENTRY_TOO_CLOSE");
    if (!invalidation.lte(entry)) reasons.push("BUY_INVALIDATION_INVALID");
  } else {
    if (!(stop.gt(entry) && target.lt(entry)))
      reasons.push("SELL_LEVEL_ORDER_INVALID");
    if (entry.gt(bid.minus(minDistance))) reasons.push("SELL_ENTRY_TOO_CLOSE");
    if (!invalidation.gte(entry)) reasons.push("SELL_INVALIDATION_INVALID");
  }
  if (risk.lt(minDistance)) reasons.push(`${side}_STOP_DISTANCE_TOO_SMALL`);
  const computedRatio = risk.gt(0) ? reward.div(risk) : new Decimal(0);
  if (computedRatio.lt(decimal(context.minRiskRewardRatio)))
    reasons.push(`${side}_REWARD_RISK_TOO_LOW`);
  if (computedRatio.minus(decimal(proposal.risk_reward_ratio)).abs().gt("0.01"))
    reasons.push(`${side}_REWARD_RISK_MISMATCH`);
  if (risk.gt(decimal(context.atr).mul(decimal(context.maxStopDistanceAtr))))
    reasons.push(`${side}_STOP_DISTANCE_EXCESSIVE`);
  const expiry = Date.parse(proposal.expires_at);
  const seconds = (expiry - context.now.getTime()) / 1000;
  if (
    !Number.isFinite(expiry) ||
    seconds < context.minExpirySeconds ||
    seconds > context.maxExpirySeconds
  ) {
    reasons.push(`${side}_EXPIRY_INVALID`);
  }
}

export function validateSemantics(
  response: ModelResponse,
  context: SemanticContext,
): SemanticResult {
  const reasons: string[] = [];
  if (response.analysis_id !== context.analysisId)
    reasons.push("ANALYSIS_ID_MISMATCH");
  if (response.symbol !== context.symbol) reasons.push("SYMBOL_MISMATCH");
  const generatedAt = Date.parse(response.generated_at);
  const validUntil = Date.parse(response.valid_until);
  const nowMs = context.now.getTime();
  if (
    !Number.isFinite(generatedAt) ||
    generatedAt < nowMs - (context.generatedAtPastToleranceMs ?? 600_000) ||
    generatedAt > nowMs + (context.generatedAtFutureToleranceMs ?? 30_000)
  ) {
    reasons.push("GENERATED_AT_IMPLAUSIBLE");
  }
  const validitySeconds = (validUntil - nowMs) / 1000;
  if (
    !Number.isFinite(validUntil) ||
    validitySeconds < context.minExpirySeconds ||
    validitySeconds > context.maxExpirySeconds
  )
    reasons.push("VALID_UNTIL_INVALID");
  if (
    Number.isFinite(generatedAt) &&
    Number.isFinite(validUntil) &&
    validUntil <= generatedAt
  )
    reasons.push("VALIDITY_WINDOW_INVALID");
  const quoteTime = Date.parse(context.quote.sourceTime);
  if (
    !Number.isFinite(quoteTime) ||
    quoteTime < nowMs - context.maxQuoteAgeMs ||
    quoteTime > nowMs + (context.generatedAtFutureToleranceMs ?? 30_000)
  )
    reasons.push("QUOTE_STALE");
  const metadataTime = Date.parse(context.metadata.metadataTime);
  if (
    !Number.isFinite(metadataTime) ||
    metadataTime < nowMs - (context.maxMetadataAgeMs ?? 86_400_000) ||
    metadataTime > nowMs + (context.generatedAtFutureToleranceMs ?? 30_000)
  )
    reasons.push("SYMBOL_METADATA_STALE");
  if (
    decimal(response.waiting_area.lower).gte(
      decimal(response.waiting_area.upper),
    )
  )
    reasons.push("WAITING_AREA_INVALID");
  if (!response.data_quality.acceptable)
    reasons.push("MODEL_DATA_QUALITY_REJECTED");
  if (response.performance_adjustment.confidence_delta > 0)
    reasons.push("PERFORMANCE_ADJUSTMENT_INCREASE_INVALID");
  const expectedAdjusted = (original: number): number =>
    Math.max(
      0,
      Math.min(
        100,
        original + response.performance_adjustment.confidence_delta,
      ),
    );
  if (
    response.confidence.overall !==
      expectedAdjusted(response.confidence.original_overall) ||
    response.confidence.buy !==
      expectedAdjusted(response.confidence.original_buy) ||
    response.confidence.sell !==
      expectedAdjusted(response.confidence.original_sell)
  ) {
    reasons.push("CONFIDENCE_ADJUSTMENT_INVALID");
  }
  if (context.expectedPerformanceAdjustment !== undefined) {
    const expected = context.expectedPerformanceAdjustment;
    if (
      response.performance_adjustment.applied !== expected.applied ||
      response.performance_adjustment.confidence_delta !==
        expected.confidenceDelta ||
      JSON.stringify(
        [...response.performance_adjustment.reason_codes].sort(),
      ) !== JSON.stringify([...expected.reasonCodes].sort())
    ) {
      reasons.push("PERFORMANCE_ADJUSTMENT_MISMATCH");
    }
  }
  if (response.decision === "NO_TRADE") {
    if (response.buy_stop.enabled || response.sell_stop.enabled)
      reasons.push("NO_TRADE_HAS_ENABLED_LEG");
    return {
      accepted: reasons.length === 0,
      executable: false,
      reasonCodes: [...new Set(reasons)].sort(),
    };
  }
  if (!response.buy_stop.enabled || !response.sell_stop.enabled)
    reasons.push("PLACE_OCO_REQUIRES_BOTH_LEGS");
  const buyExpiry = Date.parse(response.buy_stop.expires_at);
  const sellExpiry = Date.parse(response.sell_stop.expires_at);
  if (
    !Number.isFinite(buyExpiry) ||
    !Number.isFinite(sellExpiry) ||
    buyExpiry !== sellExpiry
  )
    reasons.push("OCO_EXPIRY_MISMATCH");
  if (
    Number.isFinite(validUntil) &&
    ((Number.isFinite(buyExpiry) && buyExpiry > validUntil) ||
      (Number.isFinite(sellExpiry) && sellExpiry > validUntil))
  )
    reasons.push("ORDER_EXPIRY_AFTER_VALIDITY");
  try {
    checkLeg("BUY", response.buy_stop, context, reasons);
    checkLeg("SELL", response.sell_stop, context, reasons);
  } catch {
    reasons.push("SEMANTIC_DECIMAL_INVALID");
  }
  return {
    accepted: reasons.length === 0,
    executable: reasons.length === 0,
    reasonCodes: [...new Set(reasons)].sort(),
  };
}
