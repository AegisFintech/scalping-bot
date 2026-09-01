export type DecimalString = string;
export type IsoTimestamp = string;
export type TradingMode =
  "replay" | "backtest" | "paper" | "demo" | "shadow" | "live";
export type Timeframe = "M1" | "M5" | "M15";

export interface Candle {
  readonly startTime: IsoTimestamp;
  readonly endTime: IsoTimestamp;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly close: DecimalString;
  readonly volume: DecimalString | null;
  readonly complete: boolean;
  readonly qualityFlags: readonly string[];
}

export interface CandleSeries {
  readonly timeframe: Timeframe;
  readonly candles: readonly Candle[];
}

export interface OrderBookLevel {
  readonly price: DecimalString;
  readonly size: DecimalString;
}

export interface OrderBookAggregate {
  readonly windowMs: 60_000 | 300_000 | 900_000;
  readonly sampleCount: number;
  readonly bidLiquidityChange: DecimalString;
  readonly askLiquidityChange: DecimalString;
  readonly additions: number;
  readonly removals: number;
}

export interface OrderBookSnapshot {
  readonly sourceTime: IsoTimestamp;
  readonly receivedAt: IsoTimestamp;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly complete: boolean;
  readonly discontinuity: boolean;
  readonly reconnectSequence: number;
  readonly aggregates: readonly OrderBookAggregate[];
}

export interface AnalyticsRequest {
  readonly schemaVersion: "1.0";
  readonly requestId: string;
  readonly analysisId: string;
  readonly symbol: string;
  readonly analysisTime: IsoTimestamp;
  readonly serverTime: IsoTimestamp;
  readonly candles: readonly CandleSeries[];
  readonly orderBook: OrderBookSnapshot;
  readonly config: AnalyticsConfig;
}

export interface AnalyticsConfig {
  readonly atrPeriod: number;
  readonly emaFastPeriod: number;
  readonly emaSlowPeriod: number;
  readonly adxEnabled: boolean;
  readonly adxPeriod: number;
  readonly rsiEnabled: boolean;
  readonly rsiPeriod: number;
  readonly bollingerEnabled: boolean;
  readonly bollingerPeriod: number;
  readonly bollingerStddev: DecimalString;
  readonly swingPivotLeft: number;
  readonly swingPivotRight: number;
  readonly compactTail: Readonly<Record<Timeframe, number>>;
  readonly expectedCounts: Readonly<Record<Timeframe, number>>;
}

export interface AnalyticsResponse {
  readonly schemaVersion: "1.1";
  readonly requestId: string;
  readonly analysisId: string;
  readonly generatedAt: IsoTimestamp;
  readonly acceptable: boolean;
  readonly rejectionReasons: readonly string[];
  readonly features: Readonly<Record<string, unknown>>;
  readonly chart: AnalysisChartArtifact | null;
}

export interface AnalysisChartArtifact {
  readonly rendererVersion: "completed-candles-ema-atr-v1";
  readonly mimeType: "image/png";
  readonly width: 1600;
  readonly height: 1200;
  readonly sha256: string;
  readonly dataBase64: string;
  readonly completedCandlesOnly: true;
  readonly candleCounts: Readonly<Record<Timeframe, number>>;
  readonly latestEndTimes: Readonly<Record<Timeframe, IsoTimestamp>>;
}

export interface PerformanceOutcome {
  readonly netPnl: DecimalString;
  readonly closedAt: IsoTimestamp;
}

export interface PerformanceSummary {
  readonly sample_size: number;
  readonly wins: number;
  readonly losses: number;
  readonly win_rate: DecimalString | null;
  readonly loss_rate: DecimalString | null;
  readonly profit_factor: DecimalString | null;
  readonly expectancy: DecimalString | null;
  readonly average_win: DecimalString | null;
  readonly average_loss: DecimalString | null;
  readonly realized_pnl: DecimalString;
  readonly drawdown: DecimalString;
  readonly consecutive_wins: number;
  readonly consecutive_losses: number;
}

export interface ModelOrderProposal {
  readonly trigger_price: DecimalString;
  readonly entry_price: DecimalString;
  readonly stop_loss: DecimalString;
  readonly take_profit: DecimalString;
  readonly risk_reward_ratio: DecimalString;
  readonly expires_at: IsoTimestamp;
  readonly invalidation_price: DecimalString;
}

export interface ModelResponse {
  readonly schema_version: "2.1";
  readonly analysis_id: string;
  readonly symbol: string;
  readonly generated_at: IsoTimestamp;
  readonly valid_until: IsoTimestamp;
  readonly market_regime:
    "TRENDING" | "RANGING" | "BREAKOUT" | "VOLATILE" | "QUIET" | "UNCERTAIN";
  readonly technical_map: {
    readonly decision_zone: TechnicalZone;
    readonly resistance_zones: readonly TechnicalZone[];
    readonly support_zones: readonly TechnicalZone[];
    readonly bullish_confirmation: {
      readonly price: DecimalString;
      readonly condition_code: "BUFFERED_BREAKOUT_ABOVE_RESISTANCE";
    };
    readonly bearish_confirmation: {
      readonly price: DecimalString;
      readonly condition_code: "BUFFERED_BREAKDOWN_BELOW_SUPPORT";
    };
    readonly upside_targets: readonly DecimalString[];
    readonly downside_targets: readonly DecimalString[];
  };
  readonly waiting_area: {
    readonly lower: DecimalString;
    readonly upper: DecimalString;
    readonly description_code: string;
  };
  readonly buy_stop: ModelOrderProposal;
  readonly sell_stop: ModelOrderProposal;
  readonly confidence: {
    readonly overall: number;
    readonly buy: number;
    readonly sell: number;
    readonly original_overall: number;
    readonly original_buy: number;
    readonly original_sell: number;
  };
  readonly setup_tags: readonly string[];
  readonly evidence_codes: readonly string[];
  readonly risk_flags: readonly string[];
  readonly performance_adjustment: {
    readonly applied: boolean;
    readonly confidence_delta: number;
    readonly reason_codes: readonly string[];
  };
  readonly data_quality: {
    readonly warnings: readonly string[];
  };
}

export interface ModelPromptArtifact {
  readonly version:
    | "system-v2"
    | "system-v3"
    | "system-v4"
    | "system-v5"
    | "system-v6"
    | "system-v7"
    | "system-v8"
    | "system-v9"
    | "system-v10";
  readonly content: string;
  readonly sha256: string;
}

export interface TechnicalZone {
  readonly lower: DecimalString;
  readonly upper: DecimalString;
}

export type SymbolCommissionType =
  | "USD_PER_MILLION_USD"
  | "USD_PER_LOT"
  | "PERCENTAGE_OF_VALUE"
  | "QUOTE_CCY_PER_LOT";

export interface SymbolCommissionMetadata {
  /** Broker rate in the units named by `type`. */
  readonly type: SymbolCommissionType;
  readonly rate: DecimalString;
  /** Minimum one-way commission before conversion into account currency. */
  readonly minimum: DecimalString;
  readonly minimumType: "CURRENCY" | "QUOTE_CURRENCY";
  readonly minimumAsset: string;
  /** Percent of positive realized gross P/L (for example `0.01` = 0.01%). */
  readonly pnlConversionFeeRate: DecimalString;
}

export interface SymbolMetadata {
  readonly symbolId: string;
  readonly symbolName: string;
  readonly digits: number;
  readonly pipPosition: number;
  readonly pipSize: DecimalString;
  readonly tickSize: DecimalString;
  readonly tickValue: DecimalString;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly accountAsset: string;
  readonly quoteToAccountConversionRate: DecimalString;
  readonly contractSize: DecimalString;
  /** Base units represented by one broker-native volume integer. */
  readonly volumeScale: DecimalString;
  readonly minVolume: DecimalString;
  readonly maxVolume: DecimalString;
  readonly volumeStep: DecimalString;
  readonly minStopDistance: DecimalString;
  readonly commission: SymbolCommissionMetadata;
  readonly metadataTime: IsoTimestamp;
}

export interface Quote {
  readonly bid: DecimalString;
  readonly ask: DecimalString;
  readonly sourceTime: IsoTimestamp;
  readonly receivedAt: IsoTimestamp;
}

export type OpenPositionMonitor =
  | { readonly status: "NONE" }
  | {
      readonly status: "AVAILABLE";
      readonly executionState: "NORMAL" | "RECONCILIATION_REQUIRED";
      readonly side: OrderSide;
      readonly accountCurrency: string;
      readonly bid: DecimalString;
      readonly ask: DecimalString;
      readonly markPrice: DecimalString;
      readonly grossUnrealizedPnl: DecimalString;
      readonly netUnrealizedPnl: DecimalString;
      readonly recordedCommission: DecimalString;
      readonly quoteSourceTime: IsoTimestamp;
      readonly quoteReceivedAt: IsoTimestamp;
      readonly pnlCapturedAt: IsoTimestamp;
    }
  | { readonly status: "UNAVAILABLE"; readonly reasonCode: string };

export type OrderSide = "BUY" | "SELL";

export interface PendingOrderCommand {
  readonly idempotencyKey: string;
  readonly analysisId: string;
  readonly orderGroupId: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly volume: DecimalString;
  readonly entryPrice: DecimalString;
  readonly stopLoss: DecimalString;
  readonly takeProfit: DecimalString;
  readonly expiresAt: IsoTimestamp;
  readonly strategyLabel: string;
}

export type GatewayKind = "paper" | "ctrader-demo" | "shadow" | "ctrader-live";
export type ExternalOrderState =
  | "PENDING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED"
  | "UNKNOWN";

export interface GatewayOrder {
  readonly clientOrderId: string;
  readonly brokerOrderId: string | null;
  readonly state: ExternalOrderState;
  readonly filledVolume: DecimalString;
  readonly updatedAt: IsoTimestamp;
  readonly reasonCode: string | null;
}

export interface OcoPlacementResult {
  readonly orderGroupId: string;
  readonly idempotentReplay: boolean;
  readonly orders: readonly GatewayOrder[];
}

export interface ReconciliationSnapshot {
  readonly asOf: IsoTimestamp;
  readonly certain: boolean;
  readonly reasonCodes: readonly string[];
  readonly orders: readonly GatewayOrder[];
  readonly relevantPositionCount: number;
}

export interface ExecutionGateway {
  readonly kind: GatewayKind;
  readonly canSubmitToBroker: boolean;
  placeOco(
    commands: readonly [PendingOrderCommand, PendingOrderCommand],
  ): Promise<OcoPlacementResult>;
  cancelStrategyOrder(
    clientOrderId: string,
    reasonCode: string,
  ): Promise<GatewayOrder>;
  reconcile(symbol: string): Promise<ReconciliationSnapshot>;
}

export interface MarketDataAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getServerTime(): Promise<IsoTimestamp>;
  discoverSymbol(symbol: string): Promise<SymbolMetadata>;
  getCompletedCandles(
    symbolId: string,
    timeframe: Timeframe,
    count: number,
  ): Promise<readonly Candle[]>;
  getOrderBookSnapshot(
    symbolId: string,
    depth: number,
  ): Promise<OrderBookSnapshot>;
  getQuote(symbolId: string): Promise<Quote>;
}

export interface MarketSnapshot {
  readonly serverTime: IsoTimestamp;
  readonly capturedAt: IsoTimestamp;
  readonly observedSkewMs: number;
  readonly metadata: SymbolMetadata;
  readonly quote: Quote;
  readonly candles: readonly CandleSeries[];
  readonly orderBook: OrderBookSnapshot;
}

export interface AccountState {
  readonly reconciledAt: IsoTimestamp;
  readonly certain: boolean;
  readonly equity: DecimalString;
  readonly balance: DecimalString;
  readonly availableMargin: DecimalString;
  readonly relevantPositionCount: number;
  readonly relevantPendingOrderCount: number;
  readonly hasPartialFill: boolean;
  readonly hasCancellationPending: boolean;
  readonly reasonCodes: readonly string[];
}

export interface AccountAdapter {
  authenticate(): Promise<void>;
  reconcile(symbolId: string): Promise<AccountState>;
}
