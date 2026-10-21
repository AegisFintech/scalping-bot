import pytest

from apps.dashboard.position_monitor import DecisionViewError, open_position_monitor_view


def test_open_position_monitor_view_preserves_exact_broker_values() -> None:
    view = open_position_monitor_view(
        {
            "status": "AVAILABLE",
            "executionState": "RECONCILIATION_REQUIRED",
            "side": "BUY",
            "accountCurrency": "USD",
            "bid": "4641.2",
            "ask": "4641.4",
            "markPrice": "4641.2",
            "grossUnrealizedPnl": "3.2",
            "netUnrealizedPnl": "2.75",
            "recordedCommission": "-0.3",
            "quoteSourceTime": "2026-08-25T04:00:00.000Z",
            "quoteReceivedAt": "2026-08-25T04:00:00.050Z",
            "pnlCapturedAt": "2026-08-25T04:00:00.060Z",
        }
    )

    assert view["markPrice"] == "4641.2"
    assert view["netUnrealizedPnl"] == "2.75"
    assert view["recordedCommission"] == "-0.3"
    assert view["executionState"] == "RECONCILIATION_REQUIRED"


def test_open_position_monitor_view_handles_none_and_rejects_malformed_data() -> None:
    assert open_position_monitor_view({"status": "NONE"}) == {"status": "NONE"}
    with pytest.raises(DecisionViewError, match="FIELDS_INVALID"):
        open_position_monitor_view({"status": "AVAILABLE", "broker_position_id": "must-not-render"})
    with pytest.raises(DecisionViewError, match="EXECUTION_STATE_INVALID"):
        open_position_monitor_view(
            {
                "status": "AVAILABLE",
                "executionState": "ACTIVE",
                "side": "SELL",
                "accountCurrency": "USD",
                "bid": "4641.2",
                "ask": "4641.4",
                "markPrice": "4641.4",
                "grossUnrealizedPnl": "3.2",
                "netUnrealizedPnl": "2.75",
                "recordedCommission": "-0.3",
                "quoteSourceTime": "2026-08-25T04:00:00.000Z",
                "quoteReceivedAt": "2026-08-25T04:00:00.050Z",
                "pnlCapturedAt": "2026-08-25T04:00:00.060Z",
            }
        )
    with pytest.raises(DecisionViewError, match="DECIMAL_INVALID"):
        open_position_monitor_view(
            {
                "status": "AVAILABLE",
                "executionState": "NORMAL",
                "side": "SELL",
                "accountCurrency": "USD",
                "bid": "NaN",
                "ask": "4641.4",
                "markPrice": "4641.4",
                "grossUnrealizedPnl": "3.2",
                "netUnrealizedPnl": "2.75",
                "recordedCommission": "-0.3",
                "quoteSourceTime": "2026-08-25T04:00:00.000Z",
                "quoteReceivedAt": "2026-08-25T04:00:00.050Z",
                "pnlCapturedAt": "2026-08-25T04:00:00.060Z",
            }
        )
