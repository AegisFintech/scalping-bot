import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  AnalysisCoordinator,
  InMemoryDecisionTrail,
  type CoordinatorOptions,
} from "../../apps/execution-service/src/coordinator.js";
import type { SafetyGateInput } from "../../apps/execution-service/src/safety-gates.js";
import type {
  AccountState,
  AnalyticsRequest,
  MarketSnapshot,
  ModelPromptArtifact,
  ModelResponse,
  PendingOrderCommand,
} from "../../packages/contracts/src/index.js";

function safety(): SafetyGateInput {
  return {
    tradingMode: "paper",
    liveTradingEnabled: false,
    liveAcknowledgement: "",
    environmentEmergencyStop: false,
    filesystemControlsCertain: true,
    filesystemEmergencyStop: false,
    liveEnablementFileValid: false,
    runtimeControlsCertain: true,
    databaseEmergencyStop: false,
    dashboardAcknowledged: false,
    pauseNewAnalyses: false,
    startupChecksPassed: true,
    serviceHealthy: true,
    accountAuthenticated: true,
    accountReconciled: true,
    reconciliationCertain: true,
    relevantPositionCount: 0,
    relevantPendingOrderCount: 0,
    partialFillPresent: false,
    cancellationPending: false,
    previousAnalysisExpired: true,
    candlesSynchronized: true,
    orderBookFresh: true,
    marketDataFresh: true,
    dailyLossLockout: false,
    operationalRiskLockout: false,
    aiCircuitOpen: false,
    symbolMetadataValid: true,
    aiResponseValid: false,
    deterministicRiskApproved: false,
    spreadSafe: false,
    duplicateFree: true,
    criticalAuditAvailable: true,
  };
}

function promptArtifact(): ModelPromptArtifact {
  const content = "Return a mandatory OCO proposal.";
  return {
    version: "system-v2",
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function ocoProposal(analysisId: string): ModelResponse {
  const now = Date.now();
  const expiresAt = new Date(now + 60_000).toISOString();
  return {
    schema_version: "2.0",
    analysis_id: analysisId,
    symbol: "XAUUSD",
    generated_at: new Date(now).toISOString(),
    valid_until: expiresAt,
    market_regime: "UNCERTAIN",
    waiting_area: {
      lower: "1999",
      upper: "2001",
      description_code: "IMMEDIATE_DECISION_ZONE",
    },
    buy_stop: {
      trigger_price: "2001",
      entry_price: "2001",
      stop_loss: "2000",
      take_profit: "2003",
      risk_reward_ratio: "2",
      expires_at: expiresAt,
      invalidation_price: "2000",
    },
    sell_stop: {
      trigger_price: "1999",
      entry_price: "1999",
      stop_loss: "2000",
      take_profit: "1997",
      risk_reward_ratio: "2",
      expires_at: expiresAt,
      invalidation_price: "2000",
    },
    confidence: {
      overall: 0,
      buy: 0,
      sell: 0,
      original_overall: 0,
      original_buy: 0,
      original_sell: 0,
    },
    setup_tags: [],
    evidence_codes: [],
    risk_flags: [],
    performance_adjustment: {
      applied: false,
      confidence_delta: 0,
      reason_codes: [],
    },
    data_quality: { warnings: [] },
  };
}

function accountState(): AccountState {
  return {
    reconciledAt: new Date().toISOString(),
    certain: true,
    equity: "10000",
    balance: "10000",
    availableMargin: "10000",
    relevantPositionCount: 0,
    relevantPendingOrderCount: 0,
    hasPartialFill: false,
    hasCancellationPending: false,
    reasonCodes: [],
  };
}

function commands(
  analysisId: string,
): [PendingOrderCommand, PendingOrderCommand] {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const command = (
    side: "BUY" | "SELL",
    entryPrice: string,
    stopLoss: string,
    takeProfit: string,
  ): PendingOrderCommand => ({
    idempotencyKey: `${analysisId}-${side}`,
    analysisId,
    orderGroupId: `${analysisId}-group`,
    clientOrderId: `${analysisId}-${side}`,
    symbol: "XAUUSD",
    side,
    volume: "1",
    entryPrice,
    stopLoss,
    takeProfit,
    expiresAt,
    strategyLabel: "test",
  });
  return [
    command("BUY", "2001", "2000", "2003"),
    command("SELL", "1999", "2000", "1997"),
  ];
}

function snapshot(): MarketSnapshot {
  const now = new Date().toISOString();
  return {
    serverTime: now,
    capturedAt: now,
    observedSkewMs: 0,
    metadata: {
      symbolId: "7",
      symbolName: "XAUUSD",
      digits: 2,
      tickSize: "0.01",
      tickValue: "0.01",
      contractSize: "100",
      volumeScale: "0.01",
      minVolume: "1",
      maxVolume: "10000",
      volumeStep: "1",
      minStopDistance: "0.1",
      metadataTime: now,
    },
    quote: { bid: "1999.9", ask: "2000.1", sourceTime: now, receivedAt: now },
    candles: ["M1", "M5", "M15"].map((timeframe) => ({
      timeframe: timeframe as "M1" | "M5" | "M15",
      candles: [],
    })),
    orderBook: {
      sourceTime: now,
      receivedAt: now,
      bids: [{ price: "1999.9", size: "1" }],
      asks: [{ price: "2000.1", size: "1" }],
      complete: true,
      discontinuity: false,
      reconnectSequence: 0,
      aggregates: [
        {
          windowMs: 60000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 300000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
        {
          windowMs: 900000,
          sampleCount: 1,
          bidLiquidityChange: "0",
          askLiquidityChange: "0",
          additions: 0,
          removals: 0,
        },
      ],
    },
  };
}

function options(
  overrides: Partial<CoordinatorOptions> = {},
): CoordinatorOptions {
  const marketSnapshot = snapshot();
  return {
    symbol: "XAUUSD",
    mode: "paper",
    candleCounts: { M1: 1, M5: 1, M15: 1 },
    orderBookDepth: 1,
    analyticsConfig: {
      atrPeriod: 15,
      emaFastPeriod: 5,
      emaSlowPeriod: 19,
      adxEnabled: true,
      adxPeriod: 14,
      rsiEnabled: true,
      rsiPeriod: 14,
      bollingerEnabled: false,
      bollingerPeriod: 20,
      bollingerStddev: "2",
      swingPivotLeft: 3,
      swingPivotRight: 3,
      compactTail: { M1: 1, M5: 1, M15: 1 },
      expectedCounts: { M1: 1, M5: 1, M15: 1 },
    },
    modelPayloadMode: "compact",
    promptVersion: "system-v2",
    schemaVersion: "2.0",
    strategyVersion: "test",
    minRiskRewardRatio: "2",
    minExpirySeconds: 15,
    maxExpirySeconds: 1800,
    maxStopDistanceAtr: "3",
    minStopDistancePoints: null,
    maxQuoteAgeMs: 3000,
    maxMetadataAgeMs: 86400000,
    maxOrderBookAgeMs: 3000,
    maxSpreadPoints: "50",
    maxSpreadAtrRatio: "0.1",
    maxSpreadPercentile: null,
    spreadContext: () =>
      Promise.resolve({ observedPercentile: null, sessionAbnormal: false }),
    market: { snapshot: vi.fn(() => Promise.resolve(marketSnapshot)) },
    analytics: {
      analyze: vi.fn((request: AnalyticsRequest) =>
        Promise.resolve({
          schemaVersion: "1.0" as const,
          requestId: request.requestId,
          analysisId: request.analysisId,
          generatedAt: new Date().toISOString(),
          acceptable: true,
          rejectionReasons: [],
          features: {
            timeframes: {
              M1: { atr: "5", raw_tail: [], full_candles: [] },
              M5: { atr: "5", raw_tail: [], full_candles: [] },
              M15: { atr: "5", raw_tail: [], full_candles: [] },
            },
            order_book: {},
            spread_atr_ratio_m1: "0.04",
          },
        }),
      ),
    },
    model: {
      circuitOpen: false,
      analyze: vi.fn((request: { readonly analysisId: string }) =>
        Promise.resolve({
          response: ocoProposal(request.analysisId),
          rawResponse: "{}",
          promptArtifact: promptArtifact(),
        }),
      ),
    },
    account: {
      authenticate: () => Promise.resolve(),
      reconcile: () => Promise.resolve(accountState()),
    },
    risk: {
      evaluate: (input) =>
        Promise.resolve({
          approved: true,
          reasonCodes: [],
          risk: null,
          commands: commands(input.response.analysis_id),
          equity: "10000",
          perLegRiskPercent: "0.5",
        }),
    },
    gateway: {
      kind: "paper",
      canSubmitToBroker: false,
      placeOco: vi.fn(
        (submitted: readonly [PendingOrderCommand, PendingOrderCommand]) =>
          Promise.resolve({
            orderGroupId: submitted[0].orderGroupId,
            idempotentReplay: false,
            orders: [],
          }),
      ),
      cancelStrategyOrder: () => Promise.reject(new Error("not used")),
      reconcile: () => Promise.reject(new Error("not used")),
    },
    trail: new InMemoryDecisionTrail(),
    safety: () => Promise.resolve(safety()),
    performance: () => Promise.resolve({ sample_size: 0 }),
    ...overrides,
  };
}

describe("analysis coordinator", () => {
  it("carries a mandatory two-leg proposal through deterministic placement", async () => {
    const configured = options();
    const result = await new AnalysisCoordinator(configured).runOnce();
    expect(result.outcome).toBe("PLACED");
    expect(result.placement).not.toBeNull();
  });

  it("rejects a mismatched prompt artifact before risk or placement", async () => {
    const place = vi.fn(() => Promise.reject(new Error("must not place")));
    const configured = options({
      model: {
        circuitOpen: false,
        analyze: vi.fn((request: { readonly analysisId: string }) =>
          Promise.resolve({
            response: ocoProposal(request.analysisId),
            rawResponse: "{}",
            promptArtifact: {
              ...promptArtifact(),
              version: "system-v1",
            } as unknown as ModelPromptArtifact,
          }),
        ),
      },
      gateway: {
        kind: "paper",
        canSubmitToBroker: false,
        placeOco: place,
        cancelStrategyOrder: () => Promise.reject(new Error("not used")),
        reconcile: () => Promise.reject(new Error("not used")),
      },
    });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["MODEL_PROMPT_VERSION_MISMATCH"],
    });
    expect(place).not.toHaveBeenCalled();
  });

  it("rejects before market collection when emergency stopped", async () => {
    const market = {
      snapshot: vi.fn(() => Promise.reject(new Error("must not run"))),
    };
    const configured = options({
      market,
      safety: () =>
        Promise.resolve({ ...safety(), environmentEmergencyStop: true }),
    });
    const result = await new AnalysisCoordinator(configured).runOnce();
    expect(result).toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["EMERGENCY_STOP_ENV"],
    });
    expect(market.snapshot).not.toHaveBeenCalled();
  });

  it("rejects before the model when proposal constraints are mathematically incompatible", async () => {
    const model = vi.fn(() => Promise.reject(new Error("must not call model")));
    const configured = options({
      maxStopDistanceAtr: "0.001",
      model: { circuitOpen: false, analyze: model },
    });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["MODEL_PROPOSAL_CONSTRAINTS_UNSATISFIABLE"],
    });
    expect(model).not.toHaveBeenCalled();
  });

  it("refreshes decision market state after model latency", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-24T08:00:00.000Z"));
      const initial = snapshot();
      const market = {
        snapshot: vi
          .fn()
          .mockResolvedValueOnce(initial)
          .mockImplementationOnce(() => Promise.resolve(snapshot())),
      };
      const trail = new InMemoryDecisionTrail();
      const configured = options({
        market,
        trail,
        model: {
          circuitOpen: false,
          analyze: vi.fn((request: { readonly analysisId: string }) => {
            vi.setSystemTime(new Date("2026-08-24T08:00:10.000Z"));
            return Promise.resolve({
              response: ocoProposal(request.analysisId),
              rawResponse: "{}",
              promptArtifact: promptArtifact(),
            });
          }),
        },
      });

      await expect(
        new AnalysisCoordinator(configured).runOnce(),
      ).resolves.toMatchObject({
        outcome: "PLACED",
        reasonCodes: [],
      });
      expect(market.snapshot).toHaveBeenCalledTimes(2);
      expect(trail.events).toContainEqual(
        expect.objectContaining({ type: "decision_market" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when decision market refresh is unavailable", async () => {
    const market = {
      snapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot())
        .mockRejectedValueOnce(new Error("network")),
    };
    const configured = options({ market });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["DECISION_MARKET_REFRESH_FAILED"],
    });
  });

  it("rejects a changed completed-candle context during inference", async () => {
    const initial = snapshot();
    const refreshed = snapshot();
    const changed: MarketSnapshot = {
      ...refreshed,
      candles: refreshed.candles.map((series) =>
        series.timeframe === "M1"
          ? {
              ...series,
              candles: [
                {
                  startTime: "2026-08-24T07:59:00.000Z",
                  endTime: "2026-08-24T08:00:00.000Z",
                  open: "2000",
                  high: "2001",
                  low: "1999",
                  close: "2000",
                  volume: "1",
                  complete: true,
                  qualityFlags: [],
                },
              ],
            }
          : series,
      ),
    };
    const configured = options({
      market: {
        snapshot: vi
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(changed),
      },
    });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["DECISION_CANDLE_CONTEXT_CHANGED"],
    });
  });

  it("rejects changed execution metadata during inference", async () => {
    const initial = snapshot();
    const refreshed = snapshot();
    const changed: MarketSnapshot = {
      ...refreshed,
      metadata: { ...refreshed.metadata, minStopDistance: "0.2" },
    };
    const configured = options({
      market: {
        snapshot: vi
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(changed),
      },
    });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["DECISION_SYMBOL_METADATA_CHANGED"],
    });
  });

  it("rejects regressed broker time during inference", async () => {
    const initial = snapshot();
    const configured = options({
      market: {
        snapshot: vi
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce({
            ...initial,
            serverTime: new Date(
              Date.parse(initial.serverTime) - 1,
            ).toISOString(),
          }),
      },
    });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({
      outcome: "REJECTED",
      reasonCodes: ["DECISION_MARKET_TIME_REGRESSION"],
    });
  });

  it("rejects a stale refreshed quote", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-24T08:00:00.000Z"));
      const initial = snapshot();
      const configured = options({
        market: {
          snapshot: vi
            .fn()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(initial),
        },
        model: {
          circuitOpen: false,
          analyze: vi.fn((request: { readonly analysisId: string }) => {
            vi.setSystemTime(new Date("2026-08-24T08:00:10.000Z"));
            return Promise.resolve({
              response: ocoProposal(request.analysisId),
              rawResponse: "{}",
              promptArtifact: promptArtifact(),
            });
          }),
        },
      });

      await expect(
        new AnalysisCoordinator(configured).runOnce(),
      ).resolves.toMatchObject({
        outcome: "REJECTED",
        reasonCodes: ["QUOTE_STALE"],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks spread protection against the refreshed quote", async () => {
    const initial = snapshot();
    const refreshed = snapshot();
    const widened: MarketSnapshot = {
      ...refreshed,
      quote: { ...refreshed.quote, bid: "1999", ask: "2001" },
      orderBook: {
        ...refreshed.orderBook,
        bids: [{ price: "1999", size: "1" }],
        asks: [{ price: "2001", size: "1" }],
      },
    };
    const configured = options({
      market: {
        snapshot: vi
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(widened),
      },
    });

    const result = await new AnalysisCoordinator(configured).runOnce();
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasonCodes).toEqual([
      "SPREAD_ATR_EXCEEDED",
      "SPREAD_POINTS_EXCEEDED",
    ]);
  });

  it("uses refreshed execution state for risk and placement", async () => {
    const initial = snapshot();
    const refreshed: MarketSnapshot = {
      ...snapshot(),
      quote: { ...snapshot().quote, bid: "1999.8", ask: "2000.2" },
    };
    const riskEvaluate = vi.fn(
      (input: {
        readonly response: ModelResponse;
        readonly quote: MarketSnapshot["quote"];
      }) =>
        Promise.resolve({
          approved: true,
          reasonCodes: [],
          risk: null,
          commands: commands(input.response.analysis_id),
          equity: "10000",
          perLegRiskPercent: "0.25",
        }),
    );
    const place = vi.fn((pending: readonly PendingOrderCommand[]) =>
      Promise.resolve({
        orderGroupId: pending[0]?.orderGroupId ?? "missing",
        idempotentReplay: false,
        orders: [],
      }),
    );
    const configured = options({
      market: {
        snapshot: vi
          .fn()
          .mockResolvedValueOnce(initial)
          .mockResolvedValueOnce(refreshed),
      },
      model: {
        circuitOpen: false,
        analyze: vi.fn((request: { readonly analysisId: string }) =>
          Promise.resolve({
            response: ocoProposal(request.analysisId),
            rawResponse: "{}",
            promptArtifact: promptArtifact(),
          }),
        ),
      },
      account: {
        authenticate: () => Promise.resolve(),
        reconcile: () => Promise.resolve(accountState()),
      },
      risk: { evaluate: riskEvaluate },
      gateway: {
        kind: "paper",
        canSubmitToBroker: false,
        placeOco: place,
        cancelStrategyOrder: () => Promise.reject(new Error("not used")),
        reconcile: () => Promise.reject(new Error("not used")),
      },
    });

    await expect(
      new AnalysisCoordinator(configured).runOnce(),
    ).resolves.toMatchObject({ outcome: "PLACED" });
    expect(riskEvaluate).toHaveBeenCalledWith(
      expect.objectContaining({ quote: refreshed.quote }),
    );
    expect(place).toHaveBeenCalledOnce();
  });

  it("rejects a stale refreshed order book before placement", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-24T08:00:00.000Z"));
      const initial = snapshot();
      const refreshed: MarketSnapshot = {
        ...snapshot(),
        orderBook: {
          ...snapshot().orderBook,
          sourceTime: "2026-08-24T07:59:50.000Z",
        },
      };
      const place = vi.fn(() => Promise.reject(new Error("must not place")));
      const configured = options({
        market: {
          snapshot: vi
            .fn()
            .mockResolvedValueOnce(initial)
            .mockResolvedValueOnce(refreshed),
        },
        model: {
          circuitOpen: false,
          analyze: vi.fn((request: { readonly analysisId: string }) =>
            Promise.resolve({
              response: ocoProposal(request.analysisId),
              rawResponse: "{}",
              promptArtifact: promptArtifact(),
            }),
          ),
        },
        account: {
          authenticate: () => Promise.resolve(),
          reconcile: () => Promise.resolve(accountState()),
        },
        risk: {
          evaluate: (input) =>
            Promise.resolve({
              approved: true,
              reasonCodes: [],
              risk: null,
              commands: commands(input.response.analysis_id),
              equity: "10000",
              perLegRiskPercent: "0.25",
            }),
        },
        gateway: {
          kind: "paper",
          canSubmitToBroker: false,
          placeOco: place,
          cancelStrategyOrder: () => Promise.reject(new Error("not used")),
          reconcile: () => Promise.reject(new Error("not used")),
        },
      });

      await expect(
        new AnalysisCoordinator(configured).runOnce(),
      ).resolves.toMatchObject({
        outcome: "REJECTED",
        reasonCodes: ["ORDER_BOOK_STALE"],
      });
      expect(place).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
