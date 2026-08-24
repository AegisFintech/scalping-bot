from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from python.analytics.models import AnalyticsRequest, AnalyticsResponse
from python.features import build_features

TIMEFRAME_SECONDS = {"M1": 60, "M5": 300, "M15": 900}
BROKER_SESSION_GAP_BEFORE = "BROKER_SESSION_GAP_BEFORE"
MAX_SESSION_GAP_SECONDS = 14 * 24 * 60 * 60


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
            flags = candle.quality_flags
            marker_count = flags.count(BROKER_SESSION_GAP_BEFORE)
            if marker_count > 1 or any(flag != BROKER_SESSION_GAP_BEFORE for flag in flags):
                reasons.append(f"{series.timeframe}_QUALITY_FLAG_INVALID")
            if not candle.complete:
                reasons.append(f"{series.timeframe}_FORMING_CANDLE")
            if candle.end_time.astimezone(UTC) > analysis_time:
                reasons.append(f"{series.timeframe}_LOOKAHEAD_CANDLE")
            duration = (candle.end_time - candle.start_time).total_seconds()
            if duration != expected_duration:
                reasons.append(f"{series.timeframe}_DURATION_INVALID")
            if previous_end is None:
                if marker_count:
                    reasons.append(f"{series.timeframe}_SESSION_GAP_FLAG_INVALID")
            else:
                difference = (candle.start_time - previous_end).total_seconds()
                if difference == 0:
                    if marker_count:
                        reasons.append(f"{series.timeframe}_SESSION_GAP_FLAG_INVALID")
                elif (
                    difference < 0
                    or marker_count != 1
                    or not difference.is_integer()
                    or int(difference) % expected_duration != 0
                    or difference > MAX_SESSION_GAP_SECONDS
                ):
                    reasons.append(f"{series.timeframe}_GAP_OR_OVERLAP")
                    if marker_count:
                        reasons.append(f"{series.timeframe}_SESSION_GAP_FLAG_INVALID")
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
