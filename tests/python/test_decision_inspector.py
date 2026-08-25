from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256

import pytest

from apps.dashboard.decision_inspector import (
    DecisionViewError,
    analytics_summary,
    automation_status_view,
    exact_model_input_view,
    latest_ai_request_index,
    model_input_summary,
    model_output_authority_notice,
    model_output_view,
    model_proposal_label,
    prompt_artifact_view,
    reason_code_view,
    safe_audit_detail,
    stage_state,
    take_profit_transform_view,
    trade_outcome_view,
)


def test_automation_status_explains_ai_cooldown_as_automatic_retry() -> None:
    view = automation_status_view(
        {
            "automaticAnalysisEnabled": True,
            "pauseNewAnalyses": False,
            "emergencyStopped": False,
            "tradingEnabled": False,
            "aiCircuitOpenUntil": "2026-08-25T01:02:00.000Z",
            "reasonCodes": ["AI_CIRCUIT_OPEN"],
        }
    )

    assert view["state"] == "WAITING_FOR_AI"
    assert "retry automatically" in view["detail"]
    assert view["retry_at"] == "2026-08-25T01:02:00.000Z"
    assert view["reasons"][0]["code"] == "AI_CIRCUIT_OPEN"
    assert "No restart" in view["reasons"][0]["next_action"]


def test_automation_status_keeps_emergency_stop_and_unknown_reasons_fail_closed() -> None:
    stopped = automation_status_view(
        {
            "automaticAnalysisEnabled": True,
            "emergencyStopped": True,
            "reasonCodes": ["EMERGENCY_STOP_DATABASE", "NEW_SAFETY_GATE"],
        }
    )

    assert stopped["state"] == "STOPPED"
    assert stopped["severity"] == "error"
    unknown = reason_code_view("NEW_SAFETY_GATE")
    assert unknown["code"] == "NEW_SAFETY_GATE"
    assert "do not bypass" in unknown["next_action"]


def test_automation_status_does_not_treat_malformed_reasons_as_ready() -> None:
    view = automation_status_view(
        {"automaticAnalysisEnabled": True, "reasonCodes": "AI_CIRCUIT_OPEN"}
    )

    assert view["state"] == "SAFETY_BLOCKED"
    assert view["reasons"][0]["code"] == "STATUS_REASON_CODES_INVALID"


def test_reason_code_prefix_explains_observed_semantic_rejection() -> None:
    view = reason_code_view("SELL_ENTRY_TOO_CLOSE")

    assert view["code"] == "SELL_ENTRY_TOO_CLOSE"
    assert view["title"] == "Sell proposal failed deterministic validation"
    assert "No sell order was sent" in view["next_action"]

    midpoint = reason_code_view("BUY_TP_MIDPOINT_NOT_ON_TICK")
    assert "off the broker tick" in midpoint["title"]
    assert "No order was rounded" in midpoint["next_action"]

    affordability = reason_code_view("SELL_STOP_DISTANCE_UNAFFORDABLE_AT_MIN_VOLUME")
    assert "minimum-volume risk budget" in affordability["title"]
    assert "No order was sent" in affordability["next_action"]


def test_automation_status_distinguishes_an_in_progress_cycle_from_a_stop() -> None:
    view = automation_status_view(
        {
            "automaticAnalysisEnabled": True,
            "emergencyStopped": False,
            "reasonCodes": ["PREVIOUS_ANALYSIS_ACTIVE"],
        }
    )

    assert view["state"] == "ACTIVE_CYCLE_OR_SETUP"
    assert "cycle or setup is already active" in view["headline"]


def test_analysis_selection_prefers_latest_durable_ai_request_with_safe_fallback() -> None:
    assert (
        latest_ai_request_index(
            [
                {"ai_request_recorded": False},
                {"ai_request_recorded": True},
                {"ai_request_recorded": True},
            ]
        )
        == 1
    )
    assert latest_ai_request_index([{"ai_request_recorded": False}]) == 0
    assert latest_ai_request_index([]) == 0


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
    assert "historical schema 1.0" in model_output_authority_notice(view)
    assert "not the current" in model_output_authority_notice(view)


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
    assert "two-leg conditional proposal" in model_output_authority_notice(view)


def test_missing_model_output_notice_does_not_imply_a_proposal_exists() -> None:
    assert model_output_authority_notice(None) == (
        "AI was not reached for this run; no model proposal exists."
    )


def test_take_profit_transform_view_shows_original_and_effective_levels() -> None:
    rows = take_profit_transform_view(
        [
            {
                "details": {
                    "validation_scope": "TAKE_PROFIT_TRANSFORM",
                    "proposal_transform": {
                        "code": "TAKE_PROFIT_DISTANCE_DIVIDED_BY_2",
                        "divisor": "2",
                        "buy": {
                            "entry_price": "2001",
                            "stop_loss": "2000",
                            "original_take_profit": "2005",
                            "effective_take_profit": "2003",
                            "original_risk_reward_ratio": "4",
                            "effective_risk_reward_ratio": "2",
                        },
                        "sell": {
                            "entry_price": "1999",
                            "stop_loss": "2000",
                            "original_take_profit": "1995",
                            "effective_take_profit": "1997",
                            "original_risk_reward_ratio": "4",
                            "effective_risk_reward_ratio": "2",
                        },
                    },
                }
            }
        ]
    )

    assert rows[0] == {
        "side": "BUY",
        "entry_price": "2001",
        "stop_loss": "2000",
        "ai_take_profit": "2005",
        "effective_take_profit": "2003",
        "ai_risk_reward_ratio": "4",
        "effective_risk_reward_ratio": "2",
    }
    assert rows[1]["side"] == "SELL"


def test_take_profit_transform_view_rejects_malformed_audit_details() -> None:
    with pytest.raises(DecisionViewError, match="TP_TRANSFORM_LEG_INVALID"):
        take_profit_transform_view(
            [
                {
                    "details": {
                        "validation_scope": "TAKE_PROFIT_TRANSFORM",
                        "proposal_transform": {
                            "code": "TAKE_PROFIT_DISTANCE_DIVIDED_BY_2",
                            "divisor": "2",
                            "buy": {},
                            "sell": {},
                        },
                    }
                }
            ]
        )


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
    current = prompt_artifact_view("system-v4", content, digest)
    assert current["version"] == "system-v4"
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


def test_trade_outcome_view_preserves_signed_decimal_strings() -> None:
    outcome = {
        "mode": "demo",
        "direction": "LONG",
        "setup_tags": ["BREAKOUT"],
        "market_regime": "TRENDING",
        "confidence_bucket": "HIGH",
        "realized_pnl": Decimal("9.6500000000"),
        "fees": Decimal("-0.3500000000"),
        "opened_at": datetime(2026, 8, 24, 10, 0, tzinfo=UTC),
        "closed_at": datetime(2026, 8, 24, 10, 2, tzinfo=UTC),
        "model_version": "test-model",
        "prompt_version": "system-v2",
        "schema_version": "2.0",
        "strategy_version": "test-strategy",
    }

    view = trade_outcome_view(outcome)

    assert view["realized_pnl"] == "9.6500000000"
    assert view["fees"] == "-0.3500000000"


def test_trade_outcome_view_rejects_sensitive_or_malformed_data() -> None:
    with pytest.raises(DecisionViewError, match="FIELDS_INVALID"):
        trade_outcome_view({"broker_position_id": "must-not-render"})
    malformed = {
        "mode": "demo",
        "direction": "LONG",
        "setup_tags": [],
        "market_regime": "TRENDING",
        "confidence_bucket": "HIGH",
        "realized_pnl": "9.65",
        "fees": Decimal("-0.35"),
        "opened_at": datetime(2026, 8, 24, 10, 0, tzinfo=UTC),
        "closed_at": datetime(2026, 8, 24, 10, 2, tzinfo=UTC),
        "model_version": "test-model",
        "prompt_version": "system-v2",
        "schema_version": "2.0",
        "strategy_version": "test-strategy",
    }
    with pytest.raises(DecisionViewError, match="DECIMAL_INVALID"):
        trade_outcome_view(malformed)
