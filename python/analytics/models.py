from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DECIMAL_PATTERN = re.compile(r"^(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$")
SIGNED_DECIMAL_PATTERN = re.compile(r"^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$")


def parse_decimal_string(value: object) -> Decimal:
    if not isinstance(value, str) or not DECIMAL_PATTERN.fullmatch(value):
        raise ValueError("value must be a canonical non-negative decimal string")
    return Decimal(value)


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class Candle(ApiModel):
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    open: str
    high: str
    low: str
    close: str
    volume: str | None
    complete: bool
    quality_flags: list[str] = Field(alias="qualityFlags", max_length=32)

    @field_validator("start_time", "end_time")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return value

    @field_validator("open", "high", "low", "close")
    @classmethod
    def price_is_decimal(cls, value: str) -> str:
        if parse_decimal_string(value) <= 0:
            raise ValueError("price must be positive")
        return value

    @field_validator("volume")
    @classmethod
    def volume_is_decimal(cls, value: str | None) -> str | None:
        if value is not None:
            parse_decimal_string(value)
        return value

    @model_validator(mode="after")
    def valid_ohlc(self) -> Candle:
        values = {name: Decimal(getattr(self, name)) for name in ("open", "high", "low", "close")}
        if self.end_time <= self.start_time:
            raise ValueError("candle end must follow start")
        if values["high"] < max(values["open"], values["low"], values["close"]):
            raise ValueError("high is below another OHLC value")
        if values["low"] > min(values["open"], values["close"]):
            raise ValueError("low is above open or close")
        return self

    @property
    def open_decimal(self) -> Decimal:
        return Decimal(self.open)

    @property
    def high_decimal(self) -> Decimal:
        return Decimal(self.high)

    @property
    def low_decimal(self) -> Decimal:
        return Decimal(self.low)

    @property
    def close_decimal(self) -> Decimal:
        return Decimal(self.close)


class CandleSeries(ApiModel):
    timeframe: Literal["M1", "M5", "M15"]
    candles: list[Candle] = Field(min_length=1, max_length=1000)


class OrderBookLevel(ApiModel):
    price: str
    size: str

    @field_validator("price")
    @classmethod
    def price_is_decimal(cls, value: str) -> str:
        if parse_decimal_string(value) <= 0:
            raise ValueError("price must be positive")
        return value

    @field_validator("size")
    @classmethod
    def size_is_decimal(cls, value: str) -> str:
        parse_decimal_string(value)
        return value


class OrderBookAggregate(ApiModel):
    window_ms: Literal[60000, 300000, 900000] = Field(alias="windowMs")
    sample_count: int = Field(alias="sampleCount", ge=0)
    bid_liquidity_change: str = Field(alias="bidLiquidityChange")
    ask_liquidity_change: str = Field(alias="askLiquidityChange")
    additions: int = Field(ge=0)
    removals: int = Field(ge=0)

    @field_validator("bid_liquidity_change", "ask_liquidity_change")
    @classmethod
    def change_is_signed_decimal(cls, value: str) -> str:
        if not SIGNED_DECIMAL_PATTERN.fullmatch(value):
            raise ValueError("liquidity change must be a canonical signed decimal string")
        return value


class OrderBookSnapshot(ApiModel):
    source_time: datetime = Field(alias="sourceTime")
    received_at: datetime = Field(alias="receivedAt")
    bids: list[OrderBookLevel] = Field(min_length=1, max_length=100)
    asks: list[OrderBookLevel] = Field(min_length=1, max_length=100)
    complete: bool
    discontinuity: bool
    reconnect_sequence: int = Field(alias="reconnectSequence", ge=0)
    aggregates: list[OrderBookAggregate] = Field(min_length=3, max_length=3)


class AnalyticsConfig(ApiModel):
    atr_period: int = Field(alias="atrPeriod", ge=1, le=200)
    ema_fast_period: int = Field(alias="emaFastPeriod", ge=1, le=200)
    ema_slow_period: int = Field(alias="emaSlowPeriod", ge=2, le=500)
    adx_enabled: bool = Field(alias="adxEnabled")
    adx_period: int = Field(alias="adxPeriod", ge=2, le=100)
    rsi_enabled: bool = Field(alias="rsiEnabled")
    rsi_period: int = Field(alias="rsiPeriod", ge=2, le=100)
    bollinger_enabled: bool = Field(alias="bollingerEnabled")
    bollinger_period: int = Field(alias="bollingerPeriod", ge=2, le=200)
    bollinger_stddev: str = Field(alias="bollingerStddev")
    swing_pivot_left: int = Field(alias="swingPivotLeft", ge=1, le=50)
    swing_pivot_right: int = Field(alias="swingPivotRight", ge=1, le=50)
    compact_tail: dict[Literal["M1", "M5", "M15"], int] = Field(alias="compactTail")
    expected_counts: dict[Literal["M1", "M5", "M15"], int] = Field(alias="expectedCounts")

    @field_validator("bollinger_stddev")
    @classmethod
    def positive_decimal(cls, value: str) -> str:
        if parse_decimal_string(value) <= 0:
            raise ValueError("standard deviation multiplier must be positive")
        return value

    @model_validator(mode="after")
    def period_order(self) -> AnalyticsConfig:
        if self.ema_fast_period >= self.ema_slow_period:
            raise ValueError("fast EMA period must be below slow EMA period")
        for timeframe in ("M1", "M5", "M15"):
            if (
                self.compact_tail.get(timeframe, 0) < 1
                or self.expected_counts.get(timeframe, 0) < 1
            ):
                raise ValueError("all timeframe count mappings must be positive and complete")
        return self


class AnalyticsRequest(ApiModel):
    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    request_id: UUID = Field(alias="requestId")
    analysis_id: UUID = Field(alias="analysisId")
    symbol: str = Field(pattern=r"^[A-Z0-9._-]{1,32}$")
    analysis_time: datetime = Field(alias="analysisTime")
    server_time: datetime = Field(alias="serverTime")
    candles: list[CandleSeries] = Field(min_length=3, max_length=3)
    order_book: OrderBookSnapshot = Field(alias="orderBook")
    config: AnalyticsConfig

    @model_validator(mode="after")
    def unique_timeframes(self) -> AnalyticsRequest:
        if {series.timeframe for series in self.candles} != {"M1", "M5", "M15"}:
            raise ValueError("exactly one series per required timeframe is required")
        if self.analysis_time.tzinfo is None or self.server_time.tzinfo is None:
            raise ValueError("analysis and server timestamps require timezones")
        return self


class AnalysisChart(ApiModel):
    renderer_version: Literal["completed-candles-ema-atr-v1"] = Field(alias="rendererVersion")
    mime_type: Literal["image/png"] = Field(alias="mimeType")
    width: Literal[1600]
    height: Literal[1200]
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    data_base64: str = Field(alias="dataBase64", min_length=12, max_length=1_398_104)
    completed_candles_only: Literal[True] = Field(alias="completedCandlesOnly")
    candle_counts: dict[Literal["M1", "M5", "M15"], int] = Field(alias="candleCounts")
    latest_end_times: dict[Literal["M1", "M5", "M15"], str] = Field(alias="latestEndTimes")

    @model_validator(mode="after")
    def complete_timeframes(self) -> AnalysisChart:
        expected = {"M1", "M5", "M15"}
        if set(self.candle_counts) != expected or set(self.latest_end_times) != expected:
            raise ValueError("chart metadata must cover M1, M5, and M15")
        if any(count < 1 or count > 100 for count in self.candle_counts.values()):
            raise ValueError("chart candle counts must be bounded")
        for timestamp in self.latest_end_times.values():
            parsed = datetime.fromisoformat(timestamp)
            if parsed.tzinfo is None:
                raise ValueError("chart timestamps require timezones")
        return self


class AnalyticsResponse(ApiModel):
    schema_version: Literal["1.1"] = Field(alias="schemaVersion", default="1.1")
    request_id: UUID = Field(alias="requestId")
    analysis_id: UUID = Field(alias="analysisId")
    generated_at: datetime = Field(alias="generatedAt")
    acceptable: bool
    rejection_reasons: list[str] = Field(alias="rejectionReasons", max_length=64)
    features: dict[str, object]
    chart: AnalysisChart | None

    @model_validator(mode="after")
    def chart_matches_acceptability(self) -> AnalyticsResponse:
        if self.acceptable != (self.chart is not None):
            raise ValueError("accepted analytics must contain exactly one chart")
        return self


class PerformanceOutcome(ApiModel):
    net_pnl: str = Field(alias="netPnl")
    closed_at: datetime = Field(alias="closedAt")

    @field_validator("net_pnl")
    @classmethod
    def pnl_is_signed_decimal(cls, value: str) -> str:
        if not SIGNED_DECIMAL_PATTERN.fullmatch(value):
            raise ValueError("P/L must be a canonical signed decimal string")
        return value


class PerformanceRequest(ApiModel):
    request_id: UUID = Field(alias="requestId")
    outcomes: list[PerformanceOutcome] = Field(max_length=5000)


class PerformanceSummary(ApiModel):
    sample_size: int
    wins: int
    losses: int
    win_rate: str | None
    loss_rate: str | None
    profit_factor: str | None
    expectancy: str | None
    average_win: str | None
    average_loss: str | None
    realized_pnl: str
    drawdown: str
    consecutive_wins: int
    consecutive_losses: int


class PerformanceResponse(ApiModel):
    request_id: UUID = Field(alias="requestId")
    summary: PerformanceSummary
