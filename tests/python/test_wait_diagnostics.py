import json
from datetime import UTC, datetime
from unittest.mock import Mock

import pytest

from apps.dashboard.landscape_data import landscape_events
from apps.dashboard.landscape_model import event_tape

NOW = datetime(2026, 11, 6, tzinfo=UTC)


def recorded_input() -> str:
    columns = [
        "startTime",
        "endTime",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "complete",
        "qualityFlags",
    ]
    return json.dumps(
        {
            "candles": [
                {
                    "timeframe": frame,
                    "columns": columns,
                    "rows": [
                        ["start", "end", "4000", "4001", "3999", "4000", "1", True, []]
                        for _ in range(count)
                    ],
                }
                for frame, count in [("M1", 6), ("M5", 12), ("M15", 12)]
            ]
        }
    )


def context(**patch: object) -> dict:
    return dict(
        kind="context",
        id="private-id",
        state="READY",
        requested_at=NOW,
        available_at=NOW,
        completed_at=NOW,
        plan_schema="entry-wait-1.0",
        wait_reason="No confirmed breakout.",
        trend_context=True,
        **patch,
    )


def read_context(value: dict) -> dict:
    read = Mock(side_effect=[[], [value], [], [], []])
    result = landscape_events(read, ("account", "symbol", "demo"))
    assert "provider_input" not in result[0]
    sql = read.call_args_list[1].args[0]
    assert "octet_length" in sql and "context_provider_evidence" in sql
    assert "LIMIT 12" in sql and "0.11.0-trend-retest.1-codex.1" in sql
    return result[0]


def test_recorded_gap_is_separate_from_model_wait_and_raw_input_is_removed() -> None:
    payload = json.loads(recorded_input())
    payload["candles"][2]["rows"][0][8] = ["BROKER_SESSION_GAP_BEFORE"]
    row = read_context(context(provider_input=json.dumps(payload)))
    events = event_tape([row], NOW)
    wait = next(e for e in events if e["title"] == "Codex chose WAIT")
    assert wait["detail"] == "No confirmed breakout."
    warning = next(e for e in events if e["title"] == "Recorded history warning")
    assert warning["source"] == "engine"
    assert "M15" in warning["detail"] and "session gap" in warning["detail"]
    assert "not Codex reasoning" in warning["detail"]
    assert "private-id" not in json.dumps(events)


@pytest.mark.parametrize(
    "value",
    [None, "{", "[]", '{"candles":[null]}', "x" * 128001],
    ids=["missing", "json", "array", "null-series", "oversize"],
)
def test_unavailable_history_does_not_become_healthy(value: object) -> None:
    row = read_context(context(provider_input=value))
    events = event_tape([row], NOW)
    assert any(e["title"] == "Recorded history unavailable" for e in events)


def test_short_tail_is_reported_but_unflagged_tail_is_not_qualified() -> None:
    payload = json.loads(recorded_input())
    payload["candles"][2]["rows"].pop()
    row = read_context(context(provider_input=json.dumps(payload)))
    assert "M15 11/12" in row["history_note"]
    row = read_context(context(provider_input=recorded_input()))
    assert row["history_note"] == ""
    assert not any("history" in e["title"] for e in event_tape([row], NOW))


def test_quality_warning_outside_required_tail_and_legacy_input_are_not_reclassified() -> None:
    payload = json.loads(recorded_input())
    old = payload["candles"][2]["rows"][0].copy()
    old[8] = ["BROKER_SESSION_GAP_BEFORE"]
    payload["candles"][2]["rows"].insert(0, old)
    assert read_context(context(provider_input=json.dumps(payload)))["history_note"] == ""
    row = context(provider_input=None)
    row["trend_context"] = False
    assert "history_note" not in read_context(row)


@pytest.mark.parametrize(
    "reason,title",
    [
        ("OPENAI_API_BUDGET_WAIT", "Provider budget wait"),
        ("AI_ANALYSIS_FAILED", "Provider result unavailable"),
        ("SCENARIO_INPUT_STALE", "Recorded input expired"),
        ("https://private.invalid/token", "Provider result unavailable"),
    ],
)
def test_provider_failures_do_not_claim_dispatch_or_a_market_wait(reason: str, title: str) -> None:
    row = context(reason=reason)
    row["state"] = "FAILED"
    events = event_tape([row], NOW)
    failure = next(e for e in events if e["title"] == title)
    assert "dispatch" in failure["detail"].lower()
    assert not any(e["title"] == "Codex chose WAIT" for e in events)
    assert "private.invalid" not in json.dumps(events)


def test_context_reader_executes_scoped_bounded_sql_at_postgres_boundary():
    import os
    from uuid import uuid4

    import psycopg
    from psycopg.rows import dict_row

    dsn = os.getenv("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("requires isolated PostgreSQL")
    schema = "wait_" + uuid4().hex
    with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as db:
        db.execute(f'CREATE SCHEMA "{schema}"')
        try:
            db.execute(f'SET search_path="{schema}"')
            db.execute("""
                CREATE TABLE scenario_contexts(id int,account_id text,symbol_id text,mode text,
                  requested_at timestamptz,available_at timestamptz,completed_at timestamptz,
                  state text,reason text,requested_model text,plan jsonb,source_analysis_id int);
                CREATE TABLE analysis_runs(id int,strategy_version_id int);
                CREATE TABLE strategy_versions(id int,version text);
                CREATE TABLE context_provider_evidence(
                  context_id int PRIMARY KEY,request_text text);
                INSERT INTO strategy_versions VALUES
                  (1,'0.11.0-trend-retest.1-codex.1'),(2,'legacy');
                INSERT INTO analysis_runs VALUES(1,1),(2,2);
            """)
            for i in range(18):
                # The newest foreign account/symbol/mode must never displace scoped rows.
                account, symbol, mode = ("account", "symbol", "demo")
                if i == 15:
                    account = "foreign"
                if i == 16:
                    symbol = "foreign"
                if i == 17:
                    mode = "paper"
                db.execute(
                    """INSERT INTO scenario_contexts VALUES
                  (%s,%s,%s,%s,%s,%s,%s,'READY',NULL,'model',
                   '{"schema_version":"entry-wait-1.0","reason":"Original WAIT"}',%s)""",
                    (i, account, symbol, mode, NOW, NOW, NOW, 2 if i == 14 else 1),
                )
                if i != 12:
                    db.execute(
                        "INSERT INTO context_provider_evidence VALUES(%s,%s)",
                        (i, "x" * 128001 if i == 13 else recorded_input()),
                    )

            def read(sql, params):
                if "context_provider_evidence" in sql:
                    return db.execute(sql, params).fetchall()
                return []

            db.execute("SET default_transaction_read_only=on")
            result = landscape_events(read, ("account", "symbol", "demo"))
            assert [r["id"] for r in result] == list(range(14, 2, -1))
            assert "history_note" not in result[0]  # exact legacy binding
            assert result[1]["history_note"] is None  # oversized input
            assert result[2]["history_note"] is None  # missing evidence
            assert result[3]["history_note"] == ""
            assert all(r["wait_reason"] == "Original WAIT" for r in result)
            assert all("provider_input" not in r for r in result)
        finally:
            db.execute("SET default_transaction_read_only=off")
            db.execute(f'DROP SCHEMA "{schema}" CASCADE')
