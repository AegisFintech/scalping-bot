import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from python.research.trade_paths import sample

NOW = datetime(2026, 10, 23, 1, 0, 3, tzinfo=UTC)
RELEASE = "direction-fixture"


def run(*, fault: str = "", pnl: bool = True):
    calls = []
    position = {
        "side": "BUY",
        "state": "OPEN",
        "openedAt": "2026-10-23T01:00:00Z",
        "entryPrice": "4000",
        "volume": "100",
        "broker_position_id": "private",
    }
    status = {
        "mode": "demo",
        "strategyVersion": RELEASE,
        "operationalReady": True,
        "accountId": "private",
        "managedSetup": {"positions": [position]},
    }

    def handler(request):
        calls.append((request.method, str(request.url)))
        assert not request.headers.get("authorization")
        if request.url.path == "/v1/status":
            body = json.loads(json.dumps(status))
            if fault == "source":
                body["strategyVersion"] = "changed"
            if fault == "position" and len(calls) > 2:
                body["managedSetup"]["positions"][0]["openedAt"] = "2026-10-23T01:00:02Z"
            return httpx.Response(200, json=body)
        if request.url.path == "/v1/quote":
            assert request.method == "POST" and json.loads(request.content) == {"symbol": "XAUUSD"}
            source = NOW - timedelta(seconds=10 if fault == "stale" else 1)
            return httpx.Response(
                200,
                json={
                    "accountId": "private",
                    "quote": {
                        "bid": "4001",
                        "ask": "4001.2",
                        "sourceTime": source.isoformat(),
                        "receivedAt": source.isoformat(),
                        "secret": "private",
                    },
                },
            )
        assert request.url.path == "/v1/open-position-monitor" and request.method == "GET"
        return httpx.Response(
            200,
            json={
                "status": "AVAILABLE",
                "side": "BUY",
                "accountCurrency": "USD",
                "grossUnrealizedPnl": "10",
                "netUnrealizedPnl": "8",
                "recordedCommission": "-2",
                "pnlCapturedAt": NOW.isoformat(),
                "quoteSourceTime": NOW.isoformat(),
                "quoteReceivedAt": NOW.isoformat(),
                "brokerPositionId": "private",
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        row = sample(client, RELEASE, NOW - timedelta(seconds=1), pnl=pnl, clock=lambda: NOW)
    return row, calls


def test_paths_keep_quote_and_pnl_times_separate_and_strip_identity():
    row, calls = run()
    assert row["state"] == "SAMPLED" and row["quote"] and row["pnl"]
    assert row["brokerAuthority"] is False and row["completeTickTape"] is False
    assert "private" not in json.dumps(row)
    assert len(calls) == 4


@pytest.mark.parametrize("fault,state", [("source", "SOURCE_HALT"), ("stale", "GAP")])
def test_bad_source_or_stale_quote_never_becomes_a_price_path(fault, state):
    row, calls = run(fault=fault)
    assert row["state"] == state and row["quote"] is None and row["pnl"] is None
    if fault == "source":
        assert len(calls) == 1


def test_position_change_censors_pnl_and_no_pnl_call_between_sample_intervals():
    row, _ = run(fault="position")
    assert row["pnl"] is None and row["pnl_reason"] == "POSITION_CHANGED"
    row, calls = run(pnl=False)
    assert row["quote"] and row["pnl"] is None and len(calls) == 2
