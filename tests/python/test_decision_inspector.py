from __future__ import annotations

import io
from datetime import UTC, datetime
from decimal import Decimal
from hashlib import sha256

import pytest
from PIL import Image

from apps.dashboard.decision_inspector import (
    DecisionViewError,
    analysis_attempt_funnel_view,
    analysis_chart_view,
    analysis_history_view,
    analytics_summary,
    automation_status_view,
    broker_lifecycle_view,
    exact_model_input_view,
    latest_ai_request_index,
    model_input_summary,
    model_output_authority_notice,
    model_output_view,
    model_proposal_label,
    open_position_monitor_view,
    prompt_artifact_view,
    reason_code_view,
    safe_audit_detail,
    stage_state,
    take_profit_transform_view,
    trade_outcome_view,
)


def chart_row() -> dict[str, object]:
    output = io.BytesIO()
    Image.new("RGB", (1600, 1200), "black").save(output, format="PNG")
    image = output.getvalue()
    return {
        "chart_image_bytes": image,
        "chart_renderer_version": "completed-candles-ema-atr-v1",
        "chart_mime_type": "image/png",
        "chart_width": 1600,
        "chart_height": 1200,
        "chart_sha256": sha256(image).hexdigest(),
        "chart_source_metadata": {
            "completed_candles_only": True,
            "candle_counts": {"M1": 80, "M5": 60, "M15": 48},
        },
    }


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
    assert "No action required" in view["operator_action"]
    assert view["reasons"][0]["code"] == "AI_CIRCUIT_OPEN"
    assert "No restart" in view["reasons"][0]["next_action"]


def test_analysis_chart_is_hash_and_dimension_verified() -> None:
    row = chart_row()
    view = analysis_chart_view(row)

    assert view is not None
    assert view["image_bytes"] == row["chart_image_bytes"]
    assert view["source_metadata"]["completed_candles_only"] is True

    row["chart_sha256"] = "0" * 64
    with pytest.raises(DecisionViewError, match="CHART_INTEGRITY_INVALID"):
        analysis_chart_view(row)


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

    unavailable = reason_code_view("PLACEMENT_MARKET_REFRESH_FAILED")
    changed = reason_code_view("PLACEMENT_ACCOUNT_STATE_CHANGED")
    context = reason_code_view("PLACEMENT_CANDLE_CONTEXT_CHANGED")
    assert unavailable["title"] == "Final market refresh was unavailable"
    assert changed["title"] == "Account state changed after sizing"
    assert context["title"] == "Final pre-order recheck rejected this cycle"

    broker_price = reason_code_view("CTRADER_FIELD_INVALID:price")
    assert broker_price["title"] == "Broker execution omitted a required price"
    assert "locked out" in broker_price["next_action"]

    recovery = reason_code_view("DEMO_EXECUTION_RECOVERY_RUN_FAILED")
    assert recovery["title"] == "Automatic broker-history recovery failed"
    assert "without requiring a restart" in recovery["next_action"]

    conflict = reason_code_view("DEMO_BROKER_EVENT_KEY_CONFLICT")
    assert conflict["title"] == "Two broker callbacks disagreed about the same event"
    assert "No manual clearing is required" in conflict["next_action"]

    slippage = reason_code_view("DEMO_FILL_SLIPPAGE_EXCEEDED")
    assert "exceeded the configured slippage" in slippage["title"]
    assert "releases this event-specific block automatically" in slippage["next_action"]

    upside = reason_code_view("UPSIDE_TARGETS_INVALID")
    downside = reason_code_view("DOWNSIDE_TARGETS_INVALID")
    assert "above the buy entry" in upside["meaning"]
    assert "below the sell entry" in downside["meaning"]
    assert "fresh market snapshot" in downside["next_action"]


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


def test_automation_status_prioritizes_completed_campaign_review_over_pause() -> None:
    view = automation_status_view(
        {
            "automaticAnalysisEnabled": True,
            "pauseNewAnalyses": True,
            "emergencyStopped": False,
            "reasonCodes": ["ANALYSES_PAUSED"],
            "automaticAnalysisCampaign": {
                "enabled": True,
                "limit": 100,
                "completed": 100,
                "remaining": 0,
                "complete": True,
                "reasonCodes": ["AUTOMATIC_ANALYSIS_CAMPAIGN_COMPLETE"],
            },
        }
    )

    assert view["state"] == "CAMPAIGN_COMPLETE"
    assert view["severity"] == "success"
    assert "ready for review" in view["headline"]
    assert {reason["code"] for reason in view["reasons"]} == {
        "ANALYSES_PAUSED",
        "AUTOMATIC_ANALYSIS_CAMPAIGN_COMPLETE",
    }


def test_automation_status_fails_closed_when_campaign_progress_is_unavailable() -> None:
    view = automation_status_view(
        {
            "automaticAnalysisEnabled": True,
            "pauseNewAnalyses": False,
            "emergencyStopped": False,
            "reasonCodes": [],
            "automaticAnalysisCampaign": {
                "enabled": True,
                "limit": 100,
                "completed": None,
                "remaining": None,
                "complete": False,
                "reasonCodes": ["AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE"],
            },
        }
    )

    assert view["state"] == "SAFETY_BLOCKED"
    assert view["reasons"][0]["code"] == ("AUTOMATIC_ANALYSIS_CAMPAIGN_PROGRESS_UNAVAILABLE")


def test_broker_lifecycle_explains_closed_trade_result_and_exact_block() -> None:
    status = {
        "automaticAnalysisEnabled": True,
        "reasonCodes": ["RECONCILIATION_UNCERTAIN", "DEMO_FILL_SLIPPAGE_EXCEEDED"],
        "managedSetup": {
            "status": "LATEST_TERMINAL",
            "groupState": "CLOSED",
            "orders": [
                {"side": "BUY", "state": "FILLED"},
                {"side": "SELL", "state": "CANCELLED"},
            ],
            "position": {"side": "BUY", "state": "CLOSED"},
            "trade": {
                "direction": "LONG",
                "realizedPnl": "-4.6500000000",
                "fees": "-0.2800000000",
            },
        },
    }

    view = broker_lifecycle_view(status)

    assert view["state"] == "SETUP_CLOSED"
    assert view["headline"] == "BUY demo trade closed — no order or position is active"
    assert "BUY order filled; SELL order cancelled" in view["detail"]
    assert "realized P/L -4.65; fees -0.28" in view["detail"]
    assert "fill exceeded the configured slippage" in view["next_action"]


def test_broker_lifecycle_prioritizes_live_position_then_pending_orders() -> None:
    base = {
        "automaticAnalysisEnabled": True,
        "reasonCodes": ["RELEVANT_POSITION_EXISTS"],
        "managedSetup": {
            "status": "ACTIVE",
            "groupState": "POSITION_OPEN",
            "orders": [
                {"side": "BUY", "state": "FILLED"},
                {"side": "SELL", "state": "CANCELLED"},
            ],
            "position": {"side": "BUY", "state": "OPEN"},
            "trade": None,
        },
    }
    open_trade = broker_lifecycle_view(base)
    assert open_trade["state"] == "TRADE_ACTIVE"
    assert open_trade["headline"] == "BUY demo trade is open"

    base["managedSetup"] = {
        "status": "ACTIVE",
        "groupState": "ACTIVE",
        "orders": [
            {"side": "BUY", "state": "PENDING"},
            {"side": "SELL", "state": "PENDING"},
        ],
        "position": None,
        "trade": None,
    }
    pending = broker_lifecycle_view(base)
    assert pending["state"] == "ORDERS_WAITING"
    assert pending["headline"] == "2 demo stop orders are waiting at the broker"
    assert pending["detail"] == "Active sides: BUY, SELL. No strategy position is currently open."


def test_broker_lifecycle_reports_both_terminal_oco_positions() -> None:
    view = broker_lifecycle_view(
        {
            "automaticAnalysisEnabled": True,
            "reasonCodes": [],
            "managedSetup": {
                "status": "LATEST_TERMINAL",
                "groupState": "CLOSED",
                "orders": [
                    {"side": "BUY", "state": "FILLED"},
                    {"side": "SELL", "state": "FILLED"},
                ],
                "positions": [
                    {"side": "BUY", "state": "CLOSED"},
                    {"side": "SELL", "state": "CLOSED"},
                ],
                "trades": [
                    {"direction": "LONG", "realizedPnl": "-4.98", "fees": "-0.28"},
                    {"direction": "SHORT", "realizedPnl": "-5.11", "fees": "-0.28"},
                ],
                "position": None,
                "trade": None,
            },
        }
    )

    assert view["state"] == "SETUP_CLOSED"
    assert view["headline"] == ("2 demo trades closed (BUY, SELL) — nothing remains active")
    assert "realized P/L -10.09; fees -0.56" in view["detail"]


def test_broker_lifecycle_idle_state_says_when_automation_runs_next() -> None:
    view = broker_lifecycle_view(
        {
            "automaticAnalysisEnabled": True,
            "reasonCodes": [],
            "managedSetup": {
                "status": "NONE",
                "groupState": None,
                "orders": [],
                "position": None,
                "trade": None,
            },
        }
    )

    assert view["state"] == "IDLE"
    assert view["headline"] == "No strategy order or trade is active"
    assert view["next_action"] == (
        "Automatic analysis will start at the next eligible broker M1 window."
    )


@pytest.mark.parametrize(
    "managed_setup",
    [
        None,
        {"status": "UNAVAILABLE"},
        {"status": "ACTIVE", "orders": "invalid", "position": None},
        {
            "status": "LATEST_TERMINAL",
            "groupState": "CLOSED",
            "orders": [{"side": "BUY", "state": "PENDING"}],
            "position": None,
        },
        {
            "status": "LATEST_TERMINAL",
            "groupState": "CLOSED",
            "orders": [{"side": "BUY", "state": "MALFORMED"}],
            "position": {"side": "BUY", "state": "CLOSED"},
        },
    ],
)
def test_broker_lifecycle_does_not_call_unknown_exposure_idle(
    managed_setup: object,
) -> None:
    view = broker_lifecycle_view(
        {"automaticAnalysisEnabled": True, "reasonCodes": [], "managedSetup": managed_setup}
    )

    assert view["state"] == "UNKNOWN"
    assert view["severity"] == "error"
    assert "exposure is unknown" in view["headline"]


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


def test_open_position_monitor_view_preserves_exact_broker_values() -> None:
    view = open_position_monitor_view(
        {
            "status": "AVAILABLE",
            "side": "BUY",
            "accountCurrency": "USD",
            "bid": "4641.2",
            "ask": "4641.4",
            "markPrice": "4641.2",
            "grossUnrealizedPnl": "3.2",
            "netUnrealizedPnl": "2.75",
            "recordedCommission": "-0.3",
            "quoteSourceTime": "2026-08-25T04:00:00.000Z",
            "quoteReceivedAt": "2026-08-25T04:00:00.050Z",
            "pnlCapturedAt": "2026-08-25T04:00:00.060Z",
        }
    )

    assert view["markPrice"] == "4641.2"
    assert view["netUnrealizedPnl"] == "2.75"
    assert view["recordedCommission"] == "-0.3"


def test_open_position_monitor_view_handles_none_and_rejects_malformed_data() -> None:
    assert open_position_monitor_view({"status": "NONE"}) == {"status": "NONE"}
    with pytest.raises(DecisionViewError, match="FIELDS_INVALID"):
        open_position_monitor_view({"status": "AVAILABLE", "broker_position_id": "must-not-render"})
    with pytest.raises(DecisionViewError, match="DECIMAL_INVALID"):
        open_position_monitor_view(
            {
                "status": "AVAILABLE",
                "side": "SELL",
                "accountCurrency": "USD",
                "bid": "NaN",
                "ask": "4641.4",
                "markPrice": "4641.4",
                "grossUnrealizedPnl": "3.2",
                "netUnrealizedPnl": "2.75",
                "recordedCommission": "-0.3",
                "quoteSourceTime": "2026-08-25T04:00:00.000Z",
                "quoteReceivedAt": "2026-08-25T04:00:00.050Z",
                "pnlCapturedAt": "2026-08-25T04:00:00.060Z",
            }
        )


def history_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "analysis_id": "11111111-1111-4111-8111-111111111111",
        "analysis_time": "2026-08-25T04:00:00.000Z",
        "analysis_state": "REJECTED",
        "rejection_reasons": ["BUY_ENTRY_TOO_CLOSE"],
        "cancellation_reason": None,
        "parsed_payload": {
            "schema_version": "2.1",
            "technical_map": {},
            "buy_stop": {
                "entry_price": "4653.80",
                "stop_loss": "4651.80",
                "take_profit": "4661.80",
            },
            "sell_stop": {
                "entry_price": "4648.70",
                "stop_loss": "4650.70",
                "take_profit": "4639.70",
            },
        },
        "effective_buy_entry": "4653.8",
        "effective_buy_stop_loss": "4651.8",
        "effective_buy_take_profit": "4657.8",
        "effective_sell_entry": "4648.7",
        "effective_sell_stop_loss": "4650.7",
        "effective_sell_take_profit": "4644.2",
        "group_state": None,
        "group_expires_at": None,
        "buy_order_state": None,
        "buy_order_entry": None,
        "buy_order_stop_loss": None,
        "buy_order_take_profit": None,
        "sell_order_state": None,
        "sell_order_entry": None,
        "sell_order_stop_loss": None,
        "sell_order_take_profit": None,
        "position_count": 0,
        "position_side": None,
        "position_state": None,
        "trade_count": 0,
        "trade_direction": None,
        "realized_pnl": None,
        "fees": None,
        "trade_closed_at": None,
    }
    row.update(overrides)
    return row


def attempt_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "analysis_id": "11111111-1111-4111-8111-111111111111",
        "analysis_time": "2026-08-25T04:00:00.000Z",
        "analysis_state": "REJECTED",
        "rejection_reasons": ["AI_ORCHESTRATOR_503"],
        "model_request_present": False,
        "model_completed": False,
        "group_state": None,
        "position_count": 0,
        "trade_count": 0,
        "trade_win_count": 0,
        "trade_loss_count": 0,
        "trade_break_even_count": 0,
        "trade_long_count": 0,
        "trade_short_count": 0,
        "ai_pipeline_latency_ms": None,
        "realized_pnl": None,
        "fees": None,
    }
    row.update(overrides)
    return row


def test_analysis_attempt_funnel_explains_each_attempt_once() -> None:
    rows = [
        attempt_row(),
        attempt_row(
            analysis_id="22222222-2222-4222-8222-222222222222",
            analysis_time="2026-08-25T04:01:00.000Z",
            rejection_reasons=["MARKET_DATA_SERVICE_503"],
        ),
        attempt_row(
            analysis_id="33333333-3333-4333-8333-333333333333",
            analysis_time="2026-08-25T04:02:00.000Z",
            rejection_reasons=["SPREAD_POINTS_EXCEEDED"],
        ),
        attempt_row(
            analysis_id="44444444-4444-4444-8444-444444444444",
            analysis_time="2026-08-25T04:03:00.000Z",
            rejection_reasons=[
                "SPREAD_POINTS_EXCEEDED",
                "DECISION_CANDLE_CONTEXT_CHANGED",
            ],
            model_request_present=True,
            model_completed=True,
            ai_pipeline_latency_ms=40_000,
        ),
        attempt_row(
            analysis_id="55555555-5555-4555-8555-555555555555",
            analysis_time="2026-08-25T04:04:00.000Z",
            rejection_reasons=["DOWNSIDE_TARGETS_INVALID"],
            model_request_present=True,
            model_completed=True,
            ai_pipeline_latency_ms=50_000,
        ),
        attempt_row(
            analysis_id="66666666-6666-4666-8666-666666666666",
            analysis_time="2026-08-25T04:05:00.000Z",
            analysis_state="EXPIRED",
            rejection_reasons=[],
            model_request_present=True,
            model_completed=True,
            ai_pipeline_latency_ms=60_000,
            group_state="EXPIRED",
        ),
        attempt_row(
            analysis_id="77777777-7777-4777-8777-777777777777",
            analysis_time="2026-08-25T04:06:00.000Z",
            analysis_state="EXPIRED",
            rejection_reasons=[],
            model_request_present=True,
            model_completed=True,
            ai_pipeline_latency_ms=70_000,
            group_state="CLOSED",
            position_count=1,
            trade_count=1,
            trade_win_count=1,
            trade_long_count=1,
            realized_pnl="5.00",
            fees="-0.30",
        ),
        attempt_row(
            analysis_id="88888888-8888-4888-8888-888888888888",
            analysis_time="2026-08-25T04:07:00.000Z",
            analysis_state="EXPIRED",
            rejection_reasons=[],
            model_request_present=True,
            model_completed=True,
            ai_pipeline_latency_ms=80_000,
            group_state="CLOSED",
            position_count=2,
            trade_count=2,
            trade_loss_count=2,
            trade_short_count=2,
            realized_pnl="-7.00",
            fees="-0.60",
        ),
    ]

    view = analysis_attempt_funnel_view(rows)

    assert [row["primary_category"] for row in view["rows"]] == [
        "AI_DEPENDENCY_FAILED",
        "MARKET_DATA_FAILED",
        "SPREAD_SAFETY_SKIP",
        "CONTEXT_EXPIRED",
        "AI_PROPOSAL_INVALID",
        "SETUP_EXPIRED_NO_TRADE",
        "TRADE_CLOSED_WIN",
        "TRADE_CLOSED_LOSS",
    ]
    assert view["rows"][3]["primary_reason"] == "DECISION_CANDLE_CONTEXT_CHANGED"
    assert view["summary"] == {
        "analysis_attempts": 8,
        "completed_ai_responses": 5,
        "ended_before_completed_ai": 3,
        "order_groups": 3,
        "positions": 3,
        "trades": 3,
        "wins": 1,
        "losses": 2,
        "break_even": 0,
        "long_trades": 1,
        "short_trades": 2,
        "median_ai_pipeline_seconds": "60",
        "p90_ai_pipeline_seconds": "80",
        "max_ai_pipeline_seconds": "80",
        "realized_pnl": "-2",
        "fees": "-0.9",
        "context_expired": 1,
        "ai_proposal_invalid": 1,
        "dependency_failures": 2,
        "spread_skips": 1,
        "expired_setups": 1,
    }


def test_analysis_attempt_funnel_rejects_ambiguous_or_unsafe_evidence() -> None:
    with pytest.raises(DecisionViewError, match="ANALYSIS_ID_INVALID"):
        analysis_attempt_funnel_view([attempt_row(), attempt_row()])

    unsafe_reason = attempt_row(rejection_reasons=["password=not-for-display"])
    with pytest.raises(DecisionViewError, match="REASONS_INVALID"):
        analysis_attempt_funnel_view([unsafe_reason])

    completed_without_request = attempt_row(model_completed=True, ai_pipeline_latency_ms=50_000)
    with pytest.raises(DecisionViewError, match="MODEL_STATE_INVALID"):
        analysis_attempt_funnel_view([completed_without_request])

    group_without_completed_model = attempt_row(group_state="ACTIVE")
    with pytest.raises(DecisionViewError, match="LIFECYCLE_AMBIGUOUS"):
        analysis_attempt_funnel_view([group_without_completed_model])

    impossible_trade = attempt_row(
        model_request_present=True,
        model_completed=True,
        ai_pipeline_latency_ms=50_000,
        group_state="CLOSED",
        position_count=1,
        trade_count=1,
        trade_win_count=1,
        trade_long_count=1,
    )
    with pytest.raises(DecisionViewError, match="PNL_INVALID"):
        analysis_attempt_funnel_view([impossible_trade])


def test_analysis_attempt_funnel_labels_non_terminal_processing_without_guessing() -> None:
    view = analysis_attempt_funnel_view(
        [
            attempt_row(
                analysis_state="COLLECTING",
                rejection_reasons=[],
            ),
            attempt_row(
                analysis_id="22222222-2222-4222-8222-222222222222",
                analysis_time="2026-08-25T04:01:00.000Z",
                analysis_state="VALIDATING",
                rejection_reasons=[],
                model_request_present=True,
                model_completed=True,
                ai_pipeline_latency_ms=45_000,
            ),
            attempt_row(
                analysis_id="33333333-3333-4333-8333-333333333333",
                analysis_time="2026-08-25T04:02:00.000Z",
                analysis_state="EXPIRED",
                rejection_reasons=[],
                model_request_present=True,
                model_completed=True,
                ai_pipeline_latency_ms=46_000,
            ),
        ]
    )

    assert [row["primary_category"] for row in view["rows"]] == [
        "ANALYSIS_OR_AI_IN_PROGRESS",
        "AI_RESPONSE_PROCESSING",
        "ANALYSIS_EXPIRED_NO_SETUP",
    ]


def test_analysis_history_distinguishes_non_trades_and_terminal_results() -> None:
    pending = history_row(
        analysis_id="22222222-2222-4222-8222-222222222222",
        analysis_time="2026-08-25T04:01:00.000Z",
        analysis_state="ACCEPTED",
        rejection_reasons=[],
        group_state="ACTIVE",
        group_expires_at="2026-08-25T04:16:00.000Z",
        buy_order_state="PENDING",
        buy_order_entry="4653.8000000000",
        buy_order_stop_loss="4651.8000000000",
        buy_order_take_profit="4657.8000000000",
        sell_order_state="PENDING",
        sell_order_entry="4648.7000000000",
        sell_order_stop_loss="4650.7000000000",
        sell_order_take_profit="4644.2000000000",
    )
    expired = history_row(
        analysis_id="33333333-3333-4333-8333-333333333333",
        analysis_time="2026-08-25T04:02:00.000Z",
        analysis_state="EXPIRED",
        rejection_reasons=[],
        group_state="EXPIRED",
        group_expires_at="2026-08-25T04:17:00.000Z",
        cancellation_reason="ORDER_EXPIRED",
        buy_order_state="EXPIRED",
        buy_order_entry="4653.8",
        buy_order_stop_loss="4651.8",
        buy_order_take_profit="4657.8",
        sell_order_state="EXPIRED",
        sell_order_entry="4648.7",
        sell_order_stop_loss="4650.7",
        sell_order_take_profit="4644.2",
    )
    win = history_row(
        analysis_id="44444444-4444-4444-8444-444444444444",
        analysis_time="2026-08-25T04:03:00.000Z",
        analysis_state="EXPIRED",
        rejection_reasons=[],
        group_state="CLOSED",
        group_expires_at="2026-08-25T04:18:00.000Z",
        buy_order_state="FILLED",
        buy_order_entry="4653.8",
        buy_order_stop_loss="4651.8",
        buy_order_take_profit="4657.8",
        sell_order_state="CANCELLED",
        sell_order_entry="4648.7",
        sell_order_stop_loss="4650.7",
        sell_order_take_profit="4644.2",
        position_count=1,
        position_side="BUY",
        position_state="CLOSED",
        trade_count=1,
        trade_direction="LONG",
        realized_pnl="5.00",
        fees="-0.30",
        trade_closed_at="2026-08-25T04:05:00.000Z",
    )
    loss = history_row(
        analysis_id="55555555-5555-4555-8555-555555555555",
        analysis_time="2026-08-25T04:04:00.000Z",
        analysis_state="EXPIRED",
        rejection_reasons=[],
        group_state="CLOSED",
        group_expires_at="2026-08-25T04:19:00.000Z",
        buy_order_state="CANCELLED",
        buy_order_entry="4653.8",
        buy_order_stop_loss="4651.8",
        buy_order_take_profit="4657.8",
        sell_order_state="FILLED",
        sell_order_entry="4648.7",
        sell_order_stop_loss="4650.7",
        sell_order_take_profit="4644.2",
        position_count=1,
        position_side="SELL",
        position_state="CLOSED",
        trade_count=1,
        trade_direction="SHORT",
        realized_pnl="-3.50",
        fees="-0.25",
        trade_closed_at="2026-08-25T04:06:00.000Z",
    )

    view = analysis_history_view([history_row(), pending, expired, win, loss], 5)

    assert [row["result"] for row in view["rows"]] == [
        "REJECTED — NO ORDER",
        "STOPS PENDING",
        "EXPIRED — NO TRADE",
        "CLOSED WIN",
        "CLOSED LOSS",
    ]
    assert view["rows"][0]["level_source"] == "EFFECTIVE LEVELS — NOT PLACED"
    assert view["rows"][1]["level_source"] == "PLACED ORDER LEVELS"
    assert view["summary"] == {
        "completed_ai_analyses": 5,
        "orders_created": 4,
        "pending_stops": 1,
        "expired_without_trade": 1,
        "open_trades": 0,
        "wins": 1,
        "losses": 1,
        "break_even": 0,
        "realized_pnl": "1.5",
        "fees": "-0.55",
        "context_invalidated": 0,
        "dependency_failures": 0,
        "spread_skips": 0,
        "other_rejections": 1,
    }


def test_analysis_history_fails_count_and_marks_ambiguous_evidence_unavailable() -> None:
    with pytest.raises(DecisionViewError, match="COUNT_MISMATCH"):
        analysis_history_view([history_row()], 2)

    ambiguous = history_row(position_count=3)
    view = analysis_history_view([ambiguous], 1)
    assert view["rows"][0]["result"] == "EVIDENCE UNAVAILABLE"
    assert "LIFECYCLE_AMBIGUOUS" in view["rows"][0]["reasons"]
    assert view["summary"]["losses"] == 0

    incomplete_trade = history_row(
        position_count=1,
        position_side="BUY",
        position_state="CLOSED",
        trade_count=1,
        trade_direction="LONG",
        realized_pnl="5",
        fees="-0.3",
    )
    view = analysis_history_view([incomplete_trade], 1)
    assert view["rows"][0]["result"] == "EVIDENCE UNAVAILABLE"
    assert "TRADE_NOT_CLOSED" in view["rows"][0]["reasons"]
    assert view["summary"]["wins"] == 0


def test_analysis_history_sums_a_genuine_double_fill_outcome() -> None:
    double_fill = history_row(
        analysis_state="EXPIRED",
        rejection_reasons=[],
        group_state="CLOSED",
        group_expires_at="2026-08-25T10:04:04.000Z",
        buy_order_state="FILLED",
        buy_order_entry="4640.4",
        buy_order_stop_loss="4636.61",
        buy_order_take_profit="4647.98",
        sell_order_state="FILLED",
        sell_order_entry="4635.8",
        sell_order_stop_loss="4640.4",
        sell_order_take_profit="4626.6",
        position_count=2,
        position_side="BOTH",
        position_state="CLOSED",
        trade_count=2,
        trade_direction="BOTH",
        realized_pnl="-10.09",
        fees="-0.56",
        trade_closed_at="2026-08-25T10:42:12.418Z",
    )

    view = analysis_history_view([double_fill], 1)

    assert view["rows"][0]["result"] == "CLOSED LOSS"
    assert view["rows"][0]["triggered_side"] == "BUY + SELL"
    assert view["rows"][0]["realized_pnl"] == "-10.09"
    assert view["summary"]["losses"] == 1
    assert view["summary"]["realized_pnl"] == "-10.09"


def test_analysis_history_rejects_duplicate_identity_and_sanitizes_bad_model_data() -> None:
    with pytest.raises(DecisionViewError, match="ANALYSIS_ID_INVALID"):
        analysis_history_view([history_row(), history_row()], 2)

    unsafe = history_row(
        parsed_payload={
            "schema_version": "2.1",
            "technical_map": {},
            "buy_stop": {"broker_position_id": "must-not-render"},
            "sell_stop": {},
        }
    )
    view = analysis_history_view([unsafe], 1)
    assert view["rows"][0]["evidence_status"] == "UNAVAILABLE"
    assert all("must-not-render" not in str(value) for value in view["rows"][0].values())
