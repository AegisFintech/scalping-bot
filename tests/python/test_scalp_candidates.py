from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from python.analytics.models import AnalyticsRequest
from python.research.scalp_candidates import ScanReport, ScanRequest, scan, scan_evidence
from python.technical.models import ContextRequestV11, StructureEvent, Zone
from python.technical.service import prepare_context
from tests.python.test_analytics import request_payload

D = Decimal


def source() -> ContextRequestV11:
    request = AnalyticsRequest.model_validate(request_payload(720))
    frames = []
    counts = {"M1": 720, "M5": 576, "M15": 480}
    for series in request.candles:
        bars = [
            bar.model_copy(update={"open": "2040", "close": "2040", "low": "2038", "high": "2042"})
            for bar in series.candles[-counts[series.timeframe] :]
        ]
        if series.timeframe == "M1":
            bars[-6:] = [b.model_copy(update={"low": "2039", "high": "2041"}) for b in bars[-6:]]
        frames.append(series.model_copy(update={"candles": bars}))
    request = request.model_copy(
        update={
            "candles": frames,
            "config": request.config.model_copy(update={"expected_counts": counts}),
        }
    )
    return ContextRequestV11(
        schema_version="technical-context-request-1.1",
        request=request,
        quote={
            "bid": "2040",
            "ask": "2040.2",
            "sourceTime": request.server_time,
            "receivedAt": request.server_time,
        },
        tick_size="0.01",
        minimum_entry_distance="0.03",
        snapshot_time=request.server_time,
    )


def request() -> ScanRequest:
    return ScanRequest(
        schema_version="scalp-scan-request-1.0", source=source(), round_trip_cost_price="0.02"
    )


def test_public_full_history_compression_pair_is_deterministic_and_non_authoritative() -> None:
    r = request()
    before = r.model_dump_json()
    report = scan(r)
    assert report == scan(r) and r.model_dump_json() == before
    assert report.status == "OCO_CANDIDATE" and report.pair == (0, 1)
    assert report.execution_authority is False and report.promotion == "HOLD"
    assert report.counterfactual_net_pnl is None
    buy, sell = report.candidates
    assert buy.side == "BUY" and sell.side == "SELL"
    assert buy.order_type == sell.order_type == "STOP_LIMIT"
    assert D(buy.entry) > D(r.source.quote.ask) and D(sell.entry) < D(r.source.quote.bid)
    for candidate in report.candidates:
        assert all(
            D(p) % D(r.source.tick_size) == 0
            for p in (candidate.entry, candidate.invalidation, candidate.target)
        )
        assert candidate.gross_reward_to_stop == "1"


@pytest.mark.parametrize("cost", [None, "1"])
def test_unknown_or_unaffordable_costs_never_manufacture_a_pair(cost: str | None) -> None:
    report = scan(request().model_copy(update={"round_trip_cost_price": cost}))
    assert report.pair is None and not report.candidates
    assert report.status == ("REJECTED" if cost is None else "NO_PAIR")


@pytest.mark.parametrize("bad", ["0", "-1", "NaN", "0.00000000001", 0.1])
def test_costs_require_positive_canonical_decimal_strings(bad: object) -> None:
    body = request().model_dump(mode="json", by_alias=True)
    body["round_trip_cost_price"] = bad
    with pytest.raises(ValidationError):
        ScanRequest.model_validate(body)


@pytest.mark.parametrize(
    "fault", ["forming", "future", "stale_quote", "gap", "thin_history", "bad_book"]
)
def test_public_fail_closed(fault: str) -> None:
    r = request()
    s = r.source
    frames = list(s.request.candles)
    first = frames[0]
    bars = list(first.candles)
    if fault == "forming":
        bars[-1] = bars[-1].model_copy(update={"complete": False})
    elif fault == "future":
        bars[-1] = bars[-1].model_copy(update={"end_time": s.snapshot_time + timedelta(minutes=1)})
    elif fault == "gap":
        bars.pop(-4)
    elif fault == "thin_history":
        bars = bars[-60:]
    elif fault == "stale_quote":
        s = s.model_copy(
            update={
                "quote": s.quote.model_copy(
                    update={"source_time": s.snapshot_time - timedelta(seconds=4)}
                )
            }
        )
    else:
        s = s.model_copy(
            update={
                "request": s.request.model_copy(
                    update={
                        "order_book": s.request.order_book.model_copy(update={"complete": False})
                    }
                )
            }
        )
    frames[0] = first.model_copy(update={"candles": bars})
    config = s.request.config
    if fault == "thin_history":
        config = config.model_copy(update={"expected_counts": {**config.expected_counts, "M1": 60}})
    s = s.model_copy(
        update={"request": s.request.model_copy(update={"candles": frames, "config": config})}
    )
    report = scan(r.model_copy(update={"source": s}))
    assert report.status == "REJECTED" and report.reasons
    assert report.pair is None and report.candidates == []


def zone(s: ContextRequestV11, bullish: bool = True) -> Zone:
    return Zone(
        kind="ORDER_BLOCK",
        direction="BULLISH" if bullish else "BEARISH",
        lower="2038.6" if bullish else "2040.8",
        upper="2039.4" if bullish else "2041.6",
        origin_at=(s.snapshot_time - timedelta(minutes=2)).isoformat(),
        available_at=(s.snapshot_time - timedelta(minutes=1)).isoformat(),
        status="FRESH",
        first_touched_at=None,
        resolved_at=None,
        age_bars=1,
        distance_from_quote="0.6",
    )


@pytest.mark.parametrize("bullish", [True, False])
def test_directional_pullback_records_one_side_without_inventing_peer(bullish: bool) -> None:
    s = source()
    evidence = prepare_context(s).evidence
    assert evidence is not None
    direction = "BULLISH" if bullish else "BEARISH"
    frames = [
        f.model_copy(
            update={
                "bias": direction,
                "ema_fast": "2041" if bullish else "2039",
                "ema_slow": "2040",
                "nearest_active_zones": [zone(s, bullish)] if f.timeframe == "M1" else [],
            }
        )
        for f in evidence.frames
    ]
    result = scan_evidence(s, evidence.model_copy(update={"frames": frames}), D("0.02"))
    assert len(result) == 1 and result[0].setup == "TREND_PULLBACK"
    assert result[0].side == ("BUY" if bullish else "SELL") and result[0].order_type == "LIMIT"
    # Touch/fill, future availability and stale setup must each withhold entry.
    for update in (
        {"status": "TOUCHED"},
        {"available_at": (s.snapshot_time + timedelta(seconds=1)).isoformat()},
        {"available_at": (s.snapshot_time - timedelta(seconds=121)).isoformat()},
    ):
        broken = [
            f.model_copy(
                update={"nearest_active_zones": [zone(s, bullish).model_copy(update=update)]}
            )
            if f.timeframe == "M1"
            else f
            for f in frames
        ]
        assert not scan_evidence(s, evidence.model_copy(update={"frames": broken}), D("0.02"))


@pytest.mark.parametrize("bullish", [True, False])
def test_sweep_needs_completed_reclaim_and_existing_higher_poi(bullish: bool) -> None:
    s = source()
    evidence = prepare_context(s).evidence
    assert evidence is not None
    level = "2039.6" if bullish else "2040.4"
    event = StructureEvent(
        kind="SWEEP",
        direction="BULLISH" if bullish else "BEARISH",
        level=level,
        pivot_at=(s.snapshot_time - timedelta(minutes=5)).isoformat(),
        available_at=s.snapshot_time.isoformat(),
        displacement=False,
    )
    frames = [
        f.model_copy(
            update={
                "bias": "BULLISH",
                "events": [event] if f.timeframe == "M1" else [],
                "nearest_active_zones": [zone(s, bullish)] if f.timeframe == "M5" else [],
            }
        )
        for f in evidence.frames
    ]
    result = scan_evidence(s, evidence.model_copy(update={"frames": frames}), D("0.02"))
    assert len(result) == 1 and result[0].setup == "SWEEP_RECLAIM"
    assert result[0].side == ("BUY" if bullish else "SELL")
    no_poi = [f.model_copy(update={"nearest_active_zones": []}) for f in frames]
    assert not scan_evidence(s, evidence.model_copy(update={"frames": no_poi}), D("0.02"))
    future = event.model_copy(
        update={"available_at": (s.snapshot_time + timedelta(minutes=1)).isoformat()}
    )
    future_frames = [
        f.model_copy(update={"events": [future]}) if f.timeframe == "M1" else f for f in frames
    ]
    assert not scan_evidence(s, evidence.model_copy(update={"frames": future_frames}), D("0.02"))


def test_schema_parity() -> None:
    for name, model in (("request", ScanRequest), ("report", ScanReport)):
        schema = json.loads(Path(f"schemas/scalp-scan-{name}-1.0.json").read_text())
        assert schema == model.model_json_schema(by_alias=True)


def test_directional_bias_and_wide_spread_do_not_create_compression_pairs() -> None:
    s = source()
    evidence = prepare_context(s).evidence
    assert evidence is not None
    trending = evidence.model_copy(
        update={"frames": [f.model_copy(update={"bias": "BULLISH"}) for f in evidence.frames]}
    )
    assert not scan_evidence(s, trending, D("0.02"))
    wide = s.model_copy(update={"quote": s.quote.model_copy(update={"ask": "2042"})})
    assert not scan_evidence(wide, evidence, D("0.02"))


def test_input_cannot_inject_context_or_override_authority() -> None:
    body = request().model_dump(mode="json", by_alias=True)
    for key in ("evidence", "execution_authority", "promotion", "candidates"):
        with pytest.raises(ValidationError):
            ScanRequest.model_validate({**body, key: True})


def test_failed_reclaim_is_withheld_even_with_matching_poi() -> None:
    s = source()
    evidence = prepare_context(s).evidence
    assert evidence is not None
    event = StructureEvent(
        kind="SWEEP",
        direction="BULLISH",
        level="2040.1",
        pivot_at=(s.snapshot_time - timedelta(minutes=5)).isoformat(),
        available_at=s.snapshot_time.isoformat(),
        displacement=False,
    )
    frames = [
        f.model_copy(
            update={
                "bias": "BULLISH",
                "events": [event] if f.timeframe == "M1" else [],
                "nearest_active_zones": [zone(s)] if f.timeframe == "M5" else [],
            }
        )
        for f in evidence.frames
    ]
    assert not scan_evidence(s, evidence.model_copy(update={"frames": frames}), D("0.02"))


def test_cli_private_exclusive_report_and_sanitized_failure(tmp_path: Path) -> None:
    source_path, output = tmp_path / "input.json", tmp_path / "report.json"
    source_path.write_text(request().model_dump_json(by_alias=True))
    cmd = [sys.executable, "-m", "python.research.scalp_candidates", str(source_path), str(output)]
    run = subprocess.run(cmd, capture_output=True, text=True, check=False)
    assert run.returncode == 0 and "OCO_CANDIDATE" in run.stdout
    assert output.stat().st_mode & 0o777 == 0o600
    original = output.read_bytes()
    run = subprocess.run(cmd, capture_output=True, text=True, check=False)
    assert run.returncode == 2 and "SCALP_SCAN_FAILED" in run.stderr
    assert output.read_bytes() == original
    source_path.write_text('{"private": "never-print-this"}')
    run = subprocess.run(cmd, capture_output=True, text=True, check=False)
    assert run.returncode == 2 and "never-print-this" not in run.stderr
    output.unlink()
    os.symlink(tmp_path / "missing", output)
    source_path.write_text(request().model_dump_json(by_alias=True))
    assert subprocess.run(cmd, capture_output=True, check=False).returncode == 2
