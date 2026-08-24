from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal, localcontext
from itertools import pairwise
from typing import Protocol


class PriceBar(Protocol):
    @property
    def high(self) -> Decimal: ...

    @property
    def low(self) -> Decimal: ...

    @property
    def close(self) -> Decimal: ...


def _require_period(period: int) -> None:
    if period < 1:
        raise ValueError("period must be positive")


def ema(values: list[Decimal], period: int) -> list[Decimal]:
    """EMA seeded by the first observation, with no look-ahead."""
    _require_period(period)
    if not values:
        return []
    alpha = Decimal(2) / Decimal(period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append((value * alpha) + (result[-1] * (Decimal(1) - alpha)))
    return result


def true_ranges(bars: Sequence[PriceBar]) -> list[Decimal]:
    if not bars:
        return []
    ranges = [bars[0].high - bars[0].low]
    for previous, current in pairwise(bars):
        ranges.append(
            max(
                current.high - current.low,
                abs(current.high - previous.close),
                abs(current.low - previous.close),
            )
        )
    return ranges


def wilder_smoothing(values: list[Decimal], period: int) -> list[Decimal | None]:
    _require_period(period)
    result: list[Decimal | None] = [None] * len(values)
    if len(values) < period:
        return result
    current = sum(values[:period], Decimal(0)) / Decimal(period)
    result[period - 1] = current
    for index in range(period, len(values)):
        current = ((current * Decimal(period - 1)) + values[index]) / Decimal(period)
        result[index] = current
    return result


def atr_wilder(bars: Sequence[PriceBar], period: int = 15) -> list[Decimal | None]:
    return wilder_smoothing(true_ranges(bars), period)


def rsi_wilder(values: list[Decimal], period: int = 14) -> list[Decimal | None]:
    _require_period(period)
    result: list[Decimal | None] = [None] * len(values)
    if len(values) <= period:
        return result
    changes = [current - previous for previous, current in pairwise(values)]
    gains = [max(change, Decimal(0)) for change in changes]
    losses = [max(-change, Decimal(0)) for change in changes]
    average_gain = sum(gains[:period], Decimal(0)) / Decimal(period)
    average_loss = sum(losses[:period], Decimal(0)) / Decimal(period)

    def value(gain: Decimal, loss: Decimal) -> Decimal:
        if loss == 0:
            return Decimal(100) if gain > 0 else Decimal(50)
        relative_strength = gain / loss
        return Decimal(100) - (Decimal(100) / (Decimal(1) + relative_strength))

    result[period] = value(average_gain, average_loss)
    for value_index in range(period, len(changes)):
        average_gain = ((average_gain * Decimal(period - 1)) + gains[value_index]) / Decimal(period)
        average_loss = ((average_loss * Decimal(period - 1)) + losses[value_index]) / Decimal(
            period
        )
        result[value_index + 1] = value(average_gain, average_loss)
    return result


def adx(bars: Sequence[PriceBar], period: int = 14) -> list[Decimal | None]:
    """Wilder ADX. Values are unavailable until two smoothing windows complete."""
    _require_period(period)
    output: list[Decimal | None] = [None] * len(bars)
    if len(bars) < (period * 2):
        return output
    tr = true_ranges(bars)
    plus_dm = [Decimal(0)]
    minus_dm = [Decimal(0)]
    for previous, current in pairwise(bars):
        up = current.high - previous.high
        down = previous.low - current.low
        plus_dm.append(up if up > down and up > 0 else Decimal(0))
        minus_dm.append(down if down > up and down > 0 else Decimal(0))
    smooth_tr = wilder_smoothing(tr, period)
    smooth_plus = wilder_smoothing(plus_dm, period)
    smooth_minus = wilder_smoothing(minus_dm, period)
    dx: list[Decimal | None] = [None] * len(bars)
    for index in range(period - 1, len(bars)):
        tr_value = smooth_tr[index]
        plus_value = smooth_plus[index]
        minus_value = smooth_minus[index]
        if tr_value is None or plus_value is None or minus_value is None or tr_value == 0:
            continue
        plus_di = Decimal(100) * plus_value / tr_value
        minus_di = Decimal(100) * minus_value / tr_value
        denominator = plus_di + minus_di
        dx[index] = (
            Decimal(0) if denominator == 0 else Decimal(100) * abs(plus_di - minus_di) / denominator
        )
    available = [item for item in dx[period - 1 :] if item is not None]
    if len(available) < period:
        return output
    first_index = (period - 1) + period - 1
    current_adx = sum(available[:period], Decimal(0)) / Decimal(period)
    output[first_index] = current_adx
    for index in range(first_index + 1, len(bars)):
        dx_value = dx[index]
        if dx_value is None:
            continue
        current_adx = ((current_adx * Decimal(period - 1)) + dx_value) / Decimal(period)
        output[index] = current_adx
    return output


def realized_volatility(values: list[Decimal], window: int = 20) -> Decimal | None:
    _require_period(window)
    if len(values) <= window:
        return None
    with localcontext() as context:
        context.prec = 36
        returns = [
            (current / previous).ln() for previous, current in pairwise(values) if previous > 0
        ]
        sample = returns[-window:]
        if len(sample) < window:
            return None
        mean = sum(sample, Decimal(0)) / Decimal(window)
        variance = sum(((item - mean) ** 2 for item in sample), Decimal(0)) / Decimal(window)
        return variance.sqrt()


def bollinger_bandwidth(
    values: list[Decimal], period: int = 20, stddev: Decimal = Decimal(2)
) -> Decimal | None:
    _require_period(period)
    if len(values) < period:
        return None
    sample = values[-period:]
    mean = sum(sample, Decimal(0)) / Decimal(period)
    if mean == 0:
        return None
    variance = sum(((item - mean) ** 2 for item in sample), Decimal(0)) / Decimal(period)
    return (Decimal(2) * stddev * variance.sqrt()) / mean
