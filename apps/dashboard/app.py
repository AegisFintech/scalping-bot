from __future__ import annotations

import os
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
import pandas as pd
import plotly.express as px
import psycopg
import streamlit as st
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
    columns[3].metric("Trading enabled", "YES" if status.get("tradingEnabled") else "NO")
    columns = st.columns(4)
    columns[0].metric("Emergency stop", "ACTIVE" if status.get("emergencyStopped") else "clear")
    columns[1].metric("Analyses paused", "YES" if status.get("pauseNewAnalyses") else "NO")
    columns[2].metric("Startup checks", "passed" if status.get("startupChecksPassed") else "FAILED")
    try:
        overview = frame(
            """SELECT symbol, mode, state, analysis_time, valid_until, rejection_reasons
               FROM dashboard_latest_analysis ORDER BY analysis_time DESC LIMIT 10"""
        )
        st.dataframe(overview, use_container_width=True, hide_index=True)
        daily_overview = frame(
            """SELECT trading_day, timezone, baseline_equity, current_equity, net_flows,
                      realized_pnl, unrealized_pnl, loss_percent, locked_out, reconciled_at
               FROM dashboard_daily_risk ORDER BY trading_day DESC LIMIT 1"""
        )
        if not daily_overview.empty:
            st.subheader("Current daily risk")
            st.dataframe(daily_overview, use_container_width=True, hide_index=True)
    except Exception as error:
        st.error(f"Database overview unavailable: {type(error).__name__}")
    reasons = status.get("reasonCodes", [])
    if reasons:
        st.error("Blocking reasons: " + ", ".join(str(item) for item in reasons))

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
                use_container_width=True,
            )
            st.dataframe(pnl, use_container_width=True, hide_index=True)
        period_pnl = frame(
            """SELECT mode, date_trunc('day', closed_at) AS day,
                      count(*) AS trades, sum(realized_pnl - fees) AS net_pnl
               FROM trades WHERE closed_at >= %s AND closed_at < %s
               GROUP BY mode, day ORDER BY day DESC, mode""",
            (start_time, end_time),
        )
        st.subheader("Daily totals")
        st.dataframe(period_pnl, use_container_width=True, hide_index=True)
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
        st.dataframe(sessions, use_container_width=True, hide_index=True)
        st.subheader("Setup performance")
        st.dataframe(setups, use_container_width=True, hide_index=True)
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
        st.dataframe(grouped, use_container_width=True, hide_index=True)
    except Exception as error:
        st.error(f"Performance unavailable: {type(error).__name__}")

with tabs[3]:
    try:
        market = frame(
            """SELECT source_time, received_at, bid, ask, spread, weighted_mid, microprice,
                      imbalance_top5, imbalance_top10, imbalance_top20, age_ms,
                      complete, discontinuity, reconnect_sequence
               FROM order_book_snapshots ORDER BY source_time DESC LIMIT 100"""
        )
        indicators = frame(
            """SELECT generated_at, atr, ema_fast, ema_slow, acceptable, rejection_reasons
               FROM indicator_snapshots ORDER BY generated_at DESC LIMIT 100"""
        )
        st.subheader("Depth and freshness")
        st.dataframe(market, use_container_width=True, hide_index=True)
        st.subheader("Indicators")
        st.dataframe(indicators, use_container_width=True, hide_index=True)
        candles = frame(
            """SELECT c.timeframe, c.start_time, c.end_time, c.open, c.high, c.low,
                      c.close, c.volume, c.complete, c.quality_flags
               FROM candles c
               JOIN candle_snapshots cs ON cs.id = c.snapshot_id
               WHERE cs.id = (SELECT id FROM candle_snapshots ORDER BY analysis_time DESC LIMIT 1)
               ORDER BY c.timeframe, c.start_time DESC LIMIT 1500"""
        )
        st.subheader("Latest completed candle snapshot")
        st.dataframe(candles, use_container_width=True, hide_index=True)
    except Exception as error:
        st.error(f"Market data unavailable: {type(error).__name__}")

with tabs[4]:
    try:
        analyses = query(
            """SELECT ar.analysis_time, ar.mode, ar.state, ar.valid_until,
                      mr.status AS model_status, mr.parsed_payload,
                      vr.stage, vr.accepted, vr.reason_codes
               FROM analysis_runs ar
               LEFT JOIN model_requests mq ON mq.analysis_id = ar.id
               LEFT JOIN model_responses mr ON mr.model_request_id = mq.id
               LEFT JOIN LATERAL (
                 SELECT stage, accepted, reason_codes FROM validation_results
                 WHERE analysis_id = ar.id ORDER BY validated_at DESC LIMIT 1
               ) vr ON true
               ORDER BY ar.analysis_time DESC LIMIT 20"""
        )
        for analysis in analyses:
            with st.expander(
                f"{analysis['analysis_time']} · {analysis['mode']} · {analysis['state']}",
                expanded=False,
            ):
                st.json(analysis)
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
        st.dataframe(orders, use_container_width=True, hide_index=True)
        st.subheader("Positions")
        st.dataframe(positions, use_container_width=True, hide_index=True)
        fills = frame(
            """SELECT f.occurred_at, o.side, f.price, f.volume, f.commission,
                      o.client_order_id
               FROM fills f JOIN orders o ON o.id = f.order_id
               ORDER BY f.occurred_at DESC LIMIT 1000"""
        )
        st.subheader("Fills")
        st.dataframe(fills, use_container_width=True, hide_index=True)
    except Exception as error:
        st.error(f"Orders/positions unavailable: {type(error).__name__}")

with tabs[6]:
    try:
        daily = frame("SELECT * FROM dashboard_daily_risk ORDER BY trading_day DESC LIMIT 30")
        decisions = frame(
            """SELECT decided_at, side, approved, risk_percent, risk_budget, raw_volume,
                      normalized_volume, estimated_margin, spread_points,
                      spread_atr_ratio, reason_codes
               FROM risk_decisions ORDER BY decided_at DESC LIMIT 500"""
        )
        st.subheader("Daily risk lockout")
        st.dataframe(daily, use_container_width=True, hide_index=True)
        st.subheader("Deterministic decisions")
        st.dataframe(decisions, use_container_width=True, hide_index=True)
        rejected = frame(
            """SELECT validated_at, stage, reason_codes
               FROM validation_results WHERE accepted = false
               ORDER BY validated_at DESC LIMIT 500"""
        )
        st.subheader("Rejected decisions")
        st.dataframe(rejected, use_container_width=True, hide_index=True)
    except Exception as error:
        st.error(f"Risk data unavailable: {type(error).__name__}")

with tabs[7]:
    try:
        health = frame(
            """SELECT service, instance_id, state, dependency_status, reason_codes,
                      heartbeat_at, started_at FROM service_health ORDER BY service, instance_id"""
        )
        events = frame(
            """SELECT occurred_at, severity, service, event_name, outcome, reason_code,
                      duration_ms, retry_count FROM audit_events
               ORDER BY occurred_at DESC LIMIT 500"""
        )
        st.subheader("Service health")
        st.dataframe(health, use_container_width=True, hide_index=True)
        st.subheader("Recent operational events")
        st.dataframe(events, use_container_width=True, hide_index=True)
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
            st.plotly_chart(
                px.line(metrics, x="captured_at", y="cpu_percent"), use_container_width=True
            )
            st.plotly_chart(
                px.line(
                    metrics,
                    x="captured_at",
                    y=["memory_used_bytes", "memory_available_bytes", "process_memory_bytes"],
                ),
                use_container_width=True,
            )
            st.dataframe(metrics.tail(100), use_container_width=True, hide_index=True)
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
    mode_columns[0].button("Paper mode", disabled=True, use_container_width=True)
    mode_columns[1].button("Demo mode", disabled=True, use_container_width=True)
    mode_columns[2].button("Shadow mode", disabled=True, use_container_width=True)
    st.caption("Mode changes require a reviewed environment change and service restart.")
    col1, col2, col3 = st.columns(3)
    if col1.button("ACTIVATE EMERGENCY STOP", type="primary", use_container_width=True):
        if confirmed and actor and reason:
            ok, message = control(
                "/v1/controls/emergency-stop",
                {"enabled": True, "actor": actor, "reason": reason},
            )
            (st.success if ok else st.error)(message)
        else:
            st.warning("Identity, reason, and confirmation are required")
    if (
        col2.button("Pause new analyses", use_container_width=True)
        and confirmed
        and actor
        and reason
    ):
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
    if (
        col3.button("Cancel strategy pending", use_container_width=True)
        and confirmed
        and actor
        and reason
    ):
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
