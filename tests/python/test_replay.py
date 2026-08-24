from datetime import UTC, datetime, timedelta

import pytest

from python.analytics.models import Candle
from python.replay import ReplayError, completed_snapshot


def make_candle(start: datetime, minutes: int, complete: bool = True) -> Candle:
    return Candle.model_validate(
        {
            "startTime": start.isoformat(),
            "endTime": (start + timedelta(minutes=minutes)).isoformat(),
            "open": "100.00",
            "high": "102.00",
            "low": "99.00",
            "close": "101.00",
            "volume": "10.00",
            "complete": complete,
            "qualityFlags": [],
        }
    )


def test_snapshot_never_selects_future_candle() -> None:
    analysis_time = datetime(2026, 1, 1, 12, tzinfo=UTC)
    series: dict[str, list[Candle]] = {}
    for timeframe, minutes in (("M1", 1), ("M5", 5), ("M15", 15)):
        earlier = make_candle(analysis_time - timedelta(minutes=minutes), minutes)
        future = make_candle(analysis_time, minutes)
        series[timeframe] = [earlier, future]
    snapshot = completed_snapshot(series, analysis_time, {"M1": 1, "M5": 1, "M15": 1})
    assert all(items[-1].end_time == analysis_time for items in snapshot.values())


def test_missing_completed_history_is_rejected_not_padded() -> None:
    analysis_time = datetime(2026, 1, 1, 12, tzinfo=UTC)
    series = {
        timeframe: [make_candle(analysis_time - timedelta(minutes=minutes), minutes)]
        for timeframe, minutes in (("M1", 1), ("M5", 5), ("M15", 15))
    }
    with pytest.raises(ReplayError, match="M1_INSUFFICIENT_COMPLETED_HISTORY"):
        completed_snapshot(series, analysis_time, {"M1": 2, "M5": 1, "M15": 1})
