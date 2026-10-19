from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from python.backtest.fast_exits import (
    CANDIDATES,
    RELEASE,
    compare,
    cost_distance,
    register,
    replay_exit,
    validate_registration,
    window,
)
from python.backtest.forward import DAY, iso
from python.backtest.paired import Assumptions, Leg, Setup, Tape, replay
from python.evaluation.engine import Quote

D = Decimal


def setup(side: int = 1) -> tuple[Setup, Leg]:
    anchor = Leg(side, 900, D("100"), D("2"), D("1.6"), D("100"), D("5"), D("1000"), 1000, D("100"))
    peer = replace(anchor, side=-side, fill_time=None, fill_price=None)
    return Setup(800, 700, 2000, D("0.01"), D("99"), D("101"), (anchor, peer)), anchor


def tape(*rows: tuple[int, str, str], invalid: tuple[int, ...] = ()) -> Tape:
    quotes = [Quote(at, at, D(bid), D(ask)) for at, bid, ask in rows]
    return Tape(quotes, [q.time for q in quotes], list(invalid), {})


def test_quick_exit_uses_later_quote_and_can_lose_despite_green_trigger() -> None:
    s, a = setup()
    data = tape(
        (1000, "100", "100.1"),
        (1100, "100.4", "100.5"),
        (1300, "101", "101.1"),
        (1600, "99.8", "99.9"),
    )
    result = replay_exit(
        s, a, data, 2000, Assumptions(stop_slippage=D("0.1")), "quick", D("0.1"), 1050
    )
    assert result.status == "FAST_EXIT"
    assert result.at == 1600
    assert result.gross_price_over_sl == D("-0.15")


@pytest.mark.parametrize("side", [1, -1])
def test_both_sides_use_executable_quote_and_cost_buffer(side: int) -> None:
    s, a = setup(side)
    rows = (
        (1000, "100", "100.1"),
        (1100, "100.39", "100.49"),
        (1200, "100.4", "100.5"),
        (1700, "100.5", "100.6"),
    )
    if side == -1:
        rows = tuple((t, str(D(200) - D(ask)), str(D(200) - D(bid))) for t, bid, ask in rows)
    result = replay_exit(
        s, a, tape(*rows), 2000, Assumptions(stop_slippage=D("0.1")), "quick", D("0.1"), 1050
    )
    assert result.at == 1700
    assert result.gross_price_over_sl == D("0.2")


def test_giveback_arms_before_reversal_and_does_not_capture_peak() -> None:
    s, a = setup()
    data = tape(
        (1000, "100", "100.1"),
        (1100, "100.8", "100.9"),
        (1200, "100.6", "100.7"),
        (1700, "100.3", "100.4"),
    )
    result = replay_exit(
        s, a, data, 2000, Assumptions(stop_slippage=D("0.1")), "giveback", D("0.1"), 1050
    )
    assert result.status == "FAST_EXIT"
    assert result.gross_price_over_sl == D("0.1")


@pytest.mark.parametrize("mode", list(CANDIDATES))
def test_stop_retained_and_preempts_pending_local_close(mode: str) -> None:
    s, a = setup()
    data = tape((1000, "100", "100.1"), (1100, "101", "101.1"), (1600, "97.5", "97.6"))
    result = replay_exit(s, a, data, 2000, Assumptions(), mode, D("0.1"), 1050)
    assert result.status == "SL"
    assert result.gross_price_over_sl == D("-1.575")


def test_baseline_matches_existing_conditional_replay() -> None:
    s, a = setup()
    data = tape((1000, "100", "100.1"), (1500, "100.4", "100.5"), (2000, "101.6", "101.7"))
    assert replay_exit(s, a, data, 2500, Assumptions(), "baseline", D("0.1"), 1050) == replay(
        s, data, 2500, Assumptions(), anchor=a
    )


@pytest.mark.parametrize("invalid", [(), (1400,)])
def test_gap_censors_before_later_profitable_quote(invalid: tuple[int, ...]) -> None:
    s, a = setup()
    at = 5000 if not invalid else 1600
    data = tape(
        (1000, "100", "100.1"), (1100, "101", "101.1"), (at, "101.5", "101.6"), invalid=invalid
    )
    result = replay_exit(s, a, data, at + 100, Assumptions(), "quick", D("0.1"), 1050)
    assert result.status == "CENSORED_GAP"
    assert result.gross_price_over_sl is None


def test_no_early_exit_before_peer_cancellation_or_cutoff() -> None:
    s, a = setup()
    data = tape((1000, "100", "100.1"), (1100, "101", "101.1"), (1600, "101", "101.1"))
    assert (
        replay_exit(s, a, data, 1700, Assumptions(), "quick", D("0.1"), 1650).status
        == "OPEN_AT_CUTOFF"
    )
    assert (
        replay_exit(s, a, data, 1500, Assumptions(), "quick", D("0.1"), 1050).status
        == "EXIT_PENDING_AT_CUTOFF"
    )


def row() -> dict[str, Any]:
    return {
        "created": iso(800),
        "captured": iso(600),
        "available": iso(700),
        "valid_until": iso(3000),
        "submission_valid_until": iso(2000),
        "tick_size": "0.01",
        "model_buy": "99",
        "model_sell": "101",
        "model_schema": "entry-pair-1.0",
        "legs": [
            {
                "side": side,
                "accepted": iso(900),
                "entry": "100",
                "sl": "2",
                "tp": "1.6",
                "volume": "100",
                "budget": "5",
                "equity": "1000",
                "order_type": "LIMIT",
                "tif": "GTC",
                "fill": {"time": iso(1000), "price": "100"} if side == "BUY" else None,
                "fill_count": 1 if side == "BUY" else 0,
                "cancelled_at": None if side == "BUY" else iso(1050),
                "fee_evidence": [
                    {
                        "at": iso(750),
                        "fees": "0.1",
                        "gross": "1.6",
                        "pips": "160",
                        "pip_size": "0.01",
                        "volume": "100",
                    }
                ],
            }
            for side in ("BUY", "SELL")
        ],
    }


def payload(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "label": "FAST_EXIT_INPUT_V1",
        "release": RELEASE,
        "from": iso(500),
        "until": iso(2500),
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
        "economics": None,
        "setups": rows,
    }


def test_all_denominators_retained_and_no_net_or_promotion_claim() -> None:
    good, bad = row(), row()
    bad["created"] = iso(801)
    bad["legs"][1]["fill_count"] = 1
    result = compare(payload([good, bad]), tape((1000, "100", "100.1"), (2000, "101.6", "101.7")))
    assert result["input_setups"] == 2
    assert result["comparisons"][0]["excluded"] == {"NOT_SINGLE_FULL_FILL_OR_OCO_RACE": 1}
    assert result["counterfactual_net_pnl"] is None
    assert result["decision"] == "HOLD"
    assert result["broker_authority"] is False
    assert result["production_changed"] is False


@pytest.mark.parametrize("failure", ["missing", "future", "volume", "target", "duplicate"])
def test_fee_evidence_must_be_unique_and_preintent(failure: str) -> None:
    s, a = setup()
    r = row()["legs"][0]
    if failure == "missing":
        r["fee_evidence"] = []
    elif failure == "duplicate":
        r["fee_evidence"] *= 2
    elif failure == "future":
        r["fee_evidence"][0]["at"] = iso(801)
    elif failure == "volume":
        r["fee_evidence"][0]["volume"] = "101"
    else:
        r["fee_evidence"][0]["pips"] = "159"
    with pytest.raises(ValueError):
        cost_distance(r, s, a)


def test_registration_rejects_backdating_drift_early_or_selected_windows() -> None:
    with pytest.raises(ValueError):
        register(1000, 1000)
    study = register(2000, 1000)
    validate_registration(study, 2000, 2000 + DAY, 2000 + DAY + 600_000)
    for changed in ({"source_sha256": "bad"}, {"candidates": {}}, {"days": 1}):
        with pytest.raises(ValueError):
            validate_registration({**study, **changed}, 2000, 2000 + DAY, 2 * DAY)
    with pytest.raises(ValueError):
        validate_registration(study, 2001, 2001 + DAY, 2 * DAY)
    with pytest.raises(ValueError):
        validate_registration(study, 2000, 2000 + DAY, 2000 + DAY)


def test_wrong_release_and_actual_economics_rejected() -> None:
    for changed in ({"release": "0.3.0-fade-limit.3"}, {"economics": {"fees": 0}}):
        with pytest.raises(ValueError):
            window({**payload([]), **changed})


def test_cli_does_not_overwrite_registration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    from python.backtest import fast_exits

    dest = tmp_path / "registration.json"
    monkeypatch.setattr(fast_exits, "now_ms", lambda: 1000)
    monkeypatch.setattr(
        sys, "argv", ["fast_exits", "register", "--start", iso(2000), "--output", str(dest)]
    )
    fast_exits.main()
    before = dest.read_bytes()
    with pytest.raises(SystemExit):
        fast_exits.main()
    assert dest.read_bytes() == before
    assert dest.stat().st_mode & 0o777 == 0o600


def test_collector_waits_without_export_and_rejects_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    from python.backtest import fast_exits

    study = register(2000, 1000)
    (tmp_path / "registration.json").write_text(json.dumps(study))

    def forbidden(*args: Any, **kwargs: Any) -> None:
        pytest.fail("unexpected exporter call")

    monkeypatch.setattr(fast_exits.subprocess, "run", forbidden)
    assert fast_exits.collect(tmp_path, [tmp_path], 3000) == "WAITING_FOR_WINDOW"
    study["source_sha256"] = "drift"
    (tmp_path / "registration.json").write_text(json.dumps(study))
    with pytest.raises(ValueError, match="SOURCE_DRIFT"):
        fast_exits.collect(tmp_path, [tmp_path], 2 * DAY)


def test_collector_records_one_window_and_detects_tampering(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    import subprocess

    from python.backtest import fast_exits

    study = register(2000, 1000)
    (tmp_path / "registration.json").write_text(json.dumps(study))
    empty = {**payload([]), "from": iso(2000), "until": iso(2000 + DAY)}
    calls: list[int] = []

    def exported(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        calls.append(1)
        return subprocess.CompletedProcess([], 0, json.dumps(empty).encode(), b"")

    monkeypatch.setattr(fast_exits.subprocess, "run", exported)
    monkeypatch.setattr(fast_exits, "load_tape", lambda *args: tape())
    assert fast_exits.collect(tmp_path, [tmp_path], 2000 + DAY + 600_000) == "RECORDED_HOLD"
    assert fast_exits.collect(tmp_path, [tmp_path], 2000 + DAY + 600_000) == "WAITING_FOR_WINDOW"
    assert len(calls) == 1
    dest = tmp_path / "daily-00.json"
    envelope = json.loads(dest.read_text())
    envelope["body"]["decision"] = "PROMOTE"
    dest.write_text(json.dumps(envelope))
    with pytest.raises(ValueError, match="EXISTING_REPORT_INVALID"):
        fast_exits.collect(tmp_path, [tmp_path], 2 * DAY)
