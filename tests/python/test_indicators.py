from dataclasses import dataclass
from decimal import Decimal

from python.indicators import atr_wilder, ema, rsi_wilder


@dataclass(frozen=True)
class Bar:
    high: Decimal
    low: Decimal
    close: Decimal


def test_ema_uses_first_value_seed_without_lookahead() -> None:
    values = [Decimal("10"), Decimal("11"), Decimal("12")]
    assert ema(values, 3) == [Decimal("10"), Decimal("10.5"), Decimal("11.25")]


def test_atr_uses_wilder_smoothing() -> None:
    bars = [
        Bar(Decimal("11"), Decimal("9"), Decimal("10")),
        Bar(Decimal("13"), Decimal("10"), Decimal("12")),
        Bar(Decimal("14"), Decimal("11"), Decimal("13")),
        Bar(Decimal("16"), Decimal("12"), Decimal("15")),
    ]
    assert atr_wilder(bars, 3) == [
        None,
        None,
        Decimal("2.666666666666666666666666667"),
        Decimal("3.111111111111111111111111111"),
    ]


def test_rsi_flat_series_is_neutral() -> None:
    assert rsi_wilder([Decimal("10")] * 8, 3)[-1] == Decimal("50")


def test_invalid_period_is_rejected() -> None:
    try:
        ema([Decimal("1")], 0)
    except ValueError as error:
        assert str(error) == "period must be positive"
    else:
        raise AssertionError("zero period was accepted")
