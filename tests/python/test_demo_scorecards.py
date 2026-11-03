from datetime import UTC, datetime, timedelta
from decimal import Decimal

import psycopg
import pytest

from python.operations.demo_scorecards import CloseDeal, bounds, load, summarize

NOW = datetime(2026, 11, 3, 17, tzinfo=UTC)
START = NOW - timedelta(days=2)


def deal(at: datetime, net: str, fees: str = "-7", recorded: datetime | None = None):
    return CloseDeal(
        occurredAt=at.isoformat(),
        recordedAt=(recorded or at).isoformat(),
        net=net,
        signedFeesIncluded=fees,
    )


def test_sg_days_keep_net_and_signed_fees_separate():
    rows = [deal(NOW - timedelta(hours=2), "93"), deal(NOW - timedelta(minutes=10), "-107")]
    result = summarize(rows, START, NOW, "USD", 0, 1)
    assert [(d.day.isoformat(), d.recordedNet) for d in result.days] == [
        ("2026-11-02", "0"),
        ("2026-11-03", "93"),
        ("2026-11-04", "-107"),
    ]
    assert result.recordedNet == "-14"
    assert sum(Decimal(d.signedFeesIncluded) for d in result.days) == Decimal("-14")
    assert result.realizedLedgerDrawdownLowerBound == "107"
    assert result.completePositiveDays == 1
    assert result.completeNegativeDays == 0
    assert result.openJournalPositions == 1
    assert result.accountReturn is result.externalCashflows is result.actualModelSpend is None
    assert result.openBrokerMark is result.equityDrawdown is None
    assert not result.economicQualification


def test_partial_first_and_current_days_do_not_count_as_complete_green_days():
    result = summarize(
        [deal(START + timedelta(minutes=1), "10"), deal(NOW - timedelta(seconds=1), "10")],
        START,
        NOW,
        "USD",
        0,
        0,
    )
    assert [d.completeCalendarDay for d in result.days] == [False, True, False]
    assert result.completePositiveDays == 0
    assert result.recordedNet == "20"


def test_missing_scope_reconciliation_withholds_day_classification():
    r = summarize([deal(NOW - timedelta(days=1), "100")], START, NOW, "USD", 1, 0)
    assert r.recordedNet == "100"
    assert r.completePositiveDays is r.completeNegativeDays is r.completeFlatDays is None


def test_equal_time_deals_do_not_invent_within_timestamp_drawdown():
    at = NOW - timedelta(minutes=1)
    a, b = deal(at, "100"), deal(at, "-100")
    assert summarize([a, b], START, NOW, "USD", 0, 0) == summarize([b, a], START, NOW, "USD", 0, 0)
    assert summarize([a, b], START, NOW, "USD", 0, 0).realizedLedgerDrawdownLowerBound == "0"


def test_cutoff_is_half_open_and_later_known_rows_are_not_backdated():
    r = summarize(
        [
            deal(NOW, "100"),
            deal(NOW - timedelta(minutes=1), "100", recorded=NOW + timedelta(seconds=1)),
        ],
        START,
        NOW,
        "USD",
        0,
        0,
    )
    assert r.recordedNet == "0"
    assert sum(d.closeDeals for d in r.days) == 0


def test_known_future_broker_clock_is_unavailable():
    with pytest.raises(ValueError, match=r"CLOSE_CLOCK_UNORDERED|FUTURE_BROKER_CLOCK"):
        summarize([deal(NOW + timedelta(seconds=1), "100", recorded=NOW)], START, NOW, "USD", 0, 0)


def test_seven_sg_dates_and_midnight_keep_current_empty_day():
    midnight = datetime(2026, 11, 3, 16, tzinfo=UTC)
    r = summarize([], START - timedelta(days=20), midnight, "USD", 0, 0)
    assert len(r.days) == 7
    assert r.days[-1].day.isoformat() == "2026-11-04"
    assert r.days[-1].since == r.days[-1].until
    assert not r.days[-1].completeCalendarDay
    assert r.completeFlatDays == 6


def test_decimal_zero_is_not_encoded_as_an_exponent():
    r = summarize(
        [deal(NOW - timedelta(seconds=1), "0.0000000000", "0.0000000000")], START, NOW, "USD", 0, 0
    )
    assert Decimal(r.recordedNet) == 0
    assert "E" not in r.recordedNet


def test_limits_and_naive_windows_reject():
    with pytest.raises(ValueError, match="DEAL_LIMIT"):
        summarize([deal(NOW - timedelta(seconds=1), "1")] * 5001, START, NOW, "USD", 0, 0)
    with pytest.raises(ValueError, match="WINDOW_INVALID"):
        bounds(START.replace(tzinfo=None), NOW)


def test_missing_demo_scope_never_connects(monkeypatch):
    monkeypatch.setenv("TRADING_MODE", "paper")
    monkeypatch.setenv("ACCOUNT_KEY", "fixture")
    monkeypatch.setenv("DATABASE_URL", "fixture")
    monkeypatch.setattr("psycopg.connect", lambda *a, **k: pytest.fail("must not connect"))
    assert load(NOW) is None


def test_database_unavailable_withholds_scorecard(monkeypatch):
    monkeypatch.setenv("TRADING_MODE", "demo")
    monkeypatch.setenv("ACCOUNT_KEY", "fixture")
    monkeypatch.setenv("DATABASE_URL", "fixture")

    def unavailable(*args, **kwargs):
        assert "default_transaction_read_only=on" in kwargs["options"]
        raise psycopg.OperationalError("fixture unavailable")

    monkeypatch.setattr("psycopg.connect", unavailable)
    assert load(NOW) is None
