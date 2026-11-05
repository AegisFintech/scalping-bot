from datetime import UTC, datetime, timedelta

import pytest

from python.operations.daily_trading_net import summarize_day
from python.operations.demo_scorecards import CloseDeal

NOW = datetime(2026, 11, 5, 9, 10, tzinfo=UTC)


def test_daily_net_keeps_prior_release_losses_and_signed_fees_once():
    rows = [
        (
            "0.10.0-demo-trials.1-codex.1",
            CloseDeal(
                occurredAt=(NOW - timedelta(hours=1)).isoformat(),
                recordedAt=(NOW - timedelta(hours=1)).isoformat(),
                net="-1846.13",
                signedFeesIncluded="-1558.78",
            ),
        ),
        (
            "0.11.0-trend-retest.1-codex.1",
            CloseDeal(
                occurredAt=(NOW - timedelta(minutes=1)).isoformat(),
                recordedAt=(NOW - timedelta(minutes=1)).isoformat(),
                net="100",
                signedFeesIncluded="-10",
            ),
        ),
    ]
    result = summarize_day(rows, NOW, "USD", 1, 1)
    assert result.totals.recordedNet == "-1746.13"
    assert result.totals.signedFeesIncluded == "-1568.78"
    assert result.totals.closeDeals == 2
    assert [r.recordedNet for r in result.releases] == ["-1846.13", "100"]
    assert result.totals.since == "2026-11-04T16:00:00+00:00"
    assert not result.totals.completeCalendarDay
    assert result.openJournalPositions == 1 and result.scopeUnresolvedEvents == 1
    assert result.actualModelSpend is None and result.openBrokerMark is None
    assert result.accountReturn is None and not result.economicQualification


def test_singapore_day_and_recorded_cutoff_keep_unknown_rows_out_of_totals():
    def deal(at, recorded=None):
        return CloseDeal(
            occurredAt=at.isoformat(),
            recordedAt=(recorded or at).isoformat(),
            net="100",
            signedFeesIncluded="-7",
        )

    start = datetime(2026, 11, 4, 16, tzinfo=UTC)
    result = summarize_day(
        [
            ("old", deal(start - timedelta(microseconds=1))),
            ("old", deal(start)),
            ("new", deal(NOW)),
            ("new", deal(NOW - timedelta(seconds=1), NOW + timedelta(seconds=1))),
        ],
        NOW,
        "USD",
        0,
        0,
    )
    assert result.totals.recordedNet == "100"
    assert result.totals.closeDeals == 1
    assert [r.release for r in result.releases] == ["old"]
    empty = summarize_day([], start, "USD", 0, 0)
    assert empty.totals.recordedNet == "0" and empty.totals.closeDeals == 0
    assert empty.totals.since == empty.totals.until
    assert not empty.totals.completeCalendarDay
    with pytest.raises(ValueError, match="TIMEZONE_REQUIRED"):
        summarize_day([], NOW.replace(tzinfo=None), "USD", 0, 0)
    with pytest.raises(ValueError, match="DEAL_LIMIT"):
        summarize_day([("new", deal(NOW))] * 5001, NOW, "USD", 0, 0)


def test_missing_demo_configuration_never_connects_or_reports_zero(monkeypatch):
    from python.operations.daily_trading_net import load

    monkeypatch.setenv("TRADING_MODE", "paper")
    monkeypatch.setattr("psycopg.connect", lambda *a, **k: pytest.fail("must not connect"))
    assert load(NOW) is None


def test_daily_schema_matches_typed_projection():
    import json
    from pathlib import Path

    from python.operations.daily_trading_net import DailyTradingNet

    assert json.loads(Path("schemas/daily-trading-net-1.0.json").read_bytes()) == (
        DailyTradingNet.model_json_schema()
    )


def test_daily_loader_uses_real_scoped_read_only_sql_and_withholds_ambiguous_identity(monkeypatch):
    import hashlib
    import os
    from uuid import uuid4

    import psycopg

    from python.operations.daily_trading_net import load

    dsn = os.getenv("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("requires isolated PostgreSQL")
    schema = "daily_" + uuid4().hex
    connect = psycopg.connect
    key = "daily-fixture"
    with connect(dsn, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
        try:
            admin.execute(f'SET search_path="{schema}"')
            admin.execute("""
                CREATE TABLE accounts(id text, provider text, environment text, currency text,
                    provider_account_key_hash text);
                CREATE TABLE symbols(id text, account_id text, name text);
                CREATE TABLE strategy_versions(id text, version text);
                CREATE TABLE analysis_runs(id text, account_id text, symbol_id text,
                    strategy_version_id text);
                CREATE TABLE order_groups(id text, analysis_id text, mode text);
                CREATE TABLE positions(id text, account_id text, symbol_id text, order_group_id
                    text, strategy_owned boolean, state text);
                CREATE TABLE position_close_deals(position_id text, account_id text, symbol_id
                    text, occurred_at timestamptz, recorded_at timestamptz, broker_deal_id text,
                    gross_profit numeric, commission numeric, swap numeric, conversion_fee
                    numeric);
                CREATE TABLE broker_execution_events(account_id text, symbol_id text,
                    resolved_at timestamptz, mapping_state text, reason_codes jsonb);
                INSERT INTO symbols VALUES('s', 'a', 'XAUUSD'), ('other', 'a', 'EURUSD');
                INSERT INTO strategy_versions VALUES('v1', 'old'), ('v2', 'new');
                INSERT INTO analysis_runs VALUES('a1', 'a', 's', 'v1'), ('a2', 'a', 's', 'v2'),
                    ('a3', 'a', 'other', 'v1');
                INSERT INTO order_groups VALUES('g1', 'a1', 'demo'), ('g2', 'a2', 'demo'),
                    ('g3', 'a3', 'demo');
                INSERT INTO positions VALUES('p1', 'a', 's', 'g1', true, 'CLOSED'), ('p2', 'a',
                    's', 'g2', true, 'OPEN'), ('manual', 'a', 's', 'g1', false, 'CLOSED'),
                    ('p3', 'a', 'other', 'g3', true, 'CLOSED');
            """)
            admin.execute(
                "INSERT INTO accounts VALUES('a','ctrader','demo','USD',%s)",
                (hashlib.sha256(key.encode()).hexdigest(),),
            )
            at = NOW - timedelta(minutes=1)
            for position, symbol, gross, fees, recorded in [
                ("p1", "s", "-100", "-10", at),
                ("p2", "s", "50", "-5", at),
                ("p2", "s", "1", "-1", at),
                ("manual", "s", "1000", "0", at),
                ("p3", "other", "1000", "0", at),
                ("p1", "s", "1000", "0", NOW + timedelta(seconds=1)),
            ]:
                admin.execute(
                    "INSERT INTO position_close_deals VALUES(%s,'a',%s,%s,%s,%s,%s,%s,0,0)",
                    (position, symbol, at, recorded, str(uuid4()), gross, fees),
                )
            admin.execute(
                "INSERT INTO broker_execution_events VALUES('a','s',NULL,'UNMAPPED','[]')"
            )

            def scoped(*args, **kwargs):
                assert "default_transaction_read_only=on" in kwargs["options"]
                assert "statement_timeout=1500" in kwargs["options"]
                kwargs["options"] += " -c search_path=" + schema
                return connect(*args, **kwargs)

            monkeypatch.setattr(psycopg, "connect", scoped)
            monkeypatch.setenv("DATABASE_URL", dsn)
            monkeypatch.setenv("ACCOUNT_KEY", key)
            monkeypatch.setenv("TRADING_MODE", "demo")
            result = load(NOW)
            assert result is not None
            assert result["totals"]["recordedNet"] == "-65"
            assert result["totals"]["signedFeesIncluded"] == "-16"
            assert result["totals"]["closeDeals"] == 3
            assert result["scopeUnresolvedEvents"] == result["openJournalPositions"] == 1
            assert [(r["release"], r["recordedNet"]) for r in result["releases"]] == [
                ("new", "45"),
                ("old", "-110"),
            ]
            for occurred in [datetime(2026, 11, 4, 15, 59, 59, tzinfo=UTC), NOW]:
                admin.execute(
                    "INSERT INTO position_close_deals VALUES('p1','a','s',%s,%s,%s,1000,0,0,0)",
                    (occurred, NOW, str(uuid4())),
                )
            admin.execute("INSERT INTO order_groups VALUES('paper','a1','paper')")
            admin.execute("INSERT INTO positions VALUES('paper','a','s','paper',true,'CLOSED')")
            for position, account in [("paper", "a"), ("p1", "another-account")]:
                admin.execute(
                    "INSERT INTO position_close_deals VALUES(%s,%s,'s',%s,%s,%s,1000,0,0,0)",
                    (position, account, at, at, str(uuid4())),
                )
            assert load(NOW)["totals"]["recordedNet"] == "-65"
            admin.execute(
                "INSERT INTO position_close_deals SELECT 'p1','a','s',%s,%s,"
                "'cap-'||n,0,0,0,0 FROM generate_series(1,4997) AS n",
                (at, at),
            )
            assert load(NOW)["totals"]["closeDeals"] == 5000
            admin.execute(
                "INSERT INTO position_close_deals VALUES('p1','a','s',%s,%s,'overflow',0,0,0,0)",
                (at, at),
            )
            assert load(NOW) is None
            admin.execute(
                "DELETE FROM position_close_deals WHERE broker_deal_id LIKE 'cap-%' "
                "OR broker_deal_id='overflow'"
            )
            admin.execute("INSERT INTO symbols VALUES('duplicate','a','XAUUSD')")
            assert load(NOW) is None
            admin.execute("DELETE FROM symbols WHERE id='duplicate'")
            admin.execute("DROP TABLE position_close_deals")
            assert load(NOW) is None
        finally:
            admin.execute("SET search_path=public")
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
