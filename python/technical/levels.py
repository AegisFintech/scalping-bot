"""Frozen causal-smc-1.1 level map. Descriptive, causal and bounded; never a trade call.

Every level is computed from completed candles available at the snapshot. Round numbers
and resting liquidity are hypotheses: nothing here observes orders or global flow.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_DOWN, ROUND_FLOOR, ROUND_HALF_UP, Decimal, localcontext
from typing import Any, Protocol

from python.indicators import atr_wilder

DEFINITIONS = "causal-smc-1.1"
SR_TOLERANCE_ATR = Decimal("0.25")
SR_LIMIT = 6
ANATOMY_COUNT = {"M1": 5, "M5": 3, "M15": 3}
ENVELOPES = (3, 5, 10, 20)
# UTC conventions, not exchange hours; daylight-saving shifts are not modeled.
SESSIONS = (("ASIA", 0, 7), ("LONDON", 7, 12), ("NEW_YORK", 12, 21))
ROUND_STEPS = (Decimal(5), Decimal(10))
FRACTION = Decimal("0.01")
QUANTUM = Decimal("0.0000000001")
GAP_FLAG = "BROKER_SESSION_GAP_BEFORE"


class BarLike(Protocol):
    @property
    def start_time(self) -> datetime: ...

    @property
    def end_time(self) -> datetime: ...

    @property
    def open_decimal(self) -> Decimal: ...

    @property
    def high_decimal(self) -> Decimal: ...

    @property
    def low_decimal(self) -> Decimal: ...

    @property
    def close_decimal(self) -> Decimal: ...

    @property
    def quality_flags(self) -> Sequence[str]: ...


@dataclass(frozen=True)
class Numeric:
    high: Decimal
    low: Decimal
    close: Decimal


@dataclass(frozen=True)
class SwingPivot:
    side: str
    price: Decimal
    candle_at: datetime
    available_at: datetime


def text(value: Decimal) -> str:
    """Same ten-place, truncating canonical form as the analytics service boundary."""
    if not value.is_finite():
        raise ValueError("LEVEL_DECIMAL_NON_FINITE")
    with localcontext() as context:
        context.prec = max(40, len(value.as_tuple().digits) + 12)
        normalized = value.quantize(QUANTUM, rounding=ROUND_DOWN).normalize()
    result = format(normalized, "f")
    return "0" if result in {"-0", ""} else result


def fraction(value: Decimal) -> str:
    return text(value.quantize(FRACTION, rounding=ROUND_DOWN))


def on_tick(value: Decimal, tick: Decimal) -> Decimal:
    return (value / tick).to_integral_value(rounding=ROUND_HALF_UP) * tick


def segment_start(bars: Sequence[BarLike]) -> int:
    """Structure resets at a marked broker session gap, exactly as causal-smc-1.0."""
    return max((i for i, b in enumerate(bars) if GAP_FLAG in b.quality_flags), default=0)


def swing_pivots(bars: Sequence[BarLike]) -> list[SwingPivot]:
    """3-left/3-right strict fractals, available only at the confirming candle's end."""
    pivots: list[SwingPivot] = []
    for i in range(6, len(bars)):
        k = i - 3
        center, peers = bars[k], [b for n, b in enumerate(bars[k - 3 : i + 1]) if n != 3]
        if all(center.high_decimal > b.high_decimal for b in peers):
            pivots.append(
                SwingPivot("HIGH", center.high_decimal, center.end_time, bars[i].end_time)
            )
        if all(center.low_decimal < b.low_decimal for b in peers):
            pivots.append(SwingPivot("LOW", center.low_decimal, center.end_time, bars[i].end_time))
    return pivots


def distance(lower: Decimal, upper: Decimal, mid: Decimal) -> Decimal:
    return max(lower - mid, mid - upper, Decimal(0))


def support_resistance(
    frame: str,
    bars: Sequence[BarLike],
    pivots: Sequence[SwingPivot],
    mid: Decimal,
    atr: Decimal,
    tick: Decimal,
) -> list[dict[str, Any]]:
    """Clusters of two or more confirmed pivots; traded-beyond flags are later candles."""
    tolerance = max(tick * 2, on_tick(atr * SR_TOLERANCE_ATR, tick))
    groups: list[list[SwingPivot]] = []
    for pivot in sorted(pivots, key=lambda p: (p.price, p.candle_at, p.side)):
        if groups and pivot.price - groups[-1][0].price <= tolerance:
            groups[-1].append(pivot)
        else:
            groups.append([pivot])
    ranked: list[tuple[tuple[Decimal, int, float], dict[str, Any]]] = []
    for group in groups:
        if len(group) < 2:
            continue
        lower, upper = min(p.price for p in group), max(p.price for p in group)
        available = max(p.available_at for p in group)
        later = [b for b in bars if b.end_time > available]
        away = distance(lower, upper, mid)
        role = "RESISTANCE" if lower > mid else "SUPPORT" if upper < mid else "AT_QUOTE"
        level = {
            "lower": text(lower),
            "upper": text(upper),
            "touches": len(group),
            "high_pivots": sum(p.side == "HIGH" for p in group),
            "low_pivots": sum(p.side == "LOW" for p in group),
            "first_pivot_at": min(p.candle_at for p in group).isoformat(),
            "last_pivot_at": max(p.candle_at for p in group).isoformat(),
            "available_at": available.isoformat(),
            "role": role,
            "distance_from_quote": text(away),
            "traded_above_after": any(b.high_decimal > upper for b in later),
            "traded_below_after": any(b.low_decimal < lower for b in later),
            "tolerance": text(tolerance),
        }
        ranked.append(((away, -len(group), -available.timestamp()), level))
    ranked.sort(key=lambda item: item[0])
    return [
        {"id": f"{frame}-L{rank}", **level}
        for rank, (_, level) in enumerate(ranked[:SR_LIMIT], start=1)
    ]


def dealing_range(pivots: Sequence[SwingPivot], mid: Decimal, tick: Decimal) -> dict[str, Any]:
    """Latest swing leg: the newest confirmed pivot and the latest opposite pivot beyond it.

    A newest LOW pairs with the most recent earlier HIGH above it, and vice versa, so the
    range always spans the leg that produced the newest swing point.
    """
    ordered = sorted(pivots, key=lambda p: (p.available_at, p.candle_at))
    latest = ordered[-1] if ordered else None
    other = (
        next(
            (
                p
                for p in reversed(ordered)
                if p.side != latest.side
                and p.candle_at < latest.candle_at
                and (p.price > latest.price if latest.side == "LOW" else p.price < latest.price)
            ),
            None,
        )
        if latest is not None
        else None
    )
    if latest is None or other is None:
        return {
            "high": None,
            "high_at": None,
            "low": None,
            "low_at": None,
            "equilibrium": None,
            "position": "UNAVAILABLE",
            "position_fraction": None,
        }
    high, low = (other, latest) if latest.side == "LOW" else (latest, other)
    equilibrium = on_tick((high.price + low.price) / 2, tick)
    position = (
        "ABOVE_RANGE"
        if mid > high.price
        else "BELOW_RANGE"
        if mid < low.price
        else "PREMIUM"
        if mid > equilibrium
        else "DISCOUNT"
        if mid < equilibrium
        else "EQUILIBRIUM"
    )
    return {
        "high": text(high.price),
        "high_at": high.candle_at.isoformat(),
        "low": text(low.price),
        "low_at": low.candle_at.isoformat(),
        "equilibrium": text(equilibrium),
        "position": position,
        "position_fraction": fraction((mid - low.price) / (high.price - low.price)),
    }


def zone_extension(zone: Any, bars: Sequence[BarLike], tick: Decimal) -> dict[str, str]:
    """Midpoint (mean threshold / consequent encroachment) and deepest later penetration."""
    lower, upper = Decimal(zone.lower), Decimal(zone.upper)
    available = datetime.fromisoformat(zone.available_at)
    later = [b for b in bars if b.end_time > available]
    width, depth = upper - lower, Decimal(0)
    if zone.direction == "BULLISH" and later:
        deepest = min(b.low_decimal for b in later)
        if deepest <= upper:
            depth = Decimal(1) if width == 0 else min(Decimal(1), (upper - deepest) / width)
    elif zone.direction == "BEARISH" and later:
        highest = max(b.high_decimal for b in later)
        if highest >= lower:
            depth = Decimal(1) if width == 0 else min(Decimal(1), (highest - lower) / width)
    return {
        "midpoint": text(on_tick((lower + upper) / 2, tick)),
        "penetration_fraction": fraction(depth),
    }


def anatomy(frame: str, bars: Sequence[BarLike], first: int) -> list[dict[str, Any]]:
    """Latest completed candles in the segment starting at ``first``, oldest first.

    ATR uses the full observed history exactly as causal-smc-1.0 displacement does;
    candle comparisons never reach across a broker session gap.
    """
    numeric = [Numeric(b.high_decimal, b.low_decimal, b.close_decimal) for b in bars]
    atr = atr_wilder(numeric, 15)
    rows = []
    for i in range(max(first, len(bars) - ANATOMY_COUNT[frame]), len(bars)):
        c = bars[i]
        o, h, low, close = c.open_decimal, c.high_decimal, c.low_decimal, c.close_decimal
        span, body = h - low, abs(close - o)
        # The first candle of a segment has no in-segment prior ATR, as in causal-smc-1.0.
        prior = atr[i - 1] if i > first else None
        previous = bars[i - 1] if i > first else None
        direction = "UP" if close > o else "DOWN" if close < o else "DOJI"
        engulfing = False
        if previous is not None and direction != "DOJI":
            po, pc = previous.open_decimal, previous.close_decimal
            before = "UP" if pc > po else "DOWN" if pc < po else "DOJI"
            engulfing = (
                before not in {"DOJI", direction}
                and max(o, close) >= max(po, pc)
                and min(o, close) <= min(po, pc)
            )
        rows.append(
            {
                "end_at": c.end_time.isoformat(),
                "direction": direction,
                "range_size": text(span),
                "range_to_atr": fraction(span / prior) if prior else None,
                "body_fraction": fraction(body / span) if span else "0",
                "upper_wick_fraction": fraction((h - max(o, close)) / span) if span else "0",
                "lower_wick_fraction": fraction((min(o, close) - low) / span) if span else "0",
                "close_location": fraction((close - low) / span) if span else "0.5",
                "inside_bar": previous is not None
                and h <= previous.high_decimal
                and low >= previous.low_decimal,
                "engulfing": engulfing,
                "displacement": bool(
                    prior is not None
                    and prior > 0
                    and span > 0
                    and body >= prior * Decimal("1.5")
                    and body / span >= Decimal("0.6")
                ),
            }
        )
    return rows


def envelopes(bars: Sequence[BarLike], atr: Decimal) -> list[dict[str, Any]]:
    """Exact completed-M1 extremes of the latest 3/5/10/20 candles in the segment."""
    rows = []
    for count in ENVELOPES:
        if len(bars) < count:
            continue
        window = bars[-count:]
        high = max(window, key=lambda b: (b.high_decimal, b.end_time))
        low = min(window, key=lambda b: (b.low_decimal, -b.end_time.timestamp()))
        width = high.high_decimal - low.low_decimal
        rows.append(
            {
                "candles": count,
                "high": text(high.high_decimal),
                "high_at": high.end_time.isoformat(),
                "low": text(low.low_decimal),
                "low_at": low.end_time.isoformat(),
                "width": text(width),
                "width_to_atr": fraction(width / atr) if atr > 0 else None,
            }
        )
    return rows


def sessions(bars: Sequence[BarLike], seconds: int = 300) -> list[dict[str, Any]]:
    """UTC-convention session ranges from completed candles; missing bars stay partial."""
    if not bars:
        return []
    latest = bars[-1].end_time.astimezone(UTC)
    rows = []
    for day_offset in (0, -1):
        day = latest.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=day_offset)
        for name, first, last in reversed(SESSIONS):
            start, end = day + timedelta(hours=first), day + timedelta(hours=last)
            if start >= latest:
                continue
            window = [b for b in bars if start <= b.start_time and b.end_time <= end]
            expected = int((min(end, latest) - start).total_seconds()) // seconds
            contiguous = len(window) == expected and all(
                b.start_time == start + timedelta(seconds=i * seconds) for i, b in enumerate(window)
            )
            status = (
                "PARTIAL_OR_UNAVAILABLE"
                if not window or not contiguous
                else "COMPLETE"
                if end <= latest
                else "IN_PROGRESS"
            )
            # Partial windows are censored like an incomplete previous UTC day.
            usable = status != "PARTIAL_OR_UNAVAILABLE"
            rows.append(
                {
                    "session": name,
                    "utc_start": start.isoformat(),
                    "utc_end": end.isoformat(),
                    "high": text(max(b.high_decimal for b in window)) if usable else None,
                    "low": text(min(b.low_decimal for b in window)) if usable else None,
                    "status": status,
                }
            )
    return rows[:6]


def round_levels(mid: Decimal) -> list[dict[str, str]]:
    rows = []
    for step in ROUND_STEPS:
        below = (mid / step).to_integral_value(rounding=ROUND_FLOOR) * step
        for side, price in (("BELOW", below), ("ABOVE", below + step)):
            if price <= 0:
                continue
            rows.append(
                {
                    "price": text(price),
                    "step": text(step),
                    "side": side,
                    "distance_from_quote": text(abs(price - mid)),
                }
            )
    return rows
