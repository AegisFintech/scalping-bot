from __future__ import annotations

import gzip
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from python.backtest import breakout_entry_review as b
from python.backtest import fill_gap_review as g
from python.operations import export_fill_evidence as x

NOW = datetime(2026, 10, 27, 5, 15, tzinfo=UTC)
KEY = "c" * 24


def at(seconds: float) -> datetime:
    return NOW + timedelta(seconds=seconds)


def ring(bid: str, ask: str, seconds: float, bid_updated: bool = True) -> dict[str, Any]:
    return {
        "kind": "QUOTE",
        "bid": bid,
        "ask": ask,
        "sourceTime": at(seconds).isoformat(),
        "receivedAt": at(seconds + 0.16).isoformat(),
        "bidUpdated": bid_updated,
        "askUpdated": True,
        "sequence": int(seconds * 10) + 1,
    }


def protection(tp: str = "4009.10", observed: float = 0) -> dict[str, Any]:
    return {
        "side": "BUY",
        "state": "OPEN",
        "protection_status": "VERIFIED",
        "broker_tp": tp,
        "broker_sl": "4001.70",
        "observed_at": at(observed).isoformat(),
        "updated_at": at(-1).isoformat(),
    }


def write_chain(directory: Path, records: list[tuple[str, Any]]) -> None:
    """Hash-chained Flight segment in the recorder's canonical encoding."""
    previous, lines, observed = "0" * 64, [], at(-1)
    for sequence, (kind, payload) in enumerate(records, start=1):
        # Records are appended after local receipt, never before it.
        received = payload.get("receivedAt") if kind == "BROKER_QUOTE" else None
        observed = max(
            observed + timedelta(milliseconds=1),
            datetime.fromisoformat(received) + timedelta(milliseconds=50) if received else observed,
        )
        record = {
            "kind": kind,
            "payload": payload,
            "observedAt": observed.isoformat(),
            "sequence": sequence,
            "previous": previous,
        }
        previous = hashlib.sha256(b.canonical(record)).hexdigest()
        lines.append(b.canonical({**record, "sha256": previous}))
    base = f"flight-{KEY}-20261027T051500000000"
    (directory / f"{base}-0000.jsonl").write_bytes(b"\n".join(lines) + b"\n")
    (directory / f"{base}.summary.json").write_text("{}")


def lifecycle(observed: float) -> tuple[str, Any]:
    return ("LIFECYCLE", {"protection": [protection(observed=observed)], "closedTrades": []})


def chain_records() -> list[tuple[str, Any]]:
    return [
        ("START", {"setup": {"setup": KEY}, "coverageStart": NOW.isoformat()}),
        ("BROKER_QUOTE", ring("4008.40", "4008.49", 0)),
        ("BROKER_QUOTE", ring("4008.44", "4008.53", 1)),
        lifecycle(1.5),
        # Brief TP-side touches that never reach the observed fill excursion.
        ("BROKER_QUOTE", ring("4009.15", "4009.24", 2)),
        ("BROKER_QUOTE", ring("4009.16", "4009.25", 2.4)),
        lifecycle(4.5),
        ("BROKER_QUOTE", ring("4009.31", "4009.40", 5)),
    ]


def fill(kind: str = "ENTRY", **values: Any) -> dict[str, Any]:
    row = {
        "setup": KEY,
        "originRelease": "fixture",
        "kind": kind,
        "side": "BUY",
        "executionOrderType": "STOP_LIMIT" if kind == "ENTRY" else None,
        "triggerPrice": "4008.45" if kind == "ENTRY" else None,
        "positionEntryPrice": None if kind == "ENTRY" else "4008.70",
        "fillPrice": "4008.70",
        "fillVolume": "24600",
        "volumeScale": "0.01",
        "tickSize": "0.01",
        "occurredAt": at(1.233).isoformat(),
        "receivedAt": at(1.4).isoformat(),
        "brokerAcceptedAt": at(-30).isoformat() if kind == "ENTRY" else None,
        "closingOrderType": None if kind == "ENTRY" else 4,
        "externalIntervention": None if kind == "ENTRY" else False,
        "brokerStopLoss": None if kind == "ENTRY" else "4001.70",
        "brokerTakeProfit": None if kind == "ENTRY" else "4009.10",
        "protectionObservedAt": None if kind == "ENTRY" else at(4.5).isoformat(),
    }
    return row | values


def bundle(*fills: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": "fill-evidence-input-1.1",
        "symbol": "XAUUSD",
        "from": NOW.isoformat(),
        "until": at(60).isoformat(),
        "fills": list(fills),
    }


def segment(directory: Path, rows: list[dict[str, Any]], count: int | None = None) -> Path:
    path = directory / "market-xauusd-fixture.jsonl.gz"
    data = gzip.compress(b"".join(json.dumps(r).encode() + b"\n" for r in rows), mtime=0)
    path.write_bytes(data)
    Path(str(path) + ".manifest.json").write_text(
        json.dumps(
            {
                "startedAt": rows[0]["capturedAt"],
                "completedAt": rows[-1]["capturedAt"],
                "sampleCount": len(rows) if count is None else count,
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    )
    return path


def sample(seconds: float, complete: bool = True) -> dict[str, Any]:
    source = at(seconds).isoformat()
    return {
        "schemaVersion": "1.0",
        "symbol": "XAUUSD",
        "capturedAt": at(seconds + 0.2).isoformat(),
        "quote": {
            "bid": "4008.44",
            "ask": "4008.53",
            "sourceTime": source,
            "receivedAt": at(seconds + 0.1).isoformat(),
        },
        "orderBook": {
            "sourceTime": source,
            "receivedAt": at(seconds + 0.1).isoformat(),
            "complete": complete,
            "discontinuity": False,
            "bids": [{"price": "4008.44", "size": "100"}, {"price": "4008.40", "size": "200"}],
            "asks": [
                {"price": "4008.53", "size": "100"},
                {"price": "4008.60", "size": "100"},
                {"price": "4008.70", "size": "100"},
            ],
        },
    }


def test_executable_side_mirrors_entries_and_position_closes() -> None:
    assert g.executable("ENTRY", "BUY") == "ask" and g.executable("ENTRY", "SELL") == "bid"
    assert g.executable("CLOSE", "BUY") == "bid" and g.executable("CLOSE", "SELL") == "ask"
    assert g.adverse(Decimal("4008.70"), Decimal("4008.53"), "ask") == Decimal("0.17")
    assert g.adverse(Decimal("4001.24"), Decimal("4001.10"), "bid") == Decimal("-0.14")


def test_entry_gap_uses_latest_fresh_executable_quote_and_trigger(tmp_path: Path) -> None:
    write_chain(tmp_path, chain_records())
    result = g.review(bundle(fill()), tmp_path, [])
    row = result["fills"][0]
    assert row["triggerGap"] == "0.25" and row["acceptedToFillSeconds"] == "31.233"
    assert row["quoteReference"] == {
        "origin": "FLIGHT",
        "quoteAt": at(1).isoformat(),
        "price": "4008.53",
        "gap": "0.17",
        "delayMs": 233,
        "spread": "0.09",
    }
    assert row["units"] == "246" and row["volumeBucket"] == "200-300"
    assert row["counterfactualNet"] is None and result["causeInference"] is None
    assert result["summary"]["ENTRY"]["quoteGap"]["median"] == "0.17"


def test_stale_or_unknown_side_never_supplies_a_reference(tmp_path: Path) -> None:
    records = chain_records()
    write_chain(tmp_path, records)
    late = fill(occurredAt=at(9).isoformat())
    assert g.review(bundle(late), tmp_path, [])["fills"][0]["quoteReference"] is None
    # A bid that was never updated after a gap cannot price a long close.
    gap_first = [records[0], ("GAP", {"reason": "QUOTE_SEQUENCE_GAP"})]
    gap_first.append(("BROKER_QUOTE", ring("4008.44", "4008.53", 1, bid_updated=False)))
    other = tmp_path / "other"
    other.mkdir()
    write_chain(other, gap_first)
    close = fill("CLOSE", occurredAt=at(1.1).isoformat())
    assert g.review(bundle(close), other, [])["fills"][0]["quoteReference"] is None


def test_delay_is_exact_milliseconds_and_inputs_are_scoped(tmp_path: Path) -> None:
    write_chain(tmp_path, chain_records())
    late = fill(occurredAt=at(3.401).isoformat())
    assert g.review(bundle(late), tmp_path, [])["fills"][0]["quoteReference"]["delayMs"] == 1001
    with pytest.raises(ValueError, match="SETUP_INVALID"):
        g.review(bundle(fill(setup="../" + "a" * 21)), tmp_path, [])
    link = tmp_path / "market-link"
    link.symlink_to(tmp_path)
    for directory in (link, tmp_path / "missing"):
        with pytest.raises(ValueError, match="MARKET_DIRECTORY_INVALID"):
            g.review(bundle(fill()), None, [directory])


def test_close_class_uses_order_type_and_price_not_profit() -> None:
    row = fill("CLOSE")
    t = at(5)
    assert g.close_class(row, Decimal("4009.20"), t) == "NATIVE_AT_OR_BEYOND_TP"
    assert g.close_class(row, Decimal("4001.49"), t) == "NATIVE_AT_OR_BEYOND_SL"
    assert g.close_class(row, Decimal("4005"), t) == "NATIVE_BETWEEN_LEVELS"
    assert g.close_class(row, Decimal("4001.49"), at(4)) == "NATIVE_LEVEL_UNKNOWN"
    assert g.close_class(row | {"closingOrderType": 1}, Decimal(4000), t) == "MARKET_CLOSE"
    assert g.close_class(row | {"externalIntervention": True}, Decimal(4000), t) == (
        "EXTERNAL_CLOSE"
    )
    assert g.close_class(row | {"closingOrderType": None}, Decimal(4000), t) == (
        "CLOSE_TYPE_UNAVAILABLE"
    )
    short = row | {"side": "SELL", "brokerTakeProfit": "4000.47", "brokerStopLoss": "4007.87"}
    assert g.close_class(short, Decimal("4000.47"), t) == "NATIVE_AT_OR_BEYOND_TP"


def test_tp_crossings_without_fill_are_reported_not_claimed(tmp_path: Path) -> None:
    write_chain(tmp_path, chain_records())
    sl = fill("CLOSE", fillPrice="4001.49", occurredAt=at(6).isoformat())
    result = g.review(bundle(sl), tmp_path, [])
    row = result["fills"][0]
    assert row["closeClass"] == "NATIVE_AT_OR_BEYOND_SL" and row["levelSlippage"] == "0.21"
    crossing = row["tpCrossing"]
    assert crossing["crossings"] == 3 and crossing["tpFilled"] is False
    assert crossing["maxExcursionBeyondTp"] == "0.21" and not crossing["crossingsBounded"]
    assert result["summary"]["tpCrossings"]["crossedWithoutTpFillMaxExcursion"]["max"] == "0.21"
    tp = fill("CLOSE", fillPrice="4009.15", occurredAt=at(5.3).isoformat())
    filled = g.review(bundle(tp), tmp_path, [])["fills"][0]
    assert filled["closeClass"] == "NATIVE_AT_OR_BEYOND_TP" and filled["levelSlippage"] == "-0.05"
    assert filled["tpCrossing"]["lastCrossingBeforeFill"]["lagToFillSeconds"] == "0.3"
    assert filled["quoteReference"]["gap"] == "0.16"


def test_visible_book_walk_and_shortfall_are_descriptive(tmp_path: Path) -> None:
    market = tmp_path / "market"
    market.mkdir()
    segment(market, [sample(0.9), sample(30)])
    result = g.review(bundle(fill()), None, [market])
    book = result["fills"][0]["visibleBook"]
    assert book["levelsNeeded"] == 3 and book["visibleShortfallUnits"] == "0"
    walk = (Decimal("400853") + Decimal("400860") + Decimal(46) * Decimal("4008.70")) / 246
    assert book["visibleWalkPrice"] == g.plain(walk.quantize(Decimal("1e-10")))
    assert Decimal(book["visibleWalkGap"]) == Decimal(book["visibleWalkPrice"]) - Decimal("4008.53")
    assert result["fills"][0]["quoteReference"] is None
    big = fill(fillVolume="40000")
    assert (
        g.review(bundle(big), None, [market])["fills"][0]["visibleBook"]["visibleWalkPrice"] is None
    )
    # Samples outside every fill window are never retained.
    assert result["marketEvidence"]["quoteSamples"] == 0


def test_market_segments_require_checksum_count_and_complete_book(tmp_path: Path) -> None:
    path = segment(tmp_path, [sample(0.9, complete=False)])
    quotes, books, evidence = g.market_samples([tmp_path], [at(1.233)], "XAUUSD")
    assert not quotes and not books
    assert evidence["rejected"] == {
        "SAMPLE_SIDE_FRESHNESS_UNAVAILABLE": 1,
        "SAMPLE_BOOK_INCOMPLETE": 1,
    }
    segment(tmp_path, [sample(0.9)], count=2)
    with pytest.raises(ValueError, match="COUNT_MISMATCH"):
        g.market_samples([tmp_path], [at(1.233)], "XAUUSD")
    segment(tmp_path, [sample(0.9)])
    path.write_bytes(gzip.compress(b"{}\n", mtime=0))
    with pytest.raises(ValueError, match="CHECKSUM"):
        g.market_samples([tmp_path], [at(1.233)], "XAUUSD")


def test_review_bounds_and_schema_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="INPUT_INVALID"):
        g.review(bundle(fill()) | {"schemaVersion": "other"}, None, [])
    with pytest.raises(ValueError, match="INPUT_INVALID"):
        g.review(bundle(*[fill()] * (g.MAX_FILLS + 1)), None, [])
    with pytest.raises(ValueError, match="ROW_INVALID"):
        g.review(bundle(fill(kind="OTHER")), None, [])
    with pytest.raises(ValueError, match="VOLUME_INVALID"):
        g.review(bundle(fill(fillVolume="0")), None, [])
    link = tmp_path / "link"
    link.symlink_to(tmp_path)
    with pytest.raises(ValueError, match="BOUNDS"):
        g.review(bundle(fill()), link, [])


def test_retained_cohort_reproduces_native_tp_pattern_without_cause() -> None:
    report = json.loads(Path("docs/evidence/entry-trigger-review.json").read_text())
    result = g.pattern_from_entry_review(report)
    s = result["summary"]
    assert s["closesAtOrBeyondTp"] == 7 and s["closesWithTpCrossingButNoTpFill"] == 1
    assert s["tpFilledLastCrossingExcursion"] == {
        "n": 7,
        "min": "0.14",
        "median": "0.2",
        "max": "0.35",
    }
    assert s["tpFilledLagSeconds"]["min"] == "0.246" and s["tpFilledLagSeconds"]["max"] == "0.309"
    assert s["tpFilledCloseVersusLastCrossingQuote"]["min"] == "0.14"
    assert s["tpFilledCloseVersusLastCrossingQuote"]["max"] == "0.18"
    assert s["crossedWithoutTpFillMaxExcursion"]["max"] == "0.06"
    assert s["entryFillVersusFirstCrossingQuote"] == {
        "n": 7,
        "min": "0.09",
        "median": "0.12",
        "max": "0.24",
    }
    # The derived losing close equals the independently retained broker history price.
    history = json.loads(Path("docs/evidence/entry-broker-history.json").read_text())
    loss = next(c for c in result["closes"] if c["closeAtOrBeyondRecordedTp"] is False)
    assert loss["derivedClosePrice"] == str(history["deals"][0]["executionPrice"])
    assert loss["closeVersusLastCrossingQuote"] is None
    assert result["causeInference"] is None and result["counterfactualNet"] is None
    # The committed #388 pack is exactly reproducible from the retained snapshot.
    retained = Path("docs/evidence/entry-trigger-review.json").read_bytes()
    result["source"]["sha256"] = hashlib.sha256(retained).hexdigest()
    committed = json.loads(Path("docs/evidence/native-tp-fill-pattern.json").read_text())
    assert committed == json.loads(json.dumps(result))
    with pytest.raises(ValueError, match="PATTERN_INPUT"):
        g.pattern_from_entry_review({"schemaVersion": "other"})


def test_cli_writes_exclusive_read_only_pattern(tmp_path: Path) -> None:
    output = tmp_path / "pattern.json"
    argv = ["fill_gap_review", "pattern", "--entry-review"]
    argv += ["docs/evidence/entry-trigger-review.json", "--output", str(output)]
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("sys.argv", argv)
        g.main()
        assert output.stat().st_mode & 0o777 == 0o400
        assert json.loads(output.read_text())["source"]["sha256"]
        with pytest.raises(FileExistsError):
            g.main()


def test_exporter_rejects_unscoped_windows_before_any_query() -> None:
    connection = MagicMock()
    for account, start, until in [
        ("A" * 64, NOW, at(60)),
        ("a" * 64, at(60), NOW),
        ("a" * 64, NOW - timedelta(days=32), NOW),
        ("a" * 64, NOW, datetime.now(UTC) + timedelta(days=1)),
    ]:
        with pytest.raises(ValueError, match="SCOPE"):
            x.export(connection, account, "XAUUSD", start, until)
    connection.execute.assert_not_called()


def test_exporter_projects_hashed_rows_read_only_and_bounded() -> None:
    connection = MagicMock()
    row = {
        "setup": KEY,
        "origin_release": "fixture",
        "kind": "CLOSE",
        "side": "BUY",
        "execution_order_type": None,
        "trigger_price": None,
        "position_entry_price": Decimal("4008.7000000000"),
        "fill_price": Decimal("4001.4900000000"),
        "fill_volume": Decimal("24600.0000000000"),
        "occurred_at": at(6),
        "received_at": at(6.2),
        "broker_accepted_at": None,
        "closing_order_type": 4,
        "external_intervention": False,
        "broker_sl": Decimal("4001.7000000000"),
        "broker_tp": Decimal("4009.1000000000"),
        "protection_observed_at": at(4.5),
        "volume_scale": Decimal("0.0100000000"),
        "tick_size": Decimal("0.0100000000"),
    }
    connection.execute.return_value.fetchall.return_value = [row]
    result = x.export(connection, "a" * 64, "XAUUSD", NOW, at(60))
    first = connection.execute.call_args_list[0].args[0]
    sql = connection.execute.call_args_list[1].args[0]
    assert first == "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    assert "LIMIT 10001" in sql and not any(
        word in sql.upper() for word in ("INSERT ", "UPDATE ", "DELETE ", "ALTER ", "DROP ")
    )
    projected = result["fills"][0]
    assert projected["closingOrderType"] == 4 and projected["occurredAt"] == at(6).isoformat()
    assert "broker_deal_id" not in json.dumps(result) and result["brokerAuthority"] is False
    assert g.evaluate(projected, g.Observations.build([], []), [])["closeClass"] == (
        "NATIVE_AT_OR_BEYOND_SL"
    )
    connection.execute.return_value.fetchall.return_value = [row] * (x.MAX_FILLS + 1)
    with pytest.raises(ValueError, match="LIMIT"):
        x.export(connection, "a" * 64, "XAUUSD", NOW, at(60))


def test_wrong_symbol_cannot_supply_book(tmp_path: Path) -> None:
    segment(tmp_path, [sample(0.9) | {"symbol": "EURUSD"}])
    result = g.review(bundle(fill()), None, [tmp_path])
    assert result["fills"][0]["visibleBook"] is None


def test_post_fill_book_is_not_backdated(tmp_path: Path) -> None:
    row = sample(1)
    row["capturedAt"] = at(2).isoformat()
    row["orderBook"]["receivedAt"] = at(1.8).isoformat()
    segment(tmp_path, [row])
    result = g.review(bundle(fill(occurredAt=at(1.5).isoformat())), None, [tmp_path])
    assert result["fills"][0]["visibleBook"] is None


def test_aggregate_quote_does_not_prove_side_freshness(tmp_path: Path) -> None:
    segment(tmp_path, [sample(0.9)])
    result = g.review(bundle(fill()), None, [tmp_path])
    assert result["fills"][0]["quoteReference"] is None


def test_expanded_market_bytes_are_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    segment(tmp_path, [sample(0.9)])
    monkeypatch.setattr(g, "MAX_DECODED_BYTES", 10, raising=False)
    with pytest.raises(ValueError, match="EXPANSION_LIMIT"):
        g.review(bundle(fill()), None, [tmp_path])


def test_review_requires_symbol_and_bounds_paths_sessions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing = bundle(fill())
    del missing["symbol"]
    with pytest.raises(ValueError, match="SYMBOL_INVALID"):
        g.review(missing, None, [])
    segment(tmp_path, [sample(0.9)])
    monkeypatch.setattr(g, "MAX_PATHS", 0)
    with pytest.raises(ValueError, match="PATH_LIMIT"):
        g.review(bundle(fill()), None, [tmp_path])
    write_chain(tmp_path, chain_records())
    monkeypatch.setattr(g, "MAX_SESSIONS", 0)
    with pytest.raises(ValueError, match="SESSION_LIMIT"):
        g.review(bundle(fill()), tmp_path, [])


def test_quote_received_after_fill_and_stale_protection_are_unavailable(tmp_path: Path) -> None:
    write_chain(tmp_path, chain_records())
    row = g.review(bundle(fill(occurredAt=at(1.1).isoformat())), tmp_path, [])["fills"][0]
    assert row["quoteReference"]["quoteAt"] == at(0).isoformat()
    assert g.close_class(fill("CLOSE"), Decimal("4001.49"), at(8)) == "NATIVE_LEVEL_UNKNOWN"
