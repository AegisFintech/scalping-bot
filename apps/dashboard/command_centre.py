"""Streamlit command centre. Presentation only; every dynamic panel is re-emitted."""

from datetime import UTC, datetime
from typing import Any

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from apps.dashboard.charts import ChartDataError, completed_candles_figure
from apps.dashboard.command_model import (
    action,
    cumulative_net,
    direction,
    levels,
    number,
    open_money,
    safe,
)
from apps.dashboard.overview import fresh, money, position_rows, risk_summary
from apps.dashboard.time_display import dataframe_for_display, format_gmt8_timestamp

STYLES = """<style>
:root{
--desk-bg:#080e1b;
--desk-card:#101b2e;
--desk-line:#27354d;
--desk-text:#e9f0fc;
--desk-muted:#aab9d0;
--desk-green:#5ce3b0;
--desk-red:#ff819f;
--desk-violet:#b7a0ff}

.stApp,[data-testid="stAppViewContainer"],header[data-testid="stHeader"]{
background:var(--desk-bg);
color:var(--desk-text)}

[data-testid="stSidebar"]{
background:#0d1728;
color:var(--desk-text);
border-right:1px solid var(--desk-line)}

.block-container{
max-width:1600px;
padding-top:1.5rem;
padding-bottom:2rem}

[data-testid="stBaseButton-primaryFormSubmit"]{
background:#b42318;
border-color:#b42318;
color:#fff;
}
h1,h2,h3,p,label,[data-testid="stCaptionContainer"]{
color:inherit}

[data-testid="stCaptionContainer"]{
color:var(--desk-muted)}

[data-testid="stRadio"] label{
color:var(--desk-text)!important}

[data-testid="stMetric"]{
background:var(--desk-card);
border:1px solid var(--desk-line);
border-radius:16px;
padding:18px}

[data-testid="stMetricLabel"]{
color:var(--desk-muted)}

[data-testid="stMetricValue"]{
font-variant-numeric:tabular-nums;
font-size:2rem;
color:var(--desk-text)}

.desk-header{
display:flex;
align-items:center;
justify-content:space-between;
gap:16px;
margin-bottom:16px}

.desk-brand{
font-size:25px;
font-weight:750;
letter-spacing:-1px}
.desk-brand span{
color:var(--desk-green)}

.desk-kicker{
font-size:11px;
letter-spacing:2px;
color:var(--desk-muted);
text-transform:uppercase;
margin-bottom:8px}

.desk-card{
background:linear-gradient(125deg,#121f35,#10192c);
border:1px solid var(--desk-line);
border-radius:18px;
padding:18px;
margin:6px 0 10px;
overflow-wrap:anywhere}

.desk-hero{
display:grid;
grid-template-columns:1.3fr 1fr;
gap:24px;
border-left:3px solid var(--desk-violet)}

.desk-action{
font-size:32px;
letter-spacing:-1px;
font-weight:700;
line-height:1.2;
margin-bottom:12px}

.desk-detail{
color:var(--desk-muted);
font-size:14px;
line-height:1.65}
.desk-next{
border-left:1px solid var(--desk-line);
padding-left:24px}

.desk-pill{
display:inline-block;
border:1px solid #445775;
border-radius:30px;
padding:5px 11px;
font:600 11px monospace;
color:#d6e3ff;
margin-right:6px;
margin-bottom:4px}

.desk-pill.green{
color:var(--desk-green);
border-color:#2c7562}
.desk-pill.amber{
color:#ffd383;
border-color:#8b6d3b}

.desk-flow{
display:grid;
grid-template-columns:repeat(6,minmax(0,1fr));
gap:8px;
margin:10px 0 14px}

.desk-node{
background:#101b2d;
border:1px solid var(--desk-line);
border-radius:13px;
padding:15px 10px;
color:var(--desk-muted);
font-size:12px}

.desk-node strong{
display:block;
color:#dce7fa;
margin:8px 0 4px;
font-size:14px}
.desk-node small{
font-size:10px}

.desk-node.active{
border-color:var(--desk-violet);
background:#26203f;
box-shadow:0 0 24px #a888ff18}

.desk-node.active .desk-dot{
animation:desk-pulse 2s infinite;
background:var(--desk-violet)}

.desk-dot{
display:inline-block;
width:8px;
height:8px;
border-radius:50%;
background:#53657e;
margin-right:6px}

@keyframes desk-pulse{
50%{
box-shadow:0 0 0 7px #b7a0ff20}
}

.desk-section{
display:flex;
align-items:center;
gap:10px;
font-size:12px;
font-weight:700;
letter-spacing:1.8px;
text-transform:uppercase;
margin:22px 0 12px}

.desk-section:before{
content:'';
width:5px;
height:16px;
background:var(--desk-violet);
border-radius:3px}

.desk-factor{
display:flex;
justify-content:space-between;
gap:12px;
padding:12px 0;
border-bottom:1px solid var(--desk-line);
font-size:13px}
.desk-factor:last-child{
border:0}

.desk-factor span{
color:var(--desk-muted)}
.desk-factor b{
text-align:right;
font-variant-numeric:tabular-nums}

.desk-value{
font-size:28px;
font-weight:700;
font-variant-numeric:tabular-nums}
.positive{
color:var(--desk-green)}
.negative{
color:var(--desk-red)}
.neutral{
color:var(--desk-text)}

.desk-event{
padding:12px 0;
border-bottom:1px solid var(--desk-line);
font-size:13px}
.desk-event time{
display:block;
font:11px monospace;
color:var(--desk-muted);
margin-bottom:5px}

[data-testid="stExpander"]{
background:#101b2e;
border-color:var(--desk-line);
color:var(--desk-text)}

@media(prefers-reduced-motion:reduce){
.desk-node.active .desk-dot{
animation:none}
}

@media(max-width:760px){
.desk-hero{
grid-template-columns:1fr}
.desk-next{
border-left:0;
border-top:1px solid var(--desk-line);
padding:14px 0 0}
.desk-flow{
grid-template-columns:repeat(3,minmax(0,1fr))}
.desk-action{
font-size:26px}
.desk-header{
flex-wrap:wrap}
}

</style>"""


def section(title: str) -> None:
    st.html(f'<div class="desk-section">{safe(title)}</div>')


def factors(items: list[tuple[str, object]]) -> None:
    st.html(
        '<div class="desk-card">'
        + "".join(
            f'<div class="desk-factor"><span>{safe(k)}</span><b>{safe(v)}</b></div>'
            for k, v in items
        )
        + "</div>"
    )


def style_chart(figure: go.Figure, height: int) -> go.Figure:
    figure.update_layout(
        template="plotly_dark",
        paper_bgcolor="#101b2e",
        plot_bgcolor="#101b2e",
        font=dict(color="#cad8ed", family="Inter, system-ui, sans-serif"),
        height=height,
        margin=dict(l=12, r=12, t=36, b=20),
        legend=dict(orientation="h"),
        xaxis_rangeslider_visible=False,
        uirevision="command-centre",
    )
    for trace in figure.data:
        if trace.x is not None:
            trace.x = (
                pd.to_datetime(trace.x, utc=True).tz_convert("Asia/Singapore").tz_localize(None)
            )
    figure.update_xaxes(gridcolor="#223047", title_text="GMT+8")
    figure.update_yaxes(gridcolor="#223047")
    return figure


def render_command_centre(snapshot: dict[str, Any], poll_state: str) -> None:
    now = datetime.now(UTC)
    if poll_state != "ready":
        snapshot = {}
    status = snapshot.get("status") or {"unavailable": True}
    current = action(status, now)
    if poll_state != "ready":
        current = action({"unavailable": True}, now)
        current["title"] = "Connecting" if poll_state == "loading" else "Data unavailable"
    mode = str(status.get("mode", "unknown")).upper()
    session = (status.get("marketSession") or {}).get("state", "UNAVAILABLE")
    currency = snapshot.get("currency", "Currency unavailable")
    managed_state = (status.get("managedSetup") or {}).get("status")
    position_count = (
        len(current["positions"])
        if managed_state in {"ACTIVE", "LATEST_TERMINAL", "NONE"}
        else "Unavailable"
    )
    pending_count = len(current["pending"]) if position_count != "Unavailable" else "Unavailable"
    st.html(
        f'<div class="desk-header"><div><div class="desk-brand"><span>◈</span> SCALPER / DESK</div>'
        '<div class="desk-kicker">Execution intelligence · XAUUSD</div></div><div>'
        f'<span class="desk-pill">{safe(mode)}</span>'
        f'<span class="desk-pill">SESSION {safe(session)}</span>'
        f'<span class="desk-pill">{safe(currency)} · GMT+8</span></div></div>'
    )
    st.html(
        f'<div class="desk-card desk-hero"><div><div class="desk-kicker">Current action</div>'
        f'<div class="desk-action">{safe(current["title"])}</div>'
        f'<div class="desk-detail">{safe(current["detail"])}</div></div>'
        f'<div class="desk-next"><div class="desk-kicker">What happens next</div>'
        f'<div class="desk-detail">{safe(current["next"])}</div>'
        '<div style="margin-top:14px"><span class="desk-pill">'
        f"{safe(position_count)} ledger positions</span>"
        f'<span class="desk-pill">{safe(pending_count)} ledger orders</span></div></div></div>'
    )
    if current["title"].startswith(("Entries blocked", "Blocked", "Paused")):
        st.warning(current["title"] + " · " + current["detail"])
    elif current["title"] in {"Unavailable", "Data unavailable", "Stopped"}:
        st.error(current["title"] + " · " + current["detail"])
    latest_check = status.get("lastCycle") or {}
    if latest_check.get("outcome"):
        outcome = (
            "Waiting — no order attempted"
            if latest_check["outcome"] == "DEFERRED"
            else str(latest_check["outcome"])
        )
        st.markdown(f"Latest execution check: **{outcome}**")
        st.caption("Local execution checks are not paid provider requests.")
    if current["reasons"]:
        st.caption(
            "Waiting / admission: "
            + " · ".join(str(r).replace("_", " ").lower() for r in current["reasons"][:5])
        )
    for warning in snapshot.get("warnings", []):
        st.warning(warning)
    values = risk_summary(snapshot.get("daily", {}), snapshot.get("capital", {}), now)
    for col, label, key in zip(
        st.columns(4),
        ["ACCOUNT EQUITY", "REALIZED NET · UTC DAY", "OPEN P/L · BROKER", "DRAWDOWN"],
        ["equity", "realized", "unrealized", "drawdown"],
        strict=True,
    ):
        source_key = {"realized": "realized_pnl", "unrealized": "unrealized_pnl"}.get(key)
        tone = (
            direction(snapshot.get("daily", {}).get(source_key))
            if source_key and values[key] != "Unavailable"
            else "neutral"
        )
        with col, st.container(key=f"metric_{key}"):
            colormap = {"positive": "#5ce3b0", "negative": "#ff819f", "neutral": "#e9f0fc"}
            st.html(
                f'<style>.st-key-metric_{key} [data-testid="stMetricValue"]'
                f"{{color:{colormap[tone]}}}</style>"
            )
            st.metric(label, values[key])
    st.caption(
        f"{currency} · Closed net includes broker fees · Open P/L is unrealized · "
        "Account reconciliation: "
        f"{format_gmt8_timestamp(snapshot.get('daily', {}).get('reconciled_at'))}"
    )
    stages = [
        ("idle", "01", "Ready / wait", "Safety gates"),
        ("download", "02", "Market data", "Completed OHLC"),
        ("process", "03", "Process", "Indicators & risk"),
        ("codex", "04", "Codex", "Two breakout levels"),
        ("orders", "05", "Entry pair", "STOP LIMIT · GTC"),
        ("protect", "06", "OCO / protect", "Fill → close → repeat"),
    ]
    st.html(
        '<div class="desk-flow" aria-label="Observed workflow">'
        + "".join(
            f'<div class="desk-node {"active" if key == current["active"] else ""}">'
            f'<span class="desk-dot"></span>{index}'
            f"<strong>{label}</strong><small>{desc}</small></div>"
            for key, index, label, desc in stages
        )
        + "</div>"
    )
    st.caption(
        "Highlight = observed active stage. Download/processing transitions are not "
        "individually timed by this release."
    )
    market_col, evidence_col = st.columns([1.9, 1], gap="large")
    evidence = snapshot.get("evidence") or {}
    with market_col:
        section("The setup / completed candles")
        st.caption(
            str(evidence.get("chart_source", "Recorded setup snapshot"))
            + " · "
            + format_gmt8_timestamp(evidence.get("chart_at"))
            + " · Historical candles, not a live price feed"
        )
        chart_tabs = st.tabs(["M1 · Trigger", "M5 · Holding range", "M15 · Major structure"])
        candles = pd.DataFrame(snapshot.get("candles", []))
        overlays = levels(snapshot, now)
        for tab, frame in zip(chart_tabs, ["M1", "M5", "M15"], strict=True):
            with tab:
                subset = (
                    candles[candles["timeframe"] == frame]
                    if "timeframe" in candles
                    else pd.DataFrame()
                )
                try:
                    figure = completed_candles_figure(subset, frame)
                    if figure is None:
                        st.info("No recorded completed candles for this setup.")
                    else:
                        plan = evidence.get("plan") or {}
                        lower, upper = number(plan.get("sell_stop")), number(plan.get("buy_stop"))
                        if lower is not None and upper is not None and lower < upper:
                            figure.add_hrect(
                                y0=float(lower),
                                y1=float(upper),
                                fillcolor="rgba(183,160,255,.08)",
                                line_width=0,
                                annotation_text="Buffered entry corridor",
                                row=1,
                                col=1,
                            )
                        for level in overlays:
                            figure.add_hline(
                                y=float(level["price"]),
                                line_dash="dot",
                                line_color="#5ce3b0" if level["side"] == "BUY" else "#ff819f",
                                row=1,
                                col=1,
                            )
                        st.plotly_chart(
                            style_chart(figure, 490),
                            theme=None,
                            width="stretch",
                            key=f"desk_chart_{frame}",
                        )
                except (ChartDataError, ValueError, KeyError):
                    st.warning("Chart withheld: recorded candle data could not be verified.")
        if overlays:
            st.caption("Level key · " + " | ".join(f"{v['label']}: {v['price']}" for v in overlays))
        st.caption(
            "Lines distinguish Codex breakout triggers, intended order protection and "
            "fresh verified broker protection. The provider returns no separate "
            "holding-box edges."
        )
    with evidence_col:
        section("Decision factors / recorded evidence")
        plan = evidence.get("plan") or {}
        feature_frames = (evidence.get("features") or {}).get("timeframes") or {}
        items: list[tuple[str, object]] = []
        for frame in ["M15", "M5", "M1"]:
            features = feature_frames.get(frame) or {}
            items.append((f"{frame} EMA alignment", features.get("ema_alignment") or "Unavailable"))
        items += [
            ("M1 ATR", (feature_frames.get("M1") or {}).get("atr") or "Unavailable"),
            (
                "Analytics quality",
                "Recorded pass"
                if evidence.get("analytics_acceptable") is True
                else "Unavailable / rejected",
            ),
            ("Codex buy trigger", plan.get("buy_stop") or "Unavailable"),
            ("Codex sell trigger", plan.get("sell_stop") or "Unavailable"),
        ]
        factors(items)
        st.caption(
            "Indicators are recorded context, not extra execution gates. Codex returns "
            "two prices only; narrative reasoning and confidence are unavailable."
        )
        market = (snapshot.get("market") or [{}])[0]
        market_ok = (
            market.get("complete") is True
            and not market.get("discontinuity")
            and fresh(market.get("source_time"), now, 10)
        )
        spread = (
            str(market.get("spread"))
            if market_ok and number(market.get("spread")) is not None
            else "Unavailable"
        )
        factors(
            [
                ("Current spread", spread),
                ("Next setup ceiling", values["setup_budget"]),
                ("Risk policy", values["policy"]),
                ("Shared between both legs", "Yes · race exposure included"),
            ]
        )
    left, right = st.columns([1.4, 1], gap="large")
    with left:
        section("Closed performance / realized net")
        curve = pd.DataFrame(snapshot.get("curve", []))
        if not curve.empty:
            curve = curve.sort_values("closed_at")
            try:
                cumulative = cumulative_net(curve["net_pnl"].tolist())
            except ValueError:
                cumulative = None
            if cumulative is None:
                st.warning("Performance curve unavailable: invalid closed outcome.")
            else:
                fig = go.Figure(
                    go.Scatter(
                        x=curve["closed_at"],
                        y=[float(value) for value in cumulative],
                        mode="lines",
                        fill="tozeroy",
                        line=dict(color="#5ce3b0", width=2),
                        fillcolor="rgba(92,227,176,.08)",
                        name="Cumulative closed net",
                    )
                )
                st.plotly_chart(
                    style_chart(fig, 255), theme=None, width="stretch", key="desk_curve"
                )
                st.caption(
                    f"Latest {len(curve)} closed trades · account / symbol / mode · "
                    "cumulative from first displayed trade, not account equity or return."
                )
        else:
            st.info("No verified closed outcomes available for this view.")
        section("Position / broker protection")
        monitor = open_money({"openPositionMonitor": snapshot.get("monitor", {})}, now)
        if snapshot.get("positions"):
            factors(
                [
                    ("Broker open net", monitor["net"]),
                    ("Gross open P/L", monitor["gross"]),
                    ("Recorded signed commission", monitor["commission"]),
                    ("Future closing fees / swap", monitor["closing_cost"]),
                ]
            )
            st.caption(
                "Open P/L is a broker observation, not guaranteed proceeds after closing. "
                "Future costs are not estimated here."
            )
        positions = position_rows(snapshot.get("positions", []), now)
        if positions:
            st.dataframe(
                dataframe_for_display(pd.DataFrame(positions)),
                hide_index=True,
                width="stretch",
                key="desk_positions",
            )
        elif "positions" not in snapshot:
            st.warning("Exposure unavailable. The account must not be assumed flat.")
        else:
            st.caption("No open strategy position in the scoped ledger snapshot.")
        if snapshot.get("orders"):
            st.dataframe(
                dataframe_for_display(pd.DataFrame(snapshot["orders"])),
                hide_index=True,
                width="stretch",
                key="desk_orders",
            )
    with right:
        section("Execution checks / deterministic")
        checks = snapshot.get("validations", [])
        if checks:
            factors(
                [
                    (
                        str(c.get("stage")),
                        "PASS · recorded" if c.get("accepted") else "REJECT · recorded",
                    )
                    for c in checks[:6]
                ]
            )
        else:
            st.caption("No validation evidence for this setup.")
        for risk in snapshot.get("risks", []):
            verdict = "approved" if risk.get("approved") else "rejected"
            volume = risk.get("normalized_volume") or "Unavailable"
            budget = money(risk.get("risk_budget"))
            st.caption(
                f"{risk.get('side')}: {verdict} · native volume {volume} · "
                f"modeled budget {budget} {currency}"
            )
        st.caption(
            "Approved leg budgets are modeled allocation, not measured stop risk or "
            "guaranteed loss ceilings."
        )
        section("Decision activity / latest observations")
        events = snapshot.get("activity", [])
        if events:
            rendered = []
            for event in events:
                at = safe(format_gmt8_timestamp(event.get("analysis_time")))
                reason = (
                    event.get("deferral_reason")
                    or " · ".join(str(x) for x in (event.get("rejection_reasons") or []))
                    or "Recorded decision"
                )
                rendered.append(
                    f'<div class="desk-event"><time>{at}</time>'
                    f"<strong>{safe(event.get('state'))}</strong>"
                    f'<div class="desk-detail">{safe(reason)}</div></div>'
                )
            st.html('<div class="desk-card">' + "".join(rendered) + "</div>")
        else:
            st.caption("No decision events available.")
    with st.expander("Evidence provenance & raw admission reasons"):
        st.write("Strategy: " + str(status.get("strategyVersion", "Unavailable")))
        st.write("Requested model: " + str(status.get("requestedModel", "Unavailable")))
        st.write("Returned backend identity: unavailable when not attested.")
        st.write(
            "Setup provider availability: " + format_gmt8_timestamp(evidence.get("available_at"))
        )
        st.write(
            "Original fresh-submission deadline: "
            + format_gmt8_timestamp(evidence.get("valid_until"))
        )
        st.caption(
            "Accepted GTC orders can remain active after that deadline. News and "
            "consolidated exchange order flow are unavailable here."
        )
        for reason in current["reasons"][:20]:
            st.code(str(reason), language=None)
