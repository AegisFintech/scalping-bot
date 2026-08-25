import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ModelResponseValidator,
  validateSemantics,
} from "../../packages/risk-engine/src/index.js";
import type { ModelResponse } from "../../packages/contracts/src/index.js";

const analysisId = "22222222-2222-4222-8222-222222222222";

function response(overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    schema_version: "2.0",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: "2026-01-01T00:00:00.000Z",
    valid_until: "2026-01-01T00:05:00.000Z",
    market_regime: "TRENDING",
    waiting_area: {
      lower: "1999.00",
      upper: "2001.00",
      description_code: "IMMEDIATE_DECISION_ZONE",
    },
    buy_stop: {
      trigger_price: "2001.20",
      entry_price: "2001.20",
      stop_loss: "1999.20",
      take_profit: "2005.20",
      risk_reward_ratio: "2.00",
      expires_at: "2026-01-01T00:05:00.000Z",
      invalidation_price: "1999.20",
    },
    sell_stop: {
      trigger_price: "1998.80",
      entry_price: "1998.80",
      stop_loss: "2000.80",
      take_profit: "1994.80",
      risk_reward_ratio: "2.00",
      expires_at: "2026-01-01T00:05:00.000Z",
      invalidation_price: "2000.80",
    },
    confidence: {
      overall: 60,
      buy: 60,
      sell: 55,
      original_overall: 60,
      original_buy: 60,
      original_sell: 55,
    },
    setup_tags: ["BREAKOUT"],
    evidence_codes: ["EMA_ALIGNED"],
    risk_flags: [],
    performance_adjustment: {
      applied: false,
      confidence_delta: 0,
      reason_codes: [],
    },
    data_quality: { warnings: [] },
    ...overrides,
  };
}

describe("model response schema", () => {
  const validator = new ModelResponseValidator(
    path.resolve("schemas/model-response-2.0.json"),
  );

  it("accepts the exact contract", () => {
    expect(validator.parse(JSON.stringify(response())).accepted).toBe(true);
  });

  it("uses the strict structured-output schema subset", () => {
    const schema = JSON.parse(
      readFileSync(path.resolve("schemas/model-response-2.0.json"), "utf8"),
    ) as unknown;
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      const node = value as Record<string, unknown>;
      expect(node).not.toHaveProperty("uniqueItems");
      if ("enum" in node || "const" in node) expect(node.type).toBe("string");
      for (const child of Object.values(node)) visit(child);
    };

    visit(schema);
  });

  it("rejects an extra field", () => {
    const invalid = { ...response(), position_size: "100" };
    const result = validator.parse(JSON.stringify(invalid));
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toContain("MODEL_SCHEMA_INVALID");
  });

  it("rejects legacy NO_TRADE and disabled-leg switches", () => {
    const legacySwitches = {
      ...response(),
      decision: "NO_TRADE",
      buy_stop: { ...response().buy_stop, enabled: false },
      sell_stop: { ...response().sell_stop, enabled: false },
    };
    const result = validator.parse(JSON.stringify(legacySwitches));
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toContain("MODEL_SCHEMA_INVALID");
  });

  it("rejects an AI-controlled data-quality veto", () => {
    const invalid = {
      ...response(),
      data_quality: { acceptable: false, warnings: ["TIMEFRAME_CONFLICT"] },
    };
    expect(validator.parse(JSON.stringify(invalid)).accepted).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(validator.parse("not-json").reasonCodes).toEqual([
      "MODEL_JSON_INVALID",
    ]);
  });

  it("rejects duplicate JSON object keys", () => {
    const raw = JSON.stringify(response()).replace(
      '"schema_version":"2.0"',
      '"schema_version":"2.0","schema_version":"2.0"',
    );
    expect(validator.parse(raw).reasonCodes).toEqual([
      "MODEL_JSON_DUPLICATE_KEYS",
    ]);
  });

  it("semantically validates coherent levels", () => {
    const result = validateSemantics(response(), {
      analysisId,
      symbol: "XAUUSD",
      now: new Date("2026-01-01T00:00:00.000Z"),
      quote: {
        bid: "1999.90",
        ask: "2000.10",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      metadata: {
        symbolId: "1",
        symbolName: "XAUUSD",
        digits: 2,
        tickSize: "0.01",
        tickValue: "0.01",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "1",
        maxVolume: "100000",
        volumeStep: "1",
        minStopDistance: "0.10",
        metadataTime: "2026-01-01T00:00:00.000Z",
      },
      atr: "5.00",
      minRiskRewardRatio: "2",
      minExpirySeconds: 15,
      maxExpirySeconds: 1800,
      maxStopDistanceAtr: "3",
      maxQuoteAgeMs: 3000,
    });
    expect(result).toEqual({
      accepted: true,
      reasonCodes: [],
    });
  });

  it("rejects endpoint stops above the current broker-minimum affordability limit", () => {
    const result = validateSemantics(response(), {
      analysisId,
      symbol: "XAUUSD",
      now: new Date("2026-01-01T00:00:00.000Z"),
      quote: {
        bid: "1999.90",
        ask: "2000.10",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      metadata: {
        symbolId: "1",
        symbolName: "XAUUSD",
        digits: 2,
        tickSize: "0.01",
        tickValue: "0.01",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "100",
        maxVolume: "100000",
        volumeStep: "100",
        minStopDistance: "0.10",
        metadataTime: "2026-01-01T00:00:00.000Z",
      },
      atr: "5.00",
      minRiskRewardRatio: "2",
      minExpirySeconds: 15,
      maxExpirySeconds: 1800,
      maxStopDistanceAtr: "3",
      maxAffordableStopDistance: "0.5",
      maxQuoteAgeMs: 3000,
    });

    expect(result.reasonCodes).toContain(
      "BUY_STOP_DISTANCE_UNAFFORDABLE_AT_MIN_VOLUME",
    );
    expect(result.reasonCodes).toContain(
      "SELL_STOP_DISTANCE_UNAFFORDABLE_AT_MIN_VOLUME",
    );
  });

  it("rejects a wrong symbol and inverted buy stop", () => {
    const invalid = response({
      symbol: "EURUSD",
      buy_stop: { ...response().buy_stop, stop_loss: "2002.00" },
    });
    const result = validateSemantics(invalid, {
      analysisId,
      symbol: "XAUUSD",
      now: new Date("2026-01-01T00:00:00.000Z"),
      quote: {
        bid: "1999.90",
        ask: "2000.10",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      metadata: {
        symbolId: "1",
        symbolName: "XAUUSD",
        digits: 2,
        tickSize: "0.01",
        tickValue: "0.01",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "1",
        maxVolume: "100000",
        volumeStep: "1",
        minStopDistance: "0.10",
        metadataTime: "2026-01-01T00:00:00.000Z",
      },
      atr: "5.00",
      minRiskRewardRatio: "2",
      minExpirySeconds: 15,
      maxExpirySeconds: 1800,
      maxStopDistanceAtr: "3",
      maxQuoteAgeMs: 3000,
    });
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toContain("SYMBOL_MISMATCH");
    expect(result.reasonCodes).toContain("BUY_LEVEL_ORDER_INVALID");
  });

  it("rejects stale metadata and mismatched OCO expirations", () => {
    const invalid = response({
      buy_stop: {
        ...response().buy_stop,
        expires_at: "2026-01-01T00:06:00.000Z",
      },
    });
    const result = validateSemantics(invalid, {
      analysisId,
      symbol: "XAUUSD",
      now: new Date("2026-01-01T00:00:00.000Z"),
      quote: {
        bid: "1999.90",
        ask: "2000.10",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      metadata: {
        symbolId: "1",
        symbolName: "XAUUSD",
        digits: 2,
        tickSize: "0.01",
        tickValue: "0.01",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "1",
        maxVolume: "100000",
        volumeStep: "1",
        minStopDistance: "0.10",
        metadataTime: "2025-12-30T00:00:00.000Z",
      },
      atr: "5.00",
      minRiskRewardRatio: "2",
      minExpirySeconds: 15,
      maxExpirySeconds: 1800,
      maxStopDistanceAtr: "3",
      maxQuoteAgeMs: 3000,
      maxMetadataAgeMs: 86400000,
    });
    expect(result.reasonCodes).toContain("SYMBOL_METADATA_STALE");
    expect(result.reasonCodes).toContain("OCO_EXPIRY_MISMATCH");
    expect(result.reasonCodes).toContain("ORDER_EXPIRY_AFTER_VALIDITY");
  });

  it("rejects a model-selected performance adjustment", () => {
    const result = validateSemantics(response(), {
      analysisId,
      symbol: "XAUUSD",
      now: new Date("2026-01-01T00:00:00.000Z"),
      quote: {
        bid: "1999.90",
        ask: "2000.10",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      metadata: {
        symbolId: "1",
        symbolName: "XAUUSD",
        digits: 2,
        tickSize: "0.01",
        tickValue: "0.01",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "1",
        maxVolume: "100000",
        volumeStep: "1",
        minStopDistance: "0.10",
        metadataTime: "2026-01-01T00:00:00.000Z",
      },
      atr: "5.00",
      minRiskRewardRatio: "2",
      minExpirySeconds: 15,
      maxExpirySeconds: 1800,
      maxStopDistanceAtr: "3",
      maxQuoteAgeMs: 3000,
      expectedPerformanceAdjustment: {
        applied: true,
        confidenceDelta: -10,
        reasonCodes: ["RECENT_SIMILAR_SETUP_UNDERPERFORMANCE"],
      },
    });
    expect(result.reasonCodes).toContain("PERFORMANCE_ADJUSTMENT_MISMATCH");
  });

  it("rejects adjusted confidence that does not equal original plus delta", () => {
    const invalid = response({
      confidence: {
        overall: 55,
        buy: 50,
        sell: 45,
        original_overall: 60,
        original_buy: 60,
        original_sell: 55,
      },
      performance_adjustment: {
        applied: true,
        confidence_delta: -10,
        reason_codes: ["RECENT_SIMILAR_SETUP_UNDERPERFORMANCE"],
      },
    });
    const result = validateSemantics(invalid, {
      analysisId,
      symbol: "XAUUSD",
      now: new Date("2026-01-01T00:00:00.000Z"),
      quote: {
        bid: "1999.90",
        ask: "2000.10",
        sourceTime: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
      metadata: {
        symbolId: "1",
        symbolName: "XAUUSD",
        digits: 2,
        tickSize: "0.01",
        tickValue: "0.01",
        contractSize: "100",
        volumeScale: "0.01",
        minVolume: "1",
        maxVolume: "100000",
        volumeStep: "1",
        minStopDistance: "0.10",
        metadataTime: "2026-01-01T00:00:00.000Z",
      },
      atr: "5.00",
      minRiskRewardRatio: "2",
      minExpirySeconds: 15,
      maxExpirySeconds: 1800,
      maxStopDistanceAtr: "3",
      maxQuoteAgeMs: 3000,
      expectedPerformanceAdjustment: {
        applied: true,
        confidenceDelta: -10,
        reasonCodes: ["RECENT_SIMILAR_SETUP_UNDERPERFORMANCE"],
      },
    });
    expect(result.reasonCodes).toContain("CONFIDENCE_ADJUSTMENT_INVALID");
  });
});
