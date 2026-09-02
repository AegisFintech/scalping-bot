from __future__ import annotations

import os
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse

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
    analysis_attempt_funnel_view,
    analysis_chart_view,
    analysis_history_view,
    analytics_summary,
    automation_status_view,
    broker_lifecycle_view,
    campaign_history_counts,
    continuous_demo_counters,
    exact_model_input_view,
    execution_status_recovered,
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
from psycopg.rows import dict_row
from time_display import dataframe_for_display, format_gmt8_timestamp

st.set_page_config(page_title="cTrader AI Scalper", page_icon="🛑", layout="wide")


class ExecutionStatusTemporarilyUnavailable(RuntimeError):
    """Render reconnecting state instead of a false history-integrity alarm."""


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


def display_dataframe(data: Any, **kwargs: Any) -> Any:
    """Display a copy whose timestamp columns use the operator GMT+8 format."""

    return st.dataframe(dataframe_for_display(data), **kwargs)


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


@st.fragment(run_every="2s")
def execution_status_recovery_probe() -> None:
    """Rerun the full app after a transient execution-status outage recovers."""

    try:
        recovered = api_get("/v1/status")
    except (httpx.HTTPError, RuntimeError, ValueError):
        st.warning(
            "Execution service is reconnecting. Current broker and campaign status is "
            "temporarily unavailable; PostgreSQL history has not been deleted. Retrying "
            "every 2 seconds."
        )
        return
    if execution_status_recovered(recovered):
        st.rerun()
    st.warning(
        "Execution service responded without a complete status snapshot. Durable history "
        "is retained; retrying every 2 seconds."
    )


@st.fragment(run_every="2s")
def live_open_trade_panel() -> None:
    st.subheader("Live open trade")
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
automation_view = automation_status_view(status)
broker_view = broker_lifecycle_view(status, automation_view)
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
st.caption(
    "All operator-facing timestamps use Asia/Singapore time and are labelled GMT+8. "
    "Hash-verified exact AI/audit JSON retains its original persisted timestamp text."
)

tabs = st.tabs(
    [
        "Overview",
        "P/L",
        "Performance",
        "Market",
        "AI Analysis",
        "Analysis History",
        "Orders & Positions",
        "Risk",
        "Operations",
        "Server",
        "Controls",
    ]
)

with tabs[0]:
    automation_activity = status.get("automationActivity")
    if isinstance(automation_activity, dict) and automation_activity.get("state") == "STALLED":
        st.error(
            "AUTOMATIC TRADING IS STOPPED — fresh market data is arriving but no new analysis "
            "cycle is completing. Last scheduler/lifecycle progress: "
            f"{format_gmt8_timestamp(automation_activity.get('lastProgressAt'))}."
        )
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
    trade_campaign = status.get("automaticDemoTradeCampaign")
    campaign = status.get("automaticAnalysisCampaign")
    st.subheader("Durable automation counters")
    try:
        counters = continuous_demo_counters(campaign, trade_campaign)
        counter_columns = st.columns(4)
        counter_columns[0].metric("All-time AI analyses", counters["lifetimeAnalyses"])
        counter_columns[1].metric("All-time closed trades", counters["lifetimeTrades"])
        counter_columns[2].metric("This release: analyses", counters["releaseAnalyses"])
        counter_columns[3].metric("This release: trades", counters["releaseTrades"])
        if (
            status.get("automaticAnalysisEnabled") is True
            and isinstance(campaign, dict)
            and campaign.get("limit") is None
            and isinstance(trade_campaign, dict)
            and trade_campaign.get("limit") is None
        ):
            st.success(
                "CONTINUOUS MODE — no analysis-count or closed-trade campaign boundary will "
                "pause the scheduler. Independent safety and reconciliation controls remain active."
            )
        st.caption(
            "An analysis is counted only after a durable completed external-AI response. A trade "
            "is counted only after its demo position and closed outcome are durably reconciled. "
            "Rejected attempts and unfilled expiries are not trades."
        )
    except DecisionViewError:
        st.error(
            "Durable analysis/trade counters are unavailable or inconsistent. Automation remains "
            "fail-closed until PostgreSQL progress can be verified."
        )
    if isinstance(trade_campaign, dict) and trade_campaign.get("enabled") is True:
        st.subheader("Closed demo trade collection")
        trade_campaign_columns = st.columns(4)
        trade_campaign_columns[0].metric(
            "Trade target", str(trade_campaign.get("limit", "unknown"))
        )
        trade_campaign_columns[1].metric(
            "Closed trades", str(trade_campaign.get("closedTrades", "unavailable"))
        )
        trade_campaign_columns[2].metric(
            "Trades remaining", str(trade_campaign.get("remaining", "unavailable"))
        )
        trade_campaign_columns[3].metric(
            "Collection state",
            "COMPLETE" if trade_campaign.get("complete") is True else "RUNNING",
        )
        trade_limit = trade_campaign.get("limit")
        closed_trades = trade_campaign.get("closedTrades")
        if (
            isinstance(trade_limit, int)
            and trade_limit > 0
            and isinstance(closed_trades, int)
            and closed_trades >= 0
        ):
            bounded_trades = min(closed_trades, trade_limit)
            st.progress(
                bounded_trades / trade_limit,
                text=f"{bounded_trades} of {trade_limit} durable closed demo trades",
            )
        st.caption(
            "Rejected attempts and unfilled expiries remain visible but do not complete this "
            "target. Automation continues until the trade target or inference safety limit is "
            "reached."
        )
    if isinstance(campaign, dict) and campaign.get("enabled") is True:
        st.subheader("External-AI inference safety limit")
        campaign_columns = st.columns(4)
        campaign_columns[0].metric("Target", str(campaign.get("limit", "unknown")))
        campaign_columns[1].metric("Completed", str(campaign.get("completed", "unavailable")))
        campaign_columns[2].metric("Remaining", str(campaign.get("remaining", "unavailable")))
        campaign_columns[3].metric(
            "Limit state", "REACHED" if campaign.get("complete") is True else "AVAILABLE"
        )
        campaign_baseline = campaign.get("baseline")
        campaign_release_completed = campaign.get("releaseCompleted")
        if isinstance(campaign_baseline, int) and campaign_baseline > 0:
            st.caption(
                f"Reviewed carry-forward: {campaign_baseline} completed before this bug-fix "
                f"release; {campaign_release_completed} completed by the current release."
            )
        campaign_limit = campaign.get("limit")
        campaign_completed = campaign.get("completed")
        if (
            isinstance(campaign_limit, int)
            and campaign_limit > 0
            and isinstance(campaign_completed, int)
            and campaign_completed >= 0
        ):
            bounded_completed = min(campaign_completed, campaign_limit)
            st.progress(
                bounded_completed / campaign_limit,
                text=f"{bounded_completed} of {campaign_limit} permitted AI responses",
            )
    st.subheader(f"RIGHT NOW: {broker_view['headline']}")
    broker_message = broker_view["detail"]
    if broker_view["severity"] == "error":
        st.error(broker_message)
    elif broker_view["severity"] == "warning":
        st.warning(broker_message)
    elif broker_view["severity"] == "success":
        st.success(broker_message)
    else:
        st.info(broker_message)
    st.markdown(f"**What happens next:** {broker_view['next_action']}")

    live_open_trade_panel()

    st.subheader(f"AUTOMATION STATUS: {automation_view['state']}")
    state_message = f"{automation_view['headline']} — {automation_view['detail']}"
    if automation_view["severity"] == "error":
        st.error(state_message)
    elif automation_view["severity"] == "warning":
        st.warning(state_message)
    elif automation_view["severity"] == "success":
        st.success(state_message)
    else:
        st.info(state_message)
    st.markdown(f"**What you need to do:** {automation_view['operator_action']}")
    retry_at = automation_view.get("retry_at")
    if isinstance(retry_at, str):
        st.info(
            "Automatic AI retry becomes eligible at "
            f"{format_gmt8_timestamp(retry_at)}. "
            "No process restart is required."
        )
    if automation_view["reasons"]:
        st.subheader("Why a new cycle or order is waiting")
        display_dataframe(
            pd.DataFrame(automation_view["reasons"]), width="stretch", hide_index=True
        )

    st.subheader("Orders and trade evidence")
    managed_setup = status.get("managedSetup")
    if not isinstance(managed_setup, dict) or managed_setup.get("status") == "UNAVAILABLE":
        if execution_status_error is not None:
            st.info("Orders and trade status will reload automatically after reconnection.")
        else:
            st.error(
                "Managed setup status is unavailable. Use Orders & Positions and the execution "
                "journal; do not assume there are no orders."
            )
    elif managed_setup.get("status") == "NONE":
        st.info("No managed demo order group has been created for this account and symbol.")
    else:
        setup_status = str(managed_setup.get("status", "UNAVAILABLE"))
        group_state = str(managed_setup.get("groupState", "unknown"))
        if setup_status == "ACTIVE":
            st.warning(f"ACTIVE MANAGED SETUP — group state: {group_state}")
        else:
            st.info(
                f"NO ACTIVE MANAGED SETUP — latest terminal group state: {group_state}. "
                "The levels below are history, not working broker orders."
            )
        cancellation_reason = managed_setup.get("cancellationReason")
        if isinstance(cancellation_reason, str):
            st.caption(f"Terminal reason: {cancellation_reason}")
        st.caption(
            f"Group expires: {format_gmt8_timestamp(managed_setup.get('groupExpiresAt'))} · "
            "last updated: "
            f"{format_gmt8_timestamp(managed_setup.get('groupUpdatedAt'))}"
        )
        managed_trades = managed_setup.get("trades")
        if not isinstance(managed_trades, list):
            legacy_trade = managed_setup.get("trade")
            managed_trades = [legacy_trade] if isinstance(legacy_trade, dict) else []
        managed_trades = [trade for trade in managed_trades if isinstance(trade, dict)]
        if len(managed_trades) == 1:
            managed_trade = managed_trades[0]
            trade_columns = st.columns(4)
            trade_columns[0].metric(
                "Closed demo direction", str(managed_trade.get("direction", "unknown"))
            )
            trade_columns[1].metric(
                "Realized demo P/L", str(managed_trade.get("realizedPnl", "unavailable"))
            )
            trade_columns[2].metric("Fees", str(managed_trade.get("fees", "unavailable")))
            trade_columns[3].metric(
                "Closed at", format_gmt8_timestamp(managed_trade.get("closedAt"))
            )
        elif len(managed_trades) > 1:
            total_pnl: Decimal | None
            total_fees: Decimal | None
            try:
                total_pnl = sum(
                    (Decimal(str(trade.get("realizedPnl"))) for trade in managed_trades),
                    Decimal(0),
                )
                total_fees = sum(
                    (Decimal(str(trade.get("fees"))) for trade in managed_trades),
                    Decimal(0),
                )
            except (InvalidOperation, TypeError, ValueError):
                total_pnl = total_fees = None
            trade_columns = st.columns(3)
            trade_columns[0].metric("Closed demo trades", len(managed_trades))
            trade_columns[1].metric(
                "Combined realized demo P/L",
                format(total_pnl, "f") if total_pnl is not None else "unavailable",
            )
            trade_columns[2].metric(
                "Combined fees",
                format(total_fees, "f") if total_fees is not None else "unavailable",
            )
        setup_rows: list[dict[str, object]] = []
        managed_orders = managed_setup.get("orders", [])
        if isinstance(managed_orders, list):
            for order in managed_orders:
                if isinstance(order, dict):
                    setup_rows.append(
                        {
                            "record": "ORDER",
                            "side": order.get("side"),
                            "state": order.get("state"),
                            "entry": order.get("entryPrice"),
                            "stop_loss": order.get("stopLoss"),
                            "take_profit": order.get("takeProfit"),
                            "volume": order.get("volume"),
                            "expires_at": order.get("expiresAt"),
                            "updated_at": order.get("updatedAt"),
                        }
                    )
        managed_positions = managed_setup.get("positions")
        if not isinstance(managed_positions, list):
            legacy_position = managed_setup.get("position")
            managed_positions = [legacy_position] if isinstance(legacy_position, dict) else []
        for managed_position in managed_positions:
            if isinstance(managed_position, dict):
                setup_rows.append(
                    {
                        "record": "POSITION",
                        "side": managed_position.get("side"),
                        "state": managed_position.get("state"),
                        "entry": managed_position.get("entryPrice"),
                        "stop_loss": managed_position.get("stopLoss"),
                        "take_profit": managed_position.get("takeProfit"),
                        "volume": managed_position.get("volume"),
                        "expires_at": None,
                        "updated_at": managed_position.get("updatedAt"),
                    }
                )
        if setup_rows:
            display_dataframe(pd.DataFrame(setup_rows), width="stretch", hide_index=True)
        else:
            st.warning("The selected managed group contains no strategy-owned order records.")

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
                display_dataframe(
                    pd.DataFrame([reason_code_view(reason) for reason in last_reasons]),
                    width="stretch",
                    hide_index=True,
                )
    try:
        overview = frame(
            """SELECT symbol, mode, state, analysis_time, valid_until, rejection_reasons
               FROM dashboard_latest_analysis ORDER BY analysis_time DESC LIMIT 10"""
        )
        display_dataframe(overview, width="stretch", hide_index=True)
        daily_overview = frame(
            """SELECT trading_day, timezone, baseline_equity, current_equity, net_flows,
                      realized_pnl, unrealized_pnl, loss_percent, locked_out, reconciled_at
               FROM dashboard_daily_risk ORDER BY trading_day DESC LIMIT 1"""
        )
        if not daily_overview.empty:
            st.subheader("Current daily risk")
            display_dataframe(daily_overview, width="stretch", hide_index=True)
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
                      sum(realized_pnl) OVER
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
            display_dataframe(pnl, width="stretch", hide_index=True)
        period_pnl = frame(
            """SELECT mode, date_trunc('day', closed_at) AS day,
                      count(*) AS trades, sum(realized_pnl) AS net_pnl
               FROM trades WHERE closed_at >= %s AND closed_at < %s
               GROUP BY mode, day ORDER BY day DESC, mode""",
            (start_time, end_time),
        )
        st.subheader("Daily totals")
        display_dataframe(period_pnl, width="stretch", hide_index=True)
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
        display_dataframe(sessions, width="stretch", hide_index=True)
        st.subheader("Setup performance")
        display_dataframe(setups, width="stretch", hide_index=True)
        grouped = frame(
            """SELECT mode, direction, market_regime, confidence_bucket,
                      count(*) AS trades,
                      sum(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
                      avg(realized_pnl) AS expectancy,
                      sum(realized_pnl) AS net_pnl
               FROM trades
               GROUP BY mode, direction, market_regime, confidence_bucket
               ORDER BY mode, trades DESC"""
        )
        st.subheader("Direction, regime, and confidence buckets")
        display_dataframe(grouped, width="stretch", hide_index=True)
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
        display_dataframe(market, width="stretch", hide_index=True)
        st.subheader("Indicators")
        display_dataframe(indicators, width="stretch", hide_index=True)
        st.subheader("Latest completed candle snapshot")
        display_dataframe(candles, width="stretch", hide_index=True)
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
               ORDER BY ar.created_at DESC LIMIT 100""",
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
                          mr.input_tokens, mr.output_tokens, mr.received_at AS model_received_at,
                          ac.renderer_version AS chart_renderer_version,
                          ac.mime_type AS chart_mime_type,
                          ac.width AS chart_width, ac.height AS chart_height,
                          ac.image_sha256 AS chart_sha256,
                          ac.image_bytes AS chart_image_bytes,
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
                   WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                   LIMIT 1""",
                (selected_analysis_id, account_environment, selected_symbol),
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
                   WHERE a.environment = %s AND s.name = %s
                   ORDER BY ar.created_at DESC LIMIT 100""",
                (account_environment, selected_symbol),
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
                   ORDER BY t.closed_at DESC LIMIT 2""",
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
            st.subheader("Exact completed-candle chart supplied to the AI")
            if chart_view is None:
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

with tabs[5]:
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
                 WHERE a.environment = %s AND s.name = %s
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
                      ) AS model_request_present,
                      EXISTS (
                        SELECT 1
                        FROM model_requests mq
                        JOIN model_responses mr ON mr.model_request_id = mq.id
                        WHERE mq.analysis_id = ar.id
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
                     WHERE a.environment = %s AND s.name = %s
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
                           WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                           ORDER BY vr.validated_at""",
                        (
                            selected["analysis_id"],
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
                           WHERE ar.id = %s AND a.environment = %s AND s.name = %s
                           ORDER BY bee.occurred_at""",
                        (
                            selected["analysis_id"],
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

with tabs[6]:
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
        display_dataframe(orders, width="stretch", hide_index=True)
        st.subheader("Positions")
        display_dataframe(positions, width="stretch", hide_index=True)
        fills = frame(
            """SELECT f.occurred_at, COALESCE(o.side, p.side) AS side,
                      f.price, f.volume, f.commission, o.client_order_id
               FROM fills f
               LEFT JOIN orders o ON o.id = f.order_id
               LEFT JOIN positions p ON p.id = f.position_id
               ORDER BY f.occurred_at DESC LIMIT 1000"""
        )
        st.subheader("Fills")
        display_dataframe(fills, width="stretch", hide_index=True)
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
        display_dataframe(execution_events, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Execution chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Orders/positions unavailable: {type(error).__name__}")

with tabs[7]:
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
        display_dataframe(daily, width="stretch", hide_index=True)
        st.subheader("Deterministic decisions")
        display_dataframe(decisions, width="stretch", hide_index=True)
        rejected = frame(
            """SELECT validated_at, stage, reason_codes
               FROM validation_results WHERE accepted = false
               ORDER BY validated_at DESC LIMIT 500"""
        )
        st.subheader("Rejected decisions")
        display_dataframe(rejected, width="stretch", hide_index=True)
    except ChartDataError as error:
        st.error(f"Risk chart rejected invalid persisted data: {error}")
    except Exception as error:
        st.error(f"Risk data unavailable: {type(error).__name__}")

with tabs[8]:
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

with tabs[9]:
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

with tabs[10]:
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
