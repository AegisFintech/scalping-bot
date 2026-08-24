from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from pydantic import ValidationError

from python.analytics.models import AnalyticsRequest
from python.analytics.service import analyze


def candle(start: datetime, minutes: int, price: int) -> dict[str, object]:
    return {
        "startTime": start.isoformat(),
        "endTime": (start + timedelta(minutes=minutes)).isoformat(),
        "open": f"{price}.00",
        "high": f"{price + 2}.00",
        "low": f"{price - 1}.00",
        "close": f"{price + 1}.00",
        "volume": "100.00",
        "complete": True,
        "qualityFlags": [],
    }


def request_payload(count: int = 40) -> dict[str, object]:
    analysis_time = datetime(2026, 1, 2, 12, tzinfo=UTC)
    series = []
    for timeframe, minutes in (("M1", 1), ("M5", 5), ("M15", 15)):
        start = analysis_time - timedelta(minutes=count * minutes)
        series.append(
            {
                "timeframe": timeframe,
                "candles": [
                    candle(start + timedelta(minutes=index * minutes), minutes, 2000 + index)
                    for index in range(count)
                ],
            }
        )
    bids = [
        {"price": f"{2040 - index / 10:.2f}", "size": f"{10 + index}.00"} for index in range(20)
    ]
    asks = [
        {"price": f"{2040.2 + index / 10:.2f}", "size": f"{12 + index}.00"} for index in range(20)
    ]
    return {
        "schemaVersion": "1.0",
        "requestId": "11111111-1111-4111-8111-111111111111",
        "analysisId": "22222222-2222-4222-8222-222222222222",
        "symbol": "XAUUSD",
        "analysisTime": analysis_time.isoformat(),
        "serverTime": analysis_time.isoformat(),
        "candles": series,
        "orderBook": {
            "sourceTime": analysis_time.isoformat(),
            "receivedAt": analysis_time.isoformat(),
            "bids": bids,
            "asks": asks,
            "complete": True,
            "discontinuity": False,
            "reconnectSequence": 0,
            "aggregates": [
                {
                    "windowMs": window,
                    "sampleCount": 1,
                    "bidLiquidityChange": "0",
                    "askLiquidityChange": "0",
                    "additions": 0,
                    "removals": 0,
                }
                for window in (60000, 300000, 900000)
            ],
        },
        "config": {
            "atrPeriod": 15,
            "emaFastPeriod": 5,
            "emaSlowPeriod": 19,
            "adxEnabled": True,
            "adxPeriod": 14,
            "rsiEnabled": True,
            "rsiPeriod": 14,
            "bollingerEnabled": False,
            "bollingerPeriod": 20,
            "bollingerStddev": "2",
            "swingPivotLeft": 3,
            "swingPivotRight": 3,
            "compactTail": {"M1": 10, "M5": 10, "M15": 10},
            "expectedCounts": {"M1": count, "M5": count, "M15": count},
        },
    }


def test_analytics_builds_required_features() -> None:
    request = AnalyticsRequest.model_validate(request_payload())
    response = analyze(request, now=request.analysis_time)
    assert response.acceptable
    assert response.request_id == UUID("11111111-1111-4111-8111-111111111111")
    timeframes = response.features["timeframes"]
    assert isinstance(timeframes, dict)
    assert timeframes["M1"]["atr"] is not None
    assert timeframes["M1"]["ema_alignment"] == "BULLISH"
    assert len(timeframes["M1"]["raw_tail"]) == 10
    assert len(timeframes["M1"]["full_candles"]) == 40
    assert timeframes["M1"]["full_candles"][-1]["ema_fast"] is not None


def test_forming_candle_fails_closed() -> None:
    payload = request_payload()
    payload["candles"][0]["candles"][-1]["complete"] = False  # type: ignore[index]
    response = analyze(AnalyticsRequest.model_validate(payload))
    assert not response.acceptable
    assert "M1_FORMING_CANDLE" in response.rejection_reasons
    assert response.features == {}


def test_extra_request_field_is_rejected() -> None:
    payload = request_payload()
    payload["secret"] = "not-allowed"
    with pytest.raises(ValidationError):
        AnalyticsRequest.model_validate(payload)


def test_price_must_be_a_decimal_string() -> None:
    payload = request_payload()
    payload["candles"][0]["candles"][0]["open"] = 2000.0  # type: ignore[index]
    with pytest.raises(ValidationError):
        AnalyticsRequest.model_validate(payload)


def test_broker_session_gap_is_accepted_and_counted() -> None:
    payload = request_payload()
    candles = payload["candles"][0]["candles"]  # type: ignore[index]
    for item in candles[20:]:
        item["startTime"] = (  # type: ignore[index]
            datetime.fromisoformat(str(item["startTime"])) + timedelta(days=2)
        ).isoformat()
        item["endTime"] = (  # type: ignore[index]
            datetime.fromisoformat(str(item["endTime"])) + timedelta(days=2)
        ).isoformat()
    candles[20]["qualityFlags"] = ["BROKER_SESSION_GAP_BEFORE"]  # type: ignore[index]
    payload["analysisTime"] = (  # type: ignore[index]
        datetime.fromisoformat(str(payload["analysisTime"])) + timedelta(days=2)
    ).isoformat()

    response = analyze(AnalyticsRequest.model_validate(payload))

    assert response.acceptable
    assert response.features["timeframes"]["M1"]["session_gap_count"] == 1  # type: ignore[index]


def test_unmarked_gap_still_fails_closed() -> None:
    payload = request_payload()
    candles = payload["candles"][0]["candles"]  # type: ignore[index]
    candles[20]["startTime"] = (  # type: ignore[index]
        datetime.fromisoformat(str(candles[20]["startTime"])) + timedelta(minutes=1)
    ).isoformat()
    candles[20]["endTime"] = (  # type: ignore[index]
        datetime.fromisoformat(str(candles[20]["endTime"])) + timedelta(minutes=1)
    ).isoformat()

    response = analyze(AnalyticsRequest.model_validate(payload))

    assert not response.acceptable
    assert "M1_GAP_OR_OVERLAP" in response.rejection_reasons


@pytest.mark.parametrize("position", [0, 1])
def test_misplaced_session_gap_marker_fails_closed(position: int) -> None:
    payload = request_payload()
    candles = payload["candles"][0]["candles"]  # type: ignore[index]
    candles[position]["qualityFlags"] = ["BROKER_SESSION_GAP_BEFORE"]  # type: ignore[index]

    response = analyze(AnalyticsRequest.model_validate(payload))

    assert not response.acceptable
    assert "M1_SESSION_GAP_FLAG_INVALID" in response.rejection_reasons


def test_session_marker_cannot_hide_overlap_or_unknown_quality_flag() -> None:
    payload = request_payload()
    candles = payload["candles"][0]["candles"]  # type: ignore[index]
    candles[20]["startTime"] = candles[19]["startTime"]  # type: ignore[index]
    candles[20]["endTime"] = candles[19]["endTime"]  # type: ignore[index]
    candles[20]["qualityFlags"] = [  # type: ignore[index]
        "BROKER_SESSION_GAP_BEFORE",
        "UNTRUSTED_FLAG",
    ]

    response = analyze(AnalyticsRequest.model_validate(payload))

    assert not response.acceptable
    assert "M1_GAP_OR_OVERLAP" in response.rejection_reasons
    assert "M1_SESSION_GAP_FLAG_INVALID" in response.rejection_reasons
    assert "M1_QUALITY_FLAG_INVALID" in response.rejection_reasons


def test_session_marker_cannot_hide_an_unbounded_gap() -> None:
    payload = request_payload()
    candles = payload["candles"][0]["candles"]  # type: ignore[index]
    for item in candles[20:]:
        item["startTime"] = (  # type: ignore[index]
            datetime.fromisoformat(str(item["startTime"])) + timedelta(days=15)
        ).isoformat()
        item["endTime"] = (  # type: ignore[index]
            datetime.fromisoformat(str(item["endTime"])) + timedelta(days=15)
        ).isoformat()
    candles[20]["qualityFlags"] = ["BROKER_SESSION_GAP_BEFORE"]  # type: ignore[index]
    payload["analysisTime"] = (  # type: ignore[index]
        datetime.fromisoformat(str(payload["analysisTime"])) + timedelta(days=15)
    ).isoformat()

    response = analyze(AnalyticsRequest.model_validate(payload))

    assert not response.acceptable
    assert "M1_GAP_OR_OVERLAP" in response.rejection_reasons
    assert "M1_SESSION_GAP_FLAG_INVALID" in response.rejection_reasons
