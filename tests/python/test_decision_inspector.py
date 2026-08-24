from __future__ import annotations

from hashlib import sha256

import pytest

from apps.dashboard.decision_inspector import (
    DecisionViewError,
    analytics_summary,
    exact_model_input_view,
    model_input_summary,
    model_output_view,
    model_proposal_label,
    prompt_artifact_view,
    safe_audit_detail,
    stage_state,
)


def test_model_output_view_preserves_exact_validated_ai_fields() -> None:
    payload = {
        "schema_version": "1.0",
        "decision": "NO_TRADE",
        "market_regime": "UNCERTAIN",
        "waiting_area": {"lower": "4630.10", "upper": "4640.20"},
        "buy_stop": {"enabled": False, "entry_price": "4641.00"},
        "sell_stop": {"enabled": False, "entry_price": "4629.00"},
        "confidence": {"overall": 12},
        "evidence_codes": ["MULTI_TIMEFRAME_CONFLICT"],
        "risk_flags": ["NO_VALIDATED_EDGE"],
        "data_quality": {"acceptable": False, "warnings": ["LOW_VOLUME"]},
    }

    view = model_output_view(payload)

    assert view == payload
    assert view["waiting_area"]["lower"] == "4630.10"
    assert model_proposal_label(view) == "NO_TRADE"


def test_model_output_view_accepts_mandatory_v2_oco_without_decision_switches() -> None:
    payload = {
        "schema_version": "2.0",
        "analysis_id": "00000000-0000-4000-8000-000000000001",
        "symbol": "XAUUSD",
        "buy_stop": {"entry_price": "4641.00"},
        "sell_stop": {"entry_price": "4629.00"},
    }

    view = model_output_view(payload)

    assert view == payload
    assert model_proposal_label(view) == "OCO_PROPOSAL"


def test_model_input_summary_counts_but_does_not_render_candle_arrays() -> None:
    candles = [
        {"startTime": "2026-08-24T08:00:00Z", "close": "4630.10"},
        {"startTime": "2026-08-24T08:01:00Z", "close": "4631.20"},
    ]
    payload = {
        "schema_version": "1.0",
        "analysis_id": "00000000-0000-4000-8000-000000000001",
        "symbol": "XAUUSD",
        "analysis_time": "2026-08-24T08:02:00Z",
        "server_time": "2026-08-24T08:02:00Z",
        "payload_mode": "compact",
        "versions": {"prompt": "system-v1", "schema": "1.0"},
        "market": {
            "timeframes": {
                "M1": {"raw_tail": candles, "atr": "2.1234567890", "returns": ["0.1"]},
                "M5": {"raw_tail": candles, "ema_alignment": "BEARISH"},
                "M15": {"raw_tail": candles, "session_gap_count": 2},
            },
            "order_book": {"spread": "0.05"},
            "spread_atr_ratio_m1": "0.0235",
        },
        "performance": {"sample_size": 0},
    }

    view = model_input_summary(payload)

    m1 = view["market"]["timeframes"]["M1"]
    assert "raw_tail" not in m1
    assert m1["raw_tail_summary"]["count"] == 2
    assert m1["raw_tail_summary"]["latest"]["close"] == "4631.20"
    assert m1["returns_summary"] == {"count": 1, "latest": "0.1"}


def test_analytics_summary_omits_full_candles_and_keeps_indicators() -> None:
    features = {
        "timeframes": {
            timeframe: {
                "full_candles": [{"close": "4631.20", "complete": True}],
                "atr": "2.1000000000",
                "ema_alignment": "FLAT",
            }
            for timeframe in ("M1", "M5", "M15")
        },
        "order_book": {"spread": "0.05"},
    }

    view = analytics_summary(features)

    assert view["timeframes"]["M1"]["full_candles_summary"]["count"] == 1
    assert view["timeframes"]["M1"]["atr"] == "2.1000000000"


def test_sensitive_audit_keys_are_redacted_recursively() -> None:
    detail = safe_audit_detail({"stage": "MODEL", "nested": {"authorization": "Bearer secret"}})

    assert detail["nested"]["authorization"] == "[REDACTED]"


def test_model_output_with_sensitive_key_is_not_rendered() -> None:
    with pytest.raises(DecisionViewError, match="SENSITIVE_KEY_REJECTED"):
        model_output_view(
            {
                "decision": "NO_TRADE",
                "schema_version": "1.0",
                "nested": {"broker_account_id": "must-not-render"},
            }
        )


def test_malformed_and_oversized_documents_fail_closed() -> None:
    with pytest.raises(DecisionViewError, match="MODEL_OUTPUT_INVALID"):
        model_output_view(["not", "an", "object"])
    with pytest.raises(DecisionViewError, match="MODEL_DECISION_INVALID"):
        model_output_view({"schema_version": "1.0", "decision": "MAYBE"})
    with pytest.raises(DecisionViewError, match="MODEL_OUTPUT_OVERSIZED"):
        model_output_view(
            {"schema_version": "1.0", "decision": "NO_TRADE", "padding": "x" * 256_001}
        )


def test_exact_model_input_preserves_arrays_but_rejects_sensitive_keys() -> None:
    payload = {
        "schema_version": "2.0",
        "market": {"timeframes": {"M1": {"candles": list(range(600))}}},
    }

    assert exact_model_input_view(payload) == payload
    with pytest.raises(DecisionViewError, match="SENSITIVE_KEY_REJECTED"):
        exact_model_input_view({"account_id": "must-not-render"})


def test_prompt_artifact_is_hash_verified_and_legacy_prompt_is_explicit() -> None:
    content = "Return a bounded OCO proposal."
    digest = sha256(content.encode()).hexdigest()

    persisted = prompt_artifact_view("system-v2", content, digest)
    assert persisted["provenance"] == "EXACT_PERSISTED_REQUEST_PROMPT"
    assert persisted["content"] == content
    legacy = prompt_artifact_view("system-v1", None, None)
    assert legacy["provenance"] == "TRACKED_LEGACY_ARTIFACT"
    assert "NO_TRADE" in legacy["content"]
    with pytest.raises(DecisionViewError, match="PROMPT_ARTIFACT_MISSING"):
        prompt_artifact_view("system-v2", None, None)
    with pytest.raises(DecisionViewError, match="PROMPT_HASH_MISMATCH"):
        prompt_artifact_view("system-v2", content, "0" * 64)
    secret_prompt = "Authorization: Bearer abcdefghijklmnop"
    with pytest.raises(DecisionViewError, match="PROMPT_SECRET_REJECTED"):
        prompt_artifact_view(
            "system-v2",
            secret_prompt,
            sha256(secret_prompt.encode()).hexdigest(),
        )


def test_stage_state_never_treats_missing_or_rejected_as_accepted() -> None:
    assert stage_state([]) == "NOT_REACHED"
    assert stage_state([{"accepted": True}]) == "ACCEPTED"
    assert stage_state([{"approved": True}, {"approved": True}]) == "ACCEPTED"
    assert stage_state([{"accepted": True}, {"accepted": False}]) == "REJECTED"
    assert stage_state([{"status": "COMPLETED"}]) == "RECORDED"
