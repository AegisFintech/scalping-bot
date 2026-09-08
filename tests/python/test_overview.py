import importlib.util
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

spec = importlib.util.spec_from_file_location("overview", Path("apps/dashboard/overview.py"))
assert spec and spec.loader
overview = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = overview
spec.loader.exec_module(overview)


def test_unavailable_is_never_healthy_or_zero() -> None:
    assert overview.operating_state({})[0] == "Unavailable"
    assert overview.money(None) == "Unavailable"
    assert overview.money("NaN") == "Unavailable"


def test_running_check_is_not_a_fault_but_mixed_safety_reasons_still_block() -> None:
    status = {
        "mode": "demo",
        "startupChecksPassed": True,
        "reasonCodes": ["PREVIOUS_ANALYSIS_ACTIVE"],
    }
    assert overview.operating_state(status)[0] == "Checking setup"
    status["reasonCodes"].append("DAILY_LOSS_LOCKOUT")
    assert overview.operating_state(status)[0] == "Blocked"


def test_control_and_position_precedence() -> None:
    status = {"mode": "demo", "startupChecksPassed": True, "pauseNewAnalyses": True}
    assert overview.operating_state(status)[0] == "Paused"
    status["emergencyStopped"] = True
    assert overview.operating_state(status)[0] == "Stopped"


def test_context_validity_and_consumption_are_distinct_from_provider_success() -> None:
    now = datetime(2026, 9, 7, tzinfo=UTC)
    assert overview.context_state(
        {"state": "READY", "valid_until": now.isoformat()}, now
    ).startswith("Expired")
    assert overview.context_state({"state": "READY", "valid_until": "bad"}, now) == "Unavailable"
    assert overview.context_state({"consumed": True}, now).startswith("Consumed")


def test_stale_and_future_equity_are_withheld() -> None:
    now = datetime(2026, 9, 7, tzinfo=UTC)
    for stamp in [now - timedelta(seconds=31), now + timedelta(seconds=1), "invalid"]:
        assert overview.risk_summary({"reconciled_at": stamp}, {}, now)["equity"] == "Unavailable"


def test_budget_is_unavailable_without_current_policy_and_reduced_inside_it() -> None:
    now = datetime(2026, 9, 7, tzinfo=UTC)
    daily = {
        "reconciled_at": now,
        "current_equity": "9900",
        "baseline_equity": "10000",
        "loss_percent": "1",
        "locked_out": False,
        "realized_pnl": "-90",
        "unrealized_pnl": "-10",
    }
    assert overview.risk_summary(daily, {}, now)["setup_budget"] == "Unavailable"
    capital = {
        "updated_at": now,
        "risk_multiplier": "0.5",
        "drawdown_percent": "1",
        "risk_cap_percent": "4",
        "risk_policy": {
            "version": "fixed-risk-v4",
            "setupRiskPercent": "1",
            "dailyLossLimitPercent": "5",
        },
    }
    result = overview.risk_summary(daily, capital, now)
    assert result["setup_budget"] == "49.50"
    assert result["daily_remaining"] == "400.00"
    capital["risk_cap_percent"] = "0.0001"
    assert overview.risk_summary(daily, capital, now)["setup_budget"] == "0.01"
    daily["locked_out"] = True
    assert overview.risk_summary(daily, capital, now)["setup_budget"] == "0.00"
    assert overview.risk_summary(daily, capital, now)["daily_remaining"] == "0.00"
    capital["risk_cap_percent"] = None
    assert overview.risk_summary(daily, capital, now)["setup_budget"] == "Unavailable"


def test_budget_never_guesses_a_missing_or_invalid_execution_policy() -> None:
    now = datetime(2026, 9, 7, tzinfo=UTC)
    daily = {
        "reconciled_at": now,
        "current_equity": "10000",
        "baseline_equity": "10000",
        "loss_percent": "0",
        "locked_out": False,
    }
    for policy in [
        None,
        {},
        {"version": "unknown"},
        {"version": "fixed-risk-v2", "setupRiskPercent": "NaN", "dailyLossLimitPercent": "5"},
    ]:
        capital = {
            "updated_at": now,
            "risk_multiplier": "1",
            "drawdown_percent": "0",
            "risk_cap_percent": "5",
            "risk_policy": policy,
        }
        result = overview.risk_summary(daily, capital, now)
        assert result["setup_budget"] == "Unavailable"
        assert result["daily_remaining"] == "Unavailable"


def test_rendered_dashboard_withholds_unavailable_data_and_rejects_unauthorized_control(
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    import httpx
    from streamlit.testing.v1 import AppTest

    monkeypatch.syspath_prepend(str(Path("apps/dashboard").resolve()))
    monkeypatch.setenv("ACCOUNT_KEY", "unconfigured")
    monkeypatch.delenv("DASHBOARD_CONTROL_TOKEN", raising=False)

    def unavailable(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise httpx.ConnectError("fixture unavailable")

    def forbidden(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("unauthorized control reached transport")

    monkeypatch.setattr(httpx, "get", unavailable)
    monkeypatch.setattr(httpx, "post", forbidden)
    app = AppTest.from_file(Path("apps/dashboard/app.py").resolve(), default_timeout=15).run()
    assert not app.exception
    assert len(app.metric) == 4
    assert all(metric.value == "Unavailable" for metric in app.metric)
    app.button[1].click().run()
    assert not app.exception
    assert any("authorization are required" in error.value for error in app.error)
    app.radio[0].set_value("Trade history").run()
    assert not app.exception


def test_operational_storage_failure_is_blocked_even_after_successful_startup() -> None:
    state, detail = overview.operating_state(
        {
            "mode": "demo",
            "startupChecksPassed": True,
            "operationalReady": False,
            "operationalFault": {"reasonCode": "DATABASE_STORAGE_LIMIT_EXCEEDED"},
        }
    )
    assert state == "Blocked"
    assert "Database capacity" in detail


def test_maintenance_pause_keeps_the_underlying_storage_block_visible() -> None:
    state, detail = overview.operating_state(
        {
            "mode": "demo",
            "startupChecksPassed": True,
            "pauseNewAnalyses": True,
            "operationalReady": False,
            "operationalFault": {"reasonCode": "DATABASE_STORAGE_LIMIT_EXCEEDED"},
        }
    )
    assert state == "Paused · storage blocked"
    assert "before resuming" in detail


def test_provider_failure_is_not_healthy_monitoring_and_active_management_takes_precedence() -> (
    None
):
    now = datetime(2026, 9, 8, tzinfo=UTC)
    status = {
        "mode": "demo",
        "startupChecksPassed": True,
        "automaticAnalysisEnabled": True,
        "scenarioContext": {"state": "FAILED", "reason": "AI_PROVIDER_TIMEOUT"},
    }
    state, detail = overview.operating_state(status, now)
    assert state == "Entries blocked · model unavailable"
    assert "timed out" in detail
    status["scenarioContext"]["reason"] = "AI_CIRCUIT_OPEN"
    assert "circuit" in overview.operating_state(status, now)[1]
    status["managedSetup"] = {"status": "ACTIVE"}
    assert overview.operating_state(status, now)[0] == "Managing a setup"


def test_missing_expired_consumed_and_overdue_maps_do_not_show_monitoring() -> None:
    now = datetime(2026, 9, 8, tzinfo=UTC)
    status = {"mode": "demo", "startupChecksPassed": True, "automaticAnalysisEnabled": True}
    for context in [
        None,
        {},
        {"state": "READY", "valid_until": now.isoformat()},
        {"state": "READY", "valid_until": (now + timedelta(seconds=64)).isoformat()},
        {"state": "READY", "consumed": True},
        {"state": "unknown"},
    ]:
        assert (
            overview.operating_state({**status, "scenarioContext": context}, now)[0]
            == "Waiting for map"
        )
    for stamp in [
        (now - timedelta(seconds=96)).isoformat(),
        "bad",
        (now + timedelta(seconds=1)).isoformat(),
    ]:
        state = overview.operating_state(
            {**status, "scenarioContext": {"state": "REQUESTING", "requested_at": stamp}}, now
        )[0]
        assert state == "Entries blocked · map overdue"
    assert (
        overview.operating_state(
            {**status, "scenarioContext": {"state": "REQUESTING", "requested_at": now.isoformat()}},
            now,
        )[0]
        == "Preparing market map"
    )
    assert (
        overview.operating_state(
            {
                **status,
                "scenarioContext": {
                    "state": "READY",
                    "valid_until": (now + timedelta(seconds=100)).isoformat(),
                },
            },
            now,
        )[0]
        == "Monitoring"
    )


def test_rendered_provider_outage_is_a_warning_and_labels_local_checks(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from streamlit.testing.v1 import AppTest

    monkeypatch.syspath_prepend(str(Path("apps/dashboard").resolve()))
    import background

    snapshot = {
        "status": {
            "mode": "demo",
            "startupChecksPassed": True,
            "automaticAnalysisEnabled": True,
            "scenarioContext": {"state": "FAILED", "reason": "AI_PROVIDER_TIMEOUT"},
            "lastCycle": {"outcome": "DEFERRED", "reasonCodes": ["SCENARIO_REFRESH_STARTED"]},
        }
    }
    monkeypatch.setattr(
        background.BackgroundReader,
        "poll",
        lambda self: background.PollResult(snapshot, "ready", 1),
    )
    app = AppTest.from_file(Path("apps/dashboard/app.py").resolve(), default_timeout=15).run()
    assert not app.exception
    assert any("Entries blocked · model unavailable" in warning.value for warning in app.warning)
    assert any("Latest execution check" in text.value for text in app.markdown)
    assert all("Last completed analysis" not in text.value for text in app.markdown)


def test_gtc_pending_and_position_lifecycle_labels() -> None:
    status = {
        "mode": "demo",
        "startupChecksPassed": True,
        "automaticAnalysisEnabled": True,
        "managedSetup": {"status": "ACTIVE", "orders": [{"timeInForce": "GTC"}], "positions": []},
    }
    assert overview.operating_state(status)[0] == "Orders pending"
    status["managedSetup"]["positions"] = [{"state": "OPEN"}]
    assert overview.operating_state(status)[0] == "Position active"


def test_gtc_reconciliation_failure_is_not_reported_as_normal_waiting() -> None:
    status = {
        "mode": "demo",
        "startupChecksPassed": True,
        "managedSetup": {"status": "ACTIVE", "groupState": "RECONCILIATION_REQUIRED"},
    }
    assert overview.operating_state(status)[0] == "Checking exposure"
