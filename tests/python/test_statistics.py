from __future__ import annotations

from datetime import UTC, datetime

from python.analytics.models import PerformanceOutcome
from python.analytics.statistics import summarize


def test_performance_summary_is_decimal_safe() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    summary = summarize(
        [
            PerformanceOutcome(netPnl="18", closedAt=now),
            PerformanceOutcome(netPnl="-11", closedAt=now),
        ]
    )
    assert summary.realized_pnl == "7"
    assert summary.expectancy == "3.5"
    assert summary.profit_factor == "1.6363636363"
    assert summary.wins == 1
    assert summary.losses == 1
