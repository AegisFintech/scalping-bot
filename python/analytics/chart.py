from __future__ import annotations

import base64
import hashlib
import io
from collections.abc import Mapping
from decimal import Decimal

from PIL import Image, ImageDraw

from python.analytics.models import AnalysisChart, AnalyticsRequest

WIDTH = 1600
HEIGHT = 1200
MAX_PNG_BYTES = 1_048_576
RENDERER_VERSION = "completed-candles-ema-atr-v1"
TAIL_COUNTS = {"M15": 48, "M5": 60, "M1": 80}
TIMEFRAME_ORDER = ("M15", "M5", "M1")


class ChartRenderError(ValueError):
    """Raised when accepted analytics cannot produce the exact bounded chart."""


def _mapping(value: object, reason: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ChartRenderError(reason)
    return value


def _decimal(value: object, reason: str) -> Decimal:
    if not isinstance(value, str):
        raise ChartRenderError(reason)
    try:
        result = Decimal(value)
    except Exception as exc:
        raise ChartRenderError(reason) from exc
    if not result.is_finite():
        raise ChartRenderError(reason)
    return result


def _coordinate(value: Decimal, lower: Decimal, upper: Decimal, top: int, bottom: int) -> int:
    if upper <= lower:
        return (top + bottom) // 2
    ratio = (value - lower) / (upper - lower)
    return bottom - int(ratio * Decimal(bottom - top))


def _line(
    draw: ImageDraw.ImageDraw,
    values: list[Decimal],
    *,
    left: int,
    right: int,
    top: int,
    bottom: int,
    lower: Decimal,
    upper: Decimal,
    color: str,
    width: int,
) -> None:
    if len(values) < 2:
        return
    step = Decimal(right - left) / Decimal(len(values))
    points = [
        (
            left + int((Decimal(index) + Decimal("0.5")) * step),
            _coordinate(value, lower, upper, top, bottom),
        )
        for index, value in enumerate(values)
    ]
    draw.line(points, fill=color, width=width, joint="curve")


def _draw_panel(
    draw: ImageDraw.ImageDraw,
    timeframe: str,
    source: Mapping[str, object],
    *,
    panel_top: int,
    panel_bottom: int,
) -> tuple[int, str]:
    raw = source.get("full_candles")
    if not isinstance(raw, list) or not raw:
        raise ChartRenderError(f"CHART_{timeframe}_CANDLES_MISSING")
    normalized_all: list[Mapping[str, object]] = []
    for value in raw:
        candle = _mapping(value, f"CHART_{timeframe}_CANDLE_INVALID")
        if candle.get("complete") is not True:
            raise ChartRenderError(f"CHART_{timeframe}_FORMING_CANDLE")
        normalized_all.append(candle)
    first_ready = next(
        (
            index
            for index, candle in enumerate(normalized_all)
            if all(isinstance(candle.get(field), str) for field in ("ema_fast", "ema_slow", "atr"))
        ),
        None,
    )
    if first_ready is None:
        raise ChartRenderError(f"CHART_{timeframe}_INDICATORS_MISSING")
    indicator_ready = normalized_all[first_ready:]
    if any(
        not all(isinstance(candle.get(field), str) for field in ("ema_fast", "ema_slow", "atr"))
        for candle in indicator_ready
    ):
        raise ChartRenderError(f"CHART_{timeframe}_INDICATOR_GAP")
    normalized = indicator_ready[-TAIL_COUNTS[timeframe] :]

    left = 88
    right = WIDTH - 42
    price_top = panel_top + 38
    price_bottom = panel_bottom - 76
    atr_top = panel_bottom - 57
    atr_bottom = panel_bottom - 20
    draw.rounded_rectangle(
        (30, panel_top, WIDTH - 30, panel_bottom),
        radius=10,
        fill="#101826",
        outline="#334155",
        width=2,
    )

    opens = [_decimal(item.get("open"), "CHART_OHLC_INVALID") for item in normalized]
    highs = [_decimal(item.get("high"), "CHART_OHLC_INVALID") for item in normalized]
    lows = [_decimal(item.get("low"), "CHART_OHLC_INVALID") for item in normalized]
    closes = [_decimal(item.get("close"), "CHART_OHLC_INVALID") for item in normalized]
    ema_fast = [_decimal(item.get("ema_fast"), "CHART_EMA_INVALID") for item in normalized]
    ema_slow = [_decimal(item.get("ema_slow"), "CHART_EMA_INVALID") for item in normalized]
    atr = [_decimal(item.get("atr"), "CHART_ATR_INVALID") for item in normalized]
    if any(
        high < max(open_, low, close)
        for high, open_, low, close in zip(highs, opens, lows, closes, strict=True)
    ):
        raise ChartRenderError("CHART_OHLC_INVALID")
    if any(low > min(open_, close) for low, open_, close in zip(lows, opens, closes, strict=True)):
        raise ChartRenderError("CHART_OHLC_INVALID")

    lower = min([*lows, *ema_fast, *ema_slow])
    upper = max([*highs, *ema_fast, *ema_slow])
    padding = (upper - lower) * Decimal("0.06")
    if padding == 0:
        padding = max(Decimal("0.0000000001"), upper * Decimal("0.0001"))
    lower -= padding
    upper += padding
    step = Decimal(right - left) / Decimal(len(normalized))
    body_width = max(2, min(13, int(step * Decimal("0.62"))))

    for row in range(5):
        y = price_top + int((price_bottom - price_top) * row / 4)
        draw.line((left, y, right, y), fill="#263449", width=1)
        price = upper - (upper - lower) * Decimal(row) / Decimal(4)
        draw.text((36, y - 7), f"{price:.2f}", fill="#94a3b8")

    for index, (open_, high, low, close) in enumerate(zip(opens, highs, lows, closes, strict=True)):
        x = left + int((Decimal(index) + Decimal("0.5")) * step)
        color = "#22c55e" if close >= open_ else "#ef4444"
        draw.line(
            (
                x,
                _coordinate(high, lower, upper, price_top, price_bottom),
                x,
                _coordinate(low, lower, upper, price_top, price_bottom),
            ),
            fill=color,
            width=2,
        )
        open_y = _coordinate(open_, lower, upper, price_top, price_bottom)
        close_y = _coordinate(close, lower, upper, price_top, price_bottom)
        draw.rectangle(
            (
                x - body_width // 2,
                min(open_y, close_y),
                x + body_width // 2,
                max(open_y, close_y) + 1,
            ),
            fill=color,
        )

    _line(
        draw,
        ema_fast,
        left=left,
        right=right,
        top=price_top,
        bottom=price_bottom,
        lower=lower,
        upper=upper,
        color="#38bdf8",
        width=3,
    )
    _line(
        draw,
        ema_slow,
        left=left,
        right=right,
        top=price_top,
        bottom=price_bottom,
        lower=lower,
        upper=upper,
        color="#f59e0b",
        width=3,
    )

    atr_lower = min(atr)
    atr_upper = max(atr)
    _line(
        draw,
        atr,
        left=left,
        right=right,
        top=atr_top,
        bottom=atr_bottom,
        lower=atr_lower,
        upper=atr_upper,
        color="#c084fc",
        width=2,
    )
    draw.line((left, atr_top - 5, right, atr_top - 5), fill="#334155", width=1)
    draw.text((42, panel_top + 12), timeframe, fill="#f8fafc")
    draw.text(
        (104, panel_top + 12),
        f"{len(normalized)} completed candles   EMA fast {ema_fast[-1]}   "
        f"EMA slow {ema_slow[-1]}   ATR {atr[-1]}",
        fill="#cbd5e1",
    )
    draw.text((42, atr_top + 7), "ATR", fill="#c084fc")
    draw.text((WIDTH - 480, panel_top + 12), "EMA fast", fill="#38bdf8")
    draw.text((WIDTH - 380, panel_top + 12), "EMA slow", fill="#f59e0b")
    first_time = str(normalized[0].get("startTime", ""))
    last_time = str(normalized[-1].get("endTime", ""))
    draw.text((left, panel_bottom - 17), first_time, fill="#64748b")
    draw.text((right - 230, panel_bottom - 17), last_time, fill="#64748b")
    return len(normalized), last_time


def render_analysis_chart(
    request: AnalyticsRequest, features: Mapping[str, object]
) -> AnalysisChart:
    timeframes = _mapping(features.get("timeframes"), "CHART_TIMEFRAMES_MISSING")
    image = Image.new("RGB", (WIDTH, HEIGHT), "#07111f")
    draw = ImageDraw.Draw(image)
    draw.text((32, 18), f"{request.symbol} completed-candle EMA/ATR context", fill="#f8fafc")
    draw.text(
        (32, 40),
        f"Analysis time {request.analysis_time.isoformat()}   No forming candles   UTC timestamps",
        fill="#94a3b8",
    )

    counts: dict[str, int] = {}
    latest: dict[str, str] = {}
    panel_height = 360
    panel_gap = 15
    panel_top = 72
    for timeframe in TIMEFRAME_ORDER:
        source = _mapping(timeframes.get(timeframe), f"CHART_{timeframe}_FEATURES_MISSING")
        count, latest_end = _draw_panel(
            draw,
            timeframe,
            source,
            panel_top=panel_top,
            panel_bottom=panel_top + panel_height,
        )
        counts[timeframe] = count
        latest[timeframe] = latest_end
        panel_top += panel_height + panel_gap

    output = io.BytesIO()
    image.save(output, format="PNG", optimize=False, compress_level=9)
    png = output.getvalue()
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > MAX_PNG_BYTES:
        raise ChartRenderError("CHART_PNG_INVALID_OR_OVERSIZED")
    return AnalysisChart(
        renderer_version=RENDERER_VERSION,
        mime_type="image/png",
        width=WIDTH,
        height=HEIGHT,
        sha256=hashlib.sha256(png).hexdigest(),
        data_base64=base64.b64encode(png).decode("ascii"),
        completed_candles_only=True,
        candle_counts=counts,
        latest_end_times=latest,
    )
