from datetime import UTC, datetime, timedelta
from decimal import Decimal

from python.analytics.models import Candle
from python.backtest import BacktestConfig, OrderLeg, simulate_oco


def bar(start: datetime, low: str, high: str) -> Candle:
    return Candle.model_validate(
        {
            "startTime": start.isoformat(),
            "endTime": (start + timedelta(minutes=1)).isoformat(),
            "open": "100.00",
            "high": high,
            "low": low,
            "close": "100.00",
            "volume": "10.00",
            "complete": True,
            "qualityFlags": [],
        }
    )


def legs(start: datetime) -> tuple[OrderLeg, OrderLeg]:
    expiry = start + timedelta(minutes=10)
    return (
        OrderLeg("BUY", Decimal("101"), Decimal("99"), Decimal("105"), expiry),
        OrderLeg("SELL", Decimal("98"), Decimal("100"), Decimal("94"), expiry),
    )


def test_same_bar_target_and_stop_uses_stop() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    buy, sell = legs(start)
    result = simulate_oco(
        [bar(start, "98.50", "106.00")],
        buy,
        sell,
        BacktestConfig(Decimal("0.01")),
    )
    assert result.status == "LOSS"
    assert result.filled_side == "BUY"
    assert result.exit_price == Decimal("99")
    assert result.reason_code == "CONSERVATIVE_SAME_BAR_STOP"


def test_costs_are_applied_against_the_trader() -> None:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    buy, sell = legs(start)
    result = simulate_oco(
        [bar(start, "100.00", "101.50"), bar(start + timedelta(minutes=1), "100.00", "105.00")],
        buy,
        sell,
        BacktestConfig(Decimal("0.01"), slippage_points=Decimal("2"), spread_points=Decimal("4")),
    )
    assert result.status == "WIN"
    assert result.fill_price == Decimal("101.04")
    assert result.pnl_per_unit == Decimal("3.96")
