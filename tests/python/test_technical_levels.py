from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from python.technical import levels as lv

START = datetime(2026, 10, 27, 4, tzinfo=UTC)
TICK = Decimal("0.01")


@dataclass(frozen=True)
class Bar:
    start_time: datetime
    end_time: datetime
    open_decimal: Decimal
    high_decimal: Decimal
    low_decimal: Decimal
    close_decimal: Decimal
    quality_flags: list[str] = field(default_factory=list)


def bars(
    rows: list[tuple[str, str, str, str]], minutes: int = 1, at: datetime = START
) -> list[Bar]:
    step = timedelta(minutes=minutes)
    return [
        Bar(at + i * step, at + (i + 1) * step, *(Decimal(v) for v in row))
        for i, row in enumerate(rows)
    ]


def flat(count: int, price: str = "4000") -> list[tuple[str, str, str, str]]:
    p = Decimal(price)
    return [(str(p), str(p + Decimal("0.5")), str(p - Decimal("0.5")), str(p))] * count


def test_text_is_the_truncating_service_boundary_form() -> None:
    assert lv.text(Decimal("4000.1200")) == "4000.12"
    assert lv.text(Decimal("0.123456789019")) == "0.123456789"
    assert lv.text(Decimal("-0")) == "0" and lv.text(Decimal(4000)) == "4000"
    with pytest.raises(ValueError, match="NON_FINITE"):
        lv.text(Decimal("NaN"))


def test_pivots_are_strict_fractals_available_after_three_right_candles() -> None:
    rows = flat(10)
    rows[4] = ("4000", "4003", "3999.5", "4001")
    rows[6] = ("4000", "4000.5", "3998", "3999")
    series = bars(rows)
    pivots = lv.swing_pivots(series)
    high = next(p for p in pivots if p.side == "HIGH")
    assert high.price == Decimal(4003) and high.candle_at == series[4].end_time
    assert high.available_at == series[7].end_time
    low = next(p for p in pivots if p.side == "LOW")
    assert low.price == Decimal(3998) and low.available_at == series[9].end_time
    # An equal neighbouring high is not a strict fractal.
    rows[5] = ("4000", "4003", "3999.5", "4000")
    assert not [p for p in lv.swing_pivots(bars(rows)) if p.side == "HIGH"]


def test_support_resistance_clusters_pivots_with_atr_tolerance_and_later_trades() -> None:
    at = START
    p = [
        lv.SwingPivot("HIGH", Decimal("4010.00"), at, at + timedelta(minutes=3)),
        lv.SwingPivot(
            "HIGH", Decimal("4010.20"), at + timedelta(minutes=20), at + timedelta(minutes=23)
        ),
        lv.SwingPivot(
            "LOW", Decimal("4010.10"), at + timedelta(minutes=30), at + timedelta(minutes=33)
        ),
        lv.SwingPivot(
            "LOW", Decimal("3995.00"), at + timedelta(minutes=10), at + timedelta(minutes=13)
        ),
        lv.SwingPivot(
            "LOW", Decimal("3995.40"), at + timedelta(minutes=40), at + timedelta(minutes=43)
        ),
        lv.SwingPivot(
            "HIGH", Decimal("4020.00"), at + timedelta(minutes=5), at + timedelta(minutes=8)
        ),
    ]
    later = bars([("4005", "4010.5", "4004", "4006")], at=at + timedelta(minutes=50))
    result = lv.support_resistance("M5", later, p, Decimal("4005"), Decimal("1.6"), TICK)
    assert [r["id"] for r in result] == ["M5-L1", "M5-L2"]
    resistance, support = result
    assert resistance["role"] == "RESISTANCE" and resistance["touches"] == 3
    assert (resistance["lower"], resistance["upper"]) == ("4010", "4010.2")
    assert resistance["high_pivots"] == 2 and resistance["low_pivots"] == 1
    assert resistance["traded_above_after"] is True and resistance["tolerance"] == "0.4"
    assert support["role"] == "SUPPORT" and support["traded_below_after"] is False
    assert support["distance_from_quote"] == "9.6"
    # A lone pivot is never a level and tolerance never drops below two ticks.
    lone = lv.support_resistance("M1", [], p[:1], Decimal(4000), Decimal(0), TICK)
    assert lone == []


def test_dealing_range_spans_the_latest_swing_leg() -> None:
    at = START
    high = lv.SwingPivot("HIGH", Decimal("4010"), at, at + timedelta(minutes=3))
    low = lv.SwingPivot(
        "LOW", Decimal("4000"), at + timedelta(minutes=5), at + timedelta(minutes=8)
    )
    premium = lv.dealing_range([high, low], Decimal("4007.5"), TICK)
    assert premium["position"] == "PREMIUM" and premium["equilibrium"] == "4005"
    assert (premium["high"], premium["low"], premium["position_fraction"]) == (
        "4010",
        "4000",
        "0.75",
    )
    assert lv.dealing_range([high, low], Decimal("4002"), TICK)["position"] == "DISCOUNT"
    assert lv.dealing_range([high, low], Decimal("4011"), TICK)["position"] == "ABOVE_RANGE"
    assert lv.dealing_range([high, low], Decimal("3999"), TICK)["position"] == "BELOW_RANGE"
    # A newer low above the only earlier high has no completed leg yet.
    higher = lv.SwingPivot(
        "LOW", Decimal("4012"), at + timedelta(minutes=9), at + timedelta(minutes=12)
    )
    assert lv.dealing_range([high, higher], Decimal("4013"), TICK)["position"] == "UNAVAILABLE"
    # The newest high pairs with the latest earlier low below it.
    top = lv.SwingPivot(
        "HIGH", Decimal("4020"), at + timedelta(minutes=14), at + timedelta(minutes=17)
    )
    leg = lv.dealing_range([high, low, higher, top], Decimal("4019"), TICK)
    assert (leg["low"], leg["high"], leg["position"]) == ("4012", "4020", "PREMIUM")
    assert lv.dealing_range([high], Decimal("4005"), TICK) == {
        "high": None,
        "high_at": None,
        "low": None,
        "low_at": None,
        "equilibrium": None,
        "position": "UNAVAILABLE",
        "position_fraction": None,
    }


def test_zone_midpoint_and_penetration_use_only_later_candles() -> None:
    available = START + timedelta(minutes=2)
    zone = SimpleNamespace(
        lower="4000", upper="4001", direction="BULLISH", available_at=available.isoformat()
    )
    series = bars([("4002", "4003", "3999", "4002"), ("4002", "4003", "4002", "4002")] * 2)
    # The first two candles end at or before availability and cannot count.
    extension = lv.zone_extension(zone, series[:2], TICK)
    assert extension == {"midpoint": "4000.5", "penetration_fraction": "0"}
    assert lv.zone_extension(zone, series, TICK)["penetration_fraction"] == "1"
    shallow = bars([("4002", "4003", "4000.75", "4002")], at=available)
    assert lv.zone_extension(zone, shallow, TICK)["penetration_fraction"] == "0.25"
    bearish = SimpleNamespace(
        lower="4000.005", upper="4000.005", direction="BEARISH", available_at=START.isoformat()
    )
    assert lv.zone_extension(bearish, shallow, TICK) == {
        "midpoint": "4000.01",
        "penetration_fraction": "1",
    }


def test_candle_anatomy_is_bounded_and_never_compares_across_a_gap() -> None:
    rows = flat(20)
    rows[17] = ("4001", "4001.2", "3999.8", "4000")
    rows[18] = ("3999.9", "4001.3", "3999.7", "4001.25")
    rows[19] = ("4001", "4001.1", "4000.9", "4001")
    series = bars(rows)
    result = lv.anatomy("M1", series, 0)
    assert len(result) == 5 and result[-1]["end_at"] == series[-1].end_time.isoformat()
    engulf = result[3]
    assert engulf["direction"] == "UP" and engulf["engulfing"] is True
    assert engulf["close_location"] == "0.96" and engulf["upper_wick_fraction"] == "0.03"
    doji = result[4]
    assert doji["direction"] == "DOJI" and doji["inside_bar"] is True
    assert doji["body_fraction"] == "0" and doji["displacement"] is False
    gapped = lv.anatomy("M5", series, 19)
    assert len(gapped) == 1 and gapped[0]["inside_bar"] is False
    big = flat(20)
    big[19] = ("4000", "4004", "4000", "4003.9")
    assert lv.anatomy("M15", bars(big), 0)[-1]["displacement"] is True
    # The first candle after a gap has no in-segment ATR, so no displacement or ratio.
    first = lv.anatomy("M15", bars(big), 19)[-1]
    assert first["displacement"] is False and first["range_to_atr"] is None


def test_m1_envelopes_use_exact_extremes_and_latest_ties() -> None:
    rows = flat(25)
    rows[-2] = ("4000", "4001.5", "3999.5", "4000")
    rows[-1] = ("4000", "4001.5", "3998.2", "4000")
    series = bars(rows)
    result = lv.envelopes(series, Decimal("1.1"))
    assert [e["candles"] for e in result] == [3, 5, 10, 20]
    three = result[0]
    assert (three["high"], three["low"], three["width"]) == ("4001.5", "3998.2", "3.3")
    assert three["high_at"] == series[-1].end_time.isoformat()
    assert three["width_to_atr"] == "3"
    assert lv.envelopes(series[:4], Decimal(0))[0]["width_to_atr"] is None
    assert [e["candles"] for e in lv.envelopes(series[:4], Decimal(1))] == [3]


def test_sessions_are_utc_conventions_with_explicit_partial_status() -> None:
    day = datetime(2026, 10, 27, tzinfo=UTC)
    previous = bars(flat(288), minutes=5, at=day - timedelta(days=1))
    today = bars(flat(100), minutes=5, at=day)  # through 08:20 UTC
    result = lv.sessions(previous + today)
    assert [(r["session"], r["status"]) for r in result[:2]] == [
        ("LONDON", "IN_PROGRESS"),
        ("ASIA", "COMPLETE"),
    ]
    assert [r["session"] for r in result[2:]] == ["NEW_YORK", "LONDON", "ASIA"]
    assert all(r["status"] == "COMPLETE" for r in result[2:])
    missing = previous[:100] + previous[101:] + today
    partial = lv.sessions(missing)
    assert [r["status"] for r in partial][2:] == [
        "COMPLETE",
        "PARTIAL_OR_UNAVAILABLE",
        "COMPLETE",
    ]
    # Partial windows are censored rather than publishing incomplete extremes.
    assert partial[3]["high"] is None and partial[3]["low"] is None
    weekend = lv.sessions(today[:10])
    assert weekend[1]["session"] == "NEW_YORK" and weekend[1]["high"] is None
    assert lv.sessions([]) == []


def test_round_levels_bracket_the_quote_per_step() -> None:
    result = lv.round_levels(Decimal("4008.455"))
    assert [(r["price"], r["step"], r["side"]) for r in result] == [
        ("4005", "5", "BELOW"),
        ("4010", "5", "ABOVE"),
        ("4000", "10", "BELOW"),
        ("4010", "10", "ABOVE"),
    ]
    assert result[1]["distance_from_quote"] == "1.545"
