"""Strict read-only broker-monitor validation for the landscape desk."""

import re
from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from typing import Any


class DecisionViewError(ValueError):
    """Raised when persisted decision data is unsafe or too large to display."""


_MONITOR_DECIMAL = re.compile(r"^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,10})?$")

_OPEN_POSITION_MONITOR_FIELDS = {
    "status",
    "executionState",
    "side",
    "accountCurrency",
    "bid",
    "ask",
    "markPrice",
    "grossUnrealizedPnl",
    "netUnrealizedPnl",
    "recordedCommission",
    "quoteSourceTime",
    "quoteReceivedAt",
    "pnlCapturedAt",
}


def _mapping(value: object, reason: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise DecisionViewError(reason)
    return value


def open_position_monitor_view(value: object) -> dict[str, str]:
    """Validate the bounded read-only broker position monitor for display."""

    document = _mapping(value, "DECISION_VIEW_POSITION_MONITOR_INVALID")
    status = document.get("status")
    if status == "NONE":
        if set(document) != {"status"}:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_FIELDS_INVALID")
        return {"status": "NONE"}
    if status == "UNAVAILABLE":
        if set(document) != {"status", "reasonCode"}:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_FIELDS_INVALID")
        reason = document.get("reasonCode")
        if not isinstance(reason, str) or re.fullmatch(r"[A-Z0-9_:]{1,160}", reason) is None:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_REASON_INVALID")
        return {"status": "UNAVAILABLE", "reasonCode": reason}
    if status != "AVAILABLE" or set(document) != _OPEN_POSITION_MONITOR_FIELDS:
        raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_FIELDS_INVALID")
    if document.get("executionState") not in {"NORMAL", "RECONCILIATION_REQUIRED"}:
        raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_EXECUTION_STATE_INVALID")
    if document.get("side") not in {"BUY", "SELL"}:
        raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_SIDE_INVALID")
    currency = document.get("accountCurrency")
    if not isinstance(currency, str) or re.fullmatch(r"[A-Z]{3,12}", currency) is None:
        raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_CURRENCY_INVALID")
    for key in (
        "bid",
        "ask",
        "markPrice",
        "grossUnrealizedPnl",
        "netUnrealizedPnl",
        "recordedCommission",
    ):
        number = document.get(key)
        if not isinstance(number, str) or _MONITOR_DECIMAL.fullmatch(number) is None:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_DECIMAL_INVALID")
        if key in {"bid", "ask", "markPrice"} and Decimal(number) <= 0:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_PRICE_INVALID")
    for key in ("quoteSourceTime", "quoteReceivedAt", "pnlCapturedAt"):
        raw_timestamp = document.get(key)
        if not isinstance(raw_timestamp, str):
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_TIME_INVALID")
        try:
            parsed = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
        except ValueError as error:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_TIME_INVALID") from error
        if parsed.tzinfo is None:
            raise DecisionViewError("DECISION_VIEW_POSITION_MONITOR_TIME_INVALID")
    return {key: str(document[key]) for key in _OPEN_POSITION_MONITOR_FIELDS}
