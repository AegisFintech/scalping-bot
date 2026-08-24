from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date
from decimal import Decimal
from itertools import pairwise

from python.analytics.models import AnalyticsRequest, Candle, CandleSeries, OrderBookLevel
from python.indicators import (
    adx,
    atr_wilder,
    bollinger_bandwidth,
    ema,
    realized_volatility,
    rsi_wilder,
)

BROKER_SESSION_GAP_BEFORE = "BROKER_SESSION_GAP_BEFORE"


@dataclass(frozen=True)
class NumericBar:
    high: Decimal
    low: Decimal
    close: Decimal


def decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    normalized = value.normalize()
    text = format(normalized, "f")
    return "0" if text in {"-0", ""} else text


def _latest_slope(values: Sequence[Decimal | None], lookback: int = 3) -> Decimal | None:
    available = [value for value in values if value is not None]
    if len(available) <= lookback:
        return None
    return (available[-1] - available[-1 - lookback]) / Decimal(lookback)


def _returns(closes: list[Decimal], count: int = 10) -> list[str]:
    output: list[Decimal] = []
    for previous, current in pairwise(closes):
        if previous > 0:
            output.append((current / previous) - Decimal(1))
    return [decimal_text(value) or "0" for value in output[-count:]]


def _atr_percentile(values: list[Decimal | None]) -> Decimal | None:
    available = [value for value in values if value is not None]
    if not available:
        return None
    latest = available[-1]
    return Decimal(sum(value <= latest for value in available)) / Decimal(len(available))


def _confirmed_swings(
    candles: list[Candle], left: int, right: int, limit: int = 10
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    highs: list[dict[str, str]] = []
    lows: list[dict[str, str]] = []
    for index in range(left, len(candles) - right):
        candidate = candles[index]
        window = candles[index - left : index + right + 1]
        if candidate.high_decimal == max(item.high_decimal for item in window):
            highs.append({"time": candidate.end_time.isoformat(), "price": candidate.high})
        if candidate.low_decimal == min(item.low_decimal for item in window):
            lows.append({"time": candidate.end_time.isoformat(), "price": candidate.low})
    return highs[-limit:], lows[-limit:]


def _session_features(candles: list[Candle]) -> dict[str, object]:
    by_date: dict[date, list[Candle]] = {}
    for candle in candles:
        session_date = candle.end_time.astimezone(UTC).date()
        by_date.setdefault(session_date, []).append(candle)
    ordered_dates = sorted(by_date)
    current = by_date[ordered_dates[-1]]
    previous = by_date[ordered_dates[-2]] if len(ordered_dates) > 1 else []

    def bounds(items: list[Candle]) -> dict[str, str | None]:
        if not items:
            return {"high": None, "low": None}
        return {
            "high": decimal_text(max(item.high_decimal for item in items)),
            "low": decimal_text(min(item.low_decimal for item in items)),
        }

    weighted_value = Decimal(0)
    total_volume = Decimal(0)
    for candle in current:
        if candle.volume is None:
            continue
        volume = Decimal(candle.volume)
        typical = (candle.high_decimal + candle.low_decimal + candle.close_decimal) / Decimal(3)
        weighted_value += typical * volume
        total_volume += volume
    vwap = weighted_value / total_volume if total_volume > 0 else None
    return {
        "current": bounds(current),
        "previous": bounds(previous),
        "vwap": decimal_text(vwap),
        "distance_from_vwap": decimal_text(current[-1].close_decimal - vwap) if vwap else None,
    }


def _volume_features(candles: list[Candle]) -> dict[str, str | int | None]:
    volumes = [Decimal(candle.volume) for candle in candles if candle.volume is not None]
    if not volumes:
        return {"sample_size": 0, "latest": None, "mean": None, "zscore": None}
    sample = volumes[-50:]
    average = sum(sample, Decimal(0)) / Decimal(len(sample))
    variance = sum(((value - average) ** 2 for value in sample), Decimal(0)) / Decimal(len(sample))
    deviation = variance.sqrt()
    zscore = (sample[-1] - average) / deviation if deviation > 0 else Decimal(0)
    return {
        "sample_size": len(sample),
        "latest": decimal_text(sample[-1]),
        "mean": decimal_text(average),
        "zscore": decimal_text(zscore),
    }


def _sum_size(levels: Iterable[OrderBookLevel]) -> Decimal:
    return sum((Decimal(level.size) for level in levels), Decimal(0))


def _order_book_features(request: AnalyticsRequest) -> dict[str, object]:
    book = request.order_book
    best_bid = Decimal(book.bids[0].price)
    best_ask = Decimal(book.asks[0].price)
    spread = best_ask - best_bid
    midpoint = (best_ask + best_bid) / Decimal(2)
    result: dict[str, object] = {
        "source_time": book.source_time.isoformat(),
        "received_at": book.received_at.isoformat(),
        "spread": decimal_text(spread),
        "spread_bps": decimal_text((spread / midpoint) * Decimal(10_000)) if midpoint > 0 else None,
        "midpoint": decimal_text(midpoint),
        "discontinuity": book.discontinuity,
        "reconnect_sequence": book.reconnect_sequence,
        "rolling_aggregates": [
            aggregate.model_dump(by_alias=True, mode="json") for aggregate in book.aggregates
        ],
    }
    best_bid_size = Decimal(book.bids[0].size)
    best_ask_size = Decimal(book.asks[0].size)
    top_total = best_bid_size + best_ask_size
    result["microprice"] = (
        decimal_text(((best_ask * best_bid_size) + (best_bid * best_ask_size)) / top_total)
        if top_total > 0
        else None
    )
    for depth in (5, 10, 20):
        bids = book.bids[:depth]
        asks = book.asks[:depth]
        bid_total = _sum_size(bids)
        ask_total = _sum_size(asks)
        total = bid_total + ask_total
        imbalance = (bid_total - ask_total) / total if total > 0 else None
        bid_concentration = max((Decimal(level.size) for level in bids), default=Decimal(0))
        ask_concentration = max((Decimal(level.size) for level in asks), default=Decimal(0))
        result[f"top_{depth}"] = {
            "bid_depth": decimal_text(bid_total),
            "ask_depth": decimal_text(ask_total),
            "imbalance": decimal_text(imbalance),
            "bid_concentration": decimal_text(bid_concentration / bid_total) if bid_total else None,
            "ask_concentration": decimal_text(ask_concentration / ask_total) if ask_total else None,
        }
    return result


def _timeframe_features(series: CandleSeries, request: AnalyticsRequest) -> dict[str, object]:
    candles = series.candles
    closes = [candle.close_decimal for candle in candles]
    numeric_bars = [
        NumericBar(candle.high_decimal, candle.low_decimal, candle.close_decimal)
        for candle in candles
    ]
    atr_values = atr_wilder(numeric_bars, request.config.atr_period)
    fast_values = ema(closes, request.config.ema_fast_period)
    slow_values = ema(closes, request.config.ema_slow_period)
    rsi_values = (
        rsi_wilder(closes, request.config.rsi_period) if request.config.rsi_enabled else None
    )
    adx_values = (
        adx(numeric_bars, request.config.adx_period) if request.config.adx_enabled else None
    )
    latest_atr = atr_values[-1]
    latest_close = closes[-1]
    swings_high, swings_low = _confirmed_swings(
        candles, request.config.swing_pivot_left, request.config.swing_pivot_right
    )
    rolling = candles[-min(20, len(candles)) :]
    output: dict[str, object] = {
        "session_gap_count": sum(
            BROKER_SESSION_GAP_BEFORE in candle.quality_flags for candle in candles
        ),
        "latest": {
            "start_time": candles[-1].start_time.isoformat(),
            "end_time": candles[-1].end_time.isoformat(),
            "open": candles[-1].open,
            "high": candles[-1].high,
            "low": candles[-1].low,
            "close": candles[-1].close,
            "volume": candles[-1].volume,
        },
        "raw_tail": [
            candle.model_dump(by_alias=True, mode="json")
            for candle in candles[-request.config.compact_tail[series.timeframe] :]
        ],
        "full_candles": [
            {
                **candle.model_dump(by_alias=True, mode="json"),
                "atr": decimal_text(atr_values[index]),
                "ema_fast": decimal_text(fast_values[index]),
                "ema_slow": decimal_text(slow_values[index]),
                "rsi": decimal_text(rsi_values[index]) if rsi_values is not None else None,
                "adx": decimal_text(adx_values[index]) if adx_values is not None else None,
            }
            for index, candle in enumerate(candles)
        ],
        "atr": decimal_text(latest_atr),
        "normalized_atr": decimal_text(latest_atr / latest_close)
        if latest_atr and latest_close
        else None,
        "atr_percentile": decimal_text(_atr_percentile(atr_values)),
        "ema_fast": decimal_text(fast_values[-1]),
        "ema_slow": decimal_text(slow_values[-1]),
        "ema_fast_slope": decimal_text(_latest_slope(fast_values)),
        "ema_slow_slope": decimal_text(_latest_slope(slow_values)),
        "ema_alignment": "BULLISH"
        if fast_values[-1] > slow_values[-1]
        else "BEARISH"
        if fast_values[-1] < slow_values[-1]
        else "FLAT",
        "ema_separation": decimal_text((fast_values[-1] - slow_values[-1]) / latest_close),
        "returns": _returns(closes),
        "realized_volatility": decimal_text(realized_volatility(closes)),
        "rolling_range": decimal_text(
            max(item.high_decimal for item in rolling) - min(item.low_decimal for item in rolling)
        ),
        "swing_highs": swings_high,
        "swing_lows": swings_low,
        "session": _session_features(candles),
        "volume": _volume_features(candles),
    }
    if request.config.rsi_enabled:
        output["rsi"] = decimal_text(rsi_values[-1]) if rsi_values is not None else None
    if request.config.adx_enabled:
        output["adx"] = decimal_text(adx_values[-1]) if adx_values is not None else None
    if request.config.bollinger_enabled:
        output["bollinger_bandwidth"] = decimal_text(
            bollinger_bandwidth(
                closes,
                request.config.bollinger_period,
                Decimal(request.config.bollinger_stddev),
            )
        )
    return output


def build_features(request: AnalyticsRequest) -> dict[str, object]:
    by_timeframe = {
        series.timeframe: _timeframe_features(series, request) for series in request.candles
    }
    m1_atr_text = by_timeframe["M1"].get("atr")
    spread_text = _order_book_features(request).get("spread")
    spread_atr_ratio: str | None = None
    if isinstance(m1_atr_text, str) and isinstance(spread_text, str) and Decimal(m1_atr_text) > 0:
        spread_atr_ratio = decimal_text(Decimal(spread_text) / Decimal(m1_atr_text))
    return {
        "schema_version": "1.0",
        "analysis_time": request.analysis_time.isoformat(),
        "server_time": request.server_time.isoformat(),
        "timeframes": by_timeframe,
        "order_book": _order_book_features(request),
        "spread_atr_ratio_m1": spread_atr_ratio,
    }
