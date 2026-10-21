from unittest.mock import MagicMock

import psycopg
import pytest

from apps.dashboard import snapshot


@pytest.fixture
def scoped(monkeypatch):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("ACCOUNT_KEY", "fixture-pseudonym")
    monkeypatch.setenv("DATABASE_URL", "fixture-private-database")
    monkeypatch.setattr(
        snapshot, "api", lambda _: {"mode": "demo", "accountType": "demo", "symbol": "XAUUSD"}
    )
    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    monkeypatch.setattr(snapshot.psycopg, "connect", lambda *args, **kwargs: connection)
    return cursor


def test_desk_requires_exact_account_symbol_mode(scoped, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    scoped.fetchall.side_effect = [
        [{"account_id": "fixture-account", "symbol_id": "fixture-symbol", "currency": "USD"}],
        [],
        [{"present": None}],
        [],
        [],
        [],
    ]
    monkeypatch.setattr(snapshot, "command_data", lambda rows, scope: {})
    monkeypatch.setattr(snapshot, "landscape_events", lambda rows, scope: [])
    value = snapshot.load_snapshot()
    assert value["positions"] == [] and value["orders"] == []
    for call in scoped.execute.call_args_list[3:]:
        sql, parameters = call.args
        assert "account_id=%s" in sql and "symbol_id=%s" in sql and "mode=%s" in sql
        assert parameters == ("fixture-account", "fixture-symbol", "demo")
    assert "fixture-private" not in str(value)


@pytest.mark.parametrize("identities", [[], [{}, {}]])
def test_ambiguous_identity_never_queries_history(scoped, identities) -> None:  # type: ignore[no-untyped-def]
    scoped.fetchall.return_value = identities
    value = snapshot.load_snapshot()
    assert "positions" not in value and "daily" not in value
    assert value["warnings"]
    assert scoped.execute.call_count == 1


def test_partial_database_failure_does_not_publish_a_partial_snapshot(scoped) -> None:  # type: ignore[no-untyped-def]
    scoped.fetchall.side_effect = [
        [{"account_id": "fixture-account", "symbol_id": "fixture-symbol", "currency": "USD"}],
        [{"current_equity": "100"}],
        psycopg.OperationalError("fixture-private-database"),
    ]
    value = snapshot.load_snapshot()
    assert "daily" not in value and "positions" not in value
    assert value["warnings"]
    assert "fixture-private" not in str(value)


def test_execution_outage_cannot_reuse_guessed_account_scope(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def unavailable(_path):  # type: ignore[no-untyped-def]
        raise ValueError("fixture-private-response")

    monkeypatch.setattr(snapshot, "api", unavailable)
    connect = MagicMock(side_effect=AssertionError("unverified account queried"))
    monkeypatch.setattr(snapshot.psycopg, "connect", connect)
    value = snapshot.load_snapshot()
    assert value["status"] == {"unavailable": True}
    assert "trades" not in value
    connect.assert_not_called()
