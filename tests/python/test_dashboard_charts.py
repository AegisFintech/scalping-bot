from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pandas as pd
import pytest

from apps.dashboard.charts import (
    ChartDataError,
    audit_events_figure,
    completed_candles_figure,
    daily_risk_figure,
    execution_events_figure,
    indicators_figure,
    market_quality_figure,
)


def test_completed_candles_build_price_and_volume_panels() -> None:
    data = pd.DataFrame(
        [
            {
                "start_time": datetime(2026, 8, 24, 4, 0, tzinfo=UTC),
                "open": Decimal("2000.10"),
                "high": Decimal("2001.00"),
                "low": Decimal("1999.90"),
                "close": Decimal("2000.80"),
                "volume": Decimal("42"),
                "complete": True,
            }
        ]
    )
    figure = completed_candles_figure(data, "M1")
    assert figure is not None
    assert len(figure.data) == 2
    assert figure.layout.title.text == "M1 completed candles"


def test_completed_candles_reject_forming_or_invalid_candles() -> None:
    forming = pd.DataFrame(
        [
            {
                "start_time": "2026-08-24T04:00:00Z",
                "open": "2000",
                "high": "1999",
                "low": "1998",
                "close": "2000",
                "volume": "1",
                "complete": False,
            }
        ]
    )
    with pytest.raises(ChartDataError, match="CHART_FORMING_CANDLE_REJECTED"):
        completed_candles_figure(forming, "M1")
    forming["complete"] = True
    with pytest.raises(ChartDataError, match="CHART_OHLC_INVALID"):
        completed_candles_figure(forming, "M1")


def test_indicator_and_market_quality_figures_handle_decimal_rows() -> None:
    timestamp = "2026-08-24T04:00:00Z"
    indicators = indicators_figure(
        pd.DataFrame(
            [
                {
                    "generated_at": timestamp,
                    "atr": Decimal("1.25"),
                    "ema_fast": Decimal("2000.5"),
                    "ema_slow": Decimal("1999.8"),
                }
            ]
        )
    )
    assert indicators is not None
    assert len(indicators.data) == 3
    quality = market_quality_figure(
        pd.DataFrame(
            [
                {
                    "source_time": timestamp,
                    "spread": Decimal("0.2"),
                    "age_ms": 20,
                    "imbalance_top5": Decimal("0.1"),
                    "imbalance_top10": Decimal("0.05"),
                    "imbalance_top20": None,
                    "discontinuity": False,
                }
            ]
        )
    )
    assert quality is not None
    assert len(quality.data) == 4


def test_market_quality_rejects_out_of_range_imbalance() -> None:
    data = pd.DataFrame(
        [
            {
                "source_time": "2026-08-24T04:00:00Z",
                "spread": "0.2",
                "age_ms": 20,
                "imbalance_top5": "1.1",
                "imbalance_top10": None,
                "imbalance_top20": None,
                "discontinuity": False,
            }
        ]
    )
    with pytest.raises(ChartDataError, match="CHART_IMBALANCE_INVALID"):
        market_quality_figure(data)


def test_daily_risk_keeps_modes_in_distinct_traces() -> None:
    data = pd.DataFrame(
        [
            {
                "trading_day": "2026-08-23",
                "mode": "paper",
                "baseline_equity": "10000",
                "current_equity": "9990",
                "loss_percent": "0.1",
                "locked_out": False,
            },
            {
                "trading_day": "2026-08-24",
                "mode": "demo",
                "baseline_equity": "10000",
                "current_equity": "10005",
                "loss_percent": "0",
                "locked_out": False,
            },
        ]
    )
    figure = daily_risk_figure(data)
    assert figure is not None
    names = {trace.name for trace in figure.data}
    assert "paper equity" in names
    assert "demo equity" in names


def test_event_figures_reject_unknown_enums_and_accept_empty_data() -> None:
    assert execution_events_figure(pd.DataFrame()) is None
    assert audit_events_figure(pd.DataFrame()) is None
    with pytest.raises(ChartDataError, match="CHART_MAPPING_STATE_INVALID"):
        execution_events_figure(
            pd.DataFrame([{"occurred_at": "2026-08-24T04:00:00Z", "mapping_state": "MAYBE"}])
        )
    with pytest.raises(ChartDataError, match="CHART_SEVERITY_INVALID"):
        audit_events_figure(
            pd.DataFrame([{"occurred_at": "2026-08-24T04:00:00Z", "severity": "panic"}])
        )
