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


def operating_state(status: dict[str, Any], now: datetime | None = None) -> tuple[str, str]:
    if status.get("unavailable") or not status.get("mode"):
        return "Unavailable", "Execution status could not be verified."
    if status.get("emergencyStopped") is True:
        return "Stopped", "Emergency stop is active. Protective management continues."
    if status.get("pauseNewAnalyses") is True:
        fault = status.get("operationalFault", {})
        if isinstance(fault, dict) and fault.get("reasonCode") == "DATABASE_STORAGE_LIMIT_EXCEEDED":
            return (
                "Paused · storage blocked",
                "Database capacity must be restored before resuming. "
                "Protective management continues.",
            )
        return "Paused", "New analysis is paused. Existing orders and positions remain managed."
    if status.get("operationalReady") is False:
        fault = status.get("operationalFault", {})
        if isinstance(fault, dict) and fault.get("reasonCode") == "DATABASE_STORAGE_LIMIT_EXCEEDED":
            return (
                "Blocked",
                "Database capacity is exhausted. New analysis waits for storage recovery; "
                "protective management continues.",
            )
        return (
            "Blocked",
            "An execution service failure blocks new analysis; recovery checks run automatically.",
        )
    if status.get("startupChecksPassed") is not True:
        return "Blocked", "Startup or reconciliation checks have not passed."
    managed = status.get("managedSetup", {})
    if isinstance(managed, dict) and managed.get("status") == "ACTIVE":
        if managed.get("groupState") == "RECONCILIATION_REQUIRED":
            return "Checking exposure", "Broker state needs reconciliation before the next setup."
        positions = managed.get("positions", [])
        if any(isinstance(p, dict) and p.get("state") != "CLOSED" for p in positions):
            active = [p for p in positions if isinstance(p, dict) and p.get("state") != "CLOSED"]
            if status.get("mode") == "paper":
                return "Paper position active", "Paper execution manages simulated SL/TP."
            confirmed = all(
                isinstance(p.get("protection"), dict)
                and p["protection"].get("status") == "VERIFIED"
                and p["protection"].get("stopLoss") is not None
                and p["protection"].get("takeProfit") is not None
                and fresh(p["protection"].get("observedAt"), now or datetime.now(UTC), 10)
                for p in active
            )
            return (
                "Position active",
                "Broker SL/TP confirmed. Fresh analysis follows confirmed closure."
                if confirmed
                else (
                    "SL/TP is missing, stale or awaiting broker confirmation. "
                    "Protection checks continue."
                ),
            )
        if any(
            isinstance(o, dict) and o.get("timeInForce") == "GTC" for o in managed.get("orders", [])
        ):
            return (
                "Orders pending",
                "Waiting for entry. GTC orders have no timer expiry; analysis waits.",
            )
        return "Managing a setup", "An existing position or pending order blocks replacement."
    if status.get("reasonCodes") == ["PREVIOUS_ANALYSIS_ACTIVE"]:
        return "Checking setup", "An execution check is in progress; another check cannot overlap."
    session = status.get("marketSession")
    other_reasons = set(status.get("reasonCodes") or []) - {
        "MARKET_SESSION_CLOSED",
        "MARKET_SESSION_UNAVAILABLE",
    }
    if other_reasons:
        return "Blocked", "A safety or market-quality gate currently blocks new orders."
    if isinstance(session, dict) and session.get("state") in {"CLOSED", "UNAVAILABLE"}:
        if not fresh(session.get("checkedAt"), now or datetime.now(UTC), 30):
            return "Session unavailable", "Session evidence is stale. Automatic checks continue."
        if session.get("state") == "CLOSED":
            return "Market closed", (
                "New analysis and orders wait for the broker session to reopen and fresh quotes. "
                "Monitoring and protective management continue automatically."
            )
        return "Session unavailable", (
            "Broker trading hours could not be verified. Automatic checks continue; "
            "new model requests and orders wait."
        )
    if status.get("reasonCodes"):
        return "Blocked", "A safety or market-quality gate currently blocks new orders."
    if status.get("automaticAnalysisEnabled") is not True:
        return "Manual analysis", "Automatic analysis is disabled."
    context = status.get("scenarioContext")
    if not isinstance(context, dict) or not context:
        return "Waiting for map", "No verified market map is available for new orders."
    current = now or datetime.now(UTC)
    if context.get("state") == "FAILED":
        detail = {
            "AI_PROVIDER_TIMEOUT": "The model request timed out.",
            "AI_CIRCUIT_OPEN": "The provider circuit is temporarily open after repeated failures.",
        }.get(str(context.get("reason")), "The latest market-map request failed.")
        return "Entries blocked · model unavailable", (
            f"{detail} No valid map authorizes new orders. "
            "Recovery checks are automatic; protective management continues."
        )
    if context.get("state") == "REQUESTING":
        if fresh(context.get("requested_at"), current, maximum_seconds=95):
            return "Preparing market map", (
                "Background model analysis is running. No new orders until its map is validated."
            )
        return "Entries blocked · map overdue", (
            "The market-map request has no timely completion. "
            "Recovery checks are automatic; protective management continues."
        )
    if context.get("retired_at"):
        return "Refreshing entry prices", (
            "The previous unsubmitted pair is no longer executable. "
            "Replacement is automatic; repeated failures retain request backoff."
        )
    map_state = context_state(context, current)
    if map_state != "Ready":
        return "Waiting for map", f"{map_state}. No replacement order has been submitted."
    return "Monitoring", "Waiting for a qualified opportunity; no trade is guaranteed."


def position_rows(positions: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    result = []
    for position in positions:
        row = dict(position)
        if row.get("protection_status") != "SIMULATED" and not fresh(
            row.get("protection_observed_at"), now, 10
        ):
            row.update(stop_loss=None, take_profit=None, protection_status="UNAVAILABLE_OR_STALE")
        result.append(row)
    return result


def context_state(context: dict[str, Any], now: datetime) -> str:
    if context.get("consumed"):
        return "Consumed — waiting for next map"
    if context.get("retired_at"):
        return "Unusable entries — waiting for replacement"
    if context.get("state") == "READY":
        try:
            expiry = datetime.fromisoformat(str(context["valid_until"]))
            if expiry.tzinfo is None:
                return "Unavailable"
            remaining = (expiry - now).total_seconds()
            if remaining <= 0:
                return "Expired — waiting for refresh"
            if remaining < 65:
                return "Expiring — waiting for refresh"
            return "Ready"
        except (KeyError, ValueError):
            return "Unavailable"
    if context.get("state") == "FAILED":
        return "Failed — no usable map"
    return "Refreshing" if context.get("state") == "REQUESTING" else "Unavailable"


def risk_summary(daily: dict[str, Any], capital: dict[str, Any], now: datetime) -> dict[str, str]:
    unavailable = dict.fromkeys(
        [
            "equity",
            "realized",
            "unrealized",
            "daily_remaining",
            "drawdown",
            "setup_budget",
            "policy",
        ],
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
        result = {
            **unavailable,
            "equity": money(equity),
            "realized": money(daily.get("realized_pnl")),
            "unrealized": money(daily.get("unrealized_pnl")),
            "daily_remaining": "Unavailable",
        }
        if fresh(capital.get("updated_at"), now):
            result["drawdown"] = money(capital.get("drawdown_percent")) + "%"
            policy = capital.get("risk_policy", {})
            if not isinstance(policy, dict) or policy.get("version") not in (
                "fixed-risk-v2",
                "fixed-risk-v3",
                "fixed-risk-v4",
                "direct-entry-v1",
                "market-stop-v1",
                "market-stop-v2",
            ):
                return result
            demo_development = False
            if policy["version"] == "market-stop-v2":
                enforced = policy.get("lossLimitsEnforced")
                mode = policy.get("mode")
                if (
                    not isinstance(enforced, bool)
                    or mode not in ("replay", "backtest", "paper", "demo", "shadow", "live")
                    or enforced != (mode != "demo")
                ):
                    return result
                demo_development = not enforced
            setup_percent = Decimal(str(policy["setupRiskPercent"]))
            daily_percent = Decimal(str(policy["dailyLossLimitPercent"]))
            cap = Decimal(str(capital["risk_cap_percent"]))
            if (
                not all(value.is_finite() for value in [setup_percent, daily_percent, cap])
                or not Decimal(0) < setup_percent <= Decimal(1)
                or not Decimal(0) < daily_percent <= Decimal(5)
                or cap < 0
                or equity <= 0
                or baseline <= 0
                or not isinstance(daily.get("locked_out"), bool)
            ):
                return result
            multiplier = Decimal(str(capital["risk_multiplier"]))
            if multiplier not in [Decimal(0), Decimal("0.25"), Decimal("0.5"), Decimal(1)]:
                return result
            if demo_development:
                # The stored multiplier/locks remain historical accounting evidence.
                # Admission uses the explicitly reported demo policy and current cap.
                result["daily_remaining"] = "Not applied (demo)"
                result["setup_budget"] = money(equity * min(setup_percent, cap) / 100)
                result["policy"] = f"Demo: {setup_percent}% setup / loss locks off"
                return result
            remaining = (
                Decimal(0)
                if daily["locked_out"]
                else max(Decimal(0), baseline * (daily_percent - loss) / 100)
            )
            result["daily_remaining"] = money(remaining)
            result["setup_budget"] = money(
                min(remaining, equity * setup_percent * multiplier / 100, equity * cap / 100)
            )
            result["policy"] = f"{setup_percent}% setup / {daily_percent}% daily"
        return result
    except (KeyError, InvalidOperation, ValueError):
        return unavailable
