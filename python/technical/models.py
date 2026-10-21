from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from python.analytics.models import AnalyticsRequest, ApiModel, parse_decimal_string

Frame = Literal["M1", "M5", "M15"]


class ContextQuote(ApiModel):
    bid: str
    ask: str
    source_time: datetime = Field(alias="sourceTime")
    received_at: datetime = Field(alias="receivedAt")

    @field_validator("bid", "ask")
    @classmethod
    def positive(cls, value: str) -> str:
        if parse_decimal_string(value) <= 0:
            raise ValueError("positive decimal required")
        return value

    @field_validator("source_time", "received_at")
    @classmethod
    def aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("aware time required")
        return value


class ContextRequest(ApiModel):
    schema_version: Literal["technical-context-request-1.0"] = Field(alias="schemaVersion")
    request: AnalyticsRequest
    quote: ContextQuote
    tick_size: str = Field(alias="tickSize")
    minimum_entry_distance: str = Field(alias="minimumEntryDistance")

    @field_validator("tick_size", "minimum_entry_distance")
    @classmethod
    def decimal(cls, value: str) -> str:
        parse_decimal_string(value)
        return value

    @model_validator(mode="after")
    def positive_tick(self) -> ContextRequest:
        if parse_decimal_string(self.tick_size) <= 0:
            raise ValueError("tick must be positive")
        return self


class Pivot(ApiModel):
    side: Literal["HIGH", "LOW"]
    price: str
    candle_at: str
    available_at: str


class StructureEvent(ApiModel):
    kind: Literal["INITIAL_BREAK", "BOS", "MSS", "SWEEP"]
    direction: Literal["BULLISH", "BEARISH"]
    level: str
    pivot_at: str
    available_at: str
    displacement: bool


class Zone(ApiModel):
    kind: Literal["ORDER_BLOCK", "FVG"]
    direction: Literal["BULLISH", "BEARISH"]
    lower: str
    upper: str
    origin_at: str
    available_at: str
    status: Literal["FRESH", "TOUCHED", "FILLED", "INVALIDATED"]
    first_touched_at: str | None
    resolved_at: str | None
    age_bars: int
    distance_from_quote: str
    overlap_count: int = 0


class LiquidityPool(ApiModel):
    scope: Literal["HISTORICAL_PIVOT_CLUSTER_NOT_RESTING_ORDERS"] = (
        "HISTORICAL_PIVOT_CLUSTER_NOT_RESTING_ORDERS"
    )
    kind: Literal["EQUAL_HIGHS", "EQUAL_LOWS"]
    level: str
    tolerance: str
    confirmed_touches: int
    first_pivot_at: str
    available_at: str


class DayRange(ApiModel):
    utc_date: str
    status: Literal["COMPLETE_UTC_DAY", "PARTIAL_OR_UNAVAILABLE"]
    high: str | None
    low: str | None


class FrameContext(ApiModel):
    timeframe: Frame
    candle_count: int
    latest_completed_at: str
    segment_candle_count: int
    bias: Literal["UNKNOWN", "BULLISH", "BEARISH"]
    atr: str
    ema_fast: str
    ema_slow: str
    rsi: str | None
    adx: str | None
    pivots: list[Pivot] = Field(max_length=12)
    events: list[StructureEvent] = Field(max_length=12)
    nearest_active_zones: list[Zone] = Field(max_length=8)
    recent_resolved_zones: list[Zone] = Field(max_length=4)
    liquidity_pools: list[LiquidityPool] = Field(max_length=6)
    active_zone_count: int
    resolved_zone_count: int
    previous_utc_day: DayRange


class DepthContext(ApiModel):
    scope: Literal["BROKER_ONLY_NOT_GLOBAL_ORDER_FLOW"] = "BROKER_ONLY_NOT_GLOBAL_ORDER_FLOW"
    timestamp_basis: Literal["BROKER_SPOT_CLOCK_AND_LOCAL_RECEIPT"] = (
        "BROKER_SPOT_CLOCK_AND_LOCAL_RECEIPT"
    )
    source_at: str
    received_at: str
    bid_levels: int
    ask_levels: int
    symmetric_sizes: bool
    spread: str
    imbalance: str | None
    microprice_bias: str | None
    bid_liquidity_change_60s: str | None
    ask_liquidity_change_60s: str | None
    rolling_sample_count_60s: int
    warnings: list[str]


class ContextEvidence(ApiModel):
    definitions_version: Literal["causal-smc-1.0"] = "causal-smc-1.0"
    frames: list[FrameContext] = Field(min_length=3, max_length=3)
    depth: DepthContext
    spread_to_m1_atr: str
    history_targets_met: bool
    news: Literal["NOT_COLLECTED"] = "NOT_COLLECTED"
    harmonics: Literal["NOT_IMPLEMENTED"] = "NOT_IMPLEMENTED"
    counterfactual_costs: None = None


class ContextResponse(ApiModel):
    schema_version: Literal["technical-context-response-1.0"] = Field(
        alias="schemaVersion", default="technical-context-response-1.0"
    )
    request_id: UUID = Field(alias="requestId")
    analysis_id: UUID = Field(alias="analysisId")
    input_sha256: str = Field(alias="inputSha256", pattern=r"^[0-9a-f]{64}$")
    captured_at: datetime = Field(alias="capturedAt")
    execution_authority: Literal[False] = Field(alias="executionAuthority", default=False)
    acceptable: bool
    reasons: list[str] = Field(max_length=64)
    evidence: ContextEvidence | None
    codex_payload: dict[str, object] | None = Field(alias="codexPayload")

    @model_validator(mode="after")
    def consistent(self) -> ContextResponse:
        if self.acceptable != (not self.reasons):
            raise ValueError("acceptance and reasons disagree")
        if self.acceptable != (self.evidence is not None and self.codex_payload is not None):
            raise ValueError("accepted context requires evidence and candidate payload")
        if not self.acceptable and (self.evidence is not None or self.codex_payload is not None):
            raise ValueError("rejected context must withhold evidence")
        return self


class ContextRequestV11(ApiModel):
    """Separate broker analysis time from recorded local snapshot availability."""

    schema_version: Literal["technical-context-request-1.1"] = Field(alias="schemaVersion")
    request: AnalyticsRequest
    quote: ContextQuote
    tick_size: str = Field(alias="tickSize")
    minimum_entry_distance: str = Field(alias="minimumEntryDistance")
    snapshot_time: datetime = Field(alias="snapshotTime")

    @field_validator("tick_size", "minimum_entry_distance")
    @classmethod
    def decimal(cls, value: str) -> str:
        parse_decimal_string(value)
        return value

    @field_validator("snapshot_time")
    @classmethod
    def aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("aware time required")
        return value

    @model_validator(mode="after")
    def positive_tick(self) -> ContextRequestV11:
        if parse_decimal_string(self.tick_size) <= 0:
            raise ValueError("tick must be positive")
        return self
