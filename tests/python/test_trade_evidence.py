from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest

from python.analytics.models import AnalyticsRequest
from python.research.trade_evidence import EvidenceBrief, build_brief, main
from tests.python.test_analytics import request_payload


def request() -> AnalyticsRequest:
    return AnalyticsRequest.model_validate(request_payload())


def test_context_is_descriptive_private_and_deterministic() -> None:
    source = request()
    brief = build_brief(source)
    assert brief == build_brief(source)
    assert brief.status == "CONTEXT_AVAILABLE"
    assert brief.ema_agreement == "ALL_BULLISH"
    assert brief.frames[0].five_bar_low == "2034"
    assert brief.frames[0].ten_bar_high == "2041"
    assert brief.depth is not None and brief.depth.spread == "0.2"
    assert brief.news_status == "NOT_COLLECTED"
    assert brief.round_trip_cost is None and brief.manual_holding_range is None
    assert str(source.analysis_id) not in brief.model_dump_json()
    assert str(source.request_id) not in brief.model_dump_json()
    assert brief.entry_rationale is None and brief.profit_exit_rule is None


@pytest.mark.parametrize("fault", ["forming", "future", "gap", "stale", "warmup"])
def test_bad_candles_do_not_produce_a_narrative(fault: str) -> None:
    source = request()
    series = source.candles[0]
    candles = list(series.candles)
    if fault == "forming":
        candles[-1] = candles[-1].model_copy(update={"complete": False})
    elif fault == "future":
        candles[-1] = candles[-1].model_copy(
            update={"end_time": source.analysis_time + timedelta(seconds=60)}
        )
    elif fault == "gap":
        candles.pop(15)
    elif fault == "stale":
        candles = [
            c.model_copy(
                update={
                    "start_time": c.start_time - timedelta(minutes=2),
                    "end_time": c.end_time - timedelta(minutes=2),
                }
            )
            for c in candles
        ]
    else:
        candles = candles[-5:]
    result = build_brief(
        source.model_copy(
            update={
                "candles": [series.model_copy(update={"candles": candles}), *source.candles[1:]]
            }
        )
    )
    assert result.status == "REJECTED" and result.reasons
    assert result.frames == [] and result.depth is None and result.ema_agreement == "UNKNOWN"


@pytest.mark.parametrize("fault", ["stale", "future", "naive", "reconnect", "crossed"])
def test_bad_depth_does_not_suggest_confirmation(fault: str) -> None:
    source = request()
    book = source.order_book
    changes: dict[str, object] = {}
    if fault == "stale":
        changes["source_time"] = source.server_time - timedelta(seconds=6)
    elif fault == "future":
        changes["received_at"] = source.server_time + timedelta(seconds=1)
    elif fault == "naive":
        changes["source_time"] = book.source_time.replace(tzinfo=None)
    elif fault == "reconnect":
        changes["discontinuity"] = True
    else:
        changes["asks"] = book.bids
    result = build_brief(source.model_copy(update={"order_book": book.model_copy(update=changes)}))
    assert result.status == "REJECTED" and result.depth is None and result.frames == []


def test_zero_liquidity_remains_unknown_and_reports_actual_level_count() -> None:
    source = request()
    book = source.order_book.model_copy(
        update={
            "bids": [source.order_book.bids[0].model_copy(update={"size": "0"})],
            "asks": [source.order_book.asks[0].model_copy(update={"size": "0"})],
        }
    )
    result = build_brief(source.model_copy(update={"order_book": book}))
    assert result.depth is not None
    assert result.depth.bid_levels == 1 and result.depth.ask_levels == 1
    assert result.depth.top_five_imbalance is None and result.depth.microprice_bias is None


def test_disabled_indicators_are_not_invented() -> None:
    source = request()
    result = build_brief(
        source.model_copy(
            update={
                "config": source.config.model_copy(
                    update={"rsi_enabled": False, "adx_enabled": False}
                )
            }
        )
    )
    assert all(f.rsi is None and f.adx is None for f in result.frames)


def test_output_schema_matches_checked_in_contract() -> None:
    assert json.loads(Path("schemas/trade-evidence-1.0.json").read_text()) == (
        EvidenceBrief.model_json_schema()
    )


def test_cli_outputs_context_and_suppresses_raw_validation_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "private.json"
    path.write_text(request().model_dump_json(by_alias=True))
    assert main([str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["authority"] == "OFFLINE_CONTEXT_ONLY"
    path.write_text('{"credential":"do-not-print"}')
    assert main([str(path)]) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and "do-not-print" not in captured.err
    assert "private.json" not in captured.err
    path.write_bytes(b" " * (4 * 1024 * 1024 + 1))
    assert main([str(path)]) == 2
    assert main([]) == 2
