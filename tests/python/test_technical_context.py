from __future__ import annotations

import json
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from python.analytics.api import app
from python.analytics.models import AnalyticsRequest, Candle, CandleSeries
from python.technical.models import ContextRequest, ContextResponse
from python.technical.service import prepare_context
from python.technical.structure import frame_context
from tests.python.test_analytics import request_payload


def source() -> ContextRequest:
    request = AnalyticsRequest.model_validate(request_payload(60))
    return ContextRequest(
        schema_version="technical-context-request-1.0",
        request=request,
        quote={
            "bid": "2040",
            "ask": "2040.2",
            "sourceTime": request.server_time,
            "receivedAt": request.server_time,
        },
        tick_size="0.01",
        minimum_entry_distance="0.03",
    )


def series(prices: list[tuple[str, str, str, str]]) -> CandleSeries:
    template = source().request.candles[0].candles[0]
    return CandleSeries(
        timeframe="M1",
        candles=[
            Candle(
                start_time=template.start_time + timedelta(minutes=i),
                end_time=template.start_time + timedelta(minutes=i + 1),
                open=o,
                high=h,
                low=low,
                close=c,
                volume="1",
                complete=True,
                quality_flags=[],
            )
            for i, (o, h, low, c) in enumerate(prices)
        ],
    )


def test_deterministic_bounded_context_and_dom_are_in_candidate_payload() -> None:
    s = source()
    before = s.model_dump_json()
    r = prepare_context(s)
    assert r == prepare_context(s) and s.model_dump_json() == before
    assert r.acceptable and r.evidence is not None and r.codex_payload is not None
    assert r.execution_authority is False
    assert len(r.evidence.frames) == 3 and not r.evidence.history_targets_met
    assert r.evidence.depth.bid_levels == 20
    assert r.codex_payload["technical_context"] == r.evidence.model_dump(mode="json")
    assert len(json.dumps(r.codex_payload)) < 64000
    assert r.codex_payload["entry_boundaries"] == {
        "buy_stop_minimum": "2040.23",
        "sell_stop_maximum": "2039.97",
    }
    assert r.evidence.harmonics == "NOT_IMPLEMENTED" and r.evidence.news == "NOT_COLLECTED"


@pytest.mark.parametrize(
    "fault", ["forming", "future", "gap", "duplicate", "stale", "count", "warmup", "flag"]
)
def test_bad_history_withholds_all_context(fault: str) -> None:
    s = source()
    frame = s.request.candles[0]
    bars = list(frame.candles)
    if fault == "forming":
        bars[-1] = bars[-1].model_copy(update={"complete": False})
    elif fault == "future":
        bars[-1] = bars[-1].model_copy(
            update={"end_time": s.request.server_time + timedelta(minutes=1)}
        )
    elif fault == "gap":
        bars.pop(20)
    elif fault == "duplicate":
        bars[20] = bars[19]
    elif fault == "stale":
        bars = [
            b.model_copy(
                update={
                    "start_time": b.start_time - timedelta(minutes=2),
                    "end_time": b.end_time - timedelta(minutes=2),
                }
            )
            for b in bars
        ]
    elif fault == "count":
        bars.pop()
    elif fault == "warmup":
        bars = bars[-10:]
    else:
        bars[20] = bars[20].model_copy(update={"quality_flags": ["UNVERIFIED"]})
    req = s.request.model_copy(
        update={"candles": [frame.model_copy(update={"candles": bars}), *s.request.candles[1:]]}
    )
    r = prepare_context(s.model_copy(update={"request": req}))
    assert not r.acceptable and r.reasons and r.evidence is None and r.codex_payload is None


@pytest.mark.parametrize(
    "fault", ["stale", "future_receipt", "naive", "crossed", "duplicate", "incomplete", "reconnect"]
)
def test_bad_dom_withholds_payload(fault: str) -> None:
    s = source()
    book = s.request.order_book
    changes: dict[str, object] = {}
    if fault == "stale":
        changes["source_time"] = s.request.server_time - timedelta(seconds=4)
    elif fault == "future_receipt":
        changes["received_at"] = s.request.server_time + timedelta(seconds=1)
    elif fault == "naive":
        changes["source_time"] = book.source_time.replace(tzinfo=None)
    elif fault == "crossed":
        changes["asks"] = book.bids
    elif fault == "duplicate":
        changes["bids"] = [book.bids[0]] * 2
    elif fault == "incomplete":
        changes["complete"] = False
    else:
        changes["discontinuity"] = True
    r = prepare_context(
        s.model_copy(
            update={
                "request": s.request.model_copy(
                    update={"order_book": book.model_copy(update=changes)}
                )
            }
        )
    )
    assert not r.acceptable and r.evidence is None and r.codex_payload is None


def test_shallow_symmetric_zero_depth_is_explicit_unknown() -> None:
    s = source()
    book = s.request.order_book
    bids = [x.model_copy(update={"size": "0"}) for x in book.bids[:4]]
    asks = [x.model_copy(update={"size": "0"}) for x in book.asks[:4]]
    r = prepare_context(
        s.model_copy(
            update={
                "request": s.request.model_copy(
                    update={"order_book": book.model_copy(update={"bids": bids, "asks": asks})}
                )
            }
        )
    )
    assert r.evidence is not None
    dep = r.evidence.depth
    assert dep.bid_levels == 4 and dep.imbalance is None and dep.microprice_bias is None
    assert "SHALLOW_BOOK" in dep.warnings and "SYMMETRIC_SIZE_LADDER" in dep.warnings


def test_confirmed_breaks_and_mss_are_not_backdated_or_repainted() -> None:
    prices = [("100", "101", "99", "100")] * 40
    prices[20] = ("100", "110", "99", "101")
    prices[22] = ("100", "101", "90", "99")
    prices[24] = ("100", "112", "100", "111")
    prices[28] = ("100", "100", "88", "89")
    early = frame_context(series(prices[:23]), Decimal(100))
    assert not any(p.price == "110" for p in early.pivots)
    prefix = frame_context(series(prices[:27]), Decimal(100))
    result = frame_context(series(prices), Decimal(100))
    assert any(e.kind == "INITIAL_BREAK" and e.direction == "BULLISH" for e in prefix.events)
    assert any(e.kind == "MSS" and e.direction == "BEARISH" for e in result.events)
    assert all(e in result.events for e in prefix.events)
    p = next(p for p in result.pivots if p.price == "110")
    assert p.available_at == series(prices).candles[23].end_time.isoformat()
    assert p.candle_at != p.available_at


def test_fvg_availability_and_later_touch_fill_are_separate() -> None:
    prices = [
        ("100", "101", "99", "100"),
        ("101", "104", "100", "103"),
        ("104", "105", "103", "104"),
    ]
    first = frame_context(series(prices), Decimal(104))
    z = first.nearest_active_zones[0]
    assert z.kind == "FVG" and z.lower == "101" and z.upper == "103" and z.status == "FRESH"
    touched = frame_context(series([*prices, ("104", "104", "102", "103")]), Decimal(103))
    assert (
        next(x for x in touched.nearest_active_zones if x.available_at == z.available_at).status
        == "TOUCHED"
    )
    filled = frame_context(series([*prices, ("104", "104", "100", "102")]), Decimal(102))
    assert (
        next(x for x in filled.recent_resolved_zones if x.available_at == z.available_at).status
        == "FILLED"
    )


def test_gap_resets_structure_and_does_not_infer_previous_full_day() -> None:
    s = series([("100", "101", "99", "100")] * 60)
    bars = [
        *s.candles[:20],
        *[
            c.model_copy(
                update={
                    "start_time": c.start_time + timedelta(hours=2),
                    "end_time": c.end_time + timedelta(hours=2),
                    "quality_flags": ["BROKER_SESSION_GAP_BEFORE"] if i == 20 else [],
                }
            )
            for i, c in enumerate(s.candles[20:], 20)
        ],
    ]
    r = frame_context(s.model_copy(update={"candles": bars}), Decimal(100))
    assert r.segment_candle_count == 40 and r.events == []
    assert r.previous_utc_day.status == "PARTIAL_OR_UNAVAILABLE" and r.previous_utc_day.high is None


def test_http_schema_parity_and_rejections() -> None:
    for name, model in [("request", ContextRequest), ("response", ContextResponse)]:
        assert json.loads(
            Path(f"schemas/technical-context-{name}-1.0.json").read_text()
        ) == model.model_json_schema(by_alias=True)
    with TestClient(app) as client:
        data = source().model_dump(mode="json", by_alias=True)
        r = client.post("/v1/technical-context", json=data)
        assert r.status_code == 200 and r.json()["acceptable"]
        data["quote"]["bid"] = "9999"
        rejected = client.post("/v1/technical-context", json=data)
        assert rejected.status_code == 200 and rejected.json()["codexPayload"] is None
        data["quote"]["bid"] = "NaN"
        assert client.post("/v1/technical-context", json=data).status_code == 422


def test_displacement_break_creates_body_order_block_only_after_break() -> None:
    prices = [("100", "101", "99", "100")] * 40
    prices[20] = ("100", "110", "99", "101")
    prices[23] = ("101", "102", "99", "100")
    prices[24] = ("100", "115", "100", "114")
    before = frame_context(series(prices[:24]), Decimal(101))
    assert not any(z.kind == "ORDER_BLOCK" for z in before.nearest_active_zones)
    after = frame_context(series(prices[:25]), Decimal(101))
    z = next(z for z in after.nearest_active_zones if z.kind == "ORDER_BLOCK")
    assert (z.lower, z.upper) == ("100", "101") and z.status == "FRESH"
    assert z.origin_at == series(prices).candles[23].end_time.isoformat()
    assert z.available_at == series(prices).candles[24].end_time.isoformat()
    invalidated = frame_context(series([*prices[:25], ("100", "101", "97", "98")]), Decimal(100))
    assert any(
        x.kind == "ORDER_BLOCK" and x.status == "INVALIDATED"
        for x in invalidated.recent_resolved_zones
    )


def test_valid_session_gap_resets_structure_without_hours_of_indicator_warmup() -> None:
    s = source()
    series0 = s.request.candles[0]
    bars = list(series0.candles)
    # Move earlier bars back two hours, retaining an explicitly verified closure.
    bars = [
        c.model_copy(
            update={
                "start_time": c.start_time - timedelta(hours=2),
                "end_time": c.end_time - timedelta(hours=2),
            }
        )
        if i < 50
        else c
        for i, c in enumerate(bars)
    ]
    bars[50] = bars[50].model_copy(update={"quality_flags": ["BROKER_SESSION_GAP_BEFORE"]})
    req = s.request.model_copy(
        update={"candles": [series0.model_copy(update={"candles": bars}), *s.request.candles[1:]]}
    )
    result = prepare_context(s.model_copy(update={"request": req}))
    assert result.acceptable and result.evidence is not None
    frame = next(f for f in result.evidence.frames if f.timeframe == series0.timeframe)
    assert frame.segment_candle_count == 10 and frame.atr != "0"


@pytest.mark.parametrize("fault", ["stale", "future", "crossed"])
def test_quote_faults_cannot_produce_a_candidate(fault: str) -> None:
    s = source()
    changes: dict[str, object] = {}
    if fault == "stale":
        changes["source_time"] = s.request.server_time - timedelta(seconds=4)
    elif fault == "future":
        changes["received_at"] = s.request.server_time + timedelta(seconds=1)
    else:
        changes["bid"] = "2041"
    result = prepare_context(s.model_copy(update={"quote": s.quote.model_copy(update=changes)}))
    assert not result.acceptable and result.codex_payload is None


def test_equal_highs_require_two_confirmed_pivots() -> None:
    prices = [("100", "101", "99", "100")] * 30
    prices[10] = ("100", "105", "99", "101")
    prices[20] = ("100", "105.01", "99", "101")
    before = frame_context(series(prices[:23]), Decimal(100))
    after = frame_context(series(prices), Decimal(100))
    assert before.liquidity_pools == []
    pool = next(p for p in after.liquidity_pools if p.kind == "EQUAL_HIGHS")
    assert pool.confirmed_touches == 2 and pool.tolerance == "0.02"
    assert pool.available_at == series(prices).candles[23].end_time.isoformat()
    assert pool.scope == "HISTORICAL_PIVOT_CLUSTER_NOT_RESTING_ORDERS"
