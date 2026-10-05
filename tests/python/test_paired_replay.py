import gzip
import hashlib
import json
import sys
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from python.backtest import paired as paired_module
from python.backtest.paired import (
    Assumptions,
    Leg,
    Setup,
    Tape,
    compare,
    input_window,
    load_tape,
    parse_setup,
    positive,
    replay,
    summary,
)
from python.evaluation.engine import Quote

D = Decimal


def setup() -> Setup:
    return Setup(
        1000,
        900,
        2000,
        D("0.01"),
        D("98"),
        D("102"),
        (
            Leg(1, 1000, D("99"), D("2"), D("1.6"), D("1"), D("5"), D("1000"), None, None),
            Leg(-1, 1000, D("101"), D("2"), D("1.6"), D("1"), D("5"), D("1000"), None, None),
        ),
    )


def tape(*rows: tuple[int, str, str], invalid: tuple[int, ...] = ()) -> Tape:
    quotes = [Quote(at, at, D(bid), D(ask)) for at, bid, ask in rows]
    return Tape(quotes, [q.time for q in quotes], list(invalid), {})


def test_gtc_persists_after_submission_deadline_and_does_not_mark_pending_as_loss() -> None:
    data = tape(
        (1000, "100", "100.1"),
        (2000, "100", "100.1"),
        (3000, "100", "100.1"),
        (4000, "98.8", "98.9"),
        (5000, "100.7", "100.8"),
    )
    result = replay(setup(), data, 6000, Assumptions())
    assert result.status == "TP"
    assert result.filled_at == 4000
    assert result.gross_price_over_sl == D("0.8")
    pending = replay(
        setup(), tape((1000, "100", "100.1"), (2000, "100", "100.1")), 3000, Assumptions()
    )
    assert pending.status == "PENDING_AT_CUTOFF"
    assert pending.gross_price_over_sl is None


def test_limit_requires_executable_ask_penetration_not_bid_touch() -> None:
    data = tape((1000, "100", "100.1"), (2000, "98.9", "99.1"), (3000, "98.9", "99"))
    assert replay(setup(), data, 4000, Assumptions()).status == "PENDING_AT_CUTOFF"


def test_latency_prevents_early_fill_and_model_preservation_is_not_clamped() -> None:
    data = tape(
        (1000, "100", "100.1"),
        (1100, "98.8", "98.9"),
        (2000, "100", "100.1"),
        (3000, "98.8", "98.9"),
        (4000, "100.7", "100.8"),
    )
    assert replay(setup(), data, 5000, Assumptions()).filled_at == 3000
    assert (
        replay(setup(), data, 5000, Assumptions(), preserve_entries=True).status
        == "PENDING_AT_CUTOFF"
    )


def test_open_fill_is_unknown_not_realized_mark_to_market() -> None:
    data = tape((1000, "100", "100.1"), (2000, "98.8", "98.9"), (3000, "99.1", "99.2"))
    result = replay(setup(), data, 4000, Assumptions())
    assert result.status == "OPEN_AT_CUTOFF"
    assert result.gross_price_over_sl is None
    assert summary([result])["cohort_net_pnl"] is None
    assert summary([result])["observed_path_closes"] == 0


@pytest.mark.parametrize("invalid", [(), (2500,)])
def test_missing_or_rejected_path_is_censored_before_profitable_later_quote(
    invalid: tuple[int, ...],
) -> None:
    later = 7000 if not invalid else 3000
    data = tape(
        (1000, "100", "100.1"), (2000, "98.8", "98.9"), (later, "105", "105.1"), invalid=invalid
    )
    result = replay(setup(), data, later + 1000, Assumptions())
    assert result.status == "CENSORED_GAP"
    assert result.gross_price_over_sl is None


def test_peer_fill_within_cancel_latency_censors_pair_even_if_target_also_hits() -> None:
    data = tape((1000, "100", "100.1"), (2000, "98.8", "98.9"), (2200, "101.1", "101.2"))
    assert replay(setup(), data, 3000, Assumptions()).status == "CENSORED_OCO_RACE"


def test_short_stop_uses_ask_and_adverse_slippage_without_double_spread_cost() -> None:
    leg = replace(setup().legs[1], fill_time=1000, fill_price=D("101"))
    data = tape((1000, "101", "101.1"), (2000, "102.9", "103.2"))
    result = replay(setup(), data, 3000, Assumptions(), anchor=leg)
    assert result.status == "SL"
    assert result.gross_price_over_sl == D("-1.425")


def test_tp_only_comparison_keeps_fill_stop_and_quantity_and_uses_no_future_fill() -> None:
    leg = replace(setup().legs[0], fill_time=1000, fill_price=D("99"))
    data = tape((1000, "99", "99.1"), (2000, "100.3", "100.4"), (3000, "100.7", "100.8"))
    assert replay(setup(), data, 4000, Assumptions(), anchor=leg, tp_factor=D("0.75")).at == 2000
    assert replay(setup(), data, 4000, Assumptions(), anchor=leg).at == 3000
    assert (
        replay(setup(), data, 4000, Assumptions(), anchor=leg, tp_factor=D("1.25")).status
        == "OPEN_AT_CUTOFF"
    )
    assert (
        replay(setup(), data, 4000, Assumptions(), anchor=replace(leg, fill_time=5000)).status
        == "NO_START_EVIDENCE"
    )
    assert leg.volume == D(1) and leg.sl == D(2)


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat()


def row() -> dict[str, Any]:
    return {
        "model_schema": "entry-pair-1.0",
        "created": iso(1000),
        "captured": iso(500),
        "available": iso(900),
        "valid_until": iso(3000),
        "submission_valid_until": iso(2000),
        "tick_size": "0.01",
        "model_buy": "98",
        "model_sell": "102",
        "legs": [
            {
                "side": "BUY" if leg.side == 1 else "SELL",
                "accepted": iso(leg.accepted),
                "entry": str(leg.entry),
                "sl": str(leg.sl),
                "tp": str(leg.tp),
                "volume": "1",
                "budget": "5",
                "equity": "1000",
                "fill": None,
                "order_type": "LIMIT",
                "tif": "GTC",
            }
            for leg in setup().legs
        ],
    }


@pytest.mark.parametrize(
    "field,value",
    [
        ("available", iso(1500)),
        ("tick_size", "NaN"),
        ("model_buy", "98.001"),
        ("model_schema", "unknown"),
    ],
)
def test_invalid_provenance_and_price_reject(field: str, value: str) -> None:
    raw = row()
    raw[field] = value
    with pytest.raises(ValueError):
        parse_setup(raw)


def test_shared_budget_and_gtc_are_required() -> None:
    raw = row()
    assert parse_setup(raw) == setup()
    raw["legs"][0]["budget"] = "6"
    with pytest.raises(ValueError, match="SHARED_BUDGET"):
        parse_setup(raw)
    raw = row()
    raw["legs"][0]["tif"] = "GTD"
    with pytest.raises(ValueError, match="LIFETIME"):
        parse_setup(raw)


@pytest.mark.parametrize("value", ["Infinity", "1e99999", 1, "-1", "0", "0.00000000001"])
def test_decimal_boundaries(value: object) -> None:
    with pytest.raises(ValueError):
        positive(value)


def recording(tmp_path: Path, rows: list[dict[str, Any]]) -> Path:
    content = gzip.compress("\n".join(json.dumps(r) for r in rows).encode())
    path = tmp_path / "segment.jsonl.gz"
    path.write_bytes(content)
    Path(str(path) + ".manifest.json").write_text(
        json.dumps(
            {
                "startedAt": iso(0),
                "completedAt": iso(5000),
                "sampleCount": len(rows),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    )
    return path


def sample(at: int, source: int | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": "1.1",
        "symbol": "XAUUSD",
        "capturedAt": iso(at),
        "quote": {
            "sourceTime": iso(at if source is None else source),
            "receivedAt": iso(at),
            "bid": "100",
            "ask": "100.1",
        },
        "orderBook": {"complete": True, "discontinuity": False},
    }


def test_loader_keeps_fresh_unchanged_quotes_and_invalidates_duplicate_time(tmp_path: Path) -> None:
    recording(tmp_path, [sample(1000), sample(2000, 1000), sample(3000), sample(3000)])
    data = load_tape(tmp_path, 0, 5000)
    assert data.times == [1000, 2000]
    assert data.invalid == [3000]
    assert data.broken(2000, 4000, 3000)


def test_loader_checks_hash_and_never_reads_past_cutoff(tmp_path: Path) -> None:
    path = recording(tmp_path, [sample(1000), sample(4000)])
    assert load_tape(tmp_path, 0, 3000).times == [1000]
    path.write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="CHECKSUM"):
        load_tape(tmp_path, 0, 3000)


def test_loader_parses_verified_bytes_even_if_file_changes_after_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = recording(tmp_path, [sample(1000)])
    original = Path.read_bytes

    def read_then_replace(file: Path) -> bytes:
        content = original(file)
        if file == path:
            file.write_bytes(b"changed after verification read")
        return content

    monkeypatch.setattr(Path, "read_bytes", read_then_replace)
    assert load_tape(tmp_path, 0, 3000).times == [1000]


def test_archive_copies_deduplicate_but_conflicting_named_segments_reject(tmp_path: Path) -> None:
    primary, archive = tmp_path / "primary", tmp_path / "archive"
    primary.mkdir()
    archive.mkdir()
    path = recording(primary, [sample(1000), sample(2000)])
    copy = archive / path.name
    copy.write_bytes(path.read_bytes())
    Path(str(copy) + ".manifest.json").write_bytes(Path(str(path) + ".manifest.json").read_bytes())
    data = load_tape(primary, 0, 3000, (archive,))
    assert data.times == [1000, 2000] and data.evidence["segments"] == 1
    recording(archive, [sample(1000), sample(2500)])
    with pytest.raises(ValueError, match="IDENTITY_CONFLICT"):
        load_tape(primary, 0, 3000, (archive,))


def test_cancel_window_is_checked_even_when_position_hits_target_immediately() -> None:
    # Wide spread at fill crosses the stop immediately; peer fills shortly after.
    data = tape((1000, "100", "100.1"), (2000, "96", "98.9"), (2200, "101.1", "101.2"))
    assert replay(setup(), data, 3000, Assumptions()).status == "CENSORED_OCO_RACE"


def test_missing_beginning_and_end_cannot_manufacture_flat_state() -> None:
    assert replay(setup(), tape(), 5000, Assumptions()).status == "NO_START_EVIDENCE"
    data = tape((1000, "100", "100.1"), (2000, "98.8", "98.9"))
    assert replay(setup(), data, 7000, Assumptions()).status == "CENSORED_GAP"


def test_fill_before_peer_activation_does_not_invent_the_second_submission() -> None:
    original = setup()
    staggered = replace(original, legs=(original.legs[0], replace(original.legs[1], accepted=3000)))
    data = tape((1000, "100", "100.1"), (2000, "98.8", "98.9"), (3000, "100.7", "100.8"))
    assert replay(staggered, data, 4000, Assumptions()).status == "CENSORED_INCOMPLETE_PAIR"


def test_complete_pairs_remain_conditional_and_unknown_costs_never_become_zero() -> None:
    payload = {
        "label": "PAIRED_REPLAY_INPUT_V1",
        "economics": None,
        "release": "0.3.0-fade-limit.3",
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
        "from": iso(0),
        "until": iso(6000),
        "setups": [row(), {"invalid": True}],
    }
    data = tape(
        (1000, "100", "100.1"),
        (2000, "98.8", "98.9"),
        (3000, "100.7", "100.8"),
        (4000, "100.7", "100.8"),
        (5000, "100.7", "100.8"),
    )
    result = compare(payload, data)
    assert result["decision"] == "HOLD" and result["net_pnl"] is None
    assert result["valid_setups"] == 1 and result["input_setups"] == 2
    assert result["comparisons"][0]["entry"]["paired"]["unresolved_pairs"] == 1
    assert result["production_changed"] is False


def test_input_header_cannot_smuggle_in_cost_defaults_or_unbounded_window() -> None:
    payload = {
        "label": "PAIRED_REPLAY_INPUT_V1",
        "release": "0.3.0-fade-limit.3",
        "from": iso(0),
        "until": iso(1000),
        "economics": None,
        "setups": [],
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
    }
    assert input_window(payload) == (0, 1000)
    for patch in ({"economics": {}}, {"extra": True}, {"until": iso(32 * 86400000)}):
        with pytest.raises(ValueError):
            input_window({**payload, **patch})


def test_cli_writes_private_report_and_refuses_to_overwrite(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {
        "label": "PAIRED_REPLAY_INPUT_V1",
        "release": "0.3.0-fade-limit.3",
        "from": iso(0),
        "until": iso(1000),
        "economics": None,
        "setups": [],
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
    }
    source, output = tmp_path / "input.json", tmp_path / "report.json"
    source.write_text(json.dumps(payload))
    monkeypatch.setattr(
        sys,
        "argv",
        ["paired", "--input", str(source), "--recordings", str(tmp_path), "--output", str(output)],
    )
    paired_module.main()
    original = output.read_bytes()
    assert output.stat().st_mode & 0o777 == 0o600
    assert json.loads(original)["decision"] == "HOLD"
    with pytest.raises(SystemExit, match="PAIRED_REPLAY_FAILED"):
        paired_module.main()
    assert output.read_bytes() == original
