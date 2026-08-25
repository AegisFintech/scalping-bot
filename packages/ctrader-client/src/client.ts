import { Decimal } from "decimal.js";

import type {
  AccountAdapter,
  AccountState,
  Candle,
  MarketDataAdapter,
  OrderBookSnapshot,
  PendingOrderCommand,
  Quote,
  SymbolMetadata,
  Timeframe,
} from "../../contracts/src/index.js";
import { canonical } from "../../risk-engine/src/decimal.js";
import { CTraderDepthBook, type DepthAggregate } from "./depth-book.js";
import {
  CTraderPayload,
  exactProtocolDouble,
  numberField,
  optionalNumberField,
  optionalStringField,
  protocolInteger,
  protocolPrice,
  record,
  recordsField,
  stringField,
  type CTraderEnvelope,
} from "./protocol.js";
import type { CTraderTokenManager } from "./token-manager.js";
import { CTraderJsonTransport } from "./transport.js";
import type { CTraderTransportOptions } from "./transport.js";
import {
  markBrokerSessionGaps,
  type WeeklyTradingSchedule,
  weeklyTradingSchedule,
} from "./trading-schedule.js";

const PERIOD: Readonly<
  Record<Timeframe, { code: number; milliseconds: number }>
> = {
  M1: { code: 1, milliseconds: 60_000 },
  M5: { code: 5, milliseconds: 300_000 },
  M15: { code: 7, milliseconds: 900_000 },
};

export interface CTraderClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accountId?: string;
  readonly connectionMode: "demo" | "live";
  readonly allowOrderCommands?: boolean;
  readonly tokenManager: CTraderTokenManager;
  readonly transport?: CTraderJsonTransport;
  readonly transportOptions?: CTraderTransportOptions;
  readonly orderBookTimeoutMs?: number;
  readonly conversionRate?: (
    quoteAssetId: string,
    depositAssetId: string,
    at: Date,
  ) => Promise<string>;
}

export interface RawReconciliation {
  readonly receivedAt: string;
  readonly positions: readonly Record<string, unknown>[];
  readonly orders: readonly Record<string, unknown>[];
}

export interface RawOrderHistory {
  readonly receivedAt: string;
  readonly orders: readonly Record<string, unknown>[];
  readonly hasMore: boolean;
}

export interface RawDealHistory {
  readonly receivedAt: string;
  readonly deals: readonly Record<string, unknown>[];
  readonly hasMore: boolean;
}

export interface BrokerExecution {
  readonly executionType: number;
  readonly order: Record<string, unknown> | null;
  readonly position: Record<string, unknown> | null;
  readonly deal: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly receivedAt: string;
}

export interface ExpectedMargin {
  readonly volume: string;
  readonly buyMargin: string;
  readonly sellMargin: string;
}

export interface PositionUnrealizedPnl {
  readonly grossUnrealizedPnl: string;
  readonly netUnrealizedPnl: string;
  readonly capturedAt: string;
}

export interface ExternalCashFlowSummary {
  readonly netFlows: string;
  readonly operationCount: number;
  readonly from: string;
  readonly to: string;
}

export interface DealHistorySummary {
  readonly dealCount: number;
  readonly hasMore: boolean;
  readonly from: string;
  readonly to: string;
}

export function normalizeDealHistory(
  items: readonly Record<string, unknown>[],
  hasMoreValue: unknown,
  from: Date,
  to: Date,
): DealHistorySummary {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    toMs < fromMs ||
    toMs - fromMs > 604_800_000
  ) {
    throw new Error("CTRADER_DEAL_HISTORY_RANGE_INVALID");
  }
  if (hasMoreValue !== undefined && typeof hasMoreValue !== "boolean") {
    throw new Error("CTRADER_DEAL_HISTORY_HAS_MORE_INVALID");
  }
  return {
    dealCount: items.length,
    hasMore: hasMoreValue ?? false,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

const KNOWN_BALANCE_OPERATIONS = new Set([
  0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
]);

// Capital movements alter the equity baseline; trading income, charges, swaps,
// rebates, dividends, and commissions remain part of account performance.
const EXTERNAL_BALANCE_OPERATIONS = new Set([
  0, 1, 19, 20, 30, 31, 32, 33, 36, 37, 38, 39,
]);

type ExecutionHandler = (execution: BrokerExecution) => void;
type SynchronizationHandler = () => void;

interface QuoteState {
  bid?: string | undefined;
  ask?: string | undefined;
  sourceTime?: string | undefined;
  receivedAt?: string | undefined;
}

function ensureInteger(value: string, reason: string): string {
  if (!/^\d+$/.test(value)) throw new Error(reason);
  return value;
}

function unixDate(value: number): Date {
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime()))
    throw new Error("CTRADER_TIMESTAMP_INVALID");
  return date;
}

function money(value: unknown, digits: number): Decimal {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+$/.test(String(value))
  ) {
    throw new Error("CTRADER_MONEY_INVALID");
  }
  return new Decimal(String(value)).div(new Decimal(10).pow(digits));
}

export function normalizePositionUnrealizedPnl(
  payload: Record<string, unknown>,
  brokerPositionId: string,
  capturedAt = new Date(),
): PositionUnrealizedPnl {
  ensureInteger(brokerPositionId, "CTRADER_POSITION_ID_INVALID");
  if (!Number.isFinite(capturedAt.getTime()))
    throw new Error("CTRADER_POSITION_PNL_TIMESTAMP_INVALID");
  const digits = numberField(payload, "moneyDigits");
  if (!Number.isInteger(digits) || digits < 0 || digits > 12)
    throw new Error("CTRADER_POSITION_PNL_MONEY_DIGITS_INVALID");
  const matches = recordsField(payload, "positionUnrealizedPnL").filter(
    (row) => stringField(row, "positionId") === brokerPositionId,
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length === 0
        ? "CTRADER_POSITION_PNL_MISSING"
        : "CTRADER_POSITION_PNL_AMBIGUOUS",
    );
  const row = matches[0]!;
  return {
    grossUnrealizedPnl: canonical(
      money(stringField(row, "grossUnrealizedPnL"), digits),
    ),
    netUnrealizedPnl: canonical(
      money(stringField(row, "netUnrealizedPnL"), digits),
    ),
    capturedAt: capturedAt.toISOString(),
  };
}

export function normalizeExternalCashFlows(
  items: readonly Record<string, unknown>[],
  from: Date,
  to: Date,
): ExternalCashFlowSummary {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    toMs < fromMs ||
    toMs - fromMs > 604_800_000
  ) {
    throw new Error("CTRADER_CASH_FLOW_RANGE_INVALID");
  }
  const identifiers = new Set<string>();
  let netFlows = new Decimal(0);
  let operationCount = 0;
  for (const item of items) {
    const identifier = stringField(item, "balanceHistoryId");
    if (identifiers.has(identifier))
      throw new Error("CTRADER_CASH_FLOW_DUPLICATE");
    identifiers.add(identifier);
    const timestamp = numberField(item, "changeBalanceTimestamp");
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < fromMs ||
      timestamp > toMs
    ) {
      throw new Error("CTRADER_CASH_FLOW_TIMESTAMP_INVALID");
    }
    const operationType = numberField(item, "operationType");
    if (
      !Number.isSafeInteger(operationType) ||
      !KNOWN_BALANCE_OPERATIONS.has(operationType)
    ) {
      throw new Error("CTRADER_CASH_FLOW_TYPE_UNKNOWN");
    }
    const digits = optionalNumberField(item, "moneyDigits");
    if (
      digits === undefined ||
      !Number.isSafeInteger(digits) ||
      digits < 0 ||
      digits > 12
    ) {
      throw new Error("CTRADER_CASH_FLOW_MONEY_DIGITS_INVALID");
    }
    if (EXTERNAL_BALANCE_OPERATIONS.has(operationType)) {
      netFlows = netFlows.plus(money(item.delta, digits));
      operationCount += 1;
    }
  }
  return {
    netFlows: canonical(netFlows),
    operationCount,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function tradeData(entity: Record<string, unknown>): Record<string, unknown> {
  return record(entity.tradeData, "CTRADER_TRADE_DATA_INVALID");
}

export class CTraderClient implements MarketDataAdapter, AccountAdapter {
  readonly #options: CTraderClientOptions;
  readonly #transport: CTraderJsonTransport;
  readonly #quotes = new Map<string, QuoteState>();
  readonly #books = new Map<string, CTraderDepthBook>();
  readonly #metadata = new Map<string, SymbolMetadata>();
  readonly #schedules = new Map<string, WeeklyTradingSchedule>();
  readonly #subscribedSpots = new Set<string>();
  readonly #subscribedDepth = new Set<string>();
  readonly #executionHandlers = new Set<ExecutionHandler>();
  readonly #synchronizationHandlers = new Set<SynchronizationHandler>();
  #accountId: string | null = null;
  #depositAssetId: string | null = null;
  #permissionScope: number | null = null;
  #authenticated = false;
  #lastServerTime: Date | null = null;

  constructor(options: CTraderClientOptions) {
    this.#options = options;
    this.#transport =
      options.transport ??
      new CTraderJsonTransport(
        options.transportOptions ?? {
          host:
            options.connectionMode === "live"
              ? "live.ctraderapi.com"
              : "demo.ctraderapi.com",
          port: 5036,
        },
      );
    this.#transport.onMessage((message) => this.#handleMessage(message));
    this.#transport.setReconnectHandler(async () => {
      this.#authenticated = false;
      for (const book of this.#books.values()) book.markReconnect();
      const spots = [...this.#subscribedSpots];
      const depths = [...this.#subscribedDepth];
      this.#subscribedSpots.clear();
      this.#subscribedDepth.clear();
      await this.#authorize();
      for (const symbolId of spots) await this.#subscribeSpot(symbolId);
      for (const symbolId of depths) await this.#subscribeDepth(symbolId);
      await this.reconcileRaw();
      for (const handler of this.#synchronizationHandlers) handler();
    });
  }

  get accountId(): string {
    if (this.#accountId === null)
      throw new Error("CTRADER_ACCOUNT_NOT_SELECTED");
    return this.#accountId;
  }

  get tokenExpiryKnown(): boolean {
    return this.#options.tokenManager.expiryKnown;
  }

  get tradePermission(): boolean {
    return this.#permissionScope === 1;
  }

  async externalCashFlows(
    from: Date,
    to: Date,
  ): Promise<ExternalCashFlowSummary> {
    this.#requireAuthenticated();
    const response = await this.#transport.request(
      CTraderPayload.CASH_FLOW_HISTORY_LIST_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        fromTimestamp: from.getTime(),
        toTimestamp: to.getTime(),
      },
      [CTraderPayload.CASH_FLOW_HISTORY_LIST_RES],
    );
    return normalizeExternalCashFlows(
      recordsField(response.payload, "depositWithdraw"),
      from,
      to,
    );
  }

  async dealHistory(
    from: Date,
    to: Date,
    maxRows = 1,
  ): Promise<DealHistorySummary> {
    const response = await this.dealHistoryRaw(from, to, maxRows);
    return normalizeDealHistory(response.deals, response.hasMore, from, to);
  }

  async dealHistoryRaw(
    from: Date,
    to: Date,
    maxRows = 1_000,
  ): Promise<RawDealHistory> {
    this.#requireAuthenticated();
    normalizeDealHistory([], false, from, to);
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1_000)
      throw new Error("CTRADER_DEAL_HISTORY_MAX_ROWS_INVALID");
    const response = await this.#transport.request(
      CTraderPayload.DEAL_LIST_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        fromTimestamp: from.getTime(),
        toTimestamp: to.getTime(),
        maxRows,
      },
      [CTraderPayload.DEAL_LIST_RES],
    );
    if (typeof response.payload.hasMore !== "boolean")
      throw new Error("CTRADER_DEAL_HISTORY_HAS_MORE_INVALID");
    return {
      receivedAt: new Date().toISOString(),
      deals: recordsField(response.payload, "deal"),
      hasMore: response.payload.hasMore,
    };
  }

  async orderHistoryRaw(from: Date, to: Date): Promise<RawOrderHistory> {
    this.#requireAuthenticated();
    normalizeDealHistory([], false, from, to);
    const response = await this.#transport.request(
      CTraderPayload.ORDER_LIST_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        fromTimestamp: from.getTime(),
        toTimestamp: to.getTime(),
      },
      [CTraderPayload.ORDER_LIST_RES],
    );
    if (typeof response.payload.hasMore !== "boolean")
      throw new Error("CTRADER_ORDER_HISTORY_HAS_MORE_INVALID");
    return {
      receivedAt: new Date().toISOString(),
      orders: recordsField(response.payload, "order"),
      hasMore: response.payload.hasMore,
    };
  }

  onExecution(handler: ExecutionHandler): () => void {
    this.#executionHandlers.add(handler);
    return () => this.#executionHandlers.delete(handler);
  }

  onSynchronization(handler: SynchronizationHandler): () => void {
    this.#synchronizationHandlers.add(handler);
    return () => this.#synchronizationHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    await this.#transport.connect();
    await this.#authorize();
  }

  authenticate(): Promise<void> {
    return this.connect();
  }

  async disconnect(): Promise<void> {
    this.#authenticated = false;
    await this.#transport.close();
  }

  async #authorize(): Promise<void> {
    await this.#transport.request(
      CTraderPayload.APPLICATION_AUTH_REQ,
      {
        clientId: this.#options.clientId,
        clientSecret: this.#options.clientSecret,
      },
      [CTraderPayload.APPLICATION_AUTH_RES],
    );
    const accessToken = await this.#options.tokenManager.accessToken();
    const accounts = await this.#transport.request(
      CTraderPayload.GET_ACCOUNTS_REQ,
      { accessToken },
      [CTraderPayload.GET_ACCOUNTS_RES],
    );
    this.#permissionScope =
      optionalNumberField(accounts.payload, "permissionScope") ?? null;
    const candidates = recordsField(
      accounts.payload,
      "ctidTraderAccount",
    ).filter((account) => {
      const live = account.isLive;
      if (typeof live !== "boolean")
        throw new Error("CTRADER_ACCOUNT_ENVIRONMENT_UNKNOWN");
      return live === (this.#options.connectionMode === "live");
    });
    const configured = this.#options.accountId;
    const selected =
      configured === undefined || configured.length === 0
        ? candidates.length === 1
          ? candidates[0]
          : undefined
        : candidates.find(
            (account) =>
              stringField(account, "ctidTraderAccountId") === configured,
          );
    if (selected === undefined) {
      throw new Error(
        configured
          ? "CTRADER_ACCOUNT_NOT_FOUND_IN_ENVIRONMENT"
          : "CTRADER_ACCOUNT_AMBIGUOUS",
      );
    }
    this.#accountId = stringField(selected, "ctidTraderAccountId");
    await this.#transport.request(
      CTraderPayload.ACCOUNT_AUTH_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.#accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        accessToken,
      },
      [CTraderPayload.ACCOUNT_AUTH_RES],
    );
    const trader = await this.#trader();
    this.#depositAssetId = stringField(trader, "depositAssetId");
    this.#authenticated = true;
  }

  async #trader(): Promise<Record<string, unknown>> {
    const response = await this.#transport.request(
      CTraderPayload.TRADER_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
      },
      [CTraderPayload.TRADER_RES],
    );
    return record(response.payload.trader, "CTRADER_TRADER_INVALID");
  }

  getServerTime(): Promise<string> {
    if (this.#lastServerTime === null)
      return Promise.reject(new Error("CTRADER_SERVER_TIME_UNAVAILABLE"));
    return Promise.resolve(this.#lastServerTime.toISOString());
  }

  async discoverSymbol(symbolName: string): Promise<SymbolMetadata> {
    this.#requireAuthenticated();
    const list = await this.#transport.request(
      CTraderPayload.SYMBOLS_LIST_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        includeArchivedSymbols: false,
      },
      [CTraderPayload.SYMBOLS_LIST_RES],
    );
    const light = recordsField(list.payload, "symbol").find(
      (candidate) =>
        optionalStringField(candidate, "symbolName")?.toUpperCase() ===
        symbolName.toUpperCase(),
    );
    if (light === undefined) throw new Error("CTRADER_SYMBOL_NOT_FOUND");
    const symbolId = stringField(light, "symbolId");
    const detail = await this.#transport.request(
      CTraderPayload.SYMBOL_BY_ID_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        symbolId: [protocolInteger(symbolId, "CTRADER_SYMBOL_ID_INVALID")],
      },
      [CTraderPayload.SYMBOL_BY_ID_RES],
    );
    const full = recordsField(detail.payload, "symbol").find(
      (candidate) => stringField(candidate, "symbolId") === symbolId,
    );
    if (full === undefined) throw new Error("CTRADER_SYMBOL_METADATA_MISSING");
    const schedule = weeklyTradingSchedule(
      stringField(full, "scheduleTimeZone"),
      recordsField(full, "schedule").map((interval) => ({
        startSecond: numberField(interval, "startSecond"),
        endSecond: numberField(interval, "endSecond"),
      })),
    );
    const digits = numberField(full, "digits");
    if (!Number.isSafeInteger(digits) || digits < 0 || digits > 10)
      throw new Error("CTRADER_SYMBOL_DIGITS_INVALID");
    const tradingMode = optionalNumberField(full, "tradingMode") ?? 0;
    if (tradingMode !== 0) throw new Error("CTRADER_SYMBOL_TRADING_DISABLED");
    const distanceType = optionalNumberField(full, "distanceSetIn") ?? 1;
    if (distanceType !== 1)
      throw new Error("CTRADER_PERCENTAGE_STOP_DISTANCE_UNSUPPORTED");
    const depositAssetId = this.#depositAssetId;
    if (depositAssetId === null)
      throw new Error("CTRADER_DEPOSIT_ASSET_UNKNOWN");
    const quoteAssetId = stringField(light, "quoteAssetId");
    const conversion =
      quoteAssetId === depositAssetId
        ? "1"
        : await this.#options.conversionRate?.(
            quoteAssetId,
            depositAssetId,
            new Date(),
          );
    if (conversion === undefined || new Decimal(conversion).lte(0)) {
      throw new Error("CTRADER_QUOTE_TO_DEPOSIT_RATE_UNAVAILABLE");
    }
    const tickSize = new Decimal(10).pow(-digits);
    // cTrader expresses both order volume and lotSize in hundredths of a base
    // unit. One broker-native volume integer therefore represents 0.01 base
    // units; contractSize is the separately reported base units per lot.
    const volumeScale = new Decimal("0.01");
    const metadata: SymbolMetadata = {
      symbolId,
      symbolName: stringField(light, "symbolName"),
      digits,
      tickSize: canonical(tickSize),
      tickValue: canonical(tickSize.mul(volumeScale).mul(conversion)),
      contractSize: canonical(
        new Decimal(stringField(full, "lotSize")).div(100),
      ),
      volumeScale: canonical(volumeScale),
      minVolume: ensureInteger(
        stringField(full, "minVolume"),
        "CTRADER_MIN_VOLUME_INVALID",
      ),
      maxVolume: ensureInteger(
        stringField(full, "maxVolume"),
        "CTRADER_MAX_VOLUME_INVALID",
      ),
      volumeStep: ensureInteger(
        stringField(full, "stepVolume"),
        "CTRADER_VOLUME_STEP_INVALID",
      ),
      minStopDistance: canonical(
        tickSize.mul(optionalNumberField(full, "slDistance") ?? 0),
      ),
      metadataTime: new Date().toISOString(),
    };
    this.#metadata.set(symbolId, metadata);
    this.#schedules.set(symbolId, schedule);
    return metadata;
  }

  async getQuote(symbolId: string): Promise<Quote> {
    await this.#subscribeSpot(symbolId);
    const quote = await this.#waitFor(
      () => {
        const value = this.#quotes.get(symbolId);
        return value?.bid !== undefined &&
          value.ask !== undefined &&
          value.sourceTime !== undefined &&
          value.receivedAt !== undefined
          ? value
          : null;
      },
      this.#options.orderBookTimeoutMs ?? 3_000,
      "CTRADER_QUOTE_TIMEOUT",
    );
    return {
      bid: quote.bid as string,
      ask: quote.ask as string,
      sourceTime: quote.sourceTime as string,
      receivedAt: quote.receivedAt as string,
    };
  }

  async getOrderBookSnapshot(
    symbolId: string,
    depth: number,
  ): Promise<OrderBookSnapshot> {
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > 100)
      throw new Error("CTRADER_DEPTH_INVALID");
    await this.#subscribeSpot(symbolId);
    await this.#subscribeDepth(symbolId);
    return this.#waitFor(
      () => {
        try {
          const snapshot = this.#books.get(symbolId)?.snapshot(depth);
          return snapshot?.complete === true && !snapshot.discontinuity
            ? snapshot
            : null;
        } catch {
          return null;
        }
      },
      this.#options.orderBookTimeoutMs ?? 3_000,
      "CTRADER_DEPTH_TIMEOUT",
    );
  }

  depthAggregates(
    symbolId: string,
    now = Date.now(),
  ): readonly DepthAggregate[] {
    const book = this.#books.get(symbolId);
    if (book === undefined) throw new Error("CTRADER_DEPTH_UNAVAILABLE");
    return ([60_000, 300_000, 900_000] as const).map((window) =>
      book.aggregate(window, now),
    );
  }

  async getCompletedCandles(
    symbolId: string,
    timeframe: Timeframe,
    count: number,
  ): Promise<readonly Candle[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 5_000)
      throw new Error("CTRADER_CANDLE_COUNT_INVALID");
    const server = new Date(await this.getServerTime()).getTime();
    const period = PERIOD[timeframe];
    const completedBoundary =
      Math.floor(server / period.milliseconds) * period.milliseconds;
    const response = await this.#transport.request(
      CTraderPayload.GET_TRENDBARS_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        fromTimestamp: Math.max(
          0,
          completedBoundary - count * period.milliseconds * 3,
        ),
        toTimestamp: completedBoundary - 1,
        period: period.code,
        symbolId: protocolInteger(symbolId, "CTRADER_SYMBOL_ID_INVALID"),
        count,
      },
      [CTraderPayload.GET_TRENDBARS_RES],
    );
    const candles = recordsField(response.payload, "trendbar")
      .map((bar): Candle => {
        const start = numberField(bar, "utcTimestampInMinutes") * 60_000;
        const lowRelative = new Decimal(stringField(bar, "low"));
        const price = (delta: string): string =>
          canonical(lowRelative.plus(delta).div(100_000));
        return {
          startTime: new Date(start).toISOString(),
          endTime: new Date(start + period.milliseconds).toISOString(),
          open: price(stringField(bar, "deltaOpen")),
          high: price(stringField(bar, "deltaHigh")),
          low: canonical(lowRelative.div(100_000)),
          close: price(stringField(bar, "deltaClose")),
          volume: stringField(bar, "volume"),
          complete: start + period.milliseconds <= completedBoundary,
          qualityFlags: [],
        };
      })
      .filter((bar) => bar.complete)
      .sort(
        (left, right) =>
          Date.parse(left.startTime) - Date.parse(right.startTime),
      )
      .slice(-count);
    if (candles.length !== count)
      throw new Error("CTRADER_COMPLETED_CANDLES_INSUFFICIENT");
    const schedule = this.#schedules.get(symbolId);
    if (schedule === undefined)
      throw new Error("CTRADER_SYMBOL_SCHEDULE_UNAVAILABLE");
    return markBrokerSessionGaps(candles, period.milliseconds, schedule);
  }

  async expectedMargin(
    symbolId: string,
    volumes: readonly string[],
  ): Promise<readonly ExpectedMargin[]> {
    if (volumes.length === 0 || volumes.length > 100)
      throw new Error("CTRADER_MARGIN_VOLUMES_INVALID");
    const response = await this.#transport.request(
      CTraderPayload.EXPECTED_MARGIN_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        symbolId: protocolInteger(symbolId, "CTRADER_SYMBOL_ID_INVALID"),
        volume: volumes.map((volume) =>
          protocolInteger(volume, "CTRADER_MARGIN_VOLUME_INVALID"),
        ),
      },
      [CTraderPayload.EXPECTED_MARGIN_RES],
    );
    const digits = numberField(response.payload, "moneyDigits");
    return recordsField(response.payload, "margin").map((margin) => ({
      volume: stringField(margin, "volume"),
      buyMargin: canonical(money(stringField(margin, "buyMargin"), digits)),
      sellMargin: canonical(money(stringField(margin, "sellMargin"), digits)),
    }));
  }

  async placeStop(command: PendingOrderCommand): Promise<BrokerExecution> {
    this.#requireTradingReady();
    const metadata = [...this.#metadata.values()].find(
      (item) => item.symbolName === command.symbol,
    );
    if (metadata === undefined)
      throw new Error("CTRADER_ORDER_SYMBOL_METADATA_MISSING");
    const response = await this.#transport.request(
      CTraderPayload.NEW_ORDER_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        symbolId: protocolInteger(
          metadata.symbolId,
          "CTRADER_SYMBOL_ID_INVALID",
        ),
        orderType: 3,
        tradeSide: command.side === "BUY" ? 1 : 2,
        volume: protocolInteger(command.volume, "CTRADER_ORDER_VOLUME_INVALID"),
        stopPrice: exactProtocolDouble(command.entryPrice, metadata.digits),
        timeInForce: 1,
        expirationTimestamp: Date.parse(command.expiresAt),
        stopLoss: exactProtocolDouble(command.stopLoss, metadata.digits),
        takeProfit: exactProtocolDouble(command.takeProfit, metadata.digits),
        label: command.strategyLabel.slice(0, 100),
        clientOrderId: command.clientOrderId.slice(0, 50),
        stopTriggerMethod: 1,
      },
      [CTraderPayload.EXECUTION_EVENT],
    );
    return this.#parseExecution(response);
  }

  async cancelOrder(brokerOrderId: string): Promise<BrokerExecution> {
    this.#requireTradingReady();
    const response = await this.#transport.request(
      CTraderPayload.CANCEL_ORDER_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        orderId: protocolInteger(brokerOrderId, "CTRADER_ORDER_ID_INVALID"),
      },
      [CTraderPayload.EXECUTION_EVENT],
    );
    return this.#parseExecution(response);
  }

  async reconcileRaw(): Promise<RawReconciliation> {
    this.#requireAuthenticated();
    const response = await this.#transport.request(
      CTraderPayload.RECONCILE_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        returnProtectionOrders: false,
      },
      [CTraderPayload.RECONCILE_RES],
    );
    return {
      receivedAt: new Date().toISOString(),
      positions: recordsField(response.payload, "position"),
      orders: recordsField(response.payload, "order"),
    };
  }

  async reconcile(symbolId: string): Promise<AccountState> {
    const [raw, trader, pnl] = await Promise.all([
      this.reconcileRaw(),
      this.#trader(),
      this.#transport.request(
        CTraderPayload.POSITION_UNREALIZED_PNL_REQ,
        {
          ctidTraderAccountId: protocolInteger(
            this.accountId,
            "CTRADER_ACCOUNT_ID_INVALID",
          ),
        },
        [CTraderPayload.POSITION_UNREALIZED_PNL_RES],
      ),
    ]);
    const moneyDigits = numberField(trader, "moneyDigits");
    const balance = money(stringField(trader, "balance"), moneyDigits);
    const pnlDigits = numberField(pnl.payload, "moneyDigits");
    const unrealized = recordsField(
      pnl.payload,
      "positionUnrealizedPnL",
    ).reduce(
      (total, row) =>
        total.plus(money(stringField(row, "netUnrealizedPnL"), pnlDigits)),
      new Decimal(0),
    );
    const positions = raw.positions.filter(
      (position) => stringField(tradeData(position), "symbolId") === symbolId,
    );
    const orders = raw.orders.filter(
      (order) => stringField(tradeData(order), "symbolId") === symbolId,
    );
    const usedMargin = raw.positions.reduce((total, position) => {
      const value = optionalStringField(position, "usedMargin");
      const digits = optionalNumberField(position, "moneyDigits");
      if (value === undefined || digits === undefined)
        throw new Error("CTRADER_USED_MARGIN_UNKNOWN");
      return total.plus(money(value, digits));
    }, new Decimal(0));
    const equity = balance.plus(unrealized);
    return {
      reconciledAt: raw.receivedAt,
      certain: true,
      equity: canonical(equity),
      balance: canonical(balance),
      availableMargin: canonical(Decimal.max(0, equity.minus(usedMargin))),
      relevantPositionCount: positions.length,
      relevantPendingOrderCount: orders.length,
      hasPartialFill: orders.some((order) =>
        new Decimal(optionalStringField(order, "executedVolume") ?? 0).gt(0),
      ),
      hasCancellationPending: false,
      reasonCodes: [],
    };
  }

  async positionUnrealizedPnl(
    brokerPositionId: string,
  ): Promise<PositionUnrealizedPnl> {
    this.#requireAuthenticated();
    const response = await this.#transport.request(
      CTraderPayload.POSITION_UNREALIZED_PNL_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
      },
      [CTraderPayload.POSITION_UNREALIZED_PNL_RES],
    );
    return normalizePositionUnrealizedPnl(
      response.payload,
      brokerPositionId,
      new Date(),
    );
  }

  async #subscribeSpot(symbolId: string): Promise<void> {
    this.#requireAuthenticated();
    if (this.#subscribedSpots.has(symbolId)) return;
    await this.#transport.request(
      CTraderPayload.SUBSCRIBE_SPOTS_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        symbolId: [protocolInteger(symbolId, "CTRADER_SYMBOL_ID_INVALID")],
        subscribeToSpotTimestamp: true,
      },
      [CTraderPayload.SUBSCRIBE_SPOTS_RES],
    );
    this.#subscribedSpots.add(symbolId);
  }

  async #subscribeDepth(symbolId: string): Promise<void> {
    if (this.#subscribedDepth.has(symbolId)) return;
    await this.#transport.request(
      CTraderPayload.SUBSCRIBE_DEPTH_REQ,
      {
        ctidTraderAccountId: protocolInteger(
          this.accountId,
          "CTRADER_ACCOUNT_ID_INVALID",
        ),
        symbolId: [protocolInteger(symbolId, "CTRADER_SYMBOL_ID_INVALID")],
      },
      [CTraderPayload.SUBSCRIBE_DEPTH_RES],
    );
    this.#subscribedDepth.add(symbolId);
    this.#books.set(
      symbolId,
      this.#books.get(symbolId) ?? new CTraderDepthBook(),
    );
  }

  #handleMessage(message: CTraderEnvelope): void {
    if (message.payloadType === CTraderPayload.SPOT_EVENT) {
      const symbolId = stringField(message.payload, "symbolId");
      const current = this.#quotes.get(symbolId) ?? {};
      const bid =
        message.payload.bid === undefined
          ? current.bid
          : canonical(protocolPrice(message.payload.bid));
      const ask =
        message.payload.ask === undefined
          ? current.ask
          : canonical(protocolPrice(message.payload.ask));
      const timestamp = optionalNumberField(message.payload, "timestamp");
      const source = timestamp === undefined ? undefined : unixDate(timestamp);
      if (source !== undefined) this.#lastServerTime = source;
      this.#quotes.set(symbolId, {
        bid,
        ask,
        sourceTime: source?.toISOString() ?? current.sourceTime,
        receivedAt: new Date().toISOString(),
      });
    } else if (message.payloadType === CTraderPayload.DEPTH_EVENT) {
      const symbolId = stringField(message.payload, "symbolId");
      const sourceTime = this.#lastServerTime;
      if (sourceTime === null) return;
      const book = this.#books.get(symbolId) ?? new CTraderDepthBook();
      book.apply(message.payload, sourceTime, new Date());
      this.#books.set(symbolId, book);
    } else if (message.payloadType === CTraderPayload.EXECUTION_EVENT) {
      const execution = this.#parseExecution(message);
      for (const handler of this.#executionHandlers) handler(execution);
    }
  }

  #parseExecution(message: CTraderEnvelope): BrokerExecution {
    const order =
      message.payload.order === undefined
        ? null
        : record(message.payload.order, "CTRADER_ORDER_INVALID");
    const position =
      message.payload.position === undefined
        ? null
        : record(message.payload.position, "CTRADER_POSITION_INVALID");
    const deal =
      message.payload.deal === undefined
        ? null
        : record(message.payload.deal, "CTRADER_DEAL_INVALID");
    return {
      executionType: numberField(message.payload, "executionType"),
      order,
      position,
      deal,
      errorCode: optionalStringField(message.payload, "errorCode") ?? null,
      receivedAt: new Date().toISOString(),
    };
  }

  #requireAuthenticated(): void {
    if (!this.#authenticated)
      throw new Error("CTRADER_ACCOUNT_NOT_AUTHENTICATED");
  }

  #requireTradingReady(): void {
    this.#requireAuthenticated();
    if (this.#options.allowOrderCommands !== true)
      throw new Error("CTRADER_ORDER_COMMANDS_DISABLED");
    if (!this.tradePermission)
      throw new Error("CTRADER_TRADE_PERMISSION_REQUIRED");
    if (!this.tokenExpiryKnown) throw new Error("CTRADER_TOKEN_EXPIRY_UNKNOWN");
  }

  async #waitFor<T>(
    factory: () => T | null,
    timeoutMs: number,
    reason: string,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = factory();
      if (value !== null) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(reason);
  }
}
