from __future__ import annotations

import os
import runpy
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
import plotly.express as px
import streamlit as st

from apps.dashboard.background import BackgroundReader
from apps.dashboard.command_centre import STYLES, render_command_centre
from apps.dashboard.overview import operating_state
from apps.dashboard.snapshot import api_url, load_snapshot
from apps.dashboard.time_display import dataframe_for_display, format_gmt8_timestamp

st.set_page_config(
    page_title="Scalper / Trading desk",
    page_icon="◈",
    layout="wide",
    initial_sidebar_state="collapsed",
)
st.html(STYLES)


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
st.caption("SCALPER / OPERATIONS")
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
        if state.startswith(("Blocked", "Paused", "Entries blocked"))
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


def render_history(model: dict[str, Any]) -> None:
    st.subheader("Closed trades")
    st.caption(
        "Net P&L already includes signed broker fees. "
        "Model costs are separate and unavailable for legacy trades. "
        "entry_slip is the first fill minus the order trigger (adverse when positive). "
        "stop_overshoot is the exit fill minus the stop loss (negative when exits fill favourably)."
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
        if "execution_order_type" in data.columns:
            mix = (
                data.groupby(
                    ["strategy_version", "execution_order_type"],
                )
                .size()
                .reset_index(name="trades")
            )
            st.caption("Trade count by release / order type")
            st.dataframe(mix, hide_index=True, width="stretch")
    else:
        st.info("No closed trades for this account, symbol and mode.")


if view == "Diagnostics":
    # Historical inspection is intentionally stable; only its small recovery probe polls.
    runpy.run_path(str(Path(__file__).with_name("diagnostics.py")))
else:
    names = ["command", "updated"] if view == "Overview" else ["status", "history", "updated"]
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
        if view == "Overview":
            update_region(
                "command",
                {"snapshot": snapshot, "poll_state": polled.state},
                lambda model: render_command_centre(model["snapshot"], model["poll_state"]),
            )
        else:
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
