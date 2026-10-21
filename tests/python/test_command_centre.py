from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest

from apps.dashboard.command_data import command_data, provider_candles
from apps.dashboard.command_model import (
    action,
    cumulative_net,
    direction,
    levels,
    number,
)

NOW = datetime(2026, 10, 20, 8, tzinfo=UTC)


def test_workflow_tracks_real_exposure_even_when_analysis_is_paused() -> None:
    s = {
        "mode": "demo",
        "pauseNewAnalyses": True,
        "managedSetup": {"status": "ACTIVE", "positions": [{"state": "OPEN"}], "orders": []},
    }
    a = action(s, NOW)
    assert a["active"] == "protect" and a["title"] == "Paused"
    assert "waits for resume" in a["next"]
    assert action({"unavailable": True}, NOW)["title"] == "Unavailable"


def test_pending_and_inference_are_observed_never_synthesized() -> None:
    base = {"mode": "demo", "startupChecksPassed": True}
    assert (
        action(
            {**base, "scenarioContext": {"state": "REQUESTING", "requested_at": NOW.isoformat()}},
            NOW,
        )["active"]
        == "codex"
    )
    a = action(
        {
            **base,
            "managedSetup": {"status": "ACTIVE", "positions": [], "orders": [{"state": "PENDING"}]},
        },
        NOW,
    )
    assert a["active"] == "orders" and "broker trigger" in a["next"]


def test_proposed_intended_and_verified_levels_remain_distinct() -> None:
    s = {
        "evidence": {"plan": {"buy_stop": "4010", "sell_stop": "4000"}},
        "orders": [{"side": "BUY", "entry_price": "4010", "stop_loss": "4008"}],
        "positions": [
            {
                "side": "BUY",
                "protection_status": "VERIFIED",
                "protection_observed_at": NOW,
                "stop_loss": "4009",
                "take_profit": "4012",
            }
        ],
    }
    labels = {v["label"] for v in levels(s, NOW)}
    assert {"Codex BUY breakout", "BUY intended SL", "broker SL", "broker TP"} <= labels
    assert not any("broker" in v["label"] for v in levels(s, NOW + timedelta(seconds=11)))


def test_nonfinite_numbers_are_not_trusted() -> None:
    assert number("NaN") is None and number("Infinity") is None
    assert direction("-1") == "negative" and direction(None) == "neutral"


def test_command_reads_keep_scope_and_opaque_ids_internal() -> None:
    read = Mock(
        side_effect=[
            [{"analysis_id": "internal-a", "candle_snapshot_id": "internal-c"}],
            [],
            [],
            [],
            [],
            [],
        ]
    )
    data = command_data(read, ("account", "symbol", "demo"))
    assert read.call_args_list[0].args[1] == ("account", "symbol", "demo")
    assert "ar.account_id=%s AND ar.symbol_id=%s AND ar.mode=%s" in read.call_args_list[0].args[0]
    assert "internal-a" not in str(data) and "internal-c" not in str(data)
    assert "LIMIT 300" in read.call_args_list[4].args[0]
    assert read.call_args_list[-1].args[1] == ("symbol",)


def payload() -> dict:
    columns = [
        "startTime",
        "endTime",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "complete",
        "qualityFlags",
    ]
    row = [NOW.isoformat(), NOW.isoformat(), "1", "2", "1", "2", None, True, []]
    return {
        "candles": [
            {"timeframe": f, "columns": columns, "rows": [row]} for f in ["M1", "M5", "M15"]
        ]
    }


def test_recorded_provider_grid_is_bounded_and_complete() -> None:
    assert len(provider_candles(payload())) == 3
    for fault in ["forming", "missing", "columns", "oversized"]:
        p = payload()
        if fault == "forming":
            p["candles"][0]["rows"][0][7] = False
        elif fault == "missing":
            p["candles"].pop()
        elif fault == "columns":
            p["candles"][0]["columns"] = []
        else:
            p["candles"][0]["rows"] *= 289
        with pytest.raises(ValueError):
            provider_candles(p)


def test_cumulative_money_uses_decimal_arithmetic_and_rejects_unknown_costs() -> None:
    assert cumulative_net(["0.1", "0.2", "-0.05"]) == ["0.1", "0.3", "0.25"]
    for value in [None, "NaN", "Infinity"]:
        with pytest.raises(ValueError):
            cumulative_net(["1", value])
