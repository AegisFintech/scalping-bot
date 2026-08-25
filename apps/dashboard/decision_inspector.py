from __future__ import annotations

import json
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
}
_SECRET_VALUE = re.compile(
    r"(?:bearer\s+[a-z0-9._~+/=-]{12,}|"
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"
    r"\s*[:=]\s*[^\s]{8,}|(?:postgres(?:ql)?|https?)://[^\s/:@]+:[^\s@]+@)",
    re.IGNORECASE,
)

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
}

_PREFIX_REASON_GUIDANCE: tuple[tuple[str, tuple[str, str, str]], ...] = (
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


def automation_status_view(status: Mapping[str, Any]) -> dict[str, Any]:
    """Build an operator-readable state while preserving every blocking reason."""

    raw_reasons = status.get("reasonCodes", [])
    reasons = (
        [str(reason) for reason in raw_reasons]
        if isinstance(raw_reasons, Sequence) and not isinstance(raw_reasons, (str, bytes))
        else ["STATUS_REASON_CODES_INVALID"]
    )
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
    return {
        "state": state,
        "headline": headline,
        "severity": severity,
        "detail": detail,
        "retry_at": retry_at,
        "reasons": [reason_code_view(reason) for reason in reasons],
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
    if schema_version == "2.0":
        if "decision" in safe:
            raise DecisionViewError("DECISION_VIEW_MODEL_V2_DECISION_FORBIDDEN")
        for key in ("buy_stop", "sell_stop"):
            proposal = safe.get(key)
            if not isinstance(proposal, dict) or "enabled" in proposal:
                raise DecisionViewError("DECISION_VIEW_MODEL_V2_PROPOSAL_INVALID")
    elif schema_version != "1.0":
        raise DecisionViewError("DECISION_VIEW_MODEL_SCHEMA_VERSION_INVALID")
    return safe


def model_proposal_label(value: Mapping[str, Any]) -> str:
    """Label legacy decisions and mandatory v2 OCO proposals distinctly."""

    if value.get("schema_version") == "2.0":
        return "OCO_PROPOSAL"
    decision = value.get("decision")
    if decision in {"PLACE_OCO", "NO_TRADE"}:
        return str(decision)
    raise DecisionViewError("DECISION_VIEW_MODEL_DECISION_INVALID")


def model_output_authority_notice(value: Mapping[str, Any] | None) -> str:
    """Describe proposal authority without relabelling historical decisions."""

    if value is None:
        return "AI was not reached for this run; no model proposal exists."
    if value.get("schema_version") == "2.0":
        return (
            "The schema 2.0 AI output is a two-leg conditional proposal, not a queued "
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
