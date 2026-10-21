"""Frozen descriptive definitions; no fitted thresholds or trade recommendations."""

from __future__ import annotations

from datetime import UTC, timedelta
from decimal import Decimal

from python.analytics.models import Candle, CandleSeries
from python.features.builder import NumericBar, decimal_text
from python.indicators import adx, atr_wilder, ema, rsi_wilder
from python.technical.models import (
    DayRange,
    FrameContext,
    LiquidityPool,
    Pivot,
    StructureEvent,
    Zone,
)

TARGET_COUNTS = {"M1": 720, "M5": 576, "M15": 480}


def text(value: Decimal) -> str:
    return decimal_text(value) or "0"


def previous_day(candles: list[Candle], seconds: int) -> DayRange:
    day = candles[-1].end_time.astimezone(UTC).date() - timedelta(days=1)
    start = candles[-1].end_time.astimezone(UTC).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)
    bars = [c for c in candles if start <= c.start_time < start + timedelta(days=1)]
    complete = len(bars) == 86400 // seconds and all(
        c.start_time == start + timedelta(seconds=i * seconds) for i, c in enumerate(bars)
    )
    return DayRange(
        utc_date=day.isoformat(),
        status="COMPLETE_UTC_DAY" if complete else "PARTIAL_OR_UNAVAILABLE",
        high=text(max(c.high_decimal for c in bars)) if complete else None,
        low=text(min(c.low_decimal for c in bars)) if complete else None,
    )


def frame_context(
    series: CandleSeries, quote_mid: Decimal, tick_size: Decimal = Decimal("0.01")
) -> FrameContext:
    # Structure resets at closures. Standard indicators retain the observed history,
    # including overnight true ranges; they never manufacture missing bars.
    all_bars = series.candles
    boundary = max(
        (i for i, c in enumerate(all_bars) if "BROKER_SESSION_GAP_BEFORE" in c.quality_flags),
        default=0,
    )
    bars = all_bars[boundary:]
    numeric = [NumericBar(c.high_decimal, c.low_decimal, c.close_decimal) for c in all_bars]
    atr = atr_wilder(numeric, 15)
    closes = [c.close_decimal for c in all_bars]
    fast, slow = ema(closes, 5), ema(closes, 19)
    rsis, adxs = rsi_wilder(closes, 14), adx(numeric, 14)
    pivots: list[Pivot] = []
    events: list[StructureEvent] = []
    zones: list[Zone] = []
    origins: set[tuple[str, str]] = set()
    latest: dict[str, Pivot] = {}
    broken: set[tuple[str, str]] = set()
    bias = "UNKNOWN"
    for i, c in enumerate(bars):
        at = c.end_time.isoformat()
        # Update existing zones only on candles strictly after their availability.
        for j, zone in enumerate(zones):
            if zone.status in {"FILLED", "INVALIDATED"}:
                zones[j] = zone.model_copy(update={"age_bars": zone.age_bars + 1})
                continue
            lo, hi = Decimal(zone.lower), Decimal(zone.upper)
            bull = zone.direction == "BULLISH"
            invalid = c.close_decimal < lo if bull else c.close_decimal > hi
            touch = c.low_decimal <= hi and c.high_decimal >= lo
            filled = c.low_decimal <= lo if bull else c.high_decimal >= hi
            status = (
                "INVALIDATED"
                if invalid
                else "FILLED"
                if zone.kind == "FVG" and filled
                else "TOUCHED"
                if touch
                else zone.status
            )
            zones[j] = zone.model_copy(
                update={
                    "status": status,
                    "first_touched_at": zone.first_touched_at or (at if touch else None),
                    "resolved_at": at if status in {"FILLED", "INVALIDATED"} else None,
                    "age_bars": zone.age_bars + 1,
                }
            )
        if i >= 6:
            k = i - 3
            center = bars[k]
            window = bars[k - 3 : i + 1]
            for side in ("HIGH", "LOW"):
                price = center.high_decimal if side == "HIGH" else center.low_decimal
                peers = [x for n, x in enumerate(window) if n != 3]
                confirmed = all(
                    price > b.high_decimal if side == "HIGH" else price < b.low_decimal
                    for b in peers
                )
                if confirmed:
                    confirmed_pivot = Pivot(
                        side=side,
                        price=text(price),
                        candle_at=center.end_time.isoformat(),
                        available_at=at,
                    )
                    latest[side] = confirmed_pivot
                    pivots.append(confirmed_pivot)
        body = abs(c.close_decimal - c.open_decimal)
        width = c.high_decimal - c.low_decimal
        prior_atr = atr[boundary + i - 1] if i else None
        displacement = bool(
            prior_atr is not None
            and prior_atr > 0
            and width > 0
            and body >= prior_atr * Decimal("1.5")
            and body / width >= Decimal("0.6")
        )
        for side in ("HIGH", "LOW"):
            pivot = latest.get(side)
            if pivot is None or (side, pivot.candle_at) in broken:
                continue
            level = Decimal(pivot.price)
            bull = side == "HIGH"
            direction = "BULLISH" if bull else "BEARISH"
            crossed = c.close_decimal > level if bull else c.close_decimal < level
            swept = (
                (c.high_decimal > level and c.close_decimal < level)
                if bull
                else (c.low_decimal < level and c.close_decimal > level)
            )
            if crossed:
                kind = (
                    "INITIAL_BREAK" if bias == "UNKNOWN" else "BOS" if bias == direction else "MSS"
                )
                events.append(
                    StructureEvent(
                        kind=kind,
                        direction=direction,
                        level=pivot.price,
                        pivot_at=pivot.candle_at,
                        available_at=at,
                        displacement=displacement,
                    )
                )
                broken.add((side, pivot.candle_at))
                bias = direction
                # Opposite candle body zone within ten bars before a displacement break.
                if displacement:
                    for origin in reversed(bars[max(0, i - 10) : i]):
                        opposite = (
                            origin.close_decimal < origin.open_decimal
                            if bull
                            else (origin.close_decimal > origin.open_decimal)
                        )
                        if not opposite:
                            continue
                        key = (direction, origin.end_time.isoformat())
                        if key not in origins:
                            origins.add(key)
                            zones.append(
                                Zone(
                                    kind="ORDER_BLOCK",
                                    direction=direction,
                                    lower=text(min(origin.open_decimal, origin.close_decimal)),
                                    upper=text(max(origin.open_decimal, origin.close_decimal)),
                                    origin_at=key[1],
                                    available_at=at,
                                    status="FRESH",
                                    first_touched_at=None,
                                    resolved_at=None,
                                    age_bars=0,
                                    distance_from_quote="0",
                                )
                            )
                        break
            elif swept:
                events.append(
                    StructureEvent(
                        kind="SWEEP",
                        direction="BEARISH" if bull else "BULLISH",
                        level=pivot.price,
                        pivot_at=pivot.candle_at,
                        available_at=at,
                        displacement=displacement,
                    )
                )
        if i >= 2:
            left = bars[i - 2]
            bull_gap = c.low_decimal > left.high_decimal
            bear_gap = c.high_decimal < left.low_decimal
            if bull_gap or bear_gap:
                zones.append(
                    Zone(
                        kind="FVG",
                        direction="BULLISH" if bull_gap else "BEARISH",
                        lower=text(left.high_decimal if bull_gap else c.high_decimal),
                        upper=text(c.low_decimal if bull_gap else left.low_decimal),
                        origin_at=left.end_time.isoformat(),
                        available_at=at,
                        status="FRESH",
                        first_touched_at=None,
                        resolved_at=None,
                        age_bars=0,
                        distance_from_quote="0",
                    )
                )
    zones = [
        z.model_copy(
            update={
                "distance_from_quote": text(
                    max(Decimal(z.lower) - quote_mid, quote_mid - Decimal(z.upper), Decimal(0))
                )
            }
        )
        for z in zones
    ]
    active = [z for z in zones if z.status in {"FRESH", "TOUCHED"}]
    resolved = [z for z in zones if z.status in {"FILLED", "INVALIDATED"}]
    resolved.sort(key=lambda z: z.resolved_at or "")
    ranked: list[Zone] = []
    for z in active:
        lower, upper = Decimal(z.lower), Decimal(z.upper)
        distance = max(lower - quote_mid, quote_mid - upper, Decimal(0))
        overlaps = sum(
            other is not z
            and other.direction == z.direction
            and max(lower, Decimal(other.lower)) <= min(upper, Decimal(other.upper))
            for other in active
        )
        ranked.append(
            z.model_copy(
                update={
                    "distance_from_quote": text(distance),
                    "overlap_count": overlaps,
                }
            )
        )
    ranked.sort(key=lambda z: (Decimal(z.distance_from_quote), -z.overlap_count, z.age_bars))
    pools: list[LiquidityPool] = []
    grouped: list[list[Pivot]] = []
    tolerance = tick_size * 2
    for pivot in pivots:
        group = next(
            (
                g
                for g in grouped
                if g[0].side == pivot.side
                and abs(Decimal(g[0].price) - Decimal(pivot.price)) <= tolerance
            ),
            None,
        )
        if group is None:
            grouped.append([pivot])
        else:
            group.append(pivot)
    for group in grouped:
        if len(group) >= 2:
            pools.append(
                LiquidityPool(
                    kind="EQUAL_HIGHS" if group[0].side == "HIGH" else "EQUAL_LOWS",
                    level=group[0].price,
                    tolerance=text(tolerance),
                    confirmed_touches=len(group),
                    first_pivot_at=group[0].candle_at,
                    available_at=group[-1].available_at,
                )
            )
    pools.sort(key=lambda p: abs(Decimal(p.level) - quote_mid))
    # Validate final output types, including the bias literals.
    return FrameContext.model_validate(
        {
            "timeframe": series.timeframe,
            "candle_count": len(all_bars),
            "segment_candle_count": len(bars),
            "latest_completed_at": bars[-1].end_time.isoformat(),
            "bias": bias,
            "atr": text(atr[-1] or Decimal(0)),
            "ema_fast": text(fast[-1] or Decimal(0)),
            "ema_slow": text(slow[-1] or Decimal(0)),
            "rsi": decimal_text(rsis[-1]),
            "adx": decimal_text(adxs[-1]),
            "pivots": pivots[-12:],
            "events": events[-12:],
            "nearest_active_zones": ranked[:8],
            "recent_resolved_zones": resolved[-4:],
            "liquidity_pools": pools[:6],
            "active_zone_count": len(active),
            "resolved_zone_count": len(resolved),
            "previous_utc_day": previous_day(
                all_bars, {"M1": 60, "M5": 300, "M15": 900}[series.timeframe]
            ),
        }
    )
