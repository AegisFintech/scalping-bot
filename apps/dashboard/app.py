from __future__ import annotations

import os
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
import plotly.express as px
import psycopg
import streamlit as st
from charts import (
    ChartDataError,
    audit_events_figure,
    completed_candles_figure,
    daily_risk_figure,
    execution_events_figure,
    indicators_figure,
    market_quality_figure,
)
from decision_inspector import (
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
from psycopg.rows import dict_row

st.set_page_config(page_title="cTrader AI Scalper", page_icon="🛑", layout="wide")


def execution_url() -> str:
    value = os.getenv("EXECUTION_API_URL", "http://127.0.0.1:8080")
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("dashboard control API must be loopback HTTP")
    return value.rstrip("/")


def query(sql: str, parameters: Sequence[object] = ()) -> list[dict[str, Any]]:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    with (
        psycopg.connect(database_url, row_factory=dict_row) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute(sql, parameters)
        return list(cursor.fetchall())


def frame(sql: str, parameters: Sequence[object] = ()) -> pd.DataFrame:
    return pd.DataFrame(query(sql, parameters))


def api_get(path: str) -> dict[str, Any]:
    response = httpx.get(f"{execution_url()}{path}", timeout=5)
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


try:
    status = api_get("/v1/status")
except Exception as error:
    status = {
        "mode": "unknown",
        "reasonCodes": [f"EXECUTION_API_UNAVAILABLE:{type(error).__name__}"],
    }

mode = str(status.get("mode", "unknown")).upper()
account_environment = str(status.get("accountType", "unknown")).lower()
selected_symbol = str(status.get("symbol", "unknown"))
automation_view = automation_status_view(status)
st.title("cTrader AI Scalper Operations")
if mode == "LIVE":
    st.error("LIVE-COMPATIBLE MODE — order submission remains unavailable in this build")
elif mode == "DEMO":
    st.warning("DEMO BROKER MODE — broker demo orders are not live results")
elif mode == "SHADOW":
    st.info("SHADOW MODE — live observations, hypothetical orders, no broker submission")
else:
    st.info(f"{mode} MODE — simulated/non-live results")
st.caption(
    "Replay, backtest, paper, demo, shadow, and live outcomes are never aggregated "
    "as equivalent evidence."
)

tabs = st.tabs(
    [
        "Overview",
        "P/L",
        "Performance",
        "Market",
        "AI Analysis",
        "Orders & Positions",
        "Risk",
        "Operations",
        "Server",
        "Controls",
    ]
)

with tabs[0]:
    columns = st.columns(4)
    columns[0].metric("Mode", mode)
    columns[1].metric("Symbol", str(status.get("symbol", "unknown")))
    columns[2].metric("Account type", str(status.get("accountType", "unknown")))
    columns[3].metric("Can place a new order now", "YES" if status.get("tradingEnabled") else "NO")
    columns = st.columns(4)
    columns[0].metric("Emergency stop", "ACTIVE" if status.get("emergencyStopped") else "clear")
    columns[1].metric("Analyses paused", "YES" if status.get("pauseNewAnalyses") else "NO")
    columns[2].metric("Startup checks", "passed" if status.get("startupChecksPassed") else "FAILED")
    columns[3].metric(
        "Automatic analysis", "ON" if status.get("automaticAnalysisEnabled") else "OFF"
    )
    st.subheader("What automation is doing now")
    state_message = f"{automation_view['headline']} — {automation_view['detail']}"
    if automation_view["severity"] == "error":
        st.error(state_message)
    elif automation_view["severity"] == "warning":
        st.warning(state_message)
    elif automation_view["severity"] == "success":
        st.success(state_message)
    else:
        st.info(state_message)
    retry_at = automation_view.get("retry_at")
    if isinstance(retry_at, str):
        retry_time = datetime.fromisoformat(retry_at.replace("Z", "+00:00"))
        st.info(
            "Automatic AI retry becomes eligible at "
            f"{retry_time.astimezone(UTC).isoformat()} UTC / "
            f"{retry_time.astimezone(ZoneInfo('Asia/Singapore')).isoformat()} Singapore. "
            "No process restart is required."
        )
    if automation_view["reasons"]:
        st.subheader("Why a new cycle or order is waiting")
        st.dataframe(pd.DataFrame(automation_view["reasons"]), width="stretch", hide_index=True)

    last_cycle = status.get("lastCycle")
    if isinstance(last_cycle, dict):
        st.subheader("Last completed automatic/manual cycle")
        cycle_columns = st.columns(3)
        cycle_columns[0].metric("Outcome", str(last_cycle.get("outcome", "unknown")))
        cycle_columns[1].metric("Analysis ID", str(last_cycle.get("analysisId", "not created")))
        last_reasons = last_cycle.get("reasonCodes", [])
        if isinstance(last_reasons, list):
            cycle_columns[2].metric("Reason count", len(last_reasons))
            if last_reasons:
                st.dataframe(
                    pd.DataFrame([reason_code_view(reason) for reason in last_reasons]),
                    width="stretch",
                    hide_index=True,
                )
    try:
        overview = frame(
            """SELECT symbol, mode, state, analysis_time, valid_until, rejection_reasons
               FROM dashboard_latest_analysis ORDER BY analysis_time DESC LIMIT 10"""
        )
        st.dataframe(overview, width="stretch", hide_index=True)
        daily_overview = frame(
            """SELECT trading_day, timezone, baseline_equity, current_equity, net_flows,
                      realized_pnl, unrealized_pnl, loss_percent, locked_out, reconciled_at
               FROM dashboard_daily_risk ORDER BY trading_day DESC LIMIT 1"""
        )
        if not daily_overview.empty:
            st.subheader("Current daily risk")
            st.dataframe(daily_overview, width="stretch", hide_index=True)
    except Exception as error:
        st.error(f"Database overview unavailable: {type(error).__name__}")

with tabs[1]:
    try:
        today = datetime.now(UTC).date()
        range_col1, range_col2 = st.columns(2)
        start_date = range_col1.date_input("P/L start", value=today - timedelta(days=30))
        end_date = range_col2.date_input("P/L end", value=today)
        start_time = datetime.combine(start_date, datetime.min.time(), tzinfo=UTC)
        end_time = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        pnl = frame(
            """SELECT closed_at, mode, direction, realized_pnl, fees,
                      sum(realized_pnl - fees) OVER
                        (PARTITION BY mode ORDER BY closed_at) AS cumulative_pnl
               FROM trades WHERE closed_at >= %s AND closed_at < %s
               ORDER BY closed_at DESC LIMIT 5000""",
            (start_time, end_time),
        )
        if pnl.empty:
            st.info("No closed trades. No profitability inference is available.")
        else:
            st.plotly_chart(
                px.line(
                    pnl.sort_values("closed_at"), x="closed_at", y="cumulative_pnl", color="mode"
                ),
                width="stretch",
            )
            st.dataframe(pnl, width="stretch", hide_index=True)
        period_pnl = frame(
            """SELECT mode, date_trunc('day', closed_at) AS day,
                      count(*) AS trades, sum(realized_pnl - fees) AS net_pnl
               FROM trades WHERE closed_at >= %s AND closed_at < %s
               GROUP BY mode, day ORDER BY day DESC, mode""",
            (start_time, end_time),
        )
        st.subheader("Daily totals")
        st.dataframe(period_pnl, width="stretch", hide_index=True)
    except Exception as error:
        st.error(f"P/L unavailable: {type(error).__name__}")

with tabs[2]:
    try:
        sessions = frame(
            """SELECT mode, session_key, trade_count, realized_pnl, unrealized_pnl,
                      win_rate, profit_factor, expectancy, average_win, average_loss,
                      drawdown, consecutive_wins, consecutive_losses, computed_at
               FROM session_statistics ORDER BY computed_at DESC LIMIT 200"""
        )
        setups = frame(
            """SELECT mode, setup_key, sample_size, effective_sample_size, win_rate,
                      profit_factor, expectancy, confidence_adjustment, reason_codes, computed_at
               FROM setup_statistics ORDER BY computed_at DESC LIMIT 200"""
        )
        st.subheader("Session performance")
        st.dataframe(sessions, width="stretch", hide_index=True)
        st.subheader("Setup performance")
        st.dataframe(setups, width="stretch", hide_index=True)
        grouped = frame(
            """SELECT mode, direction, market_regime, confidence_bucket,
                      count(*) AS trades,
                      sum(CASE WHEN realized_pnl - fees > 0 THEN 1 ELSE 0 END) AS wins,
                      avg(realized_pnl - fees) AS expectancy,
                      sum(realized_pnl - fees) AS net_pnl
               FROM trades
               GROUP BY mode, direction, market_regime, confidence_bucket
               ORDER BY mode, trades DESC"""
        )
        st.subheader("Direction, regime, and confidence buckets")
        st.dataframe(grouped, width="stretch", hide_index=True)
    except Exception as error:
        st.error(f"Performance unavailable: {type(error).__name__}")

with tabs[3]:
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
                 WHERE a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               )
               SELECT source_time, received_at, bid, ask, spread, weighted_mid, microprice,
                      imbalance_top5, imbalance_top10, imbalance_top20, age_ms,
                      complete, discontinuity, reconnect_sequence
               FROM order_book_snapshots
               WHERE symbol_id = (SELECT id FROM target_symbol)
               ORDER BY source_time DESC LIMIT %s""",
            (account_environment, selected_symbol, chart_samples),
        )
        indicators = frame(
            """WITH target_symbol AS (
                 SELECT s.id FROM symbols s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               )
               SELECT i.generated_at, i.atr, i.ema_fast, i.ema_slow,
                      i.acceptable, i.rejection_reasons
               FROM indicator_snapshots i
               JOIN candle_snapshots cs ON cs.id = i.candle_snapshot_id
               WHERE cs.symbol_id = (SELECT id FROM target_symbol)
               ORDER BY i.generated_at DESC LIMIT %s""",
            (account_environment, selected_symbol, chart_samples),
        )
        candles = frame(
            """WITH target_snapshot AS (
                 SELECT cs.id FROM candle_snapshots cs
                 JOIN symbols s ON s.id = cs.symbol_id
                 JOIN accounts a ON a.id = cs.account_id
                 WHERE a.environment = %s AND s.name = %s
                 ORDER BY cs.analysis_time DESC LIMIT 1
               )
               SELECT c.timeframe, c.start_time, c.end_time, c.open, c.high, c.low,
                      c.close, c.volume, c.complete, c.quality_flags
               FROM candles c
               WHERE c.snapshot_id = (SELECT id FROM target_snapshot)
                 AND c.timeframe = %s AND c.complete = true
               ORDER BY c.start_time DESC LIMIT %s""",
            (account_environment, selected_symbol, selected_timeframe, chart_samples),
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
        st.dataframe(market, width="stretch", hide_index=True)
        st.subheader("Indicators")
        st.dataframe(indicators, width="stretch", hide_index=True)
        st.subheader("Latest completed candle snapshot")
        st.dataframe(candles, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Market chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Market data unavailable: {type(error).__name__}")

with tabs[4]:
    try:
        analyses = query(
            """SELECT ar.id::text AS analysis_id, ar.analysis_time, ar.mode,
                      ar.state, ar.valid_until, ar.rejection_reasons,
                      EXISTS (
                        SELECT 1 FROM model_requests mq WHERE mq.analysis_id = ar.id
                      ) AS ai_request_recorded
               FROM analysis_runs ar
               JOIN accounts a ON a.id = ar.account_id
               JOIN symbols s ON s.id = ar.symbol_id
               WHERE a.environment = %s AND s.name = %s
               ORDER BY ar.created_at DESC LIMIT 50""",
            (account_environment, selected_symbol),
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
                singapore_time = (
                    analysis_time.astimezone(ZoneInfo("Asia/Singapore")).isoformat()
                    if isinstance(analysis_time, datetime)
                    else str(analysis_time)
                )
                request_label = (
                    "AI REQUEST RECORDED" if row["ai_request_recorded"] else "NO DURABLE AI REQUEST"
                )
                labels[analysis_id] = (
                    f"{singapore_time} Singapore · {str(row['mode']).upper()} · "
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
                          sv.version AS strategy_version,
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
                          mr.input_tokens, mr.output_tokens, mr.received_at AS model_received_at
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   LIMIT 1""",
                (selected_analysis_id, account_environment, selected_symbol),
            )
            if len(detail_rows) != 1:
                raise DecisionViewError("DECISION_VIEW_ANALYSIS_SCOPE_MISMATCH")
            detail = detail_rows[0]
            prompt_history = query(
                """SELECT ar.id::text AS analysis_id, ar.analysis_time, ar.mode, ar.state,
                          mq.prompt_version, mq.schema_version, mq.model,
                          mq.status AS request_status, mq.payload_sha256,
                          mr.status AS response_status,
                          CASE
                            WHEN mr.parsed_payload->>'schema_version' = '2.0'
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
                   WHERE a.environment = %s AND s.name = %s
                   ORDER BY ar.created_at DESC LIMIT 50""",
                (account_environment, selected_symbol),
            )
            automatic_history = query(
                """SELECT ai.interval_start, ai.broker_server_time, ai.claimed_at,
                          ai.completed_at, ai.outcome,
                          to_char(ai.interval_start AT TIME ZONE 'Asia/Singapore',
                                  'YYYY-MM-DD HH24:MI:SS') AS interval_start_singapore,
                          to_char(ai.claimed_at AT TIME ZONE 'Asia/Singapore',
                                  'YYYY-MM-DD HH24:MI:SS') AS claimed_at_singapore,
                          to_char(ai.completed_at AT TIME ZONE 'Asia/Singapore',
                                  'YYYY-MM-DD HH24:MI:SS') AS completed_at_singapore,
                          COALESCE(ai.analysis_id::text, ai.cycle_id::text) AS cycle_id,
                          ar.state AS analysis_state, ar.rejection_reasons
                   FROM automatic_analysis_intervals ai
                   JOIN accounts a ON a.id = ai.account_id
                   JOIN symbols s ON s.id = ai.symbol_id
                   LEFT JOIN analysis_runs ar ON ar.id = ai.analysis_id
                   WHERE a.environment = %s AND s.name = %s
                   ORDER BY ai.interval_start DESC LIMIT 100""",
                (account_environment, selected_symbol),
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
                   JOIN candles c ON c.snapshot_id = ar.candle_snapshot_id
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   GROUP BY c.timeframe
                   ORDER BY CASE c.timeframe WHEN 'M1' THEN 1 WHEN 'M5' THEN 2 ELSE 3 END""",
                (selected_analysis_id, account_environment, selected_symbol),
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   GROUP BY ob.id, ar.order_book_snapshot_id
                   ORDER BY ob.source_time""",
                (selected_analysis_id, account_environment, selected_symbol),
            )
            validations = query(
                """SELECT vr.validated_at, vr.stage, vr.accepted, vr.reason_codes,
                          vr.details
                   FROM validation_results vr
                   JOIN analysis_runs ar ON ar.id = vr.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   ORDER BY vr.validated_at""",
                (selected_analysis_id, account_environment, selected_symbol),
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   ORDER BY rd.decided_at, rd.side""",
                (selected_analysis_id, account_environment, selected_symbol),
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   ORDER BY o.side NULLS LAST""",
                (selected_analysis_id, account_environment, selected_symbol),
            )
            broker_events = query(
                """SELECT bee.occurred_at, bee.received_at, bee.execution_type,
                          bee.mapping_state, bee.reason_codes, bee.resolved_at
                   FROM broker_execution_events bee
                   JOIN order_groups og ON og.id = bee.order_group_id
                   JOIN analysis_runs ar ON ar.id = og.analysis_id
                   JOIN accounts a ON a.id = ar.account_id
                   JOIN symbols s ON s.id = ar.symbol_id
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   ORDER BY bee.occurred_at, bee.id""",
                (selected_analysis_id, account_environment, selected_symbol),
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   ORDER BY t.closed_at DESC LIMIT 1""",
                (selected_analysis_id, account_environment, selected_symbol),
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   ORDER BY ae.occurred_at, ae.id LIMIT 300""",
                (selected_analysis_id, account_environment, selected_symbol),
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
            st.subheader("Prompt and response history")
            st.dataframe(pd.DataFrame(prompt_history), width="stretch", hide_index=True)
            st.subheader("Automatic broker-minute cycle history")
            st.dataframe(pd.DataFrame(automatic_history), width="stretch", hide_index=True)
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
            st.dataframe(pd.DataFrame(stage_rows), width="stretch", hide_index=True)

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
                        st.dataframe(
                            pd.DataFrame(transformed_levels),
                            width="stretch",
                            hide_index=True,
                        )
                        st.caption(
                            "Entry and stop loss are unchanged. Effective take profit is the "
                            "exact midpoint between entry and the AI take profit. These effective "
                            "levels still require semantic, freshness, reconciliation, and "
                            "deterministic risk approval before broker submission."
                        )
                    else:
                        st.info(
                            "The TP transform was not reached for this run, so no effective "
                            "broker levels exist."
                        )
                st.caption(
                    "Raw provider text is intentionally not displayed. The parsed object above "
                    "is the exact locally validated JSON used by semantic validation."
                )
                st.caption(
                    "Schema 2.0 has no NO_TRADE result or enabled/disabled leg switch. Older "
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
                st.dataframe(pd.DataFrame(candles), width="stretch", hide_index=True)
                st.subheader("Initial and refreshed quote/depth snapshots")
                st.dataframe(pd.DataFrame(market_snapshots), width="stretch", hide_index=True)

            with inspector_tabs[2]:
                st.subheader("Local validation results")
                if validations:
                    st.dataframe(pd.DataFrame(validations), width="stretch", hide_index=True)
                else:
                    st.info("Validation was not reached for this run.")
                st.subheader("Deterministic risk decisions")
                if risk_decisions:
                    st.dataframe(pd.DataFrame(risk_decisions), width="stretch", hide_index=True)
                else:
                    st.info("Risk sizing was not reached; no broker volume was calculated.")
                st.subheader("Order group and strategy-owned orders")
                if orders:
                    st.dataframe(pd.DataFrame(orders), width="stretch", hide_index=True)
                else:
                    st.info("No order intent or broker order exists for this analysis.")
                st.subheader("cTrader execution-event mapping")
                if broker_events:
                    st.dataframe(pd.DataFrame(broker_events), width="stretch", hide_index=True)
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
                    st.dataframe(pd.DataFrame(safe_events), width="stretch", hide_index=True)
                    event_labels = {
                        str(event["event_id"]): (
                            f"{event['occurred_at']} · {event['event_name']} · {event['outcome']}"
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

with tabs[5]:
    try:
        orders = frame(
            """SELECT o.updated_at, og.mode, og.state AS group_state, o.side, o.state,
                      o.entry_price, o.stop_loss, o.take_profit, o.normalized_volume,
                      o.filled_volume, o.expires_at, o.strategy_owned, og.cancellation_reason
               FROM orders o JOIN order_groups og ON og.id = o.order_group_id
               ORDER BY o.updated_at DESC LIMIT 1000"""
        )
        positions = frame(
            """SELECT side, state, strategy_owned, volume, entry_price, stop_loss, take_profit,
                      unrealized_pnl, opened_at, closed_at, updated_at
               FROM positions ORDER BY updated_at DESC LIMIT 500"""
        )
        st.subheader("Orders")
        st.dataframe(orders, width="stretch", hide_index=True)
        st.subheader("Positions")
        st.dataframe(positions, width="stretch", hide_index=True)
        fills = frame(
            """SELECT f.occurred_at, COALESCE(o.side, p.side) AS side,
                      f.price, f.volume, f.commission, o.client_order_id
               FROM fills f
               LEFT JOIN orders o ON o.id = f.order_id
               LEFT JOIN positions p ON p.id = f.position_id
               ORDER BY f.occurred_at DESC LIMIT 1000"""
        )
        st.subheader("Fills")
        st.dataframe(fills, width="stretch", hide_index=True)
        execution_events = frame(
            """WITH target_symbol AS (
                 SELECT s.id FROM symbols s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               )
               SELECT occurred_at, mapping_state, execution_type, reason_codes
               FROM broker_execution_events
               WHERE symbol_id = (SELECT id FROM target_symbol)
               ORDER BY occurred_at DESC LIMIT 1000""",
            (account_environment, selected_symbol),
        )
        execution_chart = execution_events_figure(execution_events)
        if execution_chart is None:
            st.info("No cTrader execution events have been journaled for this scope.")
        else:
            st.plotly_chart(execution_chart, width="stretch")
        st.subheader("Execution-event journal")
        st.dataframe(execution_events, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Execution chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Orders/positions unavailable: {type(error).__name__}")

with tabs[6]:
    try:
        daily = frame(
            """WITH target_account AS (
                 SELECT s.account_id FROM symbols s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE a.environment = %s AND s.name = %s
                 ORDER BY s.metadata_at DESC LIMIT 1
               )
               SELECT dr.trading_day, %s AS mode, dr.timezone, dr.baseline_equity,
                      dr.current_equity, dr.net_flows, dr.realized_pnl,
                      dr.unrealized_pnl, dr.loss_percent, dr.locked_out,
                      dr.lockout_reason, dr.reconciled_at
               FROM dashboard_daily_risk dr
               WHERE dr.account_id = (SELECT account_id FROM target_account)
               ORDER BY dr.trading_day DESC LIMIT 90""",
            (account_environment, selected_symbol, mode.lower()),
        )
        decisions = frame(
            """SELECT decided_at, side, approved, risk_percent, risk_budget, raw_volume,
                      normalized_volume, estimated_margin, spread_points,
                      spread_atr_ratio, reason_codes
               FROM risk_decisions ORDER BY decided_at DESC LIMIT 500"""
        )
        st.subheader("Daily risk lockout")
        risk_chart = daily_risk_figure(daily)
        if risk_chart is None:
            st.info("No daily-risk history is available for this account scope.")
        else:
            st.plotly_chart(risk_chart, width="stretch")
        st.dataframe(daily, width="stretch", hide_index=True)
        st.subheader("Deterministic decisions")
        st.dataframe(decisions, width="stretch", hide_index=True)
        rejected = frame(
            """SELECT validated_at, stage, reason_codes
               FROM validation_results WHERE accepted = false
               ORDER BY validated_at DESC LIMIT 500"""
        )
        st.subheader("Rejected decisions")
        st.dataframe(rejected, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Risk chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Risk data unavailable: {type(error).__name__}")

with tabs[7]:
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
        st.dataframe(health, width="stretch", hide_index=True)
        st.subheader("Recent operational events")
        audit_chart = audit_events_figure(events)
        if audit_chart is None:
            st.info("No operational audit events are available.")
        else:
            st.plotly_chart(audit_chart, width="stretch")
        st.dataframe(events, width="stretch", hide_index=True)
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
            st.dataframe(delivery, width="stretch", hide_index=True)
        st.dataframe(recent_delivery, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Operations chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Operations unavailable: {type(error).__name__}")

with tabs[8]:
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
            st.dataframe(metrics.tail(100), width="stretch", hide_index=True)
    except Exception as error:
        st.error(f"Server metrics unavailable: {type(error).__name__}")

with tabs[9]:
    st.error(
        "Controls affect new analysis/order eligibility. They never create the manual "
        "live enablement file."
    )
    actor = st.text_input("Operator identity", max_chars=200)
    reason = st.text_area("Reason", max_chars=1000)
    confirmed = st.checkbox("I confirm this control action and understand it is audited")
    mode_columns = st.columns(3)
    mode_columns[0].button("Paper mode", disabled=True, width="stretch")
    mode_columns[1].button("Demo mode", disabled=True, width="stretch")
    mode_columns[2].button("Shadow mode", disabled=True, width="stretch")
    st.caption("Mode changes require a reviewed environment change and service restart.")
    col1, col2, col3 = st.columns(3)
    if col1.button("ACTIVATE EMERGENCY STOP", type="primary", width="stretch"):
        if confirmed and actor and reason:
            ok, message = control(
                "/v1/controls/emergency-stop",
                {"enabled": True, "actor": actor, "reason": reason},
            )
            (st.success if ok else st.error)(message)
        else:
            st.warning("Identity, reason, and confirmation are required")
    if col2.button("Pause new analyses", width="stretch") and confirmed and actor and reason:
        ok, message = control(
            "/v1/controls/pause-analyses",
            {"enabled": True, "actor": actor, "reason": reason},
        )
        (st.success if ok else st.error)(message)
    with st.expander("Resume new analyses"):
        if st.button("Clear database pause only") and confirmed and actor and reason:
            ok, message = control(
                "/v1/controls/pause-analyses",
                {"enabled": False, "actor": actor, "reason": reason},
            )
            (st.success if ok else st.error)(message)
    if col3.button("Cancel strategy pending", width="stretch") and confirmed and actor and reason:
        ok, message = control(
            "/v1/controls/cancel-pending",
            {"actor": actor, "reason": reason},
        )
        (st.success if ok else st.error)(message)
    with st.expander("Clear database emergency stop"):
        st.warning(
            "Environment and filesystem emergency stops remain independent and may still block."
        )
        if st.button("Clear database emergency stop only") and confirmed and actor and reason:
            ok, message = control(
                "/v1/controls/emergency-stop",
                {"enabled": False, "actor": actor, "reason": reason},
            )
            (st.success if ok else st.error)(message)
    if mode == "LIVE":
        with st.expander("Live readiness acknowledgement"):
            st.error(
                "This acknowledgement expires in 15 minutes and does not enable live "
                "execution by itself."
            )
            if (
                st.button("Acknowledge current live readiness context")
                and confirmed
                and actor
                and reason
            ):
                ok, message = control(
                    "/v1/controls/live-acknowledgement",
                    {"actor": actor, "reason": reason},
                )
                (st.success if ok else st.error)(message)
    if mode == "DEMO":
        with st.expander("Initialize reconciled demo daily-risk baseline"):
            st.error(
                "One-time operation. It is accepted only while the environment emergency "
                "stop is active, demo submission is disabled, broker state is empty, and "
                "cTrader reports no deals for the current trading day."
            )
            if st.button("Initialize demo baseline") and confirmed and actor and reason:
                ok, message = control(
                    "/v1/controls/daily-risk-baseline",
                    {"actor": actor, "reason": reason},
                )
                (st.success if ok else st.error)(message)
