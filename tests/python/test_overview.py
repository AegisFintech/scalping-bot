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


def test_control_and_position_precedence() -> None:
    status = {"mode": "demo", "startupChecksPassed": True, "pauseNewAnalyses": True}
    assert overview.operating_state(status)[0] == "Paused"
    status["emergencyStopped"] = True
    assert overview.operating_state(status)[0] == "Stopped"


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
        "loss_percent": "0.5",
        "realized_pnl": "-90",
        "unrealized_pnl": "-10",
    }
    assert overview.risk_summary(daily, {}, now)["setup_budget"] == "Unavailable"
    capital = {"updated_at": now, "risk_multiplier": "0.5", "drawdown_percent": "1"}
    result = overview.risk_summary(daily, capital, now)
    assert result["setup_budget"] == "0.05"
    assert result["daily_remaining"] == "50.00"


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
