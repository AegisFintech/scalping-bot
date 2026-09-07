"""Pure presentation rules. Never feeds execution or estimates missing money."""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


def money(value: object) -> str:
    try:
        number = Decimal(str(value))
        return f"{number:,.2f}" if number.is_finite() else "Unavailable"
    except (InvalidOperation, ValueError):
        return "Unavailable"


def fresh(timestamp: object, now: datetime, maximum_seconds: int = 30) -> bool:
    try:
        stamp = (
            timestamp if isinstance(timestamp, datetime) else datetime.fromisoformat(str(timestamp))
        )
        if stamp.tzinfo is None:
            return False
        return 0 <= (now - stamp.astimezone(UTC)).total_seconds() <= maximum_seconds
    except (TypeError, ValueError):
        return False


def operating_state(status: dict[str, Any]) -> tuple[str, str]:
    if status.get("unavailable") or not status.get("mode"):
        return "Unavailable", "Execution status could not be verified."
    if status.get("emergencyStopped") is True:
        if "ACCOUNT_EQUITY_FLOOR_REQUIRED" in status.get("reasonCodes", []):
            return "Stopped", (
                "An explicit minimum equity is needed before demo orders can resume. "
                "Protective management continues."
            )
        return "Stopped", "Emergency stop is active. Protective management continues."
    if status.get("pauseNewAnalyses") is True:
        return "Paused", "New analysis is paused. Existing orders and positions remain managed."
    if status.get("startupChecksPassed") is not True:
        return "Blocked", "Startup or reconciliation checks have not passed."
    managed = status.get("managedSetup", {})
    if isinstance(managed, dict) and managed.get("status") == "ACTIVE":
        return "Managing a setup", "An existing position or pending order blocks replacement."
    if status.get("reasonCodes"):
        return "Blocked", "A safety or market-quality gate currently blocks new orders."
    if status.get("automaticAnalysisEnabled") is not True:
        return "Manual analysis", "Automatic analysis is disabled."
    return "Monitoring", "Waiting for a qualified opportunity; no trade is guaranteed."


def context_state(context: dict[str, Any], now: datetime) -> str:
    if context.get("consumed"):
        return "Consumed — waiting for next map"
    if context.get("state") == "READY":
        try:
            expiry = datetime.fromisoformat(str(context["valid_until"]))
            if expiry.tzinfo is None:
                return "Unavailable"
            return "Ready" if expiry > now else "Expired — waiting for refresh"
        except (KeyError, ValueError):
            return "Unavailable"
    return str(context.get("state", "Unavailable"))


def risk_summary(daily: dict[str, Any], capital: dict[str, Any], now: datetime) -> dict[str, str]:
    unavailable = dict.fromkeys(
        ["equity", "realized", "unrealized", "daily_remaining", "drawdown", "setup_budget"],
        "Unavailable",
    )
    if not fresh(daily.get("reconciled_at"), now):
        return unavailable
    try:
        equity = Decimal(str(daily["current_equity"]))
        baseline = Decimal(str(daily["baseline_equity"]))
        loss = Decimal(str(daily["loss_percent"]))
        if not all(v.is_finite() for v in [equity, baseline, loss]):
            return unavailable
        remaining = max(Decimal(0), baseline * (Decimal(1) - loss) / 100)
        result = {
            **unavailable,
            "equity": money(equity),
            "realized": money(daily.get("realized_pnl")),
            "unrealized": money(daily.get("unrealized_pnl")),
            "daily_remaining": "Unavailable",
        }
        if fresh(capital.get("updated_at"), now):
            multiplier = Decimal(str(capital["risk_multiplier"]))
            if multiplier not in [Decimal(0), Decimal("0.25"), Decimal("0.5"), Decimal(1)]:
                return result
            result["daily_remaining"] = money(remaining)
            result["drawdown"] = money(capital.get("drawdown_percent")) + "%"
            result["setup_budget"] = money(min(remaining, equity * Decimal("0.00001") * multiplier))
            if "risk_cap_percent" in capital:
                cap = capital["risk_cap_percent"]
                result["setup_budget"] = (
                    "Unavailable"
                    if cap is None
                    else money(
                        min(
                            remaining,
                            equity * Decimal("0.00001") * multiplier,
                            equity * max(Decimal(0), Decimal(str(cap))) / 100,
                        )
                    )
                )
        return result
    except (KeyError, InvalidOperation, ValueError):
        return unavailable
