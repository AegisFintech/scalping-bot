from __future__ import annotations

import pytest

from apps.dashboard.decision_inspector import (
    DecisionViewError,
    analytics_summary,
    model_input_summary,
    model_output_view,
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
                "nested": {"broker_account_id": "must-not-render"},
            }
        )


def test_malformed_and_oversized_documents_fail_closed() -> None:
    with pytest.raises(DecisionViewError, match="MODEL_OUTPUT_INVALID"):
        model_output_view(["not", "an", "object"])
    with pytest.raises(DecisionViewError, match="MODEL_DECISION_INVALID"):
        model_output_view({"decision": "MAYBE"})
    with pytest.raises(DecisionViewError, match="MODEL_OUTPUT_OVERSIZED"):
        model_output_view({"decision": "NO_TRADE", "padding": "x" * 256_001})


def test_stage_state_never_treats_missing_or_rejected_as_accepted() -> None:
    assert stage_state([]) == "NOT_REACHED"
    assert stage_state([{"accepted": True}]) == "ACCEPTED"
    assert stage_state([{"approved": True}, {"approved": True}]) == "ACCEPTED"
    assert stage_state([{"accepted": True}, {"accepted": False}]) == "REJECTED"
    assert stage_state([{"status": "COMPLETED"}]) == "RECORDED"
