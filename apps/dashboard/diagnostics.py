from __future__ import annotations

import hashlib
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import pandas as pd
import plotly.express as px
import psycopg
import streamlit as st
from background import BackgroundReader
from charts import (
    ChartDataError,
    audit_events_figure,
    completed_candles_figure,
    indicators_figure,
    market_quality_figure,
)
from decision_inspector import (
    DecisionViewError,
    analysis_attempt_funnel_view,
    analysis_chart_view,
    analysis_history_view,
    analytics_summary,
    automation_status_view,
    broker_lifecycle_view,
    campaign_history_counts,
    exact_model_input_view,
    execution_status_recovered,
    latest_ai_request_index,
    model_input_summary,
    model_output_authority_notice,
    model_output_view,
    model_proposal_label,
    open_position_monitor_view,
    prompt_artifact_view,
    safe_audit_detail,
    stage_state,
    take_profit_transform_view,
    trade_outcome_view,
)
from psycopg.rows import dict_row
from storage_status import local_storage_status
from time_display import dataframe_for_display, format_gmt8_timestamp


class ExecutionStatusTemporarilyUnavailable(RuntimeError):
    """Render reconnecting state instead of a false history-integrity alarm."""


def execution_url() -> str:
    value = os.getenv("EXECUTION_API_URL", "http://127.0.0.1:8080")
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("dashboard control API must be loopback HTTP")
    return value.rstrip("/")


def market_data_url() -> str:
    value = os.getenv("MARKET_DATA_BASE_URL", "http://127.0.0.1:8081")
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("dashboard market-data API must be loopback HTTP")
    return value.rstrip("/")


def query(sql: str, parameters: Sequence[object] = ()) -> list[dict[str, Any]]:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    with (
        psycopg.connect(
            database_url,
            row_factory=dict_row,
            connect_timeout=5,
            options="-c statement_timeout=8000 -c default_transaction_read_only=on",
        ) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute(sql, parameters)
        return list(cursor.fetchall())


def frame(sql: str, parameters: Sequence[object] = ()) -> pd.DataFrame:
    return pd.DataFrame(query(sql, parameters))


def display_dataframe(data: Any, **kwargs: Any) -> Any:
    """Display a copy whose timestamp columns use the operator GMT+8 format."""

    return st.dataframe(dataframe_for_display(data), **kwargs)


def api_get(path: str) -> dict[str, Any]:
    response = httpx.get(f"{execution_url()}{path}", timeout=5)
    response.raise_for_status()
    value = response.json()
    return value if isinstance(value, dict) else {}


def market_api_get(path: str) -> dict[str, Any]:
    response = httpx.get(f"{market_data_url()}{path}", timeout=5)
    response.raise_for_status()
    value = response.json()
    return value if isinstance(value, dict) else {}


def control(path: str, payload: dict[str, object]) -> tuple[bool, str]:
    token = os.getenv("DASHBOARD_CONTROL_TOKEN", "")
    if len(token) < 24:
        return False, "DASHBOARD_CONTROL_TOKEN is missing or too short"
    try:
        response = httpx.post(
            f"{execution_url()}{path}",
            headers={"x-control-token": token},
            json=payload,
            timeout=15,
        )
        return response.is_success, response.text
    except httpx.HTTPError as error:
        return False, str(error)


@st.cache_resource(show_spinner=False)
def recovery_reader() -> BackgroundReader[dict[str, Any]]:
    return BackgroundReader(lambda: api_get("/v1/status"), interval=2, maximum_age=10)


@st.fragment(run_every="2s")
def execution_status_recovery_probe() -> None:
    """Update the recovery notice without resetting the inspected diagnostic snapshot."""

    recovered = recovery_reader().poll().value
    if recovered is None:
        st.warning(
            "Execution service is reconnecting. Current broker and campaign status is "
            "temporarily unavailable; PostgreSQL history has not been deleted. Retrying "
            "every 2 seconds."
        )
        return
    if execution_status_recovered(recovered):
        st.success("Execution service recovered. Your diagnostic selection is preserved.")
        if st.button("Reload diagnostic snapshot", key="reload_recovered_diagnostics"):
            st.rerun()
        return
    st.warning(
        "Execution service responded without a complete status snapshot. Durable history "
        "is retained; retrying every 2 seconds."
    )


@st.fragment(run_every="2s")
def live_open_trade_panel() -> None:
    st.subheader("Current broker position")
    try:
        monitor = open_position_monitor_view(api_get("/v1/open-position-monitor"))
    except (httpx.HTTPError, RuntimeError, DecisionViewError, ValueError):
        st.warning(
            "Live broker price and P/L are unavailable. The dashboard will retry in 2 seconds; "
            "no value is estimated."
        )
        return
    if monitor["status"] == "NONE":
        st.info("No strategy-owned trade is currently open at the broker.")
        return
    if monitor["status"] == "UNAVAILABLE":
        st.warning(
            "An open-trade value cannot be shown safely right now. "
            f"Reason: {monitor['reasonCode']}. The dashboard will retry in 2 seconds."
        )
        return

    if monitor["executionState"] == "RECONCILIATION_REQUIRED":
        st.warning(
            "The values below are confirmed for the exact open broker position, but its "
            "execution lifecycle still requires reconciliation. Automatic analysis and new "
            "orders remain blocked; this panel is read-only and will keep refreshing."
        )

    currency = monitor["accountCurrency"]
    side = monitor["side"]
    mark_side = "bid" if side == "BUY" else "ask"
    columns = st.columns(6)
    columns[0].metric(f"Current close price ({mark_side})", monitor["markPrice"])
    columns[1].metric("Broker net unrealized P/L", f"{monitor['netUnrealizedPnl']} {currency}")
    columns[2].metric("Broker gross unrealized P/L", f"{monitor['grossUnrealizedPnl']} {currency}")
    columns[3].metric("Commission recorded so far", f"{monitor['recordedCommission']} {currency}")
    columns[4].metric("Live bid", monitor["bid"])
    columns[5].metric("Live ask", monitor["ask"])
    st.caption(
        f"Open side: {side} · quote: {format_gmt8_timestamp(monitor['quoteSourceTime'])} · "
        f"broker P/L captured: {format_gmt8_timestamp(monitor['pnlCapturedAt'])} · "
        "refreshes every 2 seconds"
    )
    st.caption(
        "P/L is reported by cTrader. Commission is the durable amount recorded so far; "
        "the final realized P/L and total fees are authoritative only after the trade closes."
    )


execution_status_error: str | None = None
try:
    status = api_get("/v1/status")
except Exception as error:
    execution_status_error = type(error).__name__
    status = {
        "mode": "unknown",
        "reasonCodes": [f"EXECUTION_API_UNAVAILABLE:{type(error).__name__}"],
    }

if execution_status_error is not None:
    execution_status_recovery_probe()

mode = str(status.get("mode", "unknown")).upper()
account_environment = str(status.get("accountType", "unknown")).lower()
selected_symbol = str(status.get("symbol", "unknown"))
account_key_hash = hashlib.sha256(os.getenv("ACCOUNT_KEY", "unconfigured").encode()).hexdigest()
automation_view = automation_status_view(status)
broker_view = broker_lifecycle_view(status, automation_view)
st.caption("Detailed audit records · read-only diagnostics")
st.caption(
    "Diagnostic snapshots update when you change the selection; "
    "recovery checks run in the background."
)
diagnostic_section = st.selectbox(
    "Inspect", ["Market", "AI Analysis", "Analysis History", "Provider", "Operations", "Server"]
)
campaign = status.get("automaticAnalysisCampaign")
trade_campaign = status.get("automaticDemoTradeCampaign")

if diagnostic_section == "Market":
    try:
        timeframe_column, sample_column = st.columns(2)
        selected_timeframe = timeframe_column.selectbox(
            "Completed candle timeframe", ["M1", "M5", "M15"], index=0
        )
        chart_samples = sample_column.slider(
            "Chart samples", min_value=50, max_value=600, value=300, step=50
        )
        market = frame(
            """WITH target_symbol AS (
                 SELECT s.id FROM symbols s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               )
               SELECT source_time, received_at, bid, ask, spread, weighted_mid, microprice,
                      imbalance_top5, imbalance_top10, imbalance_top20, age_ms,
                      complete, discontinuity, reconnect_sequence
               FROM order_book_snapshots
               WHERE symbol_id = (SELECT id FROM target_symbol)
               ORDER BY source_time DESC LIMIT %s""",
            (account_key_hash, account_environment, selected_symbol, chart_samples),
        )
        indicators = frame(
            """WITH target_symbol AS (
                 SELECT s.id FROM symbols s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               )
               SELECT i.generated_at, i.atr, i.ema_fast, i.ema_slow,
                      i.acceptable, i.rejection_reasons
               FROM indicator_snapshots i
               JOIN candle_snapshots cs ON cs.id = i.candle_snapshot_id
               WHERE cs.symbol_id = (SELECT id FROM target_symbol)
               ORDER BY i.generated_at DESC LIMIT %s""",
            (account_key_hash, account_environment, selected_symbol, chart_samples),
        )
        candles = frame(
            """WITH target_snapshot AS (
                 SELECT cs.id FROM candle_snapshots cs
                 JOIN symbols s ON s.id = cs.symbol_id
                 JOIN accounts a ON a.id = cs.account_id
                 WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                 ORDER BY cs.analysis_time DESC LIMIT 1
               )
               SELECT c.timeframe, c.start_time, c.end_time, c.open, c.high, c.low,
                      c.close, c.volume, c.complete, c.quality_flags
               FROM decision_candles c
               WHERE c.snapshot_id = (SELECT id FROM target_snapshot)
                 AND c.timeframe = %s AND c.complete = true
               ORDER BY c.start_time DESC LIMIT %s""",
            (
                account_key_hash,
                account_environment,
                selected_symbol,
                selected_timeframe,
                chart_samples,
            ),
        )
        candle_chart = completed_candles_figure(candles, selected_timeframe)
        if candle_chart is None:
            st.info("No completed candles are available for this account/symbol/timeframe.")
        else:
            st.plotly_chart(candle_chart, width="stretch")
        indicator_chart = indicators_figure(indicators)
        if indicator_chart is None:
            st.info("No chartable deterministic indicator history is available.")
        else:
            st.plotly_chart(indicator_chart, width="stretch")
        quality_chart = market_quality_figure(market)
        if quality_chart is None:
            st.info("No spread/depth freshness samples are available.")
        else:
            st.plotly_chart(quality_chart, width="stretch")
        st.subheader("Depth and freshness")
        display_dataframe(market, width="stretch", hide_index=True)
        st.subheader("Indicators")
        display_dataframe(indicators, width="stretch", hide_index=True)
        st.subheader("Latest completed candle snapshot")
        display_dataframe(candles, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Market chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Market data unavailable: {type(error).__name__}")

if diagnostic_section == "AI Analysis":
    try:
        analyses = query(
            """SELECT ar.id::text AS analysis_id, ar.analysis_time, ar.mode,
                      ar.state, ar.valid_until, ar.rejection_reasons,
                      EXISTS (
                        SELECT 1 FROM model_requests mq WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                      ) AS ai_request_recorded
               FROM analysis_runs ar
               JOIN accounts a ON a.id = ar.account_id
               JOIN symbols s ON s.id = ar.symbol_id
               WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
               ORDER BY ar.created_at DESC LIMIT 100""",
            (account_key_hash, account_environment, selected_symbol),
        )
        if not analyses:
            st.info("No analysis runs are available for this account environment and symbol.")
        else:
            labels: dict[str, str] = {}
            analysis_ids: list[str] = []
            for row in analyses:
                analysis_id = str(row["analysis_id"])
                analysis_ids.append(analysis_id)
                analysis_time = row["analysis_time"]
                singapore_time = format_gmt8_timestamp(analysis_time)
                request_label = (
                    "AI REQUEST RECORDED" if row["ai_request_recorded"] else "NO DURABLE AI REQUEST"
                )
                labels[analysis_id] = (
                    f"{singapore_time} · {str(row['mode']).upper()} · "
                    f"{row['state']} · {request_label}"
                )
            default_analysis_index = latest_ai_request_index(analyses)
            selected_analysis_id = st.selectbox(
                "Analysis run",
                analysis_ids,
                index=default_analysis_index,
                format_func=lambda value: labels[str(value)],
                help=(
                    "Defaults to the newest run with a durable external-AI request. Runs without "
                    "one stopped before a request was persisted or failed before a response was "
                    "recorded."
                ),
            )
            detail_rows = query(
                """SELECT ar.id::text AS analysis_id, ar.analysis_time, ar.mode,
                          ar.state, ar.valid_until, ar.eligibility_reasons,
                          ar.rejection_reasons, ar.created_at, ar.updated_at,
                          sv.version AS strategy_version, ar.artifact_policy,
                          cs.server_time AS snapshot_server_time,
                          cs.received_at AS snapshot_received_at,
                          cs.max_skew_ms, cs.complete AS snapshot_complete,
                          ind.generated_at AS analytics_generated_at,
                          ind.acceptable AS analytics_acceptable,
                          ind.rejection_reasons AS analytics_rejection_reasons,
                          ind.features AS analytics_features,
                          mq.request_id, mq.api_style, mq.model,
                          mq.prompt_version, mq.schema_version, mq.payload_mode,
                          mq.payload_sha256, mq.system_prompt,
                          mq.system_prompt_sha256,
                          mq.status AS model_request_status,
                          mq.attempt_count, mq.requested_at, mq.completed_at,
                          mq.duration_ms, mq.payload_redacted,
                          mr.status AS model_response_status, mr.parsed_payload,
                          mr.input_tokens, mr.output_tokens, mr.received_at AS model_received_at,
                          ac.renderer_version AS chart_renderer_version,
                          ac.mime_type AS chart_mime_type,
                          ac.width AS chart_width, ac.height AS chart_height,
                          ac.image_sha256 AS chart_sha256,
                          ac.image_bytes AS chart_image_bytes,
                          ac.storage_kind AS chart_storage_kind,
                          ac.source_metadata AS chart_source_metadata,
                          ac.created_at AS chart_created_at
                   FROM analysis_runs ar
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
                   LEFT JOIN candle_snapshots cs ON cs.id = ar.candle_snapshot_id
                   LEFT JOIN LATERAL (
                     SELECT generated_at, acceptable, rejection_reasons, features
                     FROM indicator_snapshots
                     WHERE candle_snapshot_id = ar.candle_snapshot_id
                     ORDER BY generated_at DESC LIMIT 1
                   ) ind ON true
                   LEFT JOIN LATERAL (
                     SELECT id, request_id, api_style, model, prompt_version,
                            schema_version, payload_mode, payload_sha256,
                            system_prompt, system_prompt_sha256, status,
                            attempt_count, requested_at, completed_at,
                            duration_ms, payload_redacted
                     FROM model_requests WHERE analysis_id = ar.id
                     ORDER BY requested_at DESC LIMIT 1
                   ) mq ON true
                   LEFT JOIN model_responses mr ON mr.model_request_id = mq.id
                   LEFT JOIN analysis_chart_artifacts ac ON ac.analysis_id = ar.id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   LIMIT 1""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            if len(detail_rows) != 1:
                raise DecisionViewError("DECISION_VIEW_ANALYSIS_SCOPE_MISMATCH")
            detail = detail_rows[0]
            chart_view = analysis_chart_view(detail)
            prompt_history = query(
                """SELECT ar.id::text AS analysis_id, ar.analysis_time, ar.mode, ar.state,
                          mq.prompt_version, mq.schema_version, mq.model,
                          mq.status AS request_status, mq.payload_sha256,
                          mr.status AS response_status,
                          CASE
                            WHEN mr.parsed_payload->>'schema_version' IN ('2.0', '2.1')
                              THEN 'OCO_PROPOSAL'
                            ELSE mr.parsed_payload->>'decision'
                          END AS ai_output
                   FROM analysis_runs ar
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   JOIN LATERAL (
                     SELECT * FROM model_requests
                     WHERE analysis_id = ar.id
                     ORDER BY requested_at DESC LIMIT 1
                   ) mq ON true
                   LEFT JOIN model_responses mr ON mr.model_request_id = mq.id
                   WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY ar.created_at DESC LIMIT 100""",
                (account_key_hash, account_environment, selected_symbol),
            )
            automatic_history = query(
                """SELECT ai.interval_start, ai.broker_server_time, ai.claimed_at,
                          ai.completed_at, ai.outcome,
                          COALESCE(ai.analysis_id::text, ai.cycle_id::text) AS cycle_id,
                          ar.state AS analysis_state, ar.rejection_reasons
                   FROM automatic_analysis_intervals ai
                   JOIN accounts a ON a.id = ai.account_id
                   JOIN symbols s ON s.id = ai.symbol_id
                   LEFT JOIN analysis_runs ar ON ar.id = ai.analysis_id
                   WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY ai.interval_start DESC LIMIT 100""",
                (account_key_hash, account_environment, selected_symbol),
            )
            candles = query(
                """SELECT c.timeframe, count(*)::int AS candle_count,
                          bool_and(c.complete) AS completed_only,
                          min(c.start_time) AS first_start_time,
                          max(c.end_time) AS latest_end_time,
                          count(*) FILTER (
                            WHERE c.quality_flags ? 'BROKER_SESSION_GAP_BEFORE'
                          )::int AS session_gap_markers
                   FROM analysis_runs ar
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   JOIN decision_candles c ON c.snapshot_id = ar.candle_snapshot_id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   GROUP BY c.timeframe
                   ORDER BY CASE c.timeframe WHEN 'M1' THEN 1 WHEN 'M5' THEN 2 ELSE 3 END""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            market_snapshots = query(
                """SELECT ob.source_time, ob.received_at, ob.bid, ob.ask, ob.spread,
                          ob.weighted_mid, ob.microprice, ob.imbalance_top5,
                          ob.imbalance_top10, ob.imbalance_top20, ob.age_ms,
                          ob.complete, ob.discontinuity, ob.reconnect_sequence,
                          (ob.id = ar.order_book_snapshot_id) AS active_decision_snapshot,
                          count(obl.id) FILTER (WHERE obl.side = 'BID')::int AS bid_levels,
                          count(obl.id) FILTER (WHERE obl.side = 'ASK')::int AS ask_levels
                   FROM analysis_runs ar
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   JOIN order_book_snapshots ob
                     ON ob.candle_snapshot_id = ar.candle_snapshot_id
                   LEFT JOIN order_book_levels obl ON obl.snapshot_id = ob.id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   GROUP BY ob.id, ar.order_book_snapshot_id
                   ORDER BY ob.source_time""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            validations = query(
                """SELECT vr.validated_at, vr.stage, vr.accepted, vr.reason_codes,
                          vr.details
                   FROM validation_results vr
                   JOIN analysis_runs ar ON ar.id = vr.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY vr.validated_at""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            risk_decisions = query(
                """SELECT rd.decided_at, rd.side, rd.approved, rd.equity,
                          rd.risk_percent, rd.risk_budget, rd.entry_price,
                          rd.stop_loss, rd.stop_distance, rd.raw_volume,
                          rd.normalized_volume, rd.estimated_margin,
                          rd.spread_points, rd.spread_atr_ratio, rd.reason_codes
                   FROM risk_decisions rd
                   JOIN analysis_runs ar ON ar.id = rd.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY rd.decided_at, rd.side""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            orders = query(
                """SELECT og.state AS group_state, og.expires_at AS group_expires_at,
                          og.cancellation_reason, o.side, o.state AS order_state,
                          o.entry_price, o.stop_loss, o.take_profit,
                          o.requested_volume, o.normalized_volume, o.filled_volume,
                          o.expires_at, o.submitted_at, o.updated_at
                   FROM order_groups og
                   JOIN analysis_runs ar ON ar.id = og.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   LEFT JOIN orders o ON o.order_group_id = og.id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY o.side NULLS LAST""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            broker_events = query(
                """SELECT bee.occurred_at, bee.received_at, bee.execution_type,
                          bee.mapping_state, bee.reason_codes, bee.resolved_at
                   FROM broker_execution_events bee
                   JOIN order_groups og ON og.id = bee.order_group_id
                   JOIN analysis_runs ar ON ar.id = og.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY bee.occurred_at, bee.id""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            trade_rows = query(
                """SELECT t.mode, t.direction, t.setup_tags, t.market_regime,
                          t.confidence_bucket, t.realized_pnl, t.fees,
                          t.opened_at, t.closed_at, t.model_version,
                          t.prompt_version, t.schema_version, t.strategy_version
                   FROM trades t
                   JOIN order_groups og ON og.id = t.order_group_id
                   JOIN analysis_runs ar ON ar.id = og.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY t.closed_at DESC LIMIT 2""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )
            trade_outcomes = [trade_outcome_view(row) for row in trade_rows]
            audit_events = query(
                """SELECT ae.id::text AS event_id, ae.occurred_at, ae.severity,
                          ae.service, ae.event_name, ae.outcome, ae.reason_code,
                          ae.request_id, ae.order_group_id, ae.duration_ms,
                          ae.retry_count, ae.details,
                          ob.status AS better_stack_status,
                          ob.attempt_count AS delivery_attempts,
                          ob.next_attempt_at, ob.delivered_at,
                          ob.last_error_code AS delivery_error
                   FROM audit_events ae
                   JOIN analysis_runs ar ON ar.id = ae.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   LEFT JOIN observability_outbox ob ON ob.audit_event_id = ae.id
                   WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                   ORDER BY ae.occurred_at, ae.id LIMIT 300""",
                (selected_analysis_id, account_key_hash, account_environment, selected_symbol),
            )

            parsed_model = detail.get("parsed_payload")
            model_view = None if parsed_model is None else model_output_view(parsed_model)
            model_proposal = (
                "NOT_REACHED" if model_view is None else model_proposal_label(model_view)
            )
            transformed_levels = take_profit_transform_view(validations)
            prompt_view = (
                None
                if detail.get("prompt_version") is None
                else prompt_artifact_view(
                    detail.get("prompt_version"),
                    detail.get("system_prompt"),
                    detail.get("system_prompt_sha256"),
                )
            )
            request_metadata = {
                key: detail.get(key)
                for key in (
                    "request_id",
                    "api_style",
                    "model",
                    "prompt_version",
                    "schema_version",
                    "strategy_version",
                    "payload_mode",
                    "payload_sha256",
                    "system_prompt_sha256",
                    "model_request_status",
                    "attempt_count",
                    "requested_at",
                    "completed_at",
                    "duration_ms",
                    "input_tokens",
                    "output_tokens",
                )
            }
            refresh_reached = any(
                event["event_name"] == "decision_market_refreshed" for event in audit_events
            )
            stage_rows = [
                {
                    "stage": "Completed market snapshot",
                    "status": "RECORDED" if detail.get("snapshot_server_time") else "NOT_REACHED",
                },
                {
                    "stage": "Deterministic analytics",
                    "status": (
                        "NOT_REACHED"
                        if detail.get("analytics_generated_at") is None
                        else "ACCEPTED"
                        if detail.get("analytics_acceptable") is True
                        else "REJECTED"
                    ),
                },
                {"stage": "AI model response", "status": model_proposal},
                {
                    "stage": "Post-model market refresh",
                    "status": "RECORDED" if refresh_reached else "NOT_REACHED",
                },
                {"stage": "Local validation", "status": stage_state(validations)},
                {"stage": "Deterministic risk sizing", "status": stage_state(risk_decisions)},
                {
                    "stage": "Broker order lifecycle",
                    "status": (
                        "RECORDED" if orders or broker_events or trade_outcomes else "NOT_REACHED"
                    ),
                },
            ]

            st.caption(
                f"Analysis ID: {detail['analysis_id']} · PostgreSQL is authoritative; "
                "Better Stack is the correlated delivery mirror."
            )
            st.subheader("Exact messages sent to the external AI")
            if prompt_view is None or detail.get("payload_redacted") is None:
                st.info(
                    "This selected run has no durable AI request record. Select a run labelled "
                    "AI REQUEST RECORDED to inspect its exact persisted messages."
                )
            else:
                st.success(
                    "This is the hash-verified system message and persisted redacted user message "
                    "for the selected external-AI request. Private endpoint URLs, authorization "
                    "headers, and credentials are never stored or displayed."
                )
                st.json(request_metadata)
                with st.expander("System message (exact)", expanded=True):
                    st.code(prompt_view["content"], language="text")
                    st.json({key: value for key, value in prompt_view.items() if key != "content"})
                with st.expander("User message (exact persisted redacted JSON)", expanded=True):
                    st.json(exact_model_input_view(detail["payload_redacted"]))
                    st.caption(
                        "PostgreSQL JSONB may normalize object-key order; values and arrays are "
                        "the persisted redacted user message."
                    )
            st.subheader("Recorded market context")
            if chart_view is None and detail.get("artifact_policy") == "numeric-v1":
                st.caption(
                    "This analysis used numerical market data. "
                    "Charts below are regenerated for display."
                )
                chart_key = f"recorded_chart_{selected_analysis_id}"
                if st.button("Show recorded candles", key=chart_key):
                    recorded = frame(
                        """SELECT c.timeframe,c.start_time,c.open,c.high,c.low,c.close,
                        c.volume,c.complete FROM decision_candles c
                        JOIN analysis_runs ar ON ar.candle_snapshot_id=c.snapshot_id
                        JOIN accounts a ON a.id=ar.account_id JOIN symbols s ON s.id=ar.symbol_id
                        WHERE ar.id=%s AND a.provider_account_key_hash=%s
                        AND a.environment=%s AND s.name=%s
                        ORDER BY c.timeframe,c.start_time LIMIT 1800""",
                        (
                            selected_analysis_id,
                            account_key_hash,
                            account_environment,
                            selected_symbol,
                        ),
                    )
                    for timeframe in ("M1", "M5", "M15"):
                        series = (
                            recorded[recorded["timeframe"] == timeframe]
                            if not recorded.empty
                            else recorded
                        )
                        figure = completed_candles_figure(series, timeframe)
                        if figure is not None:
                            st.plotly_chart(figure, width="stretch")
                        else:
                            st.info(f"{timeframe} recorded candles are unavailable.")
            elif chart_view is None:
                st.info("No durable chart artifact exists for this analysis run.")
            else:
                st.image(
                    chart_view["image_bytes"],
                    caption=(
                        "Hash-verified deterministic M15/M5/M1 completed-candle chart with "
                        "fast EMA, slow EMA, and ATR."
                    ),
                    width="stretch",
                )
                st.json({key: value for key, value in chart_view.items() if key != "image_bytes"})
            st.subheader("Prompt and response history")
            display_dataframe(pd.DataFrame(prompt_history), width="stretch", hide_index=True)
            st.subheader("Automatic broker-minute cycle history")
            display_dataframe(pd.DataFrame(automatic_history), width="stretch", hide_index=True)
            summary_columns = st.columns(4)
            summary_columns[0].metric("Run state", str(detail["state"]))
            summary_columns[1].metric("AI output", model_proposal)
            summary_columns[2].metric("Validation", stage_state(validations))
            summary_columns[3].metric(
                "Broker outcome",
                "RECORDED" if orders or broker_events or trade_outcomes else "NOT_REACHED",
            )
            if detail.get("rejection_reasons"):
                st.error(
                    "Run rejection reasons: "
                    + ", ".join(str(reason) for reason in detail["rejection_reasons"])
                )
            st.subheader("Decision pipeline")
            display_dataframe(pd.DataFrame(stage_rows), width="stretch", hide_index=True)

            inspector_tabs = st.tabs(
                ["AI output", "Input & analytics", "Risk & execution", "Audit log"]
            )
            with inspector_tabs[0]:
                st.warning(model_output_authority_notice(model_view))
                if model_view is None:
                    st.info("AI was not reached for this run; no model response exists.")
                else:
                    model_columns = st.columns(3)
                    model_columns[0].metric("Proposal", model_proposal)
                    model_columns[1].metric(
                        "Market regime", str(model_view.get("market_regime", "unknown"))
                    )
                    quality = model_view.get("data_quality")
                    quality_acceptable = (
                        quality.get("acceptable") if isinstance(quality, dict) else None
                    )
                    model_columns[2].metric(
                        "AI diagnostics",
                        (
                            "LEGACY ACCEPTABLE"
                            if quality_acceptable is True
                            else "LEGACY SELF-VETO"
                            if quality_acceptable is False
                            else "WARNINGS ONLY"
                        ),
                    )
                    st.subheader("Exact parsed and schema-validated AI response")
                    st.json(model_view)
                    st.subheader("AI proposal → effective OCO levels")
                    if transformed_levels:
                        display_dataframe(
                            pd.DataFrame(transformed_levels),
                            width="stretch",
                            hide_index=True,
                        )
                        st.caption(
                            "Entry is unchanged. The effective take profit is the smallest whole "
                            "broker-pip move whose estimated gross profit exceeds opening plus "
                            "closing commission at the displayed basis volume. The effective stop "
                            "loss is exactly twice that take-profit distance (reward:risk 1:2). "
                            "The AI target and stop remain the outer technical envelope. The "
                            "displayed gross, fee, and expected-net amounts are estimates; final "
                            "sized commands are checked again before broker submission."
                        )
                    else:
                        st.info(
                            "The SL/TP transform was not reached for this run, so no effective "
                            "broker levels exist."
                        )
                st.caption(
                    "Raw provider text is intentionally not displayed. The parsed object above "
                    "is the exact locally validated JSON used by semantic validation."
                )
                st.caption(
                    "Schemas 2.0 and 2.1 have no NO_TRADE result or enabled/disabled leg "
                    "switch. Older "
                    "schema 1.0 records remain visible as historical evidence."
                )

            with inspector_tabs[1]:
                st.subheader("Model request identity and immutable input hash")
                st.json(request_metadata)
                st.subheader("System prompt sent to the model")
                if prompt_view is None:
                    st.info("System prompt was not reached for this run.")
                else:
                    st.json({key: value for key, value in prompt_view.items() if key != "content"})
                    st.code(prompt_view["content"], language="text")
                    if prompt_view["provenance"] == "TRACKED_LEGACY_ARTIFACT":
                        st.warning(
                            "This legacy request predates per-request prompt persistence. The "
                            "displayed text is the tracked artifact for its recorded version."
                        )
                if detail.get("payload_redacted") is None:
                    st.info("Model input was not reached for this run.")
                else:
                    st.subheader("Redacted AI input summary")
                    st.json(model_input_summary(detail["payload_redacted"]))
                    st.caption(
                        "Full candle arrays are summarized by count and boundary samples. View "
                        "the Market tab for completed-candle charts; the request hash above "
                        "identifies the exact persisted redacted payload."
                    )
                    st.caption(
                        "The exact redacted user JSON is displayed in the prominent external-AI "
                        "request section above."
                    )
                st.subheader("Deterministic analytics supplied to the decision path")
                if detail.get("analytics_features") is None:
                    st.info("Analytics was not reached for this run.")
                else:
                    st.json(analytics_summary(detail["analytics_features"]))
                st.subheader("Completed-candle coverage")
                display_dataframe(pd.DataFrame(candles), width="stretch", hide_index=True)
                st.subheader("Initial and refreshed quote/depth snapshots")
                display_dataframe(pd.DataFrame(market_snapshots), width="stretch", hide_index=True)

            with inspector_tabs[2]:
                st.subheader("Local validation results")
                if validations:
                    display_dataframe(pd.DataFrame(validations), width="stretch", hide_index=True)
                else:
                    st.info("Validation was not reached for this run.")
                st.subheader("Deterministic risk decisions")
                if risk_decisions:
                    display_dataframe(
                        pd.DataFrame(risk_decisions), width="stretch", hide_index=True
                    )
                else:
                    st.info("Risk sizing was not reached; no broker volume was calculated.")
                st.subheader("Order group and strategy-owned orders")
                if orders:
                    display_dataframe(pd.DataFrame(orders), width="stretch", hide_index=True)
                else:
                    st.info("No order intent or broker order exists for this analysis.")
                st.subheader("cTrader execution-event mapping")
                if broker_events:
                    display_dataframe(pd.DataFrame(broker_events), width="stretch", hide_index=True)
                else:
                    st.info("No cTrader execution callback exists for this analysis.")
                st.subheader("Closed demo trade outcome")
                if trade_outcomes:
                    st.json(trade_outcomes[0])
                    st.caption(
                        "Realized P/L equals broker gross profit plus signed swap, commission, "
                        "and P/L conversion fee. PostgreSQL retains the versioned outcome."
                    )
                else:
                    st.info("No fully closed demo trade exists for this analysis.")

            with inspector_tabs[3]:
                st.subheader("Chronological PostgreSQL decision trail")
                st.caption(
                    "Use event_id or request_id to find the same event in Better Stack Live Tail."
                )
                safe_events = []
                event_details: dict[str, Any] = {}
                for event in audit_events:
                    safe_event = dict(event)
                    event_id = str(safe_event["event_id"])
                    event_details[event_id] = safe_audit_detail(safe_event.pop("details"))
                    safe_events.append(safe_event)
                if safe_events:
                    display_dataframe(pd.DataFrame(safe_events), width="stretch", hide_index=True)
                    event_labels = {
                        str(event["event_id"]): (
                            f"{format_gmt8_timestamp(event['occurred_at'])} · "
                            f"{event['event_name']} · {event['outcome']}"
                        )
                        for event in safe_events
                    }
                    selected_event_id = st.selectbox(
                        "Audit event details",
                        list(event_details),
                        format_func=lambda event_id: event_labels[str(event_id)],
                    )
                    st.json(event_details[str(selected_event_id)])
                else:
                    st.info("No audit events exist for this analysis.")
    except DecisionViewError as error:
        st.error(f"Decision inspector rejected unsafe persisted data: {error}")
    except Exception as error:
        st.error(f"AI analysis unavailable: {type(error).__name__}")

if diagnostic_section == "Analysis History":
    st.subheader("Demo collection funnel and history")
    st.caption(
        "Attempts, completed external-AI responses, order groups, expiries, and closed trades are "
        "counted separately. A rejected analysis or expired stop is not a loss; WIN/LOSS is "
        "assigned only after PostgreSQL contains a durable closed demo trade."
    )
    try:
        if execution_status_error is not None:
            raise ExecutionStatusTemporarilyUnavailable
        campaign = status.get("automaticAnalysisCampaign")
        campaign_counts = campaign_history_counts(campaign)
        completed_count = campaign_counts["completed"]
        campaign_limit = campaign.get("limit") if isinstance(campaign, dict) else None
        campaign_baseline = campaign_counts["baseline"]
        release_completed = campaign_counts["releaseCompleted"]
        trade_campaign = status.get("automaticDemoTradeCampaign")
        if isinstance(trade_campaign, dict) and trade_campaign.get("enabled") is True:
            target_columns = st.columns(4)
            target_columns[0].metric(
                "Closed-trade target", str(trade_campaign.get("limit", "unknown"))
            )
            target_columns[1].metric(
                "Closed trades", str(trade_campaign.get("closedTrades", "unavailable"))
            )
            target_columns[2].metric(
                "Trades remaining", str(trade_campaign.get("remaining", "unavailable"))
            )
            target_columns[3].metric(
                "Target state",
                "COMPLETE" if trade_campaign.get("complete") is True else "COLLECTING",
            )
        attempt_rows = query(
            """WITH target_symbol AS (
                 SELECT s.id
                 FROM symbols s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               ), current_strategy AS (
                 SELECT sv.id, sv.created_at
                 FROM strategy_versions sv
                 ORDER BY sv.created_at DESC, sv.id DESC
                 LIMIT 1
               ), baseline_rows AS (
                 SELECT ar.id, ar.created_at
                 FROM analysis_runs ar
                 WHERE ar.symbol_id = (SELECT id FROM target_symbol)
                   AND ar.strategy_version_id <> (SELECT id FROM current_strategy)
                   AND EXISTS (
                     SELECT 1
                     FROM model_requests mq
                     JOIN model_responses mr ON mr.model_request_id = mq.id
                     WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                       AND mq.status = 'COMPLETED'
                       AND mr.status = 'COMPLETED'
                   )
                 ORDER BY ar.created_at DESC
                 LIMIT %s
               ), campaign_start AS (
                 SELECT COALESCE(
                   (SELECT min(created_at) FROM baseline_rows),
                   (SELECT created_at FROM current_strategy)
                 ) AS created_at
               )
               SELECT ar.id::text AS analysis_id,
                      ar.analysis_time,
                      ar.state AS analysis_state,
                      ar.rejection_reasons,
                      EXISTS (
                        SELECT 1 FROM model_requests mq WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                      ) AS model_request_present,
                      EXISTS (
                        SELECT 1
                        FROM model_requests mq
                        JOIN model_responses mr ON mr.model_request_id = mq.id
                        WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                          AND mq.status = 'COMPLETED'
                          AND mr.status = 'COMPLETED'
                      ) AS model_completed,
                      model.ai_pipeline_latency_ms,
                      og.state AS group_state,
                      COALESCE(position.position_count, 0)::int AS position_count,
                      COALESCE(trade.trade_count, 0)::int AS trade_count,
                      COALESCE(trade.win_count, 0)::int AS trade_win_count,
                      COALESCE(trade.loss_count, 0)::int AS trade_loss_count,
                      COALESCE(trade.break_even_count, 0)::int AS trade_break_even_count,
                      COALESCE(trade.long_count, 0)::int AS trade_long_count,
                      COALESCE(trade.short_count, 0)::int AS trade_short_count,
                      trade.realized_pnl::text AS realized_pnl,
                      trade.fees::text AS fees
               FROM analysis_runs ar
               LEFT JOIN LATERAL (
                 SELECT round(
                          extract(epoch FROM (mr.received_at - ar.created_at)) * 1000
                        )::bigint AS ai_pipeline_latency_ms
                 FROM model_requests mq
                 JOIN model_responses mr ON mr.model_request_id = mq.id
                 WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                   AND mq.status = 'COMPLETED'
                   AND mr.status = 'COMPLETED'
                 ORDER BY mr.received_at DESC
                 LIMIT 1
               ) model ON true
               LEFT JOIN order_groups og ON og.analysis_id = ar.id
               LEFT JOIN LATERAL (
                 SELECT count(*)::int AS position_count
                 FROM positions p
                 WHERE p.order_group_id = og.id AND p.strategy_owned = true
               ) position ON true
               LEFT JOIN LATERAL (
                 SELECT count(*)::int AS trade_count,
                        count(*) FILTER (WHERE t.realized_pnl > 0)::int AS win_count,
                        count(*) FILTER (WHERE t.realized_pnl < 0)::int AS loss_count,
                        count(*) FILTER (WHERE t.realized_pnl = 0)::int AS break_even_count,
                        count(*) FILTER (WHERE t.direction = 'LONG')::int AS long_count,
                        count(*) FILTER (WHERE t.direction = 'SHORT')::int AS short_count,
                        sum(t.realized_pnl) AS realized_pnl,
                        sum(t.fees) AS fees
                 FROM trades t
                 WHERE t.order_group_id = og.id
               ) trade ON true
               WHERE ar.symbol_id = (SELECT id FROM target_symbol)
                 AND ar.created_at >= (SELECT created_at FROM campaign_start)
               ORDER BY ar.created_at, ar.id
               LIMIT 2001""",
            (
                account_key_hash,
                account_environment,
                selected_symbol,
                campaign_baseline,
            ),
        )
        attempt_funnel = analysis_attempt_funnel_view(attempt_rows)
        attempt_summary = attempt_funnel["summary"]
        st.subheader("Every analysis attempt, explained")
        st.caption(
            "This includes retries that ended before a completed AI response. Raw PostgreSQL "
            "state is preserved; Primary category names the furthest verified lifecycle stage "
            "so REJECTED no longer hides whether data, AI, validation, or execution stopped it."
        )
        attempt_metrics = st.columns(6)
        attempt_metrics[0].metric("Scheduler attempts", attempt_summary["analysis_attempts"])
        attempt_metrics[1].metric(
            "Completed AI responses", attempt_summary["completed_ai_responses"]
        )
        attempt_metrics[2].metric(
            "Ended before AI completed", attempt_summary["ended_before_completed_ai"]
        )
        attempt_metrics[3].metric("Order groups", attempt_summary["order_groups"])
        attempt_metrics[4].metric("Closed demo trades", attempt_summary["trades"])
        attempt_metrics[5].metric("Terminal realized demo P/L", attempt_summary["realized_pnl"])
        attempt_reason_metrics = st.columns(6)
        attempt_reason_metrics[0].metric("Context expired", attempt_summary["context_expired"])
        attempt_reason_metrics[1].metric(
            "AI proposal invalid", attempt_summary["ai_proposal_invalid"]
        )
        attempt_reason_metrics[2].metric(
            "Dependency failures", attempt_summary["dependency_failures"]
        )
        attempt_reason_metrics[3].metric("Spread skips", attempt_summary["spread_skips"])
        attempt_reason_metrics[4].metric("Setups expired", attempt_summary["expired_setups"])
        attempt_reason_metrics[5].metric(
            "Closed W / L / BE",
            f"{attempt_summary['wins']} / {attempt_summary['losses']} / "
            f"{attempt_summary['break_even']}",
        )
        attempt_evidence_metrics = st.columns(5)
        attempt_evidence_metrics[0].metric("Closed LONG trades", attempt_summary["long_trades"])
        attempt_evidence_metrics[1].metric("Closed SHORT trades", attempt_summary["short_trades"])
        attempt_evidence_metrics[2].metric(
            "Median analysis-to-response",
            f"{attempt_summary['median_ai_pipeline_seconds']} s",
        )
        attempt_evidence_metrics[3].metric(
            "P90 analysis-to-response", f"{attempt_summary['p90_ai_pipeline_seconds']} s"
        )
        attempt_evidence_metrics[4].metric(
            "Maximum analysis-to-response",
            f"{attempt_summary['max_ai_pipeline_seconds']} s",
        )
        st.metric(
            "Placed setup → closed trade conversion",
            f"{attempt_summary['trade_conversion_percent']}%",
            help=(
                "A transport/cadence measure, not profitability: durable closed trades divided "
                "by placed OCO groups in this displayed collection window."
            ),
        )
        display_dataframe(
            pd.DataFrame(attempt_funnel["category_counts"]),
            width="stretch",
            hide_index=True,
        )
        with st.expander("Show every attempt and its exact durable reason"):
            display_dataframe(
                pd.DataFrame(attempt_funnel["rows"]),
                width="stretch",
                hide_index=True,
            )

        st.subheader("Counted completed-AI ledger")
        history_rows = (
            []
            if completed_count == 0
            else query(
                """WITH target_symbol AS (
                     SELECT s.id
                     FROM symbols s
                     JOIN accounts a ON a.id = s.account_id
                     WHERE a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                     ORDER BY s.metadata_at DESC LIMIT 1
                   ), current_strategy AS (
                     SELECT sv.id
                     FROM strategy_versions sv
                     ORDER BY sv.created_at DESC, sv.id DESC
                     LIMIT 1
                   ), release_rows AS (
                     SELECT ar.id, ar.created_at
                     FROM analysis_runs ar
                     WHERE ar.symbol_id = (SELECT id FROM target_symbol)
                       AND ar.strategy_version_id = (SELECT id FROM current_strategy)
                       AND EXISTS (
                         SELECT 1
                         FROM model_requests mq
                         JOIN model_responses mr ON mr.model_request_id = mq.id
                         WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                           AND mq.status = 'COMPLETED'
                           AND mr.status = 'COMPLETED'
                       )
                     ORDER BY ar.created_at DESC
                     LIMIT %s
                   ), baseline_rows AS (
                     SELECT ar.id, ar.created_at
                     FROM analysis_runs ar
                     WHERE ar.symbol_id = (SELECT id FROM target_symbol)
                       AND ar.strategy_version_id <> (SELECT id FROM current_strategy)
                       AND EXISTS (
                         SELECT 1
                         FROM model_requests mq
                         JOIN model_responses mr ON mr.model_request_id = mq.id
                         WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                           AND mq.status = 'COMPLETED'
                           AND mr.status = 'COMPLETED'
                       )
                     ORDER BY ar.created_at DESC
                     LIMIT %s
                   ), recent AS (
                     SELECT id, created_at FROM release_rows
                     UNION ALL
                     SELECT id, created_at FROM baseline_rows
                   )
                   SELECT ar.id::text AS analysis_id, ar.analysis_time,
                          ar.mode, ar.state AS analysis_state, ar.valid_until,
                          ar.rejection_reasons, ar.created_at, ar.updated_at,
                          sv.version AS strategy_version,
                          model.request_id, model.model, model.prompt_version,
                          model.schema_version, model.payload_mode,
                          model.payload_sha256, model.system_prompt,
                          model.system_prompt_sha256, model.payload_redacted,
                          model.model_request_status, model.model_response_status,
                          model.parsed_payload, model.requested_at,
                          model.completed_at, model.model_received_at,
                          transform.effective_buy_entry,
                          transform.effective_buy_stop_loss,
                          transform.effective_buy_take_profit,
                          transform.effective_sell_entry,
                          transform.effective_sell_stop_loss,
                          transform.effective_sell_take_profit,
                          og.state AS group_state,
                          og.expires_at AS group_expires_at,
                          og.cancellation_reason,
                          buy.state AS buy_order_state,
                          buy.entry_price::text AS buy_order_entry,
                          buy.stop_loss::text AS buy_order_stop_loss,
                          buy.take_profit::text AS buy_order_take_profit,
                          sell.state AS sell_order_state,
                          sell.entry_price::text AS sell_order_entry,
                          sell.stop_loss::text AS sell_order_stop_loss,
                          sell.take_profit::text AS sell_order_take_profit,
                          COALESCE(position.position_count, 0)::int AS position_count,
                          position.side AS position_side,
                          position.state AS position_state,
                          position.opened_at AS position_opened_at,
                          position.closed_at AS position_closed_at,
                          COALESCE(trade.trade_count, 0)::int AS trade_count,
                          trade.direction AS trade_direction,
                          trade.realized_pnl::text AS realized_pnl,
                          trade.fees::text AS fees,
                          trade.opened_at AS trade_opened_at,
                          trade.closed_at AS trade_closed_at
                   FROM recent
                   JOIN analysis_runs ar ON ar.id = recent.id
                   JOIN strategy_versions sv ON sv.id = ar.strategy_version_id
                   JOIN LATERAL (
                     SELECT mq.request_id, mq.model, mq.prompt_version,
                            mq.schema_version, mq.payload_mode, mq.payload_sha256,
                            mq.system_prompt, mq.system_prompt_sha256,
                            mq.payload_redacted, mq.status AS model_request_status,
                            mr.status AS model_response_status, mr.parsed_payload,
                            mq.requested_at, mq.completed_at,
                            mr.received_at AS model_received_at
                     FROM model_requests mq
                     JOIN model_responses mr ON mr.model_request_id = mq.id
                     WHERE mq.analysis_id = ar.id
                          AND COALESCE(to_jsonb(mq)->>'decision_source','PROVIDER')='PROVIDER'
                       AND mq.status = 'COMPLETED' AND mr.status = 'COMPLETED'
                     ORDER BY mq.requested_at DESC LIMIT 1
                   ) model ON true
                   LEFT JOIN LATERAL (
                     SELECT vr.details->'proposal_transform'->'buy'->>'entry_price'
                              AS effective_buy_entry,
                            COALESCE(
                              vr.details->'proposal_transform'->'buy'->>'effective_stop_loss',
                              vr.details->'proposal_transform'->'buy'->>'stop_loss'
                            )
                              AS effective_buy_stop_loss,
                            vr.details->'proposal_transform'->'buy'->>'effective_take_profit'
                              AS effective_buy_take_profit,
                            vr.details->'proposal_transform'->'sell'->>'entry_price'
                              AS effective_sell_entry,
                            COALESCE(
                              vr.details->'proposal_transform'->'sell'->>'effective_stop_loss',
                              vr.details->'proposal_transform'->'sell'->>'stop_loss'
                            )
                              AS effective_sell_stop_loss,
                            vr.details->'proposal_transform'->'sell'->>'effective_take_profit'
                              AS effective_sell_take_profit
                     FROM validation_results vr
                     WHERE vr.analysis_id = ar.id
                       AND vr.details->>'validation_scope' = 'TAKE_PROFIT_TRANSFORM'
                     ORDER BY vr.validated_at DESC LIMIT 1
                   ) transform ON true
                   LEFT JOIN order_groups og ON og.analysis_id = ar.id
                   LEFT JOIN orders buy
                     ON buy.order_group_id = og.id AND buy.side = 'BUY'
                    AND buy.strategy_owned = true
                   LEFT JOIN orders sell
                     ON sell.order_group_id = og.id AND sell.side = 'SELL'
                    AND sell.strategy_owned = true
                   LEFT JOIN LATERAL (
                     SELECT count(*)::int AS position_count,
                            CASE WHEN count(DISTINCT p.side) = 1 THEN min(p.side)
                                 WHEN count(*) > 1 THEN 'BOTH' END AS side,
                            CASE WHEN bool_or(p.state IN ('OPEN','CLOSING')) THEN 'OPEN'
                                 WHEN bool_or(p.state IN
                                   ('UNKNOWN','RECONCILIATION_PENDING'))
                                   THEN 'RECONCILIATION_PENDING'
                                 WHEN bool_and(p.state = 'CLOSED') THEN 'CLOSED'
                            END AS state,
                            min(p.opened_at) AS opened_at,
                            max(p.closed_at) AS closed_at
                     FROM positions p
                     WHERE p.order_group_id = og.id AND p.strategy_owned = true
                   ) position ON true
                   LEFT JOIN LATERAL (
                     SELECT count(*)::int AS trade_count,
                            CASE WHEN count(DISTINCT t.direction) = 1
                                   THEN min(t.direction)
                                 WHEN count(*) > 1 THEN 'BOTH' END AS direction,
                            sum(t.realized_pnl) AS realized_pnl,
                            sum(t.fees) AS fees,
                            min(t.opened_at) AS opened_at,
                            max(t.closed_at) AS closed_at
                     FROM trades t
                     WHERE t.order_group_id = og.id
                   ) trade ON true
                   ORDER BY recent.created_at""",
                (
                    account_key_hash,
                    account_environment,
                    selected_symbol,
                    release_completed + 1,
                    campaign_baseline,
                ),
            )
        )
        history = analysis_history_view(history_rows, completed_count)
        summary = history["summary"]
        if completed_count == 0:
            st.info("No completed external-AI response exists for this release yet.")
        else:
            summary_columns = st.columns(5)
            summary_columns[0].metric(
                "Completed AI responses / limit",
                f"{summary['completed_ai_analyses']} / {campaign_limit or 'unbounded'}",
            )
            summary_columns[1].metric("Order groups created", summary["orders_created"])
            summary_columns[2].metric("Pending stop setups", summary["pending_stops"])
            summary_columns[3].metric("Expired without trade", summary["expired_without_trade"])
            summary_columns[4].metric("Open trades", summary["open_trades"])
            result_columns = st.columns(6)
            result_columns[0].metric("Closed wins after fees", summary["wins"])
            result_columns[1].metric("Closed losses", summary["losses"])
            result_columns[2].metric("Break-even", summary["break_even"])
            result_columns[3].metric(
                "Terminal realized demo P/L",
                summary["realized_pnl"],
                help="Signed cTrader result already includes terminal fees.",
            )
            result_columns[4].metric("Terminal fees", summary["fees"])
            result_columns[5].metric(
                "Gross gains erased by fees",
                summary["gross_profit_erased_by_fees"],
                help=(
                    "The price move was positive, but the final broker result was not "
                    "profitable after fees."
                ),
            )
            st.caption(
                "Rejected means no broker order was placed. These categories separate "
                "slow/stale context and temporary dependencies from model-level output."
            )
            rejection_columns = st.columns(4)
            rejection_columns[0].metric("Context invalidated", summary["context_invalidated"])
            rejection_columns[1].metric(
                "Temporary dependency failures", summary["dependency_failures"]
            )
            rejection_columns[2].metric("Spread safety skips", summary["spread_skips"])
            rejection_columns[3].metric("Other proposal rejections", summary["other_rejections"])

            history_frame = pd.DataFrame(history["rows"])
            outcome_columns = [
                "analysis_number",
                "analysis_time",
                "result",
                "triggered_side",
                "analysis_state",
                "reasons",
                "order_expires_at",
                "gross_pnl",
                "fees",
                "realized_pnl",
                "fee_coverage",
                "trade_closed_at",
                "evidence_status",
            ]
            level_columns = [
                "analysis_number",
                "level_source",
                "ai_buy_entry",
                "ai_buy_sl",
                "ai_buy_tp",
                "execution_buy_entry",
                "execution_buy_sl",
                "execution_buy_tp",
                "ai_sell_entry",
                "ai_sell_sl",
                "ai_sell_tp",
                "execution_sell_entry",
                "execution_sell_sl",
                "execution_sell_tp",
            ]
            st.subheader("Outcome ledger")
            display_dataframe(history_frame[outcome_columns], width="stretch", hide_index=True)
            st.subheader("AI proposal versus effective/placed levels")
            display_dataframe(history_frame[level_columns], width="stretch", hide_index=True)
            st.caption(
                "EFFECTIVE LEVELS — NOT PLACED means the commission-aware exit policy was "
                "recorded but no broker order group was created. PLACED ORDER LEVELS are the "
                "exact durable order intents and their current broker lifecycle state is shown "
                "above."
            )

            history_labels: dict[int, str] = {
                int(row["analysis_number"]): (
                    f"#{row['analysis_number']} · "
                    f"{format_gmt8_timestamp(row['analysis_time'])} · {row['result']}"
                )
                for row in history["rows"]
            }
            selected_number = st.selectbox(
                "Analysis details",
                list(history_labels),
                index=len(history_labels) - 1,
                format_func=lambda value: history_labels[int(value)],
            )
            selected_index = int(selected_number) - 1
            selected_view = history["rows"][selected_index]
            selected = history_rows[selected_index]
            detail_columns = st.columns(4)
            detail_columns[0].metric("Result", selected_view["result"])
            detail_columns[1].metric("Triggered side", selected_view["triggered_side"])
            detail_columns[2].metric("Level source", selected_view["level_source"])
            detail_columns[3].metric("Evidence", selected_view["evidence_status"])
            st.write(f"Reason/status: {selected_view['reasons']}")

            selected_levels = pd.DataFrame(
                [
                    {
                        "side": side.upper(),
                        "ai_entry": selected_view[f"ai_{side}_entry"],
                        "ai_stop_loss": selected_view[f"ai_{side}_sl"],
                        "ai_take_profit": selected_view[f"ai_{side}_tp"],
                        "effective_or_placed_entry": selected_view[f"execution_{side}_entry"],
                        "effective_or_placed_stop_loss": selected_view[f"execution_{side}_sl"],
                        "effective_or_placed_take_profit": selected_view[f"execution_{side}_tp"],
                    }
                    for side in ("buy", "sell")
                ]
            )
            display_dataframe(selected_levels, width="stretch", hide_index=True)

            if selected_view["evidence_status"] == "CERTAIN":
                with st.expander("Exact prompt, user JSON, and AI response"):
                    prompt = prompt_artifact_view(
                        selected.get("prompt_version"),
                        selected.get("system_prompt"),
                        selected.get("system_prompt_sha256"),
                    )
                    st.code(prompt["content"], language="text")
                    st.json({key: value for key, value in prompt.items() if key != "content"})
                    st.subheader("Persisted redacted user message")
                    st.json(exact_model_input_view(selected.get("payload_redacted")))
                    st.subheader("Parsed and schema-validated AI response")
                    st.json(model_output_view(selected.get("parsed_payload")))
                with st.expander("Validation and broker execution evidence"):
                    validation_history = frame(
                        """SELECT vr.validated_at, vr.stage, vr.accepted,
                                  vr.reason_codes
                           FROM validation_results vr
                           JOIN analysis_runs ar ON ar.id = vr.analysis_id
                           JOIN symbols s ON s.id = ar.symbol_id
                           JOIN accounts a ON a.id = ar.account_id
                           WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                           ORDER BY vr.validated_at""",
                        (
                            selected["analysis_id"],
                            account_key_hash,
                            account_environment,
                            selected_symbol,
                        ),
                    )
                    execution_history = frame(
                        """SELECT bee.occurred_at, bee.received_at,
                                  bee.execution_type, bee.mapping_state,
                                  bee.reason_codes, bee.resolved_at
                           FROM broker_execution_events bee
                           JOIN order_groups og ON og.id = bee.order_group_id
                           JOIN analysis_runs ar ON ar.id = og.analysis_id
                           JOIN symbols s ON s.id = ar.symbol_id
                           JOIN accounts a ON a.id = ar.account_id
                           WHERE ar.id = %s AND a.provider_account_key_hash = %s
                   AND a.environment = %s AND s.name = %s
                           ORDER BY bee.occurred_at""",
                        (
                            selected["analysis_id"],
                            account_key_hash,
                            account_environment,
                            selected_symbol,
                        ),
                    )
                    st.subheader("Validation")
                    display_dataframe(validation_history, width="stretch", hide_index=True)
                    st.subheader("Broker execution journal")
                    display_dataframe(execution_history, width="stretch", hide_index=True)
            else:
                st.warning(
                    "Selected history evidence is malformed or ambiguous. Exact detail is "
                    "withheld instead of presenting a guessed lifecycle."
                )
    except ExecutionStatusTemporarilyUnavailable:
        st.info(
            "Analysis history is retained in PostgreSQL and will reload automatically when "
            "the execution service reconnects."
        )
    except DecisionViewError as error:
        st.error(f"Analysis history rejected unsafe or ambiguous evidence: {error}")
    except Exception as error:
        st.error(f"Analysis history unavailable: {type(error).__name__}")

if diagnostic_section == "Operations":
    try:
        health = frame(
            """SELECT service, instance_id, state, dependency_status, reason_codes,
                      heartbeat_at, started_at FROM service_health ORDER BY service, instance_id"""
        )
        events = frame(
            """SELECT occurred_at, severity, trading_mode, service, event_name,
                      outcome, reason_code,
                      duration_ms, retry_count FROM audit_events
               WHERE trading_mode = %s AND (symbol = %s OR symbol IS NULL)
               ORDER BY occurred_at DESC LIMIT 500""",
            (mode.lower(), selected_symbol),
        )
        st.subheader("Service health")
        display_dataframe(health, width="stretch", hide_index=True)
        st.subheader("Recent operational events")
        audit_chart = audit_events_figure(events)
        if audit_chart is None:
            st.info("No operational audit events are available.")
        else:
            st.plotly_chart(audit_chart, width="stretch")
        display_dataframe(events, width="stretch", hide_index=True)
        delivery = frame(
            """SELECT o.status, count(*) AS events,
                      max(o.attempt_count) AS maximum_attempts,
                      min(o.next_attempt_at) FILTER
                        (WHERE o.status IN ('PENDING', 'RETRY', 'DELIVERING')) AS next_attempt_at,
                      max(o.delivered_at) AS latest_delivery
               FROM observability_outbox o
               GROUP BY o.status ORDER BY o.status"""
        )
        recent_delivery = frame(
            """SELECT o.created_at, o.status, o.attempt_count, o.next_attempt_at,
                      o.delivered_at, o.last_error_code, e.analysis_id,
                      e.event_name, e.outcome, e.reason_code
               FROM observability_outbox o
               JOIN audit_events e ON e.id = o.audit_event_id
               ORDER BY o.created_at DESC LIMIT 500"""
        )
        st.subheader("Better Stack decision-trail delivery")
        if delivery.empty:
            st.info("No post-migration audit events have entered the delivery outbox.")
        else:
            display_dataframe(delivery, width="stretch", hide_index=True)
        display_dataframe(recent_delivery, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Operations chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Operations unavailable: {type(error).__name__}")

if diagnostic_section == "Server":
    st.subheader("Local storage and database recovery")
    local_health = local_storage_status(Path(__file__).resolve().parents[2] / ".runtime")
    st.json(local_health)
    st.caption(
        "Local observations remain readable during a database outage. "
        "Stale or unavailable values do not confirm current health."
    )
    try:
        metrics = frame(
            """SELECT captured_at, cpu_percent, load_1, load_5, load_15,
                      memory_used_bytes, memory_available_bytes, swap_used_bytes,
                      disk_used_bytes, disk_available_bytes, network_in_bytes, network_out_bytes,
                      process_cpu_percent, process_memory_bytes
               FROM server_metrics ORDER BY captured_at DESC LIMIT 1000"""
        )
        if metrics.empty:
            st.info("No server metrics have been sampled yet.")
        else:
            metrics = metrics.sort_values("captured_at")
            st.plotly_chart(px.line(metrics, x="captured_at", y="cpu_percent"), width="stretch")
            st.plotly_chart(
                px.line(
                    metrics,
                    x="captured_at",
                    y=["memory_used_bytes", "memory_available_bytes", "process_memory_bytes"],
                ),
                width="stretch",
            )
            display_dataframe(metrics.tail(100), width="stretch", hide_index=True)
    except Exception as error:
        st.error(f"Server metrics unavailable: {type(error).__name__}")


if diagnostic_section == "Provider":
    st.subheader("Provider reliability & cost evidence")
    st.caption(
        "Exact requested/returned identifiers and usage are recorded when supplied. "
        "Unknown costs are unavailable, never zero. Historical failures may lack token usage."
    )
    try:
        account_key = os.getenv("ACCOUNT_KEY", "")
        if not account_key or account_key == "unconfigured":
            raise ValueError("ACCOUNT_SCOPE_UNCONFIGURED")
        provider_scope = (
            hashlib.sha256(account_key.encode()).hexdigest(),
            mode.lower(),
            selected_symbol,
        )
        if query("SELECT to_regclass('scenario_contexts') AS present")[0]["present"]:
            context_rows = query(
                """SELECT c.requested_at, c.state, c.requested_model, c.duration_ms,
                    c.valid_until, c.reason, c.telemetry
                FROM scenario_contexts c JOIN accounts a ON a.id=c.account_id
                JOIN symbols s ON s.id=c.symbol_id
                WHERE a.provider_account_key_hash=%s AND c.mode=%s AND s.name=%s
                ORDER BY c.requested_at DESC LIMIT 50""",
                provider_scope,
            )
            st.caption(
                "Reusable-map requests include failures and interrupted requests. "
                "Derived local decisions incur no new model request."
            )
            if context_rows:
                display_dataframe(pd.json_normalize(context_rows), hide_index=True, width="stretch")
        if not query("SELECT to_regclass('model_call_telemetry') AS present")[0]["present"]:
            st.info(
                "Provider telemetry requires migration 0015 and new adapter calls. "
                "The running release has no verified data for this view."
            )
        else:
            rows = query(
                """SELECT mr.requested_at, mr.duration_ms, mt.telemetry
                FROM model_call_telemetry mt JOIN model_requests mr ON mr.id=mt.model_request_id
                JOIN analysis_runs ar ON ar.id=mr.analysis_id JOIN accounts a ON a.id=ar.account_id
                JOIN symbols s ON s.id=ar.symbol_id
                WHERE a.provider_account_key_hash=%s AND ar.mode=%s AND s.name=%s
                ORDER BY mr.requested_at DESC LIMIT 50""",
                provider_scope,
            )
            if rows:
                display_dataframe(pd.json_normalize(rows), hide_index=True, width="stretch")
            else:
                st.info("No adapter telemetry for this account, symbol and mode.")
            failures = query(
                """SELECT pf.occurred_at,pf.requested_model,pf.reason,pf.duration_ms,pf.telemetry
                FROM provider_failures pf JOIN analysis_runs ar ON ar.id=pf.analysis_id
                JOIN accounts a ON a.id=ar.account_id JOIN symbols s ON s.id=ar.symbol_id
                WHERE a.provider_account_key_hash=%s AND ar.mode=%s AND s.name=%s
                ORDER BY pf.occurred_at DESC LIMIT 50""",
                provider_scope,
            )
            if failures:
                display_dataframe(pd.DataFrame(failures), hide_index=True, width="stretch")
    except (psycopg.Error, ValueError, RuntimeError):
        st.warning(
            "Provider diagnostics unavailable. No private endpoint or raw error is displayed."
        )
