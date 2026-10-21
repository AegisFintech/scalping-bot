"""Truthful view models; no inference, execution authority or missing-value estimates."""

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from apps.dashboard.overview import fresh, operating_state


def number(value: object) -> Decimal | None:
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError):
        return None


def direction(value: object) -> str:
    n = number(value)
    return (
        "positive"
        if n is not None and n > 0
        else "negative"
        if n is not None and n < 0
        else "neutral"
    )


def action(status: dict[str, Any], now: datetime) -> dict[str, Any]:
    title, detail = operating_state(status, now)
    managed = status.get("managedSetup") or {}
    context = status.get("scenarioContext") or {}
    positions = [p for p in managed.get("positions", []) if p.get("state") != "CLOSED"]
    pending = [
        o
        for o in managed.get("orders", [])
        if o.get("state")
        in {"INTENT", "SUBMITTING", "PENDING", "PARTIALLY_FILLED", "CANCEL_PENDING", "UNKNOWN"}
    ]
    active = (
        "protect"
        if positions
        else "orders"
        if pending
        else "codex"
        if context.get("state") == "REQUESTING"
        else "idle"
    )
    if (
        (
            title in {"Unavailable", "Blocked", "Stopped", "Paused"}
            or title.startswith("Entries blocked")
        )
        and not positions
        and not pending
    ):
        active = "idle"
    next_step = (
        "Reconcile the close, then evaluate the next setup."
        if positions
        else "Wait for a broker trigger; cancel the peer after a fill."
        if pending
        else "Validate returned levels, costs and shared setup risk."
        if active == "codex"
        else "Evaluate when market, account and safety gates permit."
    )
    if title == "Paused":
        next_step = "Keep protection and reconciliation running; new analysis waits for resume."
    elif title == "Stopped":
        next_step = "Cancel/reconcile owned pending orders; retain position protection."
    return {
        "title": title,
        "detail": detail,
        "active": active,
        "next": next_step,
        "reasons": status.get("reasonCodes", []),
        "positions": positions,
        "pending": pending,
    }


def levels(snapshot: dict[str, Any], now: datetime) -> list[dict[str, str]]:
    plan = (snapshot.get("evidence") or {}).get("plan") or {}
    result = []
    for side, key in (("BUY", "buy_stop"), ("SELL", "sell_stop")):
        proposed = plan.get(key)
        proposed = proposed.get("entry_price") if isinstance(proposed, dict) else proposed
        if number(proposed) is not None:
            result.append({"label": f"Codex {side} breakout", "price": str(proposed), "side": side})
    for order in snapshot.get("orders", []):
        for field, label in (
            ("entry_price", "entry"),
            ("stop_loss", "intended SL"),
            ("take_profit", "intended TP"),
        ):
            if number(order.get(field)) is not None:
                result.append(
                    {
                        "label": f"{order.get('side')} {label}",
                        "price": str(order[field]),
                        "side": str(order.get("side")),
                    }
                )
    for p in snapshot.get("positions", []):
        if p.get("protection_status") == "VERIFIED" and fresh(
            p.get("protection_observed_at"), now, 10
        ):
            for field, label in (("stop_loss", "broker SL"), ("take_profit", "broker TP")):
                if number(p.get(field)) is not None:
                    result.append(
                        {"label": label, "price": str(p[field]), "side": str(p.get("side"))}
                    )
    return result


def cumulative_net(values: list[object]) -> list[str]:
    """Sum signed net money exactly; conversion to floats belongs only to plotting."""
    total = Decimal(0)
    output = []
    for value in values:
        amount = number(value)
        if amount is None:
            raise ValueError("CLOSED_NET_UNAVAILABLE")
        total += amount
        output.append(str(total))
    return output
