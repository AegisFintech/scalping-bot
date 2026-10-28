from __future__ import annotations

import copy
import gzip
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest

from python.backtest import breakout_entry_review as b
from python.operations import run_entry_observer as observer
from python.operations.entry_context import COLUMNS, entry_context
from python.operations.setup_flight_recorder import Flight
from tests.python.test_setup_flight import metadata, quote, setup

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


def input_context() -> tuple[dict, dict]:
    rows = []
    for index in range(10):
        start = NOW - timedelta(minutes=10 - index)
        rows.append(
            [
                start.isoformat(),
                (start + timedelta(minutes=1)).isoformat(),
                "4000",
                "4000.20",
                "3999.80",
                "4000.10",
                "1",
                True,
                [],
            ]
        )
    payload = {
        "captured_at": NOW.isoformat(),
        "tick_size": "0.01",
        "quote": {
            "bid": "4000",
            "ask": "4000.10",
            "sourceTime": NOW.isoformat(),
            "receivedAt": (NOW + timedelta(milliseconds=100)).isoformat(),
        },
        "entry_boundaries": {"movement_buffer": "0.10"},
        "candles": [{"timeframe": "M1", "columns": COLUMNS, "rows": rows}],
        "technical_context": {"depth": {"complete": True}},
    }
    plan = {"buy_stop": "4000.30", "sell_stop": "3999.70", "entry_side": "SELL"}
    return payload, plan


def context() -> dict:
    p, plan = input_context()
    return entry_context(json.dumps(p), plan, NOW, NOW + timedelta(seconds=1))


def record(q: dict, at: datetime) -> dict:
    return {"kind": "BROKER_QUOTE", "payload": q, "observedAt": at.isoformat()}


def quotes() -> list[dict]:
    result = []
    for index, bid in enumerate(["4000", "4000.20", "4000.25", "4000.30", "4000.40", "3999.5"]):
        at = NOW + timedelta(seconds=index + 2)
        result.append(
            record(
                {
                    "kind": "QUOTE",
                    "sourceTime": at.isoformat(),
                    "receivedAt": at.isoformat(),
                    "bid": bid,
                    "ask": str(b.number(bid) + b.number("0.10")),
                    "bidUpdated": True,
                    "askUpdated": True,
                    "sequence": index + 1,
                },
                at,
            )
        )
    return result


def orders() -> list[dict]:
    return [
        {"side": side, "broker_accepted_at": (NOW + timedelta(seconds=2)).isoformat()}
        for side in ["BUY", "SELL"]
    ]


def test_context_separates_model_levels_envelopes_round_numbers_and_liquidity() -> None:
    c = context()
    assert c["state"] == "RECORDED"
    assert c["codexDirection"] == "SELL" and c["upperEntry"] == "4000.30"
    assert c["modelSelectedBox"] is None and c["roundLevelLiquidity"] is None
    assert c["completedM1Envelopes"][0]["buyOffset"] == "0.10"
    assert {r["price"] for r in c["roundLevels"]} == {"4000", "4005", "4010"}
    assert c["spread"] == "0.10" and c["depthInputSha256"]
    assert c["counterfactualNet"] is None and not c["brokerAuthority"]


@pytest.mark.parametrize(
    "mutation", ["forming", "future", "gap", "ohlc", "precision", "side", "quote", "oversize"]
)
def test_invalid_context_is_explicitly_unavailable(mutation: str) -> None:
    p, plan = input_context()
    row = p["candles"][0]["rows"][-1]
    if mutation == "forming":
        row[7] = False
    if mutation == "future":
        row[1] = (NOW + timedelta(minutes=1)).isoformat()
    if mutation == "gap":
        p["candles"][0]["rows"].pop(3)
    if mutation == "ohlc":
        row[3] = "3990"
    if mutation == "precision":
        plan["buy_stop"] = "4000.301"
    if mutation == "side":
        plan["entry_side"] = "WAIT"
    if mutation == "quote":
        p["quote"]["ask"] = "3999"
    if mutation == "oversize":
        p["extra"] = "x" * 128001
    assert (
        entry_context(json.dumps(p), plan, NOW, NOW + timedelta(seconds=1))["state"]
        == "UNAVAILABLE"
    )


def test_buffers_delay_observed_trigger_but_never_fabricate_fills_or_net() -> None:
    rows = b.trigger_review(context(), orders(), quotes(), [], NOW + timedelta(seconds=10))
    buy_times = [
        next(s["firstObservedAt"] for s in r["signals"] if s["side"] == "BUY") for r in rows[:4]
    ]
    assert buy_times == sorted(buy_times) and buy_times[0] < buy_times[-1]
    assert rows[-1]["state"] == "NO_SIGNAL_OBSERVED" and not rows[-1]["m1EvidenceAvailable"]
    assert all(r["counterfactualNet"] is None for r in rows)
    assert all(s["hypotheticalFill"] is None for r in rows for s in r["signals"])
    assert all(r["pathCensored"] for r in rows)


def test_availability_and_actual_acceptance_precede_signals_not_local_submission() -> None:
    o = orders()
    o[0]["broker_accepted_at"] = (NOW + timedelta(seconds=6)).isoformat()
    rows = b.trigger_review(context(), o, quotes(), [], NOW + timedelta(seconds=10))
    buy = next(s for s in rows[0]["signals"] if s["side"] == "BUY")
    assert b.timestamp(buy["firstObservedAt"]) >= NOW + timedelta(seconds=6)
    assert buy["crossingProvenInObservedQuotes"] is False
    o[0]["broker_accepted_at"] = None
    assert (
        b.trigger_review(context(), o, quotes(), [], NOW + timedelta(seconds=10))[0]["state"]
        == "ACCEPTANCE_UNAVAILABLE"
    )


def test_completed_m1_uses_first_known_time_without_backdating() -> None:
    candle = {
        "startTime": (NOW + timedelta(minutes=1)).isoformat(),
        "endTime": (NOW + timedelta(minutes=2)).isoformat(),
        "availableAt": (NOW + timedelta(minutes=2, seconds=3)).isoformat(),
        "close": "4000.50",
        "complete": True,
    }
    q = quotes()[-2]
    later = NOW + timedelta(minutes=2, seconds=4)
    q["observedAt"] = q["payload"]["sourceTime"] = q["payload"]["receivedAt"] = later.isoformat()
    result = b.trigger_review(context(), orders(), [q], [candle], later + timedelta(seconds=1))[-1]
    assert result["signals"][0]["firstObservedAt"] == later.isoformat()
    assert result["signals"][0]["confirmationAvailableAt"] == candle["availableAt"]
    candle["availableAt"] = (later + timedelta(seconds=2)).isoformat()
    assert not b.trigger_review(context(), orders(), [q], [candle], later + timedelta(seconds=1))[
        -1
    ]["signals"]
    candle["complete"] = False
    with pytest.raises(ValueError, match="PROVENANCE"):
        b.trigger_review(context(), orders(), [q], [candle], later + timedelta(seconds=5))


def test_both_oco_signals_and_gaps_remain_ambiguous_or_censored() -> None:
    q = quotes()
    q[-1]["payload"]["sourceTime"] = (NOW + timedelta(seconds=6, milliseconds=100)).isoformat()
    result = b.trigger_review(context(), orders(), q, [], NOW + timedelta(seconds=10))
    assert result[3]["ocoRaceAmbiguous"]
    assert result[3]["pathCensored"]


def test_hash_chain_mutation_and_missing_first_segment_rejected(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW, history_covered=True)
    f.quote(quote(), metadata(), NOW)
    records = b.verify_records([f.path])
    assert records[0]["kind"] == "START"
    lines = f.path.read_text().splitlines()
    changed = json.loads(lines[0])
    changed["payload"]["carryIn"] = True
    lines[0] = json.dumps(changed)
    f.path.write_text("\n".join(lines) + "\n")
    with pytest.raises(ValueError, match="CHAIN"):
        b.verify_records([f.path])


def test_lossless_gzip_reads_same_verified_chain(tmp_path: Path) -> None:
    f = Flight(tmp_path, setup(), NOW, history_covered=True)
    before = b.verify_records([f.path])
    gz = tmp_path / "part.jsonl.gz"
    with gzip.open(gz, "wb") as h:
        h.write(f.path.read_bytes())
    assert b.verify_records([gz]) == before


def test_tp_audit_requires_prior_fresh_protection_and_updated_executable_side() -> None:
    p = {
        "side": "BUY",
        "state": "OPEN",
        "protection_status": "VERIFIED",
        "broker_tp": "4000.30",
        "observed_at": NOW.isoformat(),
        "updated_at": NOW.isoformat(),
    }
    initial = {"kind": "LIFECYCLE", "payload": {"protection": [p], "closedTrades": []}}
    q = quotes()[3]
    p["observed_at"] = (NOW + timedelta(seconds=3)).isoformat()
    result = b.audit_tp([initial, q])
    assert len(result["crossings"]) == 1 and result["executionCause"] is None
    q["payload"]["bidUpdated"] = False
    assert not b.audit_tp([initial, q])["crossings"]
    q["payload"]["bidUpdated"] = True
    p["observed_at"] = (NOW + timedelta(seconds=10)).isoformat()
    assert not b.audit_tp([initial, q])["crossings"]


def test_registration_is_future_exclusive_and_freezes_candidates(tmp_path: Path) -> None:
    path = tmp_path / "registration.json"
    with pytest.raises(ValueError, match="REGISTRATION"):
        b.register(path, "fixture", NOW, NOW)
    r = b.register(path, "fixture", NOW + timedelta(minutes=1), NOW)
    assert r["candidates"] == b.CANDIDATES and r["promotion"] == "HOLD"
    assert path.stat().st_mode & 0o777 == 0o400
    with pytest.raises(FileExistsError):
        b.register(path, "fixture", NOW + timedelta(minutes=1), NOW)


def test_observer_waits_without_database_and_source_drift_halts_research(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    b.register(tmp_path / "registration.json", "fixture", NOW + timedelta(minutes=1), NOW)
    connect = Mock()
    monkeypatch.setattr(observer.psycopg, "connect", connect)
    assert observer.run_once(tmp_path, tmp_path, NOW)["state"] == "WAITING_FOR_SETTLED_WINDOW"
    connect.assert_not_called()
    monkeypatch.setattr(observer, "fingerprint", lambda: "f" * 64)
    with pytest.raises(ValueError, match="DRIFT"):
        observer.run_once(tmp_path, tmp_path, NOW)
    connect.assert_not_called()


def test_day_cutoff_censors_later_quotes_and_missing_context_is_not_flat() -> None:
    c = context()
    c["availableAt"] = "2026-10-26T23:59:59+00:00"
    result = b.trigger_review(c, orders(), quotes(), [], NOW + timedelta(days=1))
    assert all(r["cutoff"] == "2026-10-27T00:00:00+00:00" for r in result)
    assert all(not r["signals"] for r in result)
    assert b.trigger_review({}, orders(), quotes(), [], NOW)[0]["state"] == "CONTEXT_UNAVAILABLE"


def test_duplicate_conflicting_m1_is_rejected() -> None:
    candle = {
        "startTime": NOW.isoformat(),
        "endTime": (NOW + timedelta(minutes=1)).isoformat(),
        "availableAt": (NOW + timedelta(minutes=1)).isoformat(),
        "close": "4000",
        "complete": True,
    }
    with pytest.raises(ValueError, match="CONFLICT"):
        b.trigger_review(
            context(),
            orders(),
            quotes(),
            [candle, copy.deepcopy(candle)],
            NOW + timedelta(minutes=2),
        )


def test_settled_observer_is_once_only_and_catches_up_one_window(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import MagicMock

    start = NOW + timedelta(minutes=1)
    b.register(tmp_path / "registration.json", "fixture", start, NOW)
    connection = MagicMock()
    monkeypatch.setattr(observer.psycopg, "connect", connection)
    monkeypatch.setenv("DATABASE_URL", "fixture")
    monkeypatch.setenv("ACCOUNT_KEY_HASH", "a" * 64)
    response = Mock()
    response.json.return_value = {"mode": "demo", "strategyVersion": "fixture"}
    monkeypatch.setattr(observer.httpx, "get", Mock(return_value=response))
    export = Mock(
        side_effect=lambda c, a, s, r, lo, hi: {
            "release": r,
            "from": lo.isoformat(),
            "until": hi.isoformat(),
            "setups": [],
            "completedM1": [],
        }
    )
    monkeypatch.setattr(observer, "export", export)
    due = start + timedelta(days=1, minutes=10)
    assert observer.run_once(tmp_path, tmp_path, due)["state"] == "REPORT_WRITTEN"
    prior = (tmp_path / "day-01.json").read_bytes()
    assert observer.run_once(tmp_path, tmp_path, due)["state"] == "WAITING_FOR_SETTLED_WINDOW"
    assert (tmp_path / "day-01.json").read_bytes() == prior
    assert export.call_count == 1
    assert observer.run_once(tmp_path, tmp_path, due + timedelta(days=4))["window"] == 2
    assert not (tmp_path / "day-03.json").exists()


def test_missing_flight_path_is_unavailable_not_an_absent_market_signal() -> None:
    r = b.trigger_review(context(), orders(), [], [], NOW + timedelta(minutes=1))
    assert all(x["state"] == "PATH_UNAVAILABLE" and x["pathCensored"] for x in r)


def test_storage_failure_halts_only_observer_before_reads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = NOW + timedelta(minutes=1)
    b.register(tmp_path / "registration.json", "fixture", start, NOW)
    monkeypatch.setattr(observer.shutil, "disk_usage", lambda _: Mock(free=1024))
    connect, http = Mock(), Mock()
    monkeypatch.setattr(observer.psycopg, "connect", connect)
    monkeypatch.setattr(observer.httpx, "get", http)
    with pytest.raises(ValueError, match="STORAGE_FULL"):
        observer.run_once(tmp_path, tmp_path, start + timedelta(days=1, minutes=10))
    connect.assert_not_called()
    http.assert_not_called()
    assert not (tmp_path / "day-01.json").exists()


def test_single_scalp_context_labels_invalidation_without_a_second_entry() -> None:
    p, plan = input_context()
    plan.update(
        schema_version="entry-scalp-1.0",
        take_profit="3999.3",
        stop_loss="4000.3",
        valid_until=(NOW + timedelta(seconds=120)).isoformat(),
    )
    result = entry_context(json.dumps(p), plan, NOW, NOW + timedelta(seconds=1))
    assert result["schemaVersion"] == "1.1" and result["entryPrice"] == "3999.70"
    assert result["invalidationPrice"] == "4000.30" and "upperEntry" not in result
    assert result["modelSelectedBox"] is None and result["roundLevelLiquidity"] is None
