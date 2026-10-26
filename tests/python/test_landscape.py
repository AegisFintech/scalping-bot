from copy import deepcopy
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest

from apps.dashboard.landscape_data import landscape_events
from apps.dashboard.landscape_model import completed_series, event_tape, landscape_model, price

NOW = datetime(2026, 10, 20, 8, tzinfo=UTC)


def snapshot() -> dict:
    return {
        "captured_at": NOW,
        "currency": "USD",
        "status": {
            "mode": "demo",
            "symbol": "XAUUSD",
            "startupChecksPassed": True,
            "automaticAnalysisEnabled": True,
            "managedSetup": {"status": "NONE", "positions": [], "orders": []},
        },
        "daily": {
            "trading_day": NOW.date(),
            "reconciled_at": NOW,
            "current_equity": "10000.1",
            "baseline_equity": "10000",
            "loss_percent": "0",
            "realized_pnl": "0.3",
            "locked_out": False,
        },
        "monitor": {
            "status": "AVAILABLE",
            "pnlCapturedAt": NOW,
            "quoteSourceTime": NOW,
            "quoteReceivedAt": NOW,
            "netUnrealizedPnl": "-2.3",
            "grossUnrealizedPnl": "1",
            "recordedCommission": "-3.3",
        },
        "positions": [],
        "orders": [],
        "curve": [
            {"closed_at": NOW - timedelta(minutes=2), "net_pnl": "0.1"},
            {"closed_at": NOW - timedelta(minutes=1), "net_pnl": "0.2"},
        ],
    }


def test_real_money_is_decimal_exact_and_unknown_costs_remain_unknown() -> None:
    result = landscape_model(snapshot(), "ready", NOW)
    assert result["values"]["day-net"]["text"] == "+0.30"
    assert result["values"]["open-net"]["text"] == "-2.30"
    assert result["curve"][-1]["net"] == "0.3"
    assert result["gross"] == "1.00" and result["commission"] == "-3.30"
    assert "closing_cost" not in result
    assert price("4000.0100") == "4000.01" and price("4000") == "4000"
    assert price("Infinity") == "Unavailable" and price("-1") == "Unavailable"


@pytest.mark.parametrize("state", ["loading", "unavailable"])
def test_failed_poll_never_retains_current_money_exposure_or_active_stage(state: str) -> None:
    result = landscape_model(snapshot(), state, NOW)
    assert not result["available"] and not result["exposureKnown"]
    assert result["stage"] is None
    assert all(v["text"] == "Unavailable" for v in result["values"].values())
    assert not result["positions"] and not result["events"]


def test_client_deadlines_preserve_independent_quote_pnl_and_protection_ages() -> None:
    s = snapshot()
    s["monitor"]["quoteReceivedAt"] = NOW - timedelta(seconds=8)
    s["positions"] = [
        {
            "side": "BUY",
            "state": "OPEN",
            "entry_price": "4000",
            "stop_loss": "3999.999",
            "take_profit": "4001.001",
            "protection_status": "VERIFIED",
            "protection_observed_at": NOW - timedelta(seconds=9),
        }
    ]
    result = landscape_model(s, "ready", NOW)
    assert result["values"]["open-net"]["until"] == (NOW + timedelta(seconds=2)).isoformat()
    assert result["positions"][0]["sl"] == "3999.999"
    assert result["positions"][0]["until"] == (NOW + timedelta(seconds=1)).isoformat()
    assert all(
        v["until"] == (NOW + timedelta(seconds=1)).isoformat()
        for v in result["overlays"]
        if "broker" in v["label"]
    )
    s["monitor"]["quoteReceivedAt"] = NOW + timedelta(seconds=1)
    assert landscape_model(s, "ready", NOW)["values"]["open-net"]["text"] == "Unavailable"


def test_wrong_utc_day_and_expired_poll_withhold_financial_values() -> None:
    s = snapshot()
    s["daily"]["trading_day"] = NOW.date() - timedelta(days=1)
    assert landscape_model(s, "ready", NOW)["values"]["day-net"]["text"] == "Unavailable"
    s["captured_at"] = NOW - timedelta(seconds=31)
    assert not landscape_model(s, "ready", NOW)["available"]
    s["captured_at"] = NOW + timedelta(seconds=1)
    assert not landscape_model(s, "ready", NOW)["available"]


def test_curve_unknown_values_and_future_outcomes_are_never_skipped_to_improve_results() -> None:
    for patch in [{"net_pnl": None}, {"net_pnl": "NaN"}, {"closed_at": NOW + timedelta(seconds=1)}]:
        s = snapshot()
        s["curve"][0].update(patch)
        assert landscape_model(s, "ready", NOW)["curve"] == []


def candle() -> dict:
    return {
        "timeframe": "M1",
        "start_time": NOW - timedelta(minutes=2),
        "end_time": NOW - timedelta(minutes=1),
        "open": "4000",
        "high": "4002",
        "low": "3999",
        "close": "4001",
        "complete": True,
    }


@pytest.mark.parametrize(
    "patch",
    [
        {"complete": False},
        {"end_time": NOW + timedelta(seconds=1)},
        {"high": "3998"},
        {"open": "NaN"},
        {"low": "0"},
    ],
)
def test_invalid_or_forming_candles_withhold_the_whole_timeframe(patch: dict) -> None:
    bad = candle()
    bad.update(patch)
    assert completed_series([bad], NOW)["M1"] == []
    assert len(completed_series([candle()], NOW)["M1"]) == 1
    assert completed_series([candle(), candle()], NOW)["M1"] == []


def test_event_identity_receipt_time_and_unknown_reasons_have_no_raw_payload_leak() -> None:
    rows = [
        {
            "kind": "context",
            "id": "opaque-context-id",
            "requested_at": NOW - timedelta(seconds=5),
            "completed_at": NOW,
            "state": "FAILED",
            "reason": "https://private.invalid/token",
        },
        {
            "kind": "broker",
            "id": "opaque-event-id",
            "received_at": NOW,
            "occurred_at": NOW - timedelta(seconds=3),
            "mapping_state": "MAPPED",
            "order_state": "CANCELLED",
            "normalized_payload": {"accountId": "not-for-display"},
        },
    ]
    output = event_tape(rows, NOW)
    assert len(output) == 3
    assert output == event_tape(deepcopy(rows), NOW)
    text = str(output)
    assert all(
        secret not in text
        for secret in ["opaque-", "private.invalid", "not-for-display", "normalized_payload"]
    )
    claimed = next(e for e in output if e["source"] == "codex" and "claimed" in e["title"])
    assert "not proof of provider receipt" in claimed["detail"]
    broker = next(e for e in output if e["source"] == "broker")
    assert broker["at"] == NOW.isoformat() and "CANCELLED" in broker["detail"]
    assert len(broker["id"]) == 64
    rows[1]["received_at"] = NOW + timedelta(seconds=1)
    assert not any(e["source"] == "broker" for e in event_tape(rows, NOW))


def test_unmapped_broker_event_is_not_recovered_and_close_reason_is_not_inferred() -> None:
    rows = [
        {
            "kind": "broker",
            "id": "b",
            "received_at": NOW,
            "mapping_state": "CONFLICT",
            "order_state": "FILLED",
        },
        {"kind": "close", "id": "t", "closed_at": NOW, "realized_pnl": "-2.5"},
    ]
    output = event_tape(rows, NOW)
    assert any("Mapping unresolved" in e["detail"] and "FILLED" not in e["detail"] for e in output)
    assert any("Exit cause is not inferred" in e["detail"] for e in output)


def test_lifecycle_reads_are_scoped_bounded_and_do_not_select_whole_payloads() -> None:
    read = Mock(return_value=[])
    assert landscape_events(read, ("account", "symbol", "demo")) == []
    assert read.call_count == 5
    for call in read.call_args_list:
        sql, bound = call.args
        assert bound == ("account", "symbol", "demo")
        assert "LIMIT" in sql and "ORDER BY" in sql
        assert "submitted_at" not in sql
        assert "SELECT *" not in sql
    assert "be.account_id=%s AND be.symbol_id=%s AND og.mode=%s" in read.call_args_list[3].args[0]


def test_current_breakout_risk_display_keeps_shared_dynamic_budget_and_rejects_mode_mismatch() -> (
    None
):
    s = snapshot()
    s["capital"] = {
        "updated_at": NOW,
        "risk_multiplier": "0",
        "drawdown_percent": "8",
        "risk_cap_percent": "1",
        "risk_policy": {
            "version": "0.4.0-breakout-scalp.1",
            "mode": "demo",
            "lossLimitsEnforced": False,
            "setupRiskPercent": "1",
            "dailyLossLimitPercent": "5",
        },
    }
    assert landscape_model(s, "ready", NOW)["values"]["ceiling"]["text"] == "100.00"
    s["daily"]["current_equity"] = "8000"
    assert landscape_model(s, "ready", NOW)["values"]["ceiling"]["text"] == "80.00"
    s["capital"]["risk_policy"]["mode"] = "live"
    assert landscape_model(s, "ready", NOW)["values"]["ceiling"]["text"] == "Unavailable"


def test_fresh_monitor_quote_is_distinct_from_missing_order_book_and_stale_quotes() -> None:
    s = snapshot()
    s["monitor"].update(bid="4000.001", ask="4000.003")
    result = landscape_model(s, "ready", NOW)
    assert result["values"]["quote"]["text"] == "4000.001"
    assert ("Current spread", "0.002") in result["factors"]
    s["monitor"]["quoteSourceTime"] = NOW - timedelta(seconds=11)
    assert landscape_model(s, "ready", NOW)["values"]["quote"]["text"] == "Unavailable"
    s["monitor"]["quoteSourceTime"] = NOW
    s["monitor"]["ask"] = "3999"
    assert landscape_model(s, "ready", NOW)["values"]["ask"]["text"] == "Unavailable"


def test_wait_observation_is_not_labelled_as_available_entry_prices() -> None:
    row = {
        "id": "wait1",
        "kind": "context",
        "state": "READY",
        "requested_at": NOW - timedelta(seconds=20),
        "available_at": NOW - timedelta(seconds=10),
        "plan_schema": "entry-wait-1.0",
        "wait_reason": "Opposing structure, no clear box",
    }
    events = event_tape([row], NOW)
    assert any(
        e["title"] == "Codex chose WAIT" and e["detail"] == row["wait_reason"] for e in events
    )
    assert not any(e["title"] == "Entry prices available" for e in events)


def test_quick_oco_budget_is_demo_only_and_flight_withdraws_with_account_evidence() -> None:
    s = snapshot()
    s["capital"] = {
        "updated_at": NOW,
        "risk_multiplier": "1",
        "drawdown_percent": "0",
        "risk_cap_percent": "5",
        "risk_policy": {
            "version": "0.7.0-quick-oco.1",
            "mode": "demo",
            "lossLimitsEnforced": False,
            "setupRiskPercent": "5",
            "dailyLossLimitPercent": "5",
        },
    }
    s["flight"] = {"available": True, "state": "RECORDING"}
    m = landscape_model(s, "ready", NOW)
    assert m["values"]["ceiling"]["text"] == "500.00"
    assert m["flight"]["available"]
    s["capital"]["risk_policy"]["version"] = "0.6.0-entry-modes.1"
    assert landscape_model(s, "ready", NOW)["values"]["ceiling"]["text"] == "Unavailable"
    s["capital"]["risk_policy"]["mode"] = "live"
    assert landscape_model(s, "ready", NOW)["values"]["ceiling"]["text"] == "Unavailable"
    assert not landscape_model(s, "unavailable", NOW)["flight"]["available"]
