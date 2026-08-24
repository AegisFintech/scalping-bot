from __future__ import annotations

from datetime import datetime

from python.analytics.models import Candle


class ReplayError(ValueError):
    pass


def completed_snapshot(
    series: dict[str, list[Candle]],
    analysis_time: datetime,
    expected_counts: dict[str, int],
) -> dict[str, list[Candle]]:
    """Select only candles completed by analysis_time; never pads missing history."""
    snapshot: dict[str, list[Candle]] = {}
    for timeframe in ("M1", "M5", "M15"):
        candles = sorted(series.get(timeframe, []), key=lambda candle: candle.end_time)
        completed = [
            candle for candle in candles if candle.complete and candle.end_time <= analysis_time
        ]
        count = expected_counts[timeframe]
        if len(completed) < count:
            raise ReplayError(f"{timeframe}_INSUFFICIENT_COMPLETED_HISTORY")
        selected = completed[-count:]
        if any(candle.end_time > analysis_time for candle in selected):
            raise ReplayError(f"{timeframe}_LOOKAHEAD_DETECTED")
        snapshot[timeframe] = selected
    return snapshot
