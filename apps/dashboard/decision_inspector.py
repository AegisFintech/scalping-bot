from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from typing import Any


class DecisionViewError(ValueError):
    """Raised when persisted decision data is unsafe or too large to display."""


_SENSITIVE_KEY = re.compile(
    r"(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|"
    r"client[_-]?secret|password|cookie|database[_-]?url|source[_-]?token|"
    r"private[_-]?key|account[_-]?id|broker[_-]?(?:account|order|position|fill)[_-]?id)",
    re.IGNORECASE,
)
_TIMEFRAMES = ("M1", "M5", "M15")
_MAX_DEPTH = 10
_MAX_COLLECTION_ITEMS = 256
_MAX_STRING_LENGTH = 8_192
_MAX_MODEL_OUTPUT_BYTES = 256_000
_MAX_MODEL_INPUT_BYTES = 4_000_000
_MAX_AUDIT_DETAIL_BYTES = 65_536
_MAX_PROMPT_BYTES = 65_536
_MAX_CHART_BYTES = 1_048_576
_MAX_EXACT_COLLECTION_ITEMS = 2_000
_TRADE_OUTCOME_FIELDS = {
    "mode",
    "direction",
    "setup_tags",
    "market_regime",
    "confidence_bucket",
    "realized_pnl",
    "fees",
    "opened_at",
    "closed_at",
    "model_version",
    "prompt_version",
    "schema_version",
    "strategy_version",
}
_PROMPT_FILES = {
    "system-v1": "system-v1.md",
    "system-v2": "system-v2.md",
    "system-v3": "system-v3.md",
    "system-v4": "system-v4.md",
    "system-v5": "system-v5.md",
    "system-v6": "system-v6.md",
    "system-v7": "system-v7.md",
}
_SECRET_VALUE = re.compile(
    r"(?:bearer\s+[a-z0-9._~+/=-]{12,}|"
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"
    r"\s*[:=]\s*[^\s]{8,}|(?:postgres(?:ql)?|https?)://[^\s/:@]+:[^\s@]+@)",
    re.IGNORECASE,
)
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

_REASON_GUIDANCE: dict[str, tuple[str, str, str]] = {
    "AI_CIRCUIT_OPEN": (
        "External AI is cooling down",
        "The last AI call timed out or returned unavailable. New analyses wait during the "
        "bounded cooldown; no order is sent.",
        "No restart is required. The scheduler retries automatically after the displayed "
        "retry time.",
    ),
    "ANALYSES_PAUSED": (
        "Analysis paused by control",
        "The analysis pause control is active. Order maintenance and reconciliation continue.",
        "Clear the pause only after confirming that resuming automatic analysis is intended.",
    ),
    "AUTOMATIC_ANALYSIS_DISABLED": (
        "Automatic analysis is off",
        "The scheduler is running maintenance but will not start analysis cycles.",
        "Enable automatic analysis through reviewed configuration when intended.",
    ),
    "AUTOMATIC_ANALYSIS_CAMPAIGN_COMPLETE": (
        "External-AI inference safety limit reached",
        "The configured number of durable external-AI responses is complete. New analyses are "
        "paused while order maintenance and reconciliation continue.",
        "Review inference usage and campaign conversion before starting a separately versioned "
        "limit.",
    ),
    "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE": (
        "Completed-analysis campaign progress is unavailable",
        "The scheduler cannot prove the durable completed count, so it will not start another "
        "analysis.",
        "Restore PostgreSQL access and verify the strategy-scoped count; do not bypass the "
        "campaign boundary.",
    ),
    "AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID": (
        "Completed-analysis campaign progress is invalid",
        "The configured limit or durable count could not be interpreted safely.",
        "Correct the configuration or durable-state fault before resuming analysis.",
    ),
    "AUTOMATIC_TRADE_CAMPAIGN_COMPLETE": (
        "Closed-demo-trade campaign reached its target",
        "The configured number of durable closed demo trades has been collected. New analyses "
        "are paused while maintenance and reconciliation continue.",
        "Review the complete trade sample before starting another immutable campaign.",
    ),
    "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_UNAVAILABLE": (
        "Closed-demo-trade progress is unavailable",
        "The scheduler cannot prove the durable closed-trade count, so it will not start another "
        "analysis.",
        "Restore PostgreSQL access and verify the strategy-scoped trade count.",
    ),
    "AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID": (
        "Closed-demo-trade progress is invalid",
        "The configured target or durable trade count could not be interpreted safely.",
        "Correct the configuration or durable-state fault before resuming analysis.",
    ),
    "MODEL_DEADLINE_INSUFFICIENT": (
        "Not enough time remains in this M1 candle",
        "The AI was not called because its response would be likely to arrive after the current "
        "completed-candle context changes.",
        "No action is required; the scheduler retries immediately after a later M1 close.",
    ),
    "EMERGENCY_STOP_ENV": (
        "Environment emergency stop is active",
        "The process configuration blocks new analyses and orders.",
        "Reconcile first, then clear the environment stop and restart only when intended.",
    ),
    "EMERGENCY_STOP_FILE": (
        "Emergency-stop file is active",
        "The local sentinel blocks new analyses and orders.",
        "Reconcile first, then remove the sentinel through the approved operator procedure.",
    ),
    "EMERGENCY_STOP_DATABASE": (
        "Dashboard emergency stop is active",
        "The durable runtime control blocks new analyses and orders.",
        "Reconcile first, then clear the dashboard control with an audited reason.",
    ),
    "PREVIOUS_ANALYSIS_ACTIVE": (
        "An analysis cycle or setup is already active",
        "The scheduler will not overlap an analysis or replace managed orders/positions.",
        "No action is normally required; wait for the cycle, close, cancellation, expiry, and "
        "reconciliation to finish.",
    ),
    "RELEVANT_POSITION_EXISTS": (
        "A relevant position is being managed",
        "A new analysis is blocked while a position for this strategy scope exists.",
        "Monitor the position lifecycle; do not manually clear durable state.",
    ),
    "RELEVANT_PENDING_ORDER_EXISTS": (
        "A relevant pending order is being managed",
        "A new analysis is blocked while a strategy or blocking pending order exists.",
        "Wait for fill/expiry/cancellation and reconciliation, or use the audited cancellation "
        "control.",
    ),
    "CANCELLATION_PENDING": (
        "Order cancellation is still pending",
        "The broker has not yet supplied certain terminal cancellation evidence.",
        "Wait for reconciliation; investigate if it persists.",
    ),
    "PARTIAL_FILL_BLOCKING": (
        "A partial fill requires reconciliation",
        "Execution state is uncertain, so replacement analysis and orders are blocked.",
        "Inspect the broker event trail and reconcile; never delete the evidence.",
    ),
    "RECONCILIATION_UNCERTAIN": (
        "Broker and local state do not yet reconcile",
        "The system cannot prove that positions and orders are in a safe known state.",
        "Inspect the execution journal and broker state before clearing any control.",
    ),
    "DEMO_FILL_SLIPPAGE_EXCEEDED": (
        "The demo fill exceeded the configured slippage limit",
        "The broker filled the entry farther from the requested stop price than the configured "
        "point or basis-point ceiling permits.",
        "The trade remains managed to its terminal outcome. After exact broker and durable "
        "terminal evidence agree, the scheduler releases this event-specific block automatically.",
    ),
    "RECONCILIATION_AUDIT_PERSISTENCE_FAILED": (
        "The latest broker reconciliation was not durably recorded",
        "Broker state was fetched, but the required PostgreSQL reconciliation trail could not be "
        "confirmed.",
        "Restore PostgreSQL audit persistence; automation remains blocked until a later "
        "reconciliation is recorded.",
    ),
    "DATABASE_RECONCILIATION_PENDING": (
        "A durable order group still requires reconciliation",
        "PostgreSQL contains a strategy group whose terminal broker outcome is not yet certain.",
        "Wait for automatic broker-history recovery and inspect the execution journal if it "
        "persists.",
    ),
    "ACCOUNT_NOT_RECONCILED": (
        "Account reconciliation is incomplete",
        "New analysis waits until broker and local account state agree.",
        "Check cTrader connectivity and the reconciliation trail.",
    ),
    "ACCOUNT_NOT_AUTHENTICATED": (
        "cTrader authentication is unavailable",
        "The system cannot safely fetch or act on the demo account.",
        "Check the service and token-renewal status without exposing credentials.",
    ),
    "SERVICE_UNHEALTHY": (
        "A required service is unhealthy",
        "The execution service cannot prove all required dependencies are available.",
        "Inspect service health and PostgreSQL events; automation resumes only after recovery.",
    ),
    "CANDLES_UNSYNCHRONIZED": (
        "Completed candles are not synchronized",
        "The required M1, M5, and M15 completed-candle context is not aligned.",
        "Wait for the market feed or inspect the Market tab if this repeats.",
    ),
    "ORDER_BOOK_STALE": (
        "Order book is stale",
        "Fresh depth is required before analysis or placement.",
        "The next eligible broker minute retries automatically; inspect market-data health if "
        "persistent.",
    ),
    "MARKET_DATA_STALE": (
        "Market data is stale",
        "A fresh broker timestamp and quote are required before analysis or placement.",
        "The next eligible broker minute retries automatically; inspect market-data health if "
        "persistent.",
    ),
    "SYMBOL_METADATA_INVALID": (
        "Broker symbol metadata is unavailable",
        "Precision, tick, volume, or session metadata cannot be proven current.",
        "Check cTrader discovery and market-data service health.",
    ),
    "DAILY_LOSS_LOCKOUT": (
        "Daily loss lockout is active",
        "Configured daily loss protection blocks new risk.",
        "Review the Risk tab; reset is permitted only on the next configured day after "
        "reconciliation.",
    ),
    "OPERATIONAL_RISK_LOCKOUT": (
        "Operational risk lockout is active",
        "A broker journal, equity-floor, recovery, or daily order-cap condition blocks new risk.",
        "Inspect the execution journal, account state, and configured caps before intervening.",
    ),
    "FILESYSTEM_CONTROLS_UNCERTAIN": (
        "Filesystem controls cannot be verified",
        "The service cannot safely determine sentinel state.",
        "Repair file access/permissions; do not bypass the control.",
    ),
    "RUNTIME_CONTROLS_UNCERTAIN": (
        "Database controls cannot be verified",
        "The durable stop/pause state is unknown.",
        "Restore PostgreSQL control access and verify the audit trail.",
    ),
    "DEMO_TRADING_DISABLED": (
        "Demo order submission is off",
        "Analysis may run, but the demo gateway is not authorized to submit broker orders.",
        "Enable demo trading only for an explicitly authorized demo session.",
    ),
    "DEMO_ACKNOWLEDGEMENT_INVALID": (
        "Demo acknowledgement is missing",
        "The required demo-only acknowledgement is not active in the running process.",
        "Set the exact acknowledgement only for an intended broker-demo session and restart "
        "safely.",
    ),
    "BUY_TP_MIDPOINT_NOT_ON_TICK": (
        "Buy TP midpoint is off the broker tick",
        "Halving the distance from the buy entry to the AI take profit produced a price the "
        "broker precision cannot represent exactly.",
        "No order was rounded or sent. A later broker minute requests a fresh AI proposal.",
    ),
    "SELL_TP_MIDPOINT_NOT_ON_TICK": (
        "Sell TP midpoint is off the broker tick",
        "Halving the distance from the sell entry to the AI take profit produced a price the "
        "broker precision cannot represent exactly.",
        "No order was rounded or sent. A later broker minute requests a fresh AI proposal.",
    ),
    "UPSIDE_TARGETS_INVALID": (
        "AI upside targets are not usable as buy objectives",
        "At least one upside target is not above the buy entry, is off the broker tick, or is "
        "not strictly higher than the preceding target.",
        "No order was sent. The automatic scheduler requests a completely fresh market snapshot "
        "and AI proposal on a later eligible broker minute.",
    ),
    "DOWNSIDE_TARGETS_INVALID": (
        "AI downside targets are not usable as sell objectives",
        "At least one downside target is not below the sell entry, is off the broker tick, or is "
        "not strictly lower than the preceding target.",
        "No order was sent. The automatic scheduler requests a completely fresh market snapshot "
        "and AI proposal on a later eligible broker minute.",
    ),
    "BUY_STOP_DISTANCE_UNAFFORDABLE_AT_MIN_VOLUME": (
        "Buy stop exceeds minimum-volume risk budget",
        "The endpoint buy SL is farther from entry than the current configured per-leg budget "
        "can support at broker minimum volume.",
        "No order was sent. The next request uses the newly reconciled maximum distance.",
    ),
    "SELL_STOP_DISTANCE_UNAFFORDABLE_AT_MIN_VOLUME": (
        "Sell stop exceeds minimum-volume risk budget",
        "The endpoint sell SL is farther from entry than the current configured per-leg budget "
        "can support at broker minimum volume.",
        "No order was sent. The next request uses the newly reconciled maximum distance.",
    ),
    "RISK_MIN_VOLUME_UNAFFORDABLE": (
        "Broker minimum volume is outside the risk budget",
        "Even a one-tick stop at broker minimum volume exceeds the configured per-leg budget.",
        "No endpoint call or order is made; review broker metadata and configured risk without "
        "bypassing the limit.",
    ),
    "PLACEMENT_MARKET_REFRESH_FAILED": (
        "Final market refresh was unavailable",
        "The service could not reacquire quote, depth, completed candles, and metadata after "
        "risk and margin work.",
        "No order was sent. The automatic scheduler starts with new data on a later minute.",
    ),
    "PLACEMENT_ACCOUNT_STATE_CHANGED": (
        "Account state changed after sizing",
        "Equity, margin, exposure, pending-order, fill, cancellation, or certainty state changed "
        "between deterministic sizing and the final placement check.",
        "No order was sent. The next cycle reconciles and sizes from the new account state.",
    ),
    "CTRADER_FIELD_INVALID:price": (
        "Broker execution omitted a required price",
        "A new fill or position event lacked a valid positive price, so reconciliation cannot "
        "assume its state.",
        "New analysis is locked out. Inspect sanitized callback structure and broker history; "
        "do not infer or invent the missing price.",
    ),
    "DEMO_BROKER_EVENT_KEY_CONFLICT": (
        "Two broker callbacks disagreed about the same event",
        "The original event is retained and new analysis is blocked until a later exact "
        "terminal broker event proves the managed setup is fully closed.",
        "No manual clearing is required. Automatic broker-history recovery retries every "
        "15 seconds; investigate cTrader and PostgreSQL only if this remains after the setup "
        "is terminal.",
    ),
    "DEMO_EXECUTION_RECOVERY_RUN_FAILED": (
        "Automatic broker-history recovery failed",
        "The scheduled reconciliation attempt could not prove the demo execution state.",
        "New analysis remains locked. Check cTrader and PostgreSQL health; the service retries "
        "on its bounded recovery cadence without requiring a restart.",
    ),
}

_PREFIX_REASON_GUIDANCE: tuple[tuple[str, tuple[str, str, str]], ...] = (
    (
        "PRE_MODEL_",
        (
            "Pre-AI market stability check stopped this attempt",
            "Two fresh market snapshots did not retain the same completed candles, eligible "
            "spread, or available data, so no paid AI request was made.",
            "No action is required unless it repeats; the scheduler retries with a fresh cycle.",
        ),
    ),
    (
        "AI_ORCHESTRATOR_",
        (
            "External AI request failed",
            "The local AI service timed out, was unavailable, or rejected the provider response; "
            "no order was sent.",
            "The automatic scheduler retries on a later eligible broker minute after any cooldown.",
        ),
    ),
    (
        "MARKET_DATA_",
        (
            "Market-data request failed",
            "Required broker market information was unavailable or invalid, so the AI/order path "
            "stopped for this cycle.",
            "The automatic scheduler retries on the next eligible broker minute; inspect Market "
            "and service health if repeated.",
        ),
    ),
    (
        "SPREAD_",
        (
            "Spread protection rejected this cycle",
            "The observed spread or its required history did not pass the configured deterministic "
            "limit.",
            "No order was sent. The next eligible broker minute is evaluated independently.",
        ),
    ),
    (
        "DECISION_",
        (
            "Post-AI market recheck rejected this cycle",
            "Market context changed, became stale, or could not be refreshed after the AI "
            "response.",
            "No order was sent. The scheduler obtains a completely new snapshot on a later "
            "eligible minute.",
        ),
    ),
    (
        "PLACEMENT_",
        (
            "Final pre-order recheck rejected this cycle",
            "Market or account state changed, regressed, or could not be refreshed immediately "
            "before broker intent.",
            "No order was sent. Inspect the final refresh and validation rows; a later broker "
            "minute starts from new data.",
        ),
    ),
    (
        "BUY_RISK_",
        (
            "Buy proposal failed deterministic risk sizing",
            "The buy-side AI levels could not produce a broker-valid size within configured risk "
            "and notional limits.",
            "No buy order was sent; inspect the selected run's Risk & execution tab.",
        ),
    ),
    (
        "SELL_RISK_",
        (
            "Sell proposal failed deterministic risk sizing",
            "The sell-side AI levels could not produce a broker-valid size within configured risk "
            "and notional limits.",
            "No sell order was sent; inspect the selected run's Risk & execution tab.",
        ),
    ),
    (
        "BUY_",
        (
            "Buy proposal failed deterministic validation",
            "The buy-side AI levels no longer satisfy current price, distance, precision, or "
            "expiry rules.",
            "No buy order was sent; inspect the selected run's validation rows.",
        ),
    ),
    (
        "SELL_",
        (
            "Sell proposal failed deterministic validation",
            "The sell-side AI levels no longer satisfy current price, distance, precision, or "
            "expiry rules.",
            "No sell order was sent; inspect the selected run's validation rows.",
        ),
    ),
    (
        "RISK_",
        (
            "Deterministic risk rejected this cycle",
            "The proposal could not satisfy a configured money, volume, margin, exposure, or "
            "price constraint.",
            "No order was sent; inspect the selected run's Risk & execution tab.",
        ),
    ),
    (
        "MODEL_",
        (
            "AI response validation failed",
            "The returned JSON did not pass the strict schema or semantic contract.",
            "No order was sent; inspect the exact AI response and local validation rows.",
        ),
    ),
)


def reason_code_view(reason: object) -> dict[str, str]:
    """Translate one internal gate code without hiding the authoritative code."""

    code = str(reason)
    guidance = _REASON_GUIDANCE.get(code)
    if guidance is None:
        guidance = next(
            (value for prefix, value in _PREFIX_REASON_GUIDANCE if code.startswith(prefix)),
            None,
        )
    if guidance is None:
        return {
            "code": code,
            "title": "Safety condition is blocking this cycle",
            "meaning": "The system retained an unrecognized fail-closed reason code.",
            "next_action": (
                "Use this exact code in the PostgreSQL audit trail and runbook; do not bypass it."
            ),
        }
    title, meaning, next_action = guidance
    return {"code": code, "title": title, "meaning": meaning, "next_action": next_action}


def execution_status_recovered(value: object) -> bool:
    """Return true only for the bounded status shape needed by the full dashboard."""

    if not isinstance(value, Mapping):
        return False
    reasons = value.get("reasonCodes")
    return (
        value.get("mode") in {"paper", "demo", "shadow", "live"}
        and isinstance(value.get("managedSetup"), Mapping)
        and isinstance(value.get("automaticAnalysisCampaign"), Mapping)
        and isinstance(reasons, Sequence)
        and not isinstance(reasons, (str, bytes))
    )


def campaign_history_counts(value: object) -> dict[str, int]:
    """Validate the exact current-release and carry-forward campaign counts."""

    if not isinstance(value, Mapping):
        raise DecisionViewError("DECISION_VIEW_HISTORY_CAMPAIGN_COUNT_INVALID")
    completed = value.get("completed")
    baseline = value.get("baseline")
    release_completed = value.get("releaseCompleted")
    if (
        not isinstance(completed, int)
        or isinstance(completed, bool)
        or not 0 <= completed <= _MAX_EXACT_COLLECTION_ITEMS
        or not isinstance(baseline, int)
        or isinstance(baseline, bool)
        or not isinstance(release_completed, int)
        or isinstance(release_completed, bool)
        or baseline < 0
        or release_completed < 0
        or baseline + release_completed != completed
    ):
        raise DecisionViewError("DECISION_VIEW_HISTORY_CAMPAIGN_COUNT_INVALID")
    return {
        "completed": completed,
        "baseline": baseline,
        "releaseCompleted": release_completed,
    }


def automation_status_view(status: Mapping[str, Any]) -> dict[str, Any]:
    """Build an operator-readable state while preserving every blocking reason."""

    raw_reasons = status.get("reasonCodes", [])
    reasons = (
        [str(reason) for reason in raw_reasons]
        if isinstance(raw_reasons, Sequence) and not isinstance(raw_reasons, (str, bytes))
        else ["STATUS_REASON_CODES_INVALID"]
    )
    campaign = status.get("automaticAnalysisCampaign")
    if isinstance(campaign, Mapping):
        raw_campaign_reasons = campaign.get("reasonCodes", [])
        if isinstance(raw_campaign_reasons, Sequence) and not isinstance(
            raw_campaign_reasons, (str, bytes)
        ):
            reasons.extend(str(reason) for reason in raw_campaign_reasons)
        else:
            reasons.append("AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_INVALID")
        campaign_complete = campaign.get("complete") is True
    else:
        campaign_complete = False
    trade_campaign = status.get("automaticDemoTradeCampaign")
    if isinstance(trade_campaign, Mapping):
        raw_trade_reasons = trade_campaign.get("reasonCodes", [])
        if isinstance(raw_trade_reasons, Sequence) and not isinstance(
            raw_trade_reasons, (str, bytes)
        ):
            reasons.extend(str(reason) for reason in raw_trade_reasons)
        else:
            reasons.append("AUTOMATIC_TRADE_CAMPAIGN_PROGRESS_INVALID")
        trade_campaign_complete = trade_campaign.get("complete") is True
    else:
        trade_campaign_complete = False
    reasons = list(dict.fromkeys(reasons))
    reason_set = set(reasons)
    automatic = status.get("automaticAnalysisEnabled") is True
    paused = status.get("pauseNewAnalyses") is True
    emergency = status.get("emergencyStopped") is True

    if emergency or reason_set.intersection(
        {"EMERGENCY_STOP_ENV", "EMERGENCY_STOP_FILE", "EMERGENCY_STOP_DATABASE"}
    ):
        state, headline, severity = "STOPPED", "Automation stopped by an emergency control", "error"
        detail = "New analyses and orders are blocked; maintenance and reconciliation continue."
    elif not automatic:
        state, headline, severity = "OFF", "Automatic analysis is off", "info"
        detail = (
            "The process can maintain existing state, but it will not start scheduled analyses."
        )
    elif trade_campaign_complete:
        state, headline, severity = (
            "TRADE_CAMPAIGN_COMPLETE",
            "Closed-demo-trade campaign is ready for review",
            "success",
        )
        detail = (
            "The durable closed-demo-trade target was reached; no next analysis will start while "
            "maintenance and reconciliation continue."
        )
    elif campaign_complete:
        state, headline, severity = (
            "CAMPAIGN_COMPLETE",
            "External-AI inference limit is ready for review",
            "success",
        )
        detail = (
            "The configured durable external-AI response limit was reached; no next analysis will "
            "start while maintenance and reconciliation continue."
        )
    elif paused or "ANALYSES_PAUSED" in reason_set:
        state, headline, severity = "PAUSED", "Automatic analysis is paused", "warning"
        detail = "A runtime control is preventing new cycles."
    elif "AI_CIRCUIT_OPEN" in reason_set:
        state, headline, severity = (
            "WAITING_FOR_AI",
            "Automatic analysis is on — waiting for the external AI cooldown",
            "warning",
        )
        detail = "The scheduler remains alive and will retry automatically after the cooldown."
    elif reason_set.intersection(
        {
            "PREVIOUS_ANALYSIS_ACTIVE",
            "RELEVANT_POSITION_EXISTS",
            "RELEVANT_PENDING_ORDER_EXISTS",
            "CANCELLATION_PENDING",
        }
    ):
        state, headline, severity = (
            "ACTIVE_CYCLE_OR_SETUP",
            "Automatic analysis is on — a cycle or setup is already active",
            "info",
        )
        detail = (
            "The next scheduled analysis waits for the current analysis or broker lifecycle to "
            "finish."
        )
    elif reasons:
        state, headline, severity = (
            "SAFETY_BLOCKED",
            "Automatic analysis is on — safety checks are waiting",
            "warning",
        )
        detail = "No new order is sent until every listed condition clears."
    else:
        state, headline, severity = "READY", "Automatic demo analysis is running", "success"
        detail = (
            "The scheduler checks broker time and starts at most one cycle in each eligible M1 "
            "window."
        )

    retry_at = status.get("aiCircuitOpenUntil")
    if not isinstance(retry_at, str):
        retry_at = None
    reason_views = [reason_code_view(reason) for reason in reasons]
    if state == "READY":
        operator_action = "No action required; the scheduler will start on an eligible M1 window."
    elif state == "ACTIVE_CYCLE_OR_SETUP":
        operator_action = (
            "No action required; wait for the current analysis, pending orders, or position to "
            "finish."
        )
    elif state == "WAITING_FOR_AI":
        operator_action = "No action required; the same process retries after the displayed time."
    elif state == "TRADE_CAMPAIGN_COMPLETE":
        operator_action = "Review the completed demo trade sample before starting another campaign."
    elif state == "CAMPAIGN_COMPLETE":
        operator_action = "Review the 100 completed AI analyses before starting another campaign."
    elif reason_views:
        operator_action = reason_views[0]["next_action"]
    elif state == "PAUSED":
        operator_action = (
            "Release the audited analysis pause only after the maintenance state is known."
        )
    else:
        operator_action = "Review the configured controls before expecting a new automatic cycle."
    return {
        "state": state,
        "headline": headline,
        "severity": severity,
        "detail": detail,
        "operator_action": operator_action,
        "retry_at": retry_at,
        "reasons": reason_views,
    }


_ACTIVE_ORDER_STATES = {
    "INTENT",
    "SUBMITTING",
    "PENDING",
    "PARTIALLY_FILLED",
    "CANCEL_PENDING",
    "UNKNOWN",
}
_ACTIVE_POSITION_STATES = {"OPEN", "CLOSING", "RECONCILIATION_PENDING", "UNKNOWN"}
_TERMINAL_ORDER_STATES = {"FILLED", "CANCELLED", "EXPIRED", "REJECTED"}
_GENERIC_RECONCILIATION_REASONS = {
    "RECONCILIATION_UNCERTAIN",
    "OPERATIONAL_RISK_LOCKOUT",
}


def _plain_decimal(value: object) -> str:
    try:
        number = Decimal(str(value))
    except Exception:
        return "Unavailable"
    if not number.is_finite():
        return "Unavailable"
    rendered = format(number, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return "0" if rendered in {"", "-0"} else rendered


def _next_automation_action(automation: Mapping[str, Any]) -> str:
    state = str(automation.get("state", "UNKNOWN"))
    if state == "READY":
        return "Automatic analysis will start at the next eligible broker M1 window."
    if state == "ACTIVE_CYCLE_OR_SETUP":
        return "The current analysis or broker lifecycle will finish before another one starts."
    reason_rows = automation.get("reasons", [])
    if isinstance(reason_rows, Sequence) and not isinstance(reason_rows, (str, bytes)):
        valid_rows = [row for row in reason_rows if isinstance(row, Mapping)]
        preferred = next(
            (
                row
                for row in valid_rows
                if str(row.get("code")) not in _GENERIC_RECONCILIATION_REASONS
            ),
            valid_rows[0] if valid_rows else None,
        )
        if preferred is not None:
            return (
                f"Next analysis is blocked: {preferred.get('title', 'Unknown condition')}. "
                f"{preferred.get('next_action', 'Inspect the reason details below.')}"
            )
    return str(
        automation.get(
            "operator_action", "Review the automation status before expecting a new cycle."
        )
    )


def broker_lifecycle_view(
    status: Mapping[str, Any], automation: Mapping[str, Any] | None = None
) -> dict[str, str]:
    """Summarize what is actually live at the broker and what happens next."""

    automation_view = automation_status_view(status) if automation is None else automation
    raw_reasons = status.get("reasonCodes", [])
    if (
        isinstance(raw_reasons, Sequence)
        and not isinstance(raw_reasons, (str, bytes))
        and any(str(reason).startswith("EXECUTION_API_UNAVAILABLE:") for reason in raw_reasons)
    ):
        return {
            "state": "RECONNECTING",
            "headline": "Execution service is reconnecting",
            "detail": (
                "Current broker status is temporarily unavailable; durable order, trade, "
                "and analysis history has not been deleted."
            ),
            "next_action": "No action required; the dashboard retries every two seconds.",
            "severity": "warning",
        }
    managed = status.get("managedSetup")
    unavailable = {
        "state": "UNKNOWN",
        "headline": "Broker state is unavailable — exposure is unknown",
        "detail": (
            "The dashboard cannot prove whether a strategy order or position is active. "
            "Do not treat old rows as current broker state."
        ),
        "next_action": (
            "Check the execution service, Orders & Positions, and the execution journal."
        ),
        "severity": "error",
    }
    if not isinstance(managed, Mapping):
        return unavailable
    setup_status = str(managed.get("status", "UNAVAILABLE"))
    if setup_status == "UNAVAILABLE":
        return unavailable
    if setup_status == "NONE":
        return {
            "state": "IDLE",
            "headline": "No strategy order or trade is active",
            "detail": "No managed demo setup has been created for this account and symbol.",
            "next_action": _next_automation_action(automation_view),
            "severity": "info",
        }
    if setup_status not in {"ACTIVE", "LATEST_TERMINAL"}:
        return unavailable

    raw_orders = managed.get("orders", [])
    if not isinstance(raw_orders, Sequence) or isinstance(raw_orders, (str, bytes)):
        return unavailable
    if any(not isinstance(order, Mapping) for order in raw_orders):
        return unavailable
    orders = list(raw_orders)
    raw_positions = managed.get("positions")
    if raw_positions is None:
        legacy_position = managed.get("position")
        raw_positions = [] if legacy_position is None else [legacy_position]
    if not isinstance(raw_positions, Sequence) or isinstance(raw_positions, (str, bytes)):
        return unavailable
    if any(not isinstance(position, Mapping) for position in raw_positions):
        return unavailable
    positions = list(raw_positions)
    active_orders = [order for order in orders if str(order.get("state")) in _ACTIVE_ORDER_STATES]
    active_positions = [
        position for position in positions if str(position.get("state")) in _ACTIVE_POSITION_STATES
    ]

    if setup_status == "ACTIVE":
        if active_positions:
            sides = ", ".join(
                str(position.get("side", "Unknown")).upper() for position in active_positions
            )
            states = ", ".join(
                str(position.get("state", "UNKNOWN")).replace("_", " ").lower()
                for position in active_positions
            )
            return {
                "state": "TRADE_ACTIVE",
                "headline": (
                    f"{sides} demo trade is {states}"
                    if len(active_positions) == 1
                    else f"{len(active_positions)} demo trades are active ({sides})"
                ),
                "detail": (
                    "The broker is managing the displayed position evidence. Entries, stop "
                    "losses, and take profits are listed below."
                ),
                "next_action": (
                    "No action is required; automatic analysis waits for the position to close "
                    "and reconcile."
                ),
                "severity": "warning",
            }
        if active_orders:
            count = len(active_orders)
            sides = ", ".join(str(order.get("side", "unknown")).upper() for order in active_orders)
            noun = "stop order is" if count == 1 else "stop orders are"
            return {
                "state": "ORDERS_WAITING",
                "headline": f"{count} demo {noun} waiting at the broker",
                "detail": f"Active sides: {sides}. No strategy position is currently open.",
                "next_action": (
                    "No action is required; the broker waits for a stop to fill or for the setup "
                    "to expire."
                ),
                "severity": "warning",
            }
        return {
            "state": "RECONCILING",
            "headline": "The current broker setup is being reconciled",
            "detail": (
                "The group is active but no certainly active order or position can be displayed."
            ),
            "next_action": _next_automation_action(automation_view),
            "severity": "warning",
        }

    if active_orders or active_positions:
        return unavailable
    group_state = str(managed.get("groupState", "UNKNOWN")).upper()
    if any(str(order.get("state")) not in _TERMINAL_ORDER_STATES for order in orders):
        return unavailable
    if group_state == "CLOSED" and (
        not positions or any(str(position.get("state")) != "CLOSED" for position in positions)
    ):
        return unavailable
    sides = ", ".join(str(position.get("side", "Unknown")).upper() for position in positions)
    if group_state == "CLOSED":
        headline = (
            f"{sides} demo trade closed — no order or position is active"
            if len(positions) == 1
            else f"{len(positions)} demo trades closed ({sides}) — nothing remains active"
        )
    elif group_state == "EXPIRED":
        headline = "The previous stop orders expired — no trade is active"
    elif group_state == "FAILED":
        headline = "The previous setup ended — no order or position is active"
    else:
        return unavailable

    details: list[str] = []
    if orders:
        details.append(
            "; ".join(
                f"{str(order.get('side', 'Unknown')).upper()} order "
                f"{str(order.get('state', 'UNKNOWN')).replace('_', ' ').lower()}"
                for order in orders
            )
        )
    raw_trades = managed.get("trades")
    if raw_trades is None:
        legacy_trade = managed.get("trade")
        raw_trades = [] if legacy_trade is None else [legacy_trade]
    if not isinstance(raw_trades, Sequence) or isinstance(raw_trades, (str, bytes)):
        return unavailable
    if any(not isinstance(trade, Mapping) for trade in raw_trades):
        return unavailable
    trades = list(raw_trades)
    if trades:
        if group_state == "CLOSED" and len(trades) != len(positions):
            return unavailable
        try:
            total_pnl = sum(
                (Decimal(str(trade.get("realizedPnl"))) for trade in trades), Decimal(0)
            )
            total_fees = sum((Decimal(str(trade.get("fees"))) for trade in trades), Decimal(0))
        except (ArithmeticError, TypeError, ValueError):
            return unavailable
        if not total_pnl.is_finite() or not total_fees.is_finite():
            return unavailable
        details.append(
            f"Durable demo result across {len(trades)} trade(s): realized P/L "
            f"{_plain_decimal(total_pnl)}; fees {_plain_decimal(total_fees)}"
        )
    if not details:
        details.append("The latest managed group is terminal history, not a working broker setup")
    return {
        "state": f"SETUP_{group_state}",
        "headline": headline,
        "detail": ". ".join(details) + ".",
        "next_action": _next_automation_action(automation_view),
        "severity": "info",
    }


def latest_ai_request_index(rows: Sequence[Mapping[str, Any]]) -> int:
    """Prefer the newest run with a durable request, retaining a safe empty fallback."""

    for index, row in enumerate(rows):
        if row.get("ai_request_recorded") is True:
            return index
    return 0


def _json_default(value: object) -> str:
    if isinstance(value, (datetime, date, Decimal)):
        return str(value)
    raise TypeError(f"unsupported JSON value: {type(value).__name__}")


def _document_size(value: object) -> int:
    try:
        return len(
            json.dumps(
                value,
                default=_json_default,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
    except (TypeError, ValueError, OverflowError) as error:
        raise DecisionViewError("DECISION_VIEW_JSON_INVALID") from error


def _mapping(value: object, reason: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise DecisionViewError(reason)
    return value


def _safe_value(
    value: object,
    *,
    depth: int = 0,
    max_collection_items: int = _MAX_COLLECTION_ITEMS,
) -> Any:
    if depth > _MAX_DEPTH:
        raise DecisionViewError("DECISION_VIEW_DEPTH_EXCEEDED")
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (datetime, date, Decimal)):
        return str(value)
    if isinstance(value, str):
        if len(value) > _MAX_STRING_LENGTH:
            raise DecisionViewError("DECISION_VIEW_STRING_OVERSIZED")
        return value
    if isinstance(value, Mapping):
        if len(value) > max_collection_items:
            raise DecisionViewError("DECISION_VIEW_OBJECT_OVERSIZED")
        output: dict[str, Any] = {}
        for raw_key, child in value.items():
            key = str(raw_key)
            if len(key) > 128:
                raise DecisionViewError("DECISION_VIEW_KEY_OVERSIZED")
            output[key] = (
                "[REDACTED]"
                if _SENSITIVE_KEY.search(key)
                else _safe_value(
                    child,
                    depth=depth + 1,
                    max_collection_items=max_collection_items,
                )
            )
        return output
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        if len(value) > max_collection_items:
            raise DecisionViewError("DECISION_VIEW_ARRAY_OVERSIZED")
        return [
            _safe_value(
                child,
                depth=depth + 1,
                max_collection_items=max_collection_items,
            )
            for child in value
        ]
    raise DecisionViewError(f"DECISION_VIEW_TYPE_INVALID:{type(value).__name__}")


def _reject_sensitive_keys(value: object, *, depth: int = 0) -> None:
    if depth > _MAX_DEPTH:
        raise DecisionViewError("DECISION_VIEW_DEPTH_EXCEEDED")
    if isinstance(value, Mapping):
        for raw_key, child in value.items():
            key = str(raw_key)
            if _SENSITIVE_KEY.search(key):
                raise DecisionViewError("DECISION_VIEW_SENSITIVE_KEY_REJECTED")
            _reject_sensitive_keys(child, depth=depth + 1)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for child in value:
            _reject_sensitive_keys(child, depth=depth + 1)


def safe_audit_detail(value: object) -> Any:
    """Return a bounded recursively redacted audit detail document."""

    if _document_size(value) > _MAX_AUDIT_DETAIL_BYTES:
        raise DecisionViewError("DECISION_VIEW_AUDIT_OVERSIZED")
    return _safe_value(value)


def model_output_view(value: object) -> dict[str, Any]:
    """Return the complete parsed model object after defensive display checks."""

    document = _mapping(value, "DECISION_VIEW_MODEL_OUTPUT_INVALID")
    if _document_size(document) > _MAX_MODEL_OUTPUT_BYTES:
        raise DecisionViewError("DECISION_VIEW_MODEL_OUTPUT_OVERSIZED")
    _reject_sensitive_keys(document)
    safe = _safe_value(document)
    if not isinstance(safe, dict):  # pragma: no cover - guaranteed by _mapping
        raise DecisionViewError("DECISION_VIEW_MODEL_OUTPUT_INVALID")
    schema_version = safe.get("schema_version")
    if schema_version == "1.0" and safe.get("decision") not in {"PLACE_OCO", "NO_TRADE"}:
        raise DecisionViewError("DECISION_VIEW_MODEL_DECISION_INVALID")
    if schema_version in {"2.0", "2.1"}:
        if "decision" in safe:
            raise DecisionViewError("DECISION_VIEW_MODEL_V2_DECISION_FORBIDDEN")
        for key in ("buy_stop", "sell_stop"):
            proposal = safe.get(key)
            if not isinstance(proposal, dict) or "enabled" in proposal:
                raise DecisionViewError("DECISION_VIEW_MODEL_V2_PROPOSAL_INVALID")
        if schema_version == "2.1" and not isinstance(safe.get("technical_map"), dict):
            raise DecisionViewError("DECISION_VIEW_MODEL_V2_TECHNICAL_MAP_INVALID")
    elif schema_version != "1.0":
        raise DecisionViewError("DECISION_VIEW_MODEL_SCHEMA_VERSION_INVALID")
    return safe


def model_proposal_label(value: Mapping[str, Any]) -> str:
    """Label legacy decisions and mandatory v2 OCO proposals distinctly."""

    if value.get("schema_version") in {"2.0", "2.1"}:
        return "OCO_PROPOSAL"
    decision = value.get("decision")
    if decision in {"PLACE_OCO", "NO_TRADE"}:
        return str(decision)
    raise DecisionViewError("DECISION_VIEW_MODEL_DECISION_INVALID")


def model_output_authority_notice(value: Mapping[str, Any] | None) -> str:
    """Describe proposal authority without relabelling historical decisions."""

    if value is None:
        return "AI was not reached for this run; no model proposal exists."
    if value.get("schema_version") in {"2.0", "2.1"}:
        schema_version = str(value.get("schema_version"))
        return (
            f"The schema {schema_version} AI output is a two-leg conditional proposal, "
            "not a queued "
            "or broker order. Local semantic validation, risk sizing, freshness checks, "
            "and mode gates retain execution authority."
        )
    if value.get("schema_version") == "1.0":
        return (
            "This is an immutable historical schema 1.0 output and may contain the old "
            "NO_TRADE self-veto. It is retained as audit evidence and is not the current "
            "schema 2.0 proposal contract."
        )
    raise DecisionViewError("DECISION_VIEW_MODEL_SCHEMA_VERSION_INVALID")


def analysis_chart_view(value: Mapping[str, Any]) -> dict[str, Any] | None:
    """Verify a persisted model chart before returning bounded display data."""

    raw = value.get("chart_image_bytes")
    if raw is None:
        return None
    if isinstance(raw, memoryview):
        image = raw.tobytes()
    elif isinstance(raw, bytes):
        image = raw
    else:
        raise DecisionViewError("DECISION_VIEW_CHART_BYTES_INVALID")
    if not 33 <= len(image) <= _MAX_CHART_BYTES:
        raise DecisionViewError("DECISION_VIEW_CHART_SIZE_INVALID")
    width = value.get("chart_width")
    height = value.get("chart_height")
    digest = value.get("chart_sha256")
    if (
        value.get("chart_renderer_version") != "completed-candles-ema-atr-v1"
        or value.get("chart_mime_type") != "image/png"
        or width != 1600
        or height != 1200
        or not isinstance(digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", digest)
        or image[:8] != bytes.fromhex("89504e470d0a1a0a")
        or image[12:16] != b"IHDR"
        or int.from_bytes(image[16:20], "big") != width
        or int.from_bytes(image[20:24], "big") != height
        or sha256(image).hexdigest() != digest
    ):
        raise DecisionViewError("DECISION_VIEW_CHART_INTEGRITY_INVALID")
    metadata = _mapping(value.get("chart_source_metadata"), "DECISION_VIEW_CHART_METADATA_INVALID")
    if _document_size(metadata) > 16_384:
        raise DecisionViewError("DECISION_VIEW_CHART_METADATA_OVERSIZED")
    _reject_sensitive_keys(metadata)
    return {
        "image_bytes": image,
        "sha256": digest,
        "renderer_version": value.get("chart_renderer_version"),
        "mime_type": value.get("chart_mime_type"),
        "width": width,
        "height": height,
        "source_metadata": _safe_value(metadata),
    }


def take_profit_transform_view(
    validations: Sequence[Mapping[str, Any]],
) -> list[dict[str, str]]:
    """Return the audited AI-to-effective TP comparison, if that stage ran."""

    for validation in reversed(validations):
        details = validation.get("details")
        if not isinstance(details, Mapping):
            continue
        if details.get("validation_scope") != "TAKE_PROFIT_TRANSFORM":
            continue
        transform = details.get("proposal_transform")
        if not isinstance(transform, Mapping):
            raise DecisionViewError("DECISION_VIEW_TP_TRANSFORM_INVALID")
        _reject_sensitive_keys(transform)
        if (
            transform.get("code") != "TAKE_PROFIT_DISTANCE_DIVIDED_BY_2"
            or transform.get("divisor") != "2"
        ):
            raise DecisionViewError("DECISION_VIEW_TP_TRANSFORM_INVALID")
        output: list[dict[str, str]] = []
        for side in ("buy", "sell"):
            leg = transform.get(side)
            if not isinstance(leg, Mapping):
                raise DecisionViewError("DECISION_VIEW_TP_TRANSFORM_LEG_INVALID")
            keys = (
                "entry_price",
                "stop_loss",
                "original_take_profit",
                "effective_take_profit",
                "original_risk_reward_ratio",
                "effective_risk_reward_ratio",
            )
            if any(not isinstance(leg.get(key), str) for key in keys):
                raise DecisionViewError("DECISION_VIEW_TP_TRANSFORM_LEG_INVALID")
            output.append(
                {
                    "side": side.upper(),
                    "entry_price": str(leg["entry_price"]),
                    "stop_loss": str(leg["stop_loss"]),
                    "ai_take_profit": str(leg["original_take_profit"]),
                    "effective_take_profit": str(leg["effective_take_profit"]),
                    "ai_risk_reward_ratio": str(leg["original_risk_reward_ratio"]),
                    "effective_risk_reward_ratio": str(leg["effective_risk_reward_ratio"]),
                }
            )
        return output
    return []


def exact_model_input_view(value: object) -> dict[str, Any]:
    """Return exact redacted model JSON with PostgreSQL-normalized object ordering."""

    document = _mapping(value, "DECISION_VIEW_MODEL_INPUT_INVALID")
    if _document_size(document) > _MAX_MODEL_INPUT_BYTES:
        raise DecisionViewError("DECISION_VIEW_MODEL_INPUT_OVERSIZED")
    _reject_sensitive_keys(document)
    safe = _safe_value(document, max_collection_items=_MAX_EXACT_COLLECTION_ITEMS)
    if not isinstance(safe, dict):  # pragma: no cover - guaranteed by _mapping
        raise DecisionViewError("DECISION_VIEW_MODEL_INPUT_INVALID")
    return safe


def trade_outcome_view(value: object) -> dict[str, Any]:
    """Return one bounded terminal trade outcome without broker identifiers."""

    document = _mapping(value, "DECISION_VIEW_TRADE_OUTCOME_INVALID")
    if set(document) != _TRADE_OUTCOME_FIELDS:
        raise DecisionViewError("DECISION_VIEW_TRADE_OUTCOME_FIELDS_INVALID")
    _reject_sensitive_keys(document)
    if document.get("mode") != "demo":
        raise DecisionViewError("DECISION_VIEW_TRADE_OUTCOME_MODE_INVALID")
    if document.get("direction") not in {"LONG", "SHORT"}:
        raise DecisionViewError("DECISION_VIEW_TRADE_OUTCOME_DIRECTION_INVALID")
    for key in ("realized_pnl", "fees"):
        value = document.get(key)
        if not isinstance(value, Decimal) or not value.is_finite():
            raise DecisionViewError("DECISION_VIEW_TRADE_OUTCOME_DECIMAL_INVALID")
    safe = _safe_value(document)
    if not isinstance(safe, dict):  # pragma: no cover - guaranteed by _mapping
        raise DecisionViewError("DECISION_VIEW_TRADE_OUTCOME_INVALID")
    return safe


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


def _history_decimal(value: object, reason: str, *, positive: bool = False) -> str:
    if not isinstance(value, (str, Decimal)):
        raise DecisionViewError(reason)
    text = format(value, "f") if isinstance(value, Decimal) else value
    if _MONITOR_DECIMAL.fullmatch(text) is None:
        raise DecisionViewError(reason)
    number = Decimal(text)
    if not number.is_finite() or (positive and number <= 0):
        raise DecisionViewError(reason)
    rendered = format(number, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return "0" if rendered in {"", "-0"} else rendered


def _history_reason_codes(value: object) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise DecisionViewError("DECISION_VIEW_HISTORY_REASONS_INVALID")
    reasons: list[str] = []
    for reason in value:
        if (
            not isinstance(reason, str)
            or not 1 <= len(reason) <= 160
            or re.fullmatch(r"[A-Z0-9_:.-]+", reason) is None
            or _SECRET_VALUE.search(reason)
        ):
            raise DecisionViewError("DECISION_VIEW_HISTORY_REASONS_INVALID")
        reasons.append(reason)
    return list(dict.fromkeys(reasons))


def _history_reasons(value: object, cancellation_reason: object) -> str:
    reasons = _history_reason_codes(value)
    if cancellation_reason is not None:
        if (
            not isinstance(cancellation_reason, str)
            or not 1 <= len(cancellation_reason) <= 160
            or re.fullmatch(r"[A-Z0-9_:.-]+", cancellation_reason) is None
            or _SECRET_VALUE.search(cancellation_reason)
        ):
            raise DecisionViewError("DECISION_VIEW_HISTORY_REASONS_INVALID")
        reasons.append(cancellation_reason)
    return ", ".join(dict.fromkeys(reasons)) if reasons else "—"


def _history_timestamp(value: object, reason: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise DecisionViewError(reason) from error
    else:
        raise DecisionViewError(reason)
    if parsed.tzinfo is None:
        raise DecisionViewError(reason)
    return parsed


def _history_model_levels(value: object) -> dict[str, str]:
    model = model_output_view(value)
    if model.get("schema_version") not in {"2.0", "2.1"}:
        raise DecisionViewError("DECISION_VIEW_HISTORY_MODEL_VERSION_UNSUPPORTED")
    levels: dict[str, str] = {}
    for side in ("buy", "sell"):
        leg = model.get(f"{side}_stop")
        if not isinstance(leg, Mapping):
            raise DecisionViewError("DECISION_VIEW_HISTORY_MODEL_LEG_INVALID")
        for source, target in (
            ("entry_price", "entry"),
            ("stop_loss", "sl"),
            ("take_profit", "tp"),
        ):
            levels[f"ai_{side}_{target}"] = _history_decimal(
                leg.get(source),
                "DECISION_VIEW_HISTORY_MODEL_PRICE_INVALID",
                positive=True,
            )
    return levels


def _history_execution_levels(row: Mapping[str, Any]) -> tuple[str, dict[str, str]]:
    order_present = any(row.get(f"{side}_order_state") is not None for side in ("buy", "sell"))
    values: dict[str, str] = {}
    for side in ("buy", "sell"):
        source_state = row.get(f"{side}_order_state")
        if order_present and not isinstance(source_state, str):
            raise DecisionViewError("DECISION_VIEW_HISTORY_ORDER_PAIR_INCOMPLETE")
        for source, target in (
            ("entry", "entry"),
            ("stop_loss", "sl"),
            ("take_profit", "tp"),
        ):
            value = row.get(
                f"{side}_order_{source}" if order_present else f"effective_{side}_{source}"
            )
            if value is None:
                if order_present:
                    raise DecisionViewError("DECISION_VIEW_HISTORY_ORDER_LEVEL_INVALID")
                values[f"execution_{side}_{target}"] = "—"
            else:
                values[f"execution_{side}_{target}"] = _history_decimal(
                    value,
                    "DECISION_VIEW_HISTORY_EXECUTION_PRICE_INVALID",
                    positive=True,
                )
    if order_present:
        return "PLACED ORDER LEVELS", values
    transformed = any(value != "—" for value in values.values())
    if transformed and not all(value != "—" for value in values.values()):
        raise DecisionViewError("DECISION_VIEW_HISTORY_EFFECTIVE_LEVELS_INCOMPLETE")
    return (
        "EFFECTIVE LEVELS — NOT PLACED" if transformed else "NOT REACHED",
        values,
    )


def _history_outcome(row: Mapping[str, Any]) -> tuple[str, str, str, str]:
    position_count = row.get("position_count")
    trade_count = row.get("trade_count")
    if (
        not isinstance(position_count, int)
        or isinstance(position_count, bool)
        or not isinstance(trade_count, int)
        or isinstance(trade_count, bool)
        or position_count not in {0, 1, 2}
        or trade_count not in {0, 1, 2}
        or trade_count > position_count
    ):
        raise DecisionViewError("DECISION_VIEW_HISTORY_LIFECYCLE_AMBIGUOUS")

    triggered_side = "—"
    realized_pnl = "—"
    fees = "—"
    if position_count > trade_count:
        side = row.get("position_side")
        state = row.get("position_state")
        if side not in {"BUY", "SELL", "BOTH"}:
            raise DecisionViewError("DECISION_VIEW_HISTORY_POSITION_SIDE_INVALID")
        triggered_side = "BUY + SELL" if side == "BOTH" else str(side)
        if state in {"OPEN", "CLOSING"}:
            return "TRADE OPEN", triggered_side, realized_pnl, fees
        if state in {"UNKNOWN", "RECONCILIATION_PENDING"}:
            return "RECONCILIATION REQUIRED", triggered_side, realized_pnl, fees
        raise DecisionViewError("DECISION_VIEW_HISTORY_POSITION_OUTCOME_MISSING")

    if trade_count > 0:
        if row.get("trade_closed_at") is None:
            raise DecisionViewError("DECISION_VIEW_HISTORY_TRADE_NOT_CLOSED")
        direction = row.get("trade_direction")
        if direction not in {"LONG", "SHORT", "BOTH"}:
            raise DecisionViewError("DECISION_VIEW_HISTORY_TRADE_DIRECTION_INVALID")
        triggered_side = (
            "BUY" if direction == "LONG" else "SELL" if direction == "SHORT" else "BUY + SELL"
        )
        realized_pnl = _history_decimal(
            row.get("realized_pnl"), "DECISION_VIEW_HISTORY_PNL_INVALID"
        )
        fees = _history_decimal(row.get("fees"), "DECISION_VIEW_HISTORY_FEES_INVALID")
        pnl = Decimal(realized_pnl)
        return (
            "CLOSED WIN" if pnl > 0 else "CLOSED LOSS" if pnl < 0 else "CLOSED BREAK-EVEN",
            triggered_side,
            realized_pnl,
            fees,
        )

    buy_state = row.get("buy_order_state")
    sell_state = row.get("sell_order_state")
    filled = [
        side for side, state in (("BUY", buy_state), ("SELL", sell_state)) if state == "FILLED"
    ]
    if len(filled) > 1:
        triggered_side = "BUY + SELL"
    elif filled:
        triggered_side = filled[0]

    group_state = row.get("group_state")
    if group_state is None:
        analysis_state = row.get("analysis_state")
        if analysis_state == "REJECTED":
            return "REJECTED — NO ORDER", triggered_side, realized_pnl, fees
        if analysis_state == "EXPIRED":
            return "ANALYSIS EXPIRED — NO ORDER", triggered_side, realized_pnl, fees
        if analysis_state in {
            "PENDING",
            "COLLECTING",
            "FEATURED",
            "MODEL_PENDING",
            "VALIDATING",
            "ACCEPTED",
        }:
            return "ANALYSIS IN PROGRESS", triggered_side, realized_pnl, fees
        raise DecisionViewError("DECISION_VIEW_HISTORY_ANALYSIS_STATE_INVALID")
    if not isinstance(group_state, str):
        raise DecisionViewError("DECISION_VIEW_HISTORY_GROUP_STATE_INVALID")
    if group_state in {"INTENT_RECORDED", "SUBMITTING", "ACTIVE"}:
        return "STOPS PENDING", triggered_side, realized_pnl, fees
    if group_state in {"ONE_FILLED", "CANCELLING_PEER"}:
        return "FILL / PEER CANCELLING", triggered_side, realized_pnl, fees
    if group_state == "EXPIRED":
        return "EXPIRED — NO TRADE", triggered_side, realized_pnl, fees
    if group_state == "FAILED":
        return "FAILED — NO TRADE", triggered_side, realized_pnl, fees
    if group_state == "RECONCILIATION_REQUIRED":
        return "RECONCILIATION REQUIRED", triggered_side, realized_pnl, fees
    raise DecisionViewError("DECISION_VIEW_HISTORY_GROUP_OUTCOME_MISSING")


_ANALYSIS_STATES = {
    "PENDING",
    "COLLECTING",
    "FEATURED",
    "MODEL_PENDING",
    "VALIDATING",
    "ACCEPTED",
    "REJECTED",
    "EXPIRED",
}
_GROUP_STATES = {
    "INTENT_RECORDED",
    "SUBMITTING",
    "ACTIVE",
    "ONE_FILLED",
    "CANCELLING_PEER",
    "POSITION_OPEN",
    "RECONCILIATION_REQUIRED",
    "CLOSED",
    "EXPIRED",
    "FAILED",
}


def _attempt_primary_reason(reasons: Sequence[str], category: str) -> str:
    matchers: dict[str, tuple[str, ...]] = {
        "AI_DEPENDENCY_FAILED": ("AI_",),
        "MARKET_DATA_FAILED": ("MARKET_DATA_", "ANALYTICS_", "QUOTE_", "ORDER_BOOK_"),
        "SPREAD_SAFETY_SKIP": ("SPREAD_",),
        "CONTEXT_EXPIRED": (
            "PRE_MODEL_CANDLE_CONTEXT_CHANGED",
            "DECISION_CANDLE_CONTEXT_CHANGED",
            "PLACEMENT_CANDLE_CONTEXT_CHANGED",
            "MODEL_DEADLINE_INSUFFICIENT",
        ),
        "MARKET_REFRESH_FAILED": (
            "DECISION_MARKET_REFRESH_FAILED",
            "PLACEMENT_MARKET_REFRESH_FAILED",
            "MARKET_DATA_STALE",
            "ORDER_BOOK_STALE",
            "QUOTE_STALE",
        ),
    }
    prefixes = matchers.get(category, ())
    for reason in reasons:
        if any(reason == prefix or reason.startswith(prefix) for prefix in prefixes):
            return reason
    return reasons[0] if reasons else "—"


def analysis_attempt_funnel_view(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Classify every campaign analysis attempt once without rewriting raw evidence."""

    if len(rows) > _MAX_EXACT_COLLECTION_ITEMS:
        raise DecisionViewError("DECISION_VIEW_ATTEMPT_COUNT_INVALID")
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    previous_time: datetime | None = None
    category_counts: dict[str, int] = {}
    realized_total = Decimal(0)
    fee_total = Decimal(0)
    completed_ai = 0
    order_groups = 0
    positions = 0
    trades = 0
    wins = 0
    losses = 0
    break_even = 0
    long_trades = 0
    short_trades = 0
    ai_latencies_ms: list[int] = []

    for index, row in enumerate(rows, start=1):
        analysis_id = row.get("analysis_id")
        if (
            not isinstance(analysis_id, str)
            or re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                analysis_id,
            )
            is None
            or analysis_id in seen
        ):
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_ANALYSIS_ID_INVALID")
        seen.add(analysis_id)
        analysis_time = _history_timestamp(
            row.get("analysis_time"), "DECISION_VIEW_ATTEMPT_TIME_INVALID"
        )
        if previous_time is not None and analysis_time < previous_time:
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_ORDER_INVALID")
        previous_time = analysis_time
        state = row.get("analysis_state")
        if state not in _ANALYSIS_STATES:
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_STATE_INVALID")
        reasons = _history_reason_codes(row.get("rejection_reasons"))
        model_request_present = row.get("model_request_present")
        model_completed = row.get("model_completed")
        if (
            not isinstance(model_request_present, bool)
            or not isinstance(model_completed, bool)
            or (model_completed and not model_request_present)
        ):
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_MODEL_STATE_INVALID")
        group_state = row.get("group_state")
        if group_state is not None and group_state not in _GROUP_STATES:
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_GROUP_STATE_INVALID")

        counts: dict[str, int] = {}
        for key in (
            "position_count",
            "trade_count",
            "trade_win_count",
            "trade_loss_count",
            "trade_break_even_count",
            "trade_long_count",
            "trade_short_count",
        ):
            value = row.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > 2:
                raise DecisionViewError("DECISION_VIEW_ATTEMPT_LIFECYCLE_COUNT_INVALID")
            counts[key] = value
        if (
            counts["trade_count"] > counts["position_count"]
            or counts["trade_win_count"]
            + counts["trade_loss_count"]
            + counts["trade_break_even_count"]
            != counts["trade_count"]
            or counts["trade_long_count"] + counts["trade_short_count"] != counts["trade_count"]
            or (group_state is None and (counts["position_count"] or counts["trade_count"]))
        ):
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_LIFECYCLE_AMBIGUOUS")
        if group_state is not None and not model_completed:
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_LIFECYCLE_AMBIGUOUS")

        latency_ms = row.get("ai_pipeline_latency_ms")
        if model_completed:
            if (
                not isinstance(latency_ms, int)
                or isinstance(latency_ms, bool)
                or not 0 <= latency_ms <= 600_000
            ):
                raise DecisionViewError("DECISION_VIEW_ATTEMPT_LATENCY_INVALID")
            ai_latencies_ms.append(latency_ms)
            rendered_latency = _history_decimal(
                Decimal(latency_ms) / Decimal(1000),
                "DECISION_VIEW_ATTEMPT_LATENCY_INVALID",
            )
        else:
            if latency_ms is not None:
                raise DecisionViewError("DECISION_VIEW_ATTEMPT_LATENCY_INVALID")
            rendered_latency = "—"

        rendered_pnl = "—"
        rendered_fees = "—"
        if counts["trade_count"] > 0:
            rendered_pnl = _history_decimal(
                row.get("realized_pnl"), "DECISION_VIEW_ATTEMPT_PNL_INVALID"
            )
            rendered_fees = _history_decimal(row.get("fees"), "DECISION_VIEW_ATTEMPT_FEES_INVALID")
            realized_total += Decimal(rendered_pnl)
            fee_total += Decimal(rendered_fees)
        elif row.get("realized_pnl") is not None or row.get("fees") is not None:
            raise DecisionViewError("DECISION_VIEW_ATTEMPT_MONEY_WITHOUT_TRADE")

        if group_state is not None:
            stage = "BROKER LIFECYCLE"
            order_groups += 1
            if counts["trade_count"] > 0:
                if group_state != "CLOSED" or counts["position_count"] != counts["trade_count"]:
                    category = "EXECUTION_REVIEW_REQUIRED"
                elif counts["trade_win_count"] == counts["trade_count"]:
                    category = "TRADE_CLOSED_WIN"
                elif counts["trade_loss_count"] == counts["trade_count"]:
                    category = "TRADE_CLOSED_LOSS"
                elif counts["trade_break_even_count"] == counts["trade_count"]:
                    category = "TRADE_CLOSED_BREAK_EVEN"
                else:
                    category = "TRADE_CLOSED_MIXED"
            elif group_state == "EXPIRED":
                category = "SETUP_EXPIRED_NO_TRADE"
            elif group_state in {
                "INTENT_RECORDED",
                "SUBMITTING",
                "ACTIVE",
                "ONE_FILLED",
                "CANCELLING_PEER",
                "POSITION_OPEN",
            }:
                category = "SETUP_OR_TRADE_ACTIVE"
            else:
                category = "EXECUTION_REVIEW_REQUIRED"
        elif model_completed:
            stage = "AFTER AI RESPONSE"
            if any("CANDLE_CONTEXT_CHANGED" in reason for reason in reasons):
                category = "CONTEXT_EXPIRED"
            elif any(
                "REFRESH_FAILED" in reason
                or reason in {"MARKET_DATA_STALE", "ORDER_BOOK_STALE", "QUOTE_STALE"}
                for reason in reasons
            ):
                category = "MARKET_REFRESH_FAILED"
            elif any(reason.startswith("SPREAD_") for reason in reasons):
                category = "SPREAD_SAFETY_SKIP"
            elif (
                state
                in {
                    "PENDING",
                    "COLLECTING",
                    "FEATURED",
                    "MODEL_PENDING",
                    "VALIDATING",
                    "ACCEPTED",
                }
                and not reasons
            ):
                category = "AI_RESPONSE_PROCESSING"
            elif state == "EXPIRED":
                category = "ANALYSIS_EXPIRED_NO_SETUP"
            else:
                category = "AI_PROPOSAL_INVALID"
        else:
            stage = "BEFORE COMPLETED AI RESPONSE"
            if (
                state
                in {
                    "PENDING",
                    "COLLECTING",
                    "FEATURED",
                    "MODEL_PENDING",
                    "VALIDATING",
                    "ACCEPTED",
                }
                and not reasons
            ):
                category = "ANALYSIS_OR_AI_IN_PROGRESS"
            elif any("CANDLE_CONTEXT_CHANGED" in reason for reason in reasons) or any(
                reason == "MODEL_DEADLINE_INSUFFICIENT" for reason in reasons
            ):
                category = "CONTEXT_EXPIRED"
            elif any(reason.startswith("AI_") for reason in reasons):
                category = "AI_DEPENDENCY_FAILED"
            elif any(reason.startswith("SPREAD_") for reason in reasons):
                category = "SPREAD_SAFETY_SKIP"
            elif any(
                reason.startswith(prefix)
                for reason in reasons
                for prefix in (
                    "MARKET_DATA_",
                    "ANALYTICS_",
                    "QUOTE_",
                    "ORDER_BOOK_",
                    "PRE_MODEL_MARKET_",
                )
            ):
                category = "MARKET_DATA_FAILED"
            else:
                category = "PRE_MODEL_REJECTED"

        if model_completed:
            completed_ai += 1
        positions += counts["position_count"]
        trades += counts["trade_count"]
        wins += counts["trade_win_count"]
        losses += counts["trade_loss_count"]
        break_even += counts["trade_break_even_count"]
        long_trades += counts["trade_long_count"]
        short_trades += counts["trade_short_count"]
        category_counts[category] = category_counts.get(category, 0) + 1
        output.append(
            {
                "attempt_number": index,
                "analysis_time": row.get("analysis_time"),
                "stage": stage,
                "primary_category": category,
                "primary_reason": _attempt_primary_reason(reasons, category),
                "raw_analysis_state": state,
                "raw_reasons": ", ".join(reasons) if reasons else "—",
                "model_completed": model_completed,
                "group_state": group_state or "—",
                "position_count": counts["position_count"],
                "trade_count": counts["trade_count"],
                "trade_direction": (
                    "LONG + SHORT"
                    if counts["trade_long_count"] and counts["trade_short_count"]
                    else "LONG"
                    if counts["trade_long_count"]
                    else "SHORT"
                    if counts["trade_short_count"]
                    else "—"
                ),
                "ai_pipeline_seconds": rendered_latency,
                "realized_pnl": rendered_pnl,
                "fees": rendered_fees,
            }
        )

    sorted_latencies = sorted(ai_latencies_ms)
    if sorted_latencies:
        midpoint = len(sorted_latencies) // 2
        if len(sorted_latencies) % 2:
            median_ms = Decimal(sorted_latencies[midpoint])
        else:
            median_ms = Decimal(
                sorted_latencies[midpoint - 1] + sorted_latencies[midpoint]
            ) / Decimal(2)
        p90_ms = Decimal(sorted_latencies[math.ceil(len(sorted_latencies) * 0.9) - 1])
        maximum_ms = Decimal(sorted_latencies[-1])
    else:
        median_ms = p90_ms = maximum_ms = Decimal(0)

    return {
        "rows": output,
        "category_counts": [
            {"primary_category": category, "count": count}
            for category, count in sorted(
                category_counts.items(), key=lambda item: (-item[1], item[0])
            )
        ],
        "summary": {
            "analysis_attempts": len(output),
            "completed_ai_responses": completed_ai,
            "ended_before_completed_ai": len(output) - completed_ai,
            "order_groups": order_groups,
            "positions": positions,
            "trades": trades,
            "wins": wins,
            "losses": losses,
            "break_even": break_even,
            "long_trades": long_trades,
            "short_trades": short_trades,
            "median_ai_pipeline_seconds": _history_decimal(
                median_ms / Decimal(1000),
                "DECISION_VIEW_ATTEMPT_LATENCY_TOTAL_INVALID",
            ),
            "p90_ai_pipeline_seconds": _history_decimal(
                p90_ms / Decimal(1000),
                "DECISION_VIEW_ATTEMPT_LATENCY_TOTAL_INVALID",
            ),
            "max_ai_pipeline_seconds": _history_decimal(
                maximum_ms / Decimal(1000),
                "DECISION_VIEW_ATTEMPT_LATENCY_TOTAL_INVALID",
            ),
            "realized_pnl": _history_decimal(
                realized_total, "DECISION_VIEW_ATTEMPT_PNL_TOTAL_INVALID"
            ),
            "fees": _history_decimal(fee_total, "DECISION_VIEW_ATTEMPT_FEES_TOTAL_INVALID"),
            "context_expired": category_counts.get("CONTEXT_EXPIRED", 0),
            "ai_proposal_invalid": category_counts.get("AI_PROPOSAL_INVALID", 0),
            "dependency_failures": sum(
                category_counts.get(category, 0)
                for category in (
                    "AI_DEPENDENCY_FAILED",
                    "MARKET_DATA_FAILED",
                    "MARKET_REFRESH_FAILED",
                )
            ),
            "spread_skips": category_counts.get("SPREAD_SAFETY_SKIP", 0),
            "expired_setups": category_counts.get("SETUP_EXPIRED_NO_TRADE", 0),
        },
    }


def analysis_history_view(rows: Sequence[Mapping[str, Any]], expected_count: int) -> dict[str, Any]:
    """Build a bounded campaign ledger without converting non-trades into losses."""

    if (
        not isinstance(expected_count, int)
        or isinstance(expected_count, bool)
        or not 0 <= expected_count <= _MAX_EXACT_COLLECTION_ITEMS
        or len(rows) != expected_count
    ):
        raise DecisionViewError("DECISION_VIEW_HISTORY_COUNT_MISMATCH")

    output: list[dict[str, Any]] = []
    analysis_ids: list[str] = []
    seen: set[str] = set()
    previous_analysis_time: datetime | None = None
    for index, row in enumerate(rows, start=1):
        analysis_id = row.get("analysis_id")
        if (
            not isinstance(analysis_id, str)
            or re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                analysis_id,
            )
            is None
            or analysis_id in seen
        ):
            raise DecisionViewError("DECISION_VIEW_HISTORY_ANALYSIS_ID_INVALID")
        seen.add(analysis_id)
        analysis_ids.append(analysis_id)
        try:
            analysis_time = _history_timestamp(
                row.get("analysis_time"), "DECISION_VIEW_HISTORY_TIME_INVALID"
            )
            if previous_analysis_time is not None and analysis_time < previous_analysis_time:
                raise DecisionViewError("DECISION_VIEW_HISTORY_ORDER_INVALID")
            previous_analysis_time = analysis_time
            if row.get("group_expires_at") is not None:
                _history_timestamp(
                    row.get("group_expires_at"),
                    "DECISION_VIEW_HISTORY_EXPIRY_INVALID",
                )
            if row.get("trade_closed_at") is not None:
                _history_timestamp(
                    row.get("trade_closed_at"),
                    "DECISION_VIEW_HISTORY_CLOSE_TIME_INVALID",
                )
            model_levels = _history_model_levels(row.get("parsed_payload"))
            level_source, execution_levels = _history_execution_levels(row)
            outcome, triggered_side, realized_pnl, fees = _history_outcome(row)
            reasons = _history_reasons(row.get("rejection_reasons"), row.get("cancellation_reason"))
            evidence_status = "CERTAIN"
        except DecisionViewError as error:
            model_levels = {
                f"ai_{side}_{field}": "Unavailable"
                for side in ("buy", "sell")
                for field in ("entry", "sl", "tp")
            }
            execution_levels = {
                f"execution_{side}_{field}": "Unavailable"
                for side in ("buy", "sell")
                for field in ("entry", "sl", "tp")
            }
            level_source = "UNAVAILABLE"
            outcome = "EVIDENCE UNAVAILABLE"
            triggered_side = "—"
            realized_pnl = "—"
            fees = "—"
            reasons = str(error)
            evidence_status = "UNAVAILABLE"
        output.append(
            {
                "analysis_number": index,
                "analysis_time": row.get("analysis_time"),
                "result": outcome,
                "triggered_side": triggered_side,
                "analysis_state": str(row.get("analysis_state", "UNAVAILABLE")),
                "reasons": reasons,
                "level_source": level_source,
                **model_levels,
                **execution_levels,
                "order_expires_at": row.get("group_expires_at"),
                "realized_pnl": realized_pnl,
                "fees": fees,
                "trade_closed_at": row.get("trade_closed_at"),
                "evidence_status": evidence_status,
            }
        )

    wins = sum(row["result"] == "CLOSED WIN" for row in output)
    losses = sum(row["result"] == "CLOSED LOSS" for row in output)
    break_even = sum(row["result"] == "CLOSED BREAK-EVEN" for row in output)
    closed_rows = [row for row in output if str(row["result"]).startswith("CLOSED ")]
    pnl_total = sum((Decimal(str(row["realized_pnl"])) for row in closed_rows), Decimal(0))
    fee_total = sum((Decimal(str(row["fees"])) for row in closed_rows), Decimal(0))
    rejection_code_sets = [
        {reason for reason in row.get("rejection_reasons", []) if isinstance(reason, str)}
        for row in rows
    ]
    context_invalidated = sum(
        any("CANDLE_CONTEXT_CHANGED" in reason for reason in reasons)
        for reasons in rejection_code_sets
    )
    dependency_failures = sum(
        any("HTTP_ERROR" in reason or "REFRESH_FAILED" in reason for reason in reasons)
        for reasons in rejection_code_sets
    )
    spread_skips = sum(
        any(reason.startswith("SPREAD_") for reason in reasons) for reasons in rejection_code_sets
    )
    classified = context_invalidated + dependency_failures + spread_skips
    rejected_no_order = sum(row["result"] == "REJECTED — NO ORDER" for row in output)
    return {
        "rows": output,
        "analysis_ids": analysis_ids,
        "summary": {
            "completed_ai_analyses": len(output),
            "orders_created": sum(row.get("group_state") is not None for row in rows),
            "pending_stops": sum(row["result"] == "STOPS PENDING" for row in output),
            "expired_without_trade": sum(row["result"] == "EXPIRED — NO TRADE" for row in output),
            "open_trades": sum(row["result"] == "TRADE OPEN" for row in output),
            "wins": wins,
            "losses": losses,
            "break_even": break_even,
            "realized_pnl": _history_decimal(pnl_total, "DECISION_VIEW_HISTORY_PNL_TOTAL_INVALID"),
            "fees": _history_decimal(fee_total, "DECISION_VIEW_HISTORY_FEES_TOTAL_INVALID"),
            "context_invalidated": context_invalidated,
            "dependency_failures": dependency_failures,
            "spread_skips": spread_skips,
            "other_rejections": max(0, rejected_no_order - classified),
        },
    }


def prompt_artifact_view(
    prompt_version: object,
    persisted_content: object,
    persisted_sha256: object,
) -> dict[str, str]:
    """Return a bounded hash-verified prompt, with an explicit legacy fallback."""

    if not isinstance(prompt_version, str) or prompt_version not in _PROMPT_FILES:
        raise DecisionViewError("DECISION_VIEW_PROMPT_VERSION_INVALID")
    if (persisted_content is None) != (persisted_sha256 is None):
        raise DecisionViewError("DECISION_VIEW_PROMPT_ARTIFACT_INCOMPLETE")
    if persisted_content is None:
        if prompt_version != "system-v1":
            raise DecisionViewError("DECISION_VIEW_PROMPT_ARTIFACT_MISSING")
        prompt_path = (
            Path(__file__).resolve().parents[2] / "prompts" / _PROMPT_FILES[prompt_version]
        )
        content = prompt_path.read_text(encoding="utf-8").strip()
        digest = sha256(content.encode("utf-8")).hexdigest()
        provenance = "TRACKED_LEGACY_ARTIFACT"
    else:
        if not isinstance(persisted_content, str) or not isinstance(persisted_sha256, str):
            raise DecisionViewError("DECISION_VIEW_PROMPT_ARTIFACT_INVALID")
        content = persisted_content
        digest = persisted_sha256
        provenance = "EXACT_PERSISTED_REQUEST_PROMPT"
    if not 1 <= len(content.encode("utf-8")) <= _MAX_PROMPT_BYTES:
        raise DecisionViewError("DECISION_VIEW_PROMPT_OVERSIZED")
    if _SECRET_VALUE.search(content):
        raise DecisionViewError("DECISION_VIEW_PROMPT_SECRET_REJECTED")
    calculated = sha256(content.encode("utf-8")).hexdigest()
    if not re.fullmatch(r"[0-9a-f]{64}", digest) or calculated != digest:
        raise DecisionViewError("DECISION_VIEW_PROMPT_HASH_MISMATCH")
    return {
        "version": prompt_version,
        "sha256": digest,
        "provenance": provenance,
        "content": content,
    }


def _array_digest(value: object, *, include_edges: bool) -> dict[str, Any]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise DecisionViewError("DECISION_VIEW_MODEL_ARRAY_INVALID")
    result: dict[str, Any] = {"count": len(value)}
    if include_edges and value:
        result["first"] = _safe_value(value[0])
        result["latest"] = _safe_value(value[-1])
    elif value:
        result["latest"] = _safe_value(value[-1])
    return result


def _timeframe_summary(value: object) -> dict[str, Any]:
    source = _mapping(value, "DECISION_VIEW_TIMEFRAME_INVALID")
    result: dict[str, Any] = {}
    for key, child in source.items():
        if key in {"candles", "full_candles", "raw_tail"}:
            result[f"{key}_summary"] = _array_digest(child, include_edges=True)
        elif key in {"returns", "swing_highs", "swing_lows"}:
            result[f"{key}_summary"] = _array_digest(child, include_edges=False)
        else:
            result[key] = _safe_value(child)
    return result


def _market_summary(value: object) -> dict[str, Any]:
    market = _mapping(value, "DECISION_VIEW_MARKET_INVALID")
    timeframes = _mapping(market.get("timeframes"), "DECISION_VIEW_TIMEFRAMES_INVALID")
    output = {key: _safe_value(child) for key, child in market.items() if key != "timeframes"}
    output["timeframes"] = {
        timeframe: _timeframe_summary(timeframes[timeframe])
        for timeframe in _TIMEFRAMES
        if timeframe in timeframes
    }
    return output


def model_input_summary(value: object) -> dict[str, Any]:
    """Summarize the redacted model request without rendering raw candle arrays."""

    document = _mapping(value, "DECISION_VIEW_MODEL_INPUT_INVALID")
    if _document_size(document) > _MAX_MODEL_INPUT_BYTES:
        raise DecisionViewError("DECISION_VIEW_MODEL_INPUT_OVERSIZED")
    safe: dict[str, Any] = {}
    for key in (
        "schema_version",
        "analysis_id",
        "symbol",
        "analysis_time",
        "server_time",
        "payload_mode",
        "versions",
        "performance",
        "execution_constraints",
    ):
        if key in document:
            safe[key] = _safe_value(document[key])
    safe["market"] = _market_summary(document.get("market"))
    return safe


def analytics_summary(value: object) -> dict[str, Any]:
    """Summarize persisted deterministic features without full candle arrays."""

    document = _mapping(value, "DECISION_VIEW_ANALYTICS_INVALID")
    if _document_size(document) > _MAX_MODEL_INPUT_BYTES:
        raise DecisionViewError("DECISION_VIEW_ANALYTICS_OVERSIZED")
    output = {key: _safe_value(child) for key, child in document.items() if key != "timeframes"}
    timeframes = _mapping(document.get("timeframes"), "DECISION_VIEW_TIMEFRAMES_INVALID")
    output["timeframes"] = {
        timeframe: _timeframe_summary(timeframes[timeframe])
        for timeframe in _TIMEFRAMES
        if timeframe in timeframes
    }
    return output


def stage_state(rows: Sequence[Mapping[str, Any]]) -> str:
    """Describe a persisted stage without treating absence as success."""

    if not rows:
        return "NOT_REACHED"
    accepted = [row.get("accepted", row.get("approved")) for row in rows]
    if any(value is False for value in accepted):
        return "REJECTED"
    if accepted and all(value is True for value in accepted):
        return "ACCEPTED"
    return "RECORDED"
