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
_PROMPT_FILES = {
    "system-v1": "system-v1.md",
    "system-v2": "system-v2.md",
}
_SECRET_VALUE = re.compile(
    r"(?:bearer\s+[a-z0-9._~+/=-]{12,}|"
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)"
    r"\s*[:=]\s*[^\s]{8,}|(?:postgres(?:ql)?|https?)://[^\s/:@]+:[^\s@]+@)",
    re.IGNORECASE,
)


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
