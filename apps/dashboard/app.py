from __future__ import annotations

import os
import runpy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
import plotly.express as px
import streamlit as st
from background import BackgroundReader
from overview import operating_state, risk_summary
from snapshot import api_url, load_snapshot
from time_display import dataframe_for_display, format_gmt8_timestamp

st.set_page_config(page_title="Scalper · Operations", page_icon="◈", layout="wide")
st.markdown(
    """<style>
.block-container {max-width:1280px;padding-top:3.5rem}
[data-testid="stMetric"] {
    border:1px solid;color:inherit;
    border-color:color-mix(in srgb, currentColor 28%, transparent);
    border-radius:12px;padding:16px;
    background:color-mix(in srgb, currentColor 5%, transparent)
}
[data-testid="stMetricLabel"] {color:inherit;font-size:.9rem;opacity:1}
[data-testid="stMetricValue"] {color:inherit;font-size:1.7rem;
    font-variant-numeric:tabular-nums;white-space:normal}
[data-testid="stCaptionContainer"] {color:inherit;opacity:1}
[data-testid="stBaseButton-primaryFormSubmit"] {
    background:#b42318;border-color:#b42318;color:#fff
}
[data-testid="stBaseButton-primaryFormSubmit"]:hover {
    background:#912018;border-color:#912018;color:#fff
}
.js-plotly-plot .xtick text, .js-plotly-plot .ytick text,
.js-plotly-plot .g-xtitle text, .js-plotly-plot .g-ytitle text {
    fill:currentColor !important
}
h1 {letter-spacing:-.035em}
</style>""",
    unsafe_allow_html=True,
)


def table(rows: list[dict[str, Any]], key: str) -> None:
    st.dataframe(
        dataframe_for_display(pd.DataFrame(rows)), hide_index=True, width="stretch", key=key
    )


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
                        st.success("Control recorded. Status updates automatically.")
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


controls()
st.title("Trading at a glance")
st.caption("Demo and simulated outcomes are distinct from live results. All times: GMT+8.")
view = st.radio(
    "View",
    ["Overview", "Trade history", "Diagnostics"],
    horizontal=True,
    label_visibility="collapsed",
    key="dashboard_view",
)


@st.cache_resource(show_spinner=False)
def reader(selected_view: str) -> BackgroundReader[dict[str, Any]]:
    return BackgroundReader(lambda: load_snapshot(selected_view))


def render_status(model: dict[str, Any]) -> None:
    st.caption(model["context"])
    state, explanation = model["state"], model["explanation"]
    show = (
        st.error
        if state in {"Stopped", "Unavailable"}
        else st.warning
        if state in {"Blocked", "Paused"}
        else st.info
    )
    show(f"**{state}** · {explanation}")
    reasons = model["reasons"]
    if reasons:
        with st.expander(f"Why · {len(reasons)} recorded reasons"):
            for reason_code in reasons[:20]:
                st.code(str(reason_code), language=None)
    for warning in model["warnings"]:
        st.warning(warning)


def render_money(model: dict[str, Any]) -> None:
    values = model["values"]
    for column, label, key in zip(
        st.columns(4),
        ["Equity", "Today · net realized", "Unrealized P&L", "Drawdown"],
        ["equity", "realized", "unrealized", "drawdown"],
        strict=True,
    ):
        column.metric(label, values[key])
    st.caption(
        f"{model['currency']} · Daily loss capacity: {values['daily_remaining']} · "
        f"Next setup ceiling: {values['setup_budget']} · Reconciled: {model['reconciled']}"
    )
    if values["equity"] == "Unavailable":
        st.caption(
            "Financial values older than 30 seconds are withheld. "
            "Historical rows remain in the audit trail."
        )
    if not model["capital_available"]:
        st.caption(
            "Capital policy telemetry unavailable for this running release; "
            "do not interpret the missing budget as zero exposure."
        )


def render_exposure(model: dict[str, Any]) -> None:
    st.subheader("Active positions & orders")
    if not model["available"]:
        st.warning("Active exposure is unavailable; do not assume the account is flat.")
        return
    if model["positions"]:
        table(model["positions"], "active_positions")
    if model["orders"]:
        table(model["orders"], "active_orders")
    if not model["positions"] and not model["orders"]:
        st.info("No active strategy positions or orders in the durable ledger.")
    st.caption(
        "Submitted orders, partial fills and reconciled positions are distinct states. "
        "Ledger rows are not a fresh broker confirmation."
    )


def render_decision(model: dict[str, Any]) -> None:
    st.subheader("Latest decision & execution")
    if model["outcome"] is not None:
        st.write(f"Last completed analysis: **{model['outcome']}**")
        st.caption(" · ".join(str(x) for x in model["reasons"]))
    if model["latest"]:
        table(model["latest"], "latest_decision")
    elif model["available"]:
        st.info("No recorded analysis for this mode and account.")
    else:
        st.warning("Latest decision history is unavailable.")


def render_history(model: dict[str, Any]) -> None:
    st.subheader("Closed trades")
    st.caption(
        "Net P&L already includes signed broker fees. "
        "Model costs are separate and unavailable for legacy trades."
    )
    if not model["available"]:
        st.warning("Trade history is unavailable.")
    elif model["trades"]:
        data = pd.DataFrame(model["trades"]).sort_values("closed_at")
        data["Cumulative net P&L"] = data["net_pnl"].cumsum()
        figure = px.line(data, x="closed_at", y="Cumulative net P&L")
        figure.update_layout(uirevision="trade-history", margin=dict(l=0, r=10, t=20, b=0))
        st.plotly_chart(figure, width="stretch", theme="streamlit", key="history_chart")
        table(model["trades"], "closed_trades")
    else:
        st.info("No closed trades for this account, symbol and mode.")


if view == "Diagnostics":
    # Historical inspection is intentionally stable; only its small recovery probe polls.
    runpy.run_path(str(Path(__file__).with_name("diagnostics.py")))
else:
    names = (
        ["status", "money", "exposure", "decision", "updated"]
        if view == "Overview"
        else ["status", "history", "updated"]
    )
    regions = {name: st.empty() for name in names}

    def update_region(name: str, model: dict[str, Any], draw: Any) -> None:
        # Streamlit clears fragment-owned elements on each tick. Re-emit them;
        # stable element keys let the browser retain unchanged tables/charts.
        with regions[name].container():
            draw(model)

    @st.fragment(run_every="2s")
    def update_live_sections() -> None:
        polled = reader(view).poll()
        snapshot = polled.value or {}
        status = snapshot.get("status", {"unavailable": True})
        state, explanation = operating_state(status)
        if polled.state == "loading":
            state, explanation = "Connecting", "Loading account information in the background."
        elif polled.state == "unavailable":
            state, explanation = (
                "Unavailable",
                "Current data could not be verified. Retrying in the background.",
            )
        update_region(
            "status",
            {
                "context": (
                    f"{str(status.get('mode', 'unknown')).upper()} / "
                    f"{status.get('symbol', 'Symbol unavailable')} / OPERATIONS"
                ),
                "state": state,
                "explanation": explanation,
                "reasons": status.get("reasonCodes", []),
                "warnings": snapshot.get("warnings", []),
            },
            render_status,
        )
        if view == "Overview":
            daily, capital = snapshot.get("daily", {}), snapshot.get("capital", {})
            update_region(
                "money",
                {
                    "values": risk_summary(daily, capital, datetime.now(UTC)),
                    "currency": snapshot.get("currency", "Currency unavailable"),
                    "reconciled": format_gmt8_timestamp(daily.get("reconciled_at")),
                    "capital_available": bool(capital),
                },
                render_money,
            )
            update_region(
                "exposure",
                {
                    "available": "positions" in snapshot,
                    "positions": snapshot.get("positions", []),
                    "orders": snapshot.get("orders", []),
                },
                render_exposure,
            )
            latest = status.get("lastCycle")
            latest = latest if isinstance(latest, dict) else {}
            update_region(
                "decision",
                {
                    "available": "latest" in snapshot,
                    "latest": snapshot.get("latest", []),
                    "outcome": latest.get("outcome"),
                    "reasons": latest.get("reasonCodes", []),
                },
                render_decision,
            )
        else:
            update_region(
                "history",
                {"available": "trades" in snapshot, "trades": snapshot.get("trades", [])},
                render_history,
            )
        update_region(
            "updated",
            {"captured": snapshot.get("captured_at"), "state": polled.state},
            lambda model: st.caption(
                "Background updates · "
                + (
                    f"Last observation: {format_gmt8_timestamp(model['captured'])}"
                    if model["captured"]
                    else "Waiting for current data"
                )
            ),
        )

    update_live_sections()
