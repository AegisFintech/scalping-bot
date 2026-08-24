from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from python.analytics.models import AnalyticsRequest, AnalyticsResponse
from python.features import build_features

TIMEFRAME_SECONDS = {"M1": 60, "M5": 300, "M15": 900}


def quality_reasons(request: AnalyticsRequest) -> list[str]:
    reasons: list[str] = []
    analysis_time = request.analysis_time.astimezone(UTC)
    for series in request.candles:
        expected = request.config.expected_counts[series.timeframe]
        if len(series.candles) != expected:
            reasons.append(f"{series.timeframe}_COUNT_MISMATCH")
        previous_end: datetime | None = None
        expected_duration = TIMEFRAME_SECONDS[series.timeframe]
        for candle in series.candles:
            if not candle.complete:
                reasons.append(f"{series.timeframe}_FORMING_CANDLE")
            if candle.end_time.astimezone(UTC) > analysis_time:
                reasons.append(f"{series.timeframe}_LOOKAHEAD_CANDLE")
            duration = int((candle.end_time - candle.start_time).total_seconds())
            if duration != expected_duration:
                reasons.append(f"{series.timeframe}_DURATION_INVALID")
            if previous_end is not None and candle.start_time != previous_end:
                reasons.append(f"{series.timeframe}_GAP_OR_OVERLAP")
            previous_end = candle.end_time
    book = request.order_book
    if not book.complete:
        reasons.append("ORDER_BOOK_INCOMPLETE")
    if book.discontinuity:
        reasons.append("ORDER_BOOK_DISCONTINUITY")
    bid_prices = [Decimal(level.price) for level in book.bids]
    ask_prices = [Decimal(level.price) for level in book.asks]
    if bid_prices != sorted(bid_prices, reverse=True):
        reasons.append("ORDER_BOOK_BID_ORDER_INVALID")
    if ask_prices != sorted(ask_prices):
        reasons.append("ORDER_BOOK_ASK_ORDER_INVALID")
    if bid_prices[0] >= ask_prices[0]:
        reasons.append("ORDER_BOOK_CROSSED")
    if book.source_time > request.server_time:
        reasons.append("ORDER_BOOK_FUTURE_TIMESTAMP")
    if {aggregate.window_ms for aggregate in book.aggregates} != {60_000, 300_000, 900_000}:
        reasons.append("ORDER_BOOK_AGGREGATES_INCOMPLETE")
    return sorted(set(reasons))


def analyze(request: AnalyticsRequest, now: datetime | None = None) -> AnalyticsResponse:
    reasons = quality_reasons(request)
    features: dict[str, object] = {}
    if not reasons:
        features = build_features(request)
    return AnalyticsResponse(
        request_id=request.request_id,
        analysis_id=request.analysis_id,
        generated_at=now or datetime.now(UTC),
        acceptable=not reasons,
        rejection_reasons=reasons,
        features=features,
    )
