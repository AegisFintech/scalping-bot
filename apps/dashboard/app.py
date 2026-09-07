from __future__ import annotations

import hashlib
import os
import runpy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import pandas as pd
import plotly.express as px
import psycopg
import streamlit as st
from overview import operating_state, risk_summary
from psycopg.rows import dict_row
from time_display import dataframe_for_display, format_gmt8_timestamp

st.set_page_config(page_title="Scalper · Operations", page_icon="◈", layout="wide")
st.markdown(
    """<style>
.block-container {max-width:1280px;padding-top:4rem}
[data-testid="stMetric"] {border:1px solid
                #dce3e8;border-radius:12px;padding:16px;background:#f8fafb}
[data-testid="stMetricLabel"] {color:#536471;font-size:.85rem}
[data-testid="stMetricValue"] {font-size:1.85rem;font-variant-numeric:tabular-nums}
h1 {letter-spacing:-.04em} [data-testid="stSidebar"] {background:#f4f7f8}
</style>""",
    unsafe_allow_html=True,
)


def api_url() -> str:
    value = os.getenv("EXECUTION_API_URL", "http://127.0.0.1:8080")
    parsed = urlparse(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
    ):
        raise ValueError("CONTROL_ENDPOINT_INVALID")
    return value.rstrip("/")


def api(path: str) -> dict[str, Any]:
    response = httpx.get(api_url() + path, timeout=5)
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise ValueError("API_SHAPE_INVALID")
    return value


def query(sql: str, parameters: tuple[object, ...] = ()) -> list[dict[str, Any]]:
    database = os.getenv("DATABASE_URL", "")
    if not database:
        raise ValueError("DATABASE_UNCONFIGURED")
    with (
        psycopg.connect(
            database,
            row_factory=dict_row,
            connect_timeout=5,
            options="-c statement_timeout=8000 -c default_transaction_read_only=on",
        ) as connection,
        connection.cursor() as cursor,
    ):
        cursor.execute(sql, parameters)
        return list(cursor.fetchall())


def table(rows: list[dict[str, Any]]) -> None:
    st.dataframe(dataframe_for_display(pd.DataFrame(rows)), hide_index=True, width="stretch")


def controls() -> None:
    with st.sidebar:
        st.subheader("Operator controls")
        with st.form("controls"):
            actor = st.text_input("Identity", max_chars=200)
            reason = st.text_input("Reason", max_chars=1000)
            confirmed = st.checkbox("Confirm audited action")
            pause = st.form_submit_button("Pause new analysis", width="stretch")
            stop = st.form_submit_button("Emergency stop", type="primary", width="stretch")
            resume = st.form_submit_button("Clear analysis pause", width="stretch")
        if pause or stop or resume:
            token = os.getenv("DASHBOARD_CONTROL_TOKEN", "")
            if not confirmed or not actor.strip() or not reason.strip() or len(token) < 24:
                st.error(
                    "Identity, reason, confirmation and configured authorization are required."
                )
            else:
                endpoint = "/v1/controls/emergency-stop" if stop else "/v1/controls/pause-analyses"
                try:
                    response = httpx.post(
                        api_url() + endpoint,
                        headers={"x-control-token": token},
                        json={"enabled": not resume, "actor": actor, "reason": reason},
                        timeout=10,
                    )
                    if response.is_success:
                        st.success("Control recorded. Refresh to verify current state.")
                    else:
                        st.error("Control rejected. Inspect the audited reason in diagnostics.")
                except (httpx.HTTPError, ValueError):
                    st.error("Control outcome unavailable. Verify status before retrying.")
        st.caption(
            "Pause stops new analysis. Emergency stop also cancels strategy pending "
            "orders; it does not flatten positions. Broker protection and "
            "reconciliation continue."
        )
        st.caption(
            "Trading mode and capital limits require a reviewed restart. Live execution "
            "is disabled in this build."
        )
        st.button("Refresh status", on_click=lambda: None, width="stretch")


controls()


@st.fragment(run_every="10s")
def render_content() -> None:
    try:
        status = api("/v1/status")
    except (httpx.HTTPError, ValueError):
        status = {"unavailable": True}
    mode = str(status.get("mode", os.getenv("TRADING_MODE", "unknown"))).lower()
    symbol = str(status.get("symbol", os.getenv("TRADING_SYMBOL", "XAUUSD")))
    account_environment = (
        "paper"
        if mode in {"paper", "backtest", "replay"}
        else str(status.get("accountType", "unknown"))
    )
    st.caption(f"{mode.upper()}  /  {symbol}  /  OPERATIONS")
    st.title("Trading at a glance")
    st.caption("Demo and simulated outcomes are distinct from live results. All times: GMT+8.")
    view = st.radio(
        "View",
        ["Overview", "Trade history", "Diagnostics"],
        horizontal=True,
        label_visibility="collapsed",
    )

    if view == "Diagnostics":
        runpy.run_path(str(Path(__file__).with_name("diagnostics.py")))
        st.stop()

    scope: tuple[object, ...] | None = None
    try:
        account_key = os.getenv("ACCOUNT_KEY", "")
        if not account_key or account_key == "unconfigured":
            raise ValueError("ACCOUNT_SCOPE_UNCONFIGURED")
        identities = query(
            """SELECT s.id AS symbol_id, a.id AS account_id, a.currency
            FROM symbols s JOIN accounts a ON a.id=s.account_id
            WHERE a.provider_account_key_hash=%s AND a.environment=%s AND s.name=%s""",
            (hashlib.sha256(account_key.encode()).hexdigest(), account_environment, symbol),
        )
        if len(identities) != 1:
            raise ValueError("ACCOUNT_SCOPE_AMBIGUOUS")
        identity = identities[0]
        scope = (identity["account_id"], identity["symbol_id"], mode)
    except (psycopg.Error, ValueError):
        identity = {}
        st.warning(
            "Account history is unavailable or its scope could not be verified. No "
            "values are estimated."
        )

    if view == "Overview":
        state, explanation = operating_state(status)
        show = (
            st.error
            if state in {"Stopped", "Unavailable"}
            else st.warning
            if state in {"Blocked", "Paused"}
            else st.info
        )
        show(f"**{state}** · {explanation}")
        reasons = status.get("reasonCodes", [])
        if isinstance(reasons, list) and reasons:
            with st.expander(f"Why · {len(reasons)} recorded reasons"):
                for reason_code in reasons[:20]:
                    st.code(str(reason_code), language=None)
        daily: dict[str, Any] = {}
        capital: dict[str, Any] = {}
        if scope:
            try:
                rows = query(
                    (
                        "SELECT * FROM daily_risk_state WHERE account_id=%s ORDER BY "
                        "trading_day DESC LIMIT 1"
                    ),
                    (scope[0],),
                )
                daily = rows[0] if rows else {}
                if query("SELECT to_regclass('capital_risk_state') AS present")[0]["present"]:
                    rows = query(
                        "SELECT * FROM capital_risk_state WHERE account_id=%s", (scope[0],)
                    )
                    capital = rows[0] if rows else {}
            except psycopg.Error:
                st.warning("Current account/risk data is unavailable.")
        values = risk_summary(daily, capital, datetime.now(UTC))
        columns = st.columns(4)
        for column, label, key in zip(
            columns,
            ["Equity", "Today · net realized", "Unrealized P&L", "Drawdown"],
            ["equity", "realized", "unrealized", "drawdown"],
            strict=True,
        ):
            column.metric(label, values[key])
        st.caption(
            f"{identity.get('currency', 'Currency unavailable')} · "
            f"Daily loss capacity: {values['daily_remaining']} · "
            f"Next setup ceiling: {values['setup_budget']} · "
            f"Reconciled: {format_gmt8_timestamp(daily.get('reconciled_at'))}"
        )
        if values["equity"] == "Unavailable":
            st.caption(
                "Financial values older than 30 seconds are withheld. Historical rows "
                "remain in the audit trail."
            )
        if not capital:
            st.caption(
                "Capital policy telemetry unavailable for this running release; do not "
                "interpret the missing budget as zero exposure."
            )
        st.subheader("Active positions & orders")
        if scope:
            try:
                positions = query(
                    """SELECT p.side, p.state, p.volume, p.entry_price,
                        p.stop_loss, p.take_profit, p.updated_at
                    FROM positions p JOIN order_groups og ON og.id=p.order_group_id
                    WHERE p.account_id=%s AND p.symbol_id=%s AND og.mode=%s AND p.state <> 'CLOSED'
                    ORDER BY p.updated_at DESC LIMIT 20""",
                    scope,
                )
                orders = query(
                    """SELECT o.side, o.state, o.entry_price, o.stop_loss,
                        o.take_profit, o.normalized_volume AS
                volume, o.expires_at
                    FROM orders o JOIN order_groups og ON og.id=o.order_group_id JOIN
                analysis_runs ar ON ar.id=og.analysis_id
                    WHERE ar.account_id=%s AND ar.symbol_id=%s AND og.mode=%s
                    AND o.state IN
                ('INTENT','SUBMITTING','PENDING','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN')
                    ORDER BY o.updated_at DESC LIMIT 20""",
                    scope,
                )
                if positions:
                    table(positions)
                if orders:
                    table(orders)
                if not positions and not orders:
                    st.info("No active strategy positions or orders in the durable ledger.")
                st.caption(
                    "Submitted orders, partial fills and reconciled positions are "
                    "distinct states. Ledger rows are not a fresh broker confirmation."
                )
            except psycopg.Error:
                st.warning("Active exposure is unavailable; do not assume the account is flat.")
        st.subheader("Latest decision & execution")
        latest = status.get("lastCycle")
        if isinstance(latest, dict):
            st.write(f"Last completed analysis: **{latest.get('outcome', 'Unavailable')}**")
            st.caption(" · ".join(str(x) for x in latest.get("reasonCodes", [])))
        if scope:
            try:
                rows = query(
                    """SELECT ar.analysis_time, ar.state AS analysis,
                        ar.rejection_reasons AS reasons, og.state AS
                order_group,
                    (SELECT count(*) FROM fills f JOIN orders o ON o.id=f.order_id WHERE
                o.order_group_id=og.id) AS fills,
                    (SELECT sum(t.realized_pnl) FROM trades t WHERE t.order_group_id=og.id) AS
                closed_net_pnl
                    FROM analysis_runs ar LEFT JOIN order_groups og ON og.analysis_id=ar.id
                    WHERE ar.account_id=%s AND ar.symbol_id=%s AND ar.mode=%s
                    ORDER BY ar.analysis_time DESC LIMIT 1""",
                    scope,
                )
                if rows:
                    table(rows)
                else:
                    st.info("No recorded analysis for this mode and account.")
            except psycopg.Error:
                st.warning("Latest decision history is unavailable.")
    else:
        st.subheader("Closed trades")
        st.caption(
            "Net P&L already includes signed broker fees. Model costs are separate and "
            "unavailable for legacy trades."
        )
        if scope:
            try:
                trades = query(
                    """SELECT t.closed_at, t.direction, t.realized_pnl AS net_pnl,
                        t.fees, t.strategy_version
                    FROM trades t JOIN order_groups og ON og.id=t.order_group_id JOIN
                analysis_runs ar ON ar.id=og.analysis_id
                    WHERE ar.account_id=%s AND ar.symbol_id=%s AND t.mode=%s ORDER BY
                t.closed_at DESC LIMIT 1000""",
                    scope,
                )
                if trades:
                    data = pd.DataFrame(trades).sort_values("closed_at")
                    data["Cumulative net P&L"] = data["net_pnl"].cumsum()
                    st.plotly_chart(
                        px.line(
                            data, x="closed_at", y="Cumulative net P&L", template="plotly_white"
                        ),
                        width="stretch",
                    )
                    table(trades)
                else:
                    st.info("No closed trades for this account, symbol and mode.")
            except psycopg.Error:
                st.warning("Trade history is unavailable.")


render_content()
