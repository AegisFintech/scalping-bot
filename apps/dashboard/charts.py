from __future__ import annotations

from collections.abc import Iterable

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots


class ChartDataError(ValueError):
    """Raised when persisted dashboard data cannot be charted safely."""


def _require_columns(data: pd.DataFrame, columns: Iterable[str]) -> None:
    missing = sorted(set(columns) - set(data.columns))
    if missing:
        raise ChartDataError(f"CHART_COLUMNS_MISSING:{','.join(missing)}")


def _timestamp(data: pd.DataFrame, column: str) -> pd.Series:
    converted = pd.to_datetime(data[column], utc=True, errors="coerce")
    if converted.isna().any():
        raise ChartDataError(f"CHART_TIMESTAMP_INVALID:{column}")
    return converted


def _numeric(data: pd.DataFrame, column: str, *, nullable: bool = False) -> pd.Series:
    converted = pd.to_numeric(data[column], errors="coerce")
    invalid = data[column].notna() & converted.isna()
    if invalid.any() or (not nullable and converted.isna().any()):
        raise ChartDataError(f"CHART_NUMBER_INVALID:{column}")
    return converted


def completed_candles_figure(data: pd.DataFrame, timeframe: str) -> go.Figure | None:
    if data.empty:
        return None
    if timeframe not in {"M1", "M5", "M15"}:
        raise ChartDataError("CHART_TIMEFRAME_INVALID")
    required = {"start_time", "open", "high", "low", "close", "volume", "complete"}
    _require_columns(data, required)
    values = data.copy()
    if not values["complete"].eq(True).all():
        raise ChartDataError("CHART_FORMING_CANDLE_REJECTED")
    values["start_time"] = _timestamp(values, "start_time")
    for column in ("open", "high", "low", "close", "volume"):
        values[column] = _numeric(values, column)
    if (values[["open", "high", "low", "close"]] <= 0).any().any():
        raise ChartDataError("CHART_PRICE_NON_POSITIVE")
    if (values["volume"] < 0).any():
        raise ChartDataError("CHART_VOLUME_NEGATIVE")
    if (values["high"] < values[["open", "low", "close"]].max(axis=1)).any() or (
        values["low"] > values[["open", "high", "close"]].min(axis=1)
    ).any():
        raise ChartDataError("CHART_OHLC_INVALID")
    values = values.sort_values("start_time")
    figure = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.04,
        row_heights=[0.76, 0.24],
    )
    figure.add_trace(
        go.Candlestick(
            x=values["start_time"],
            open=values["open"],
            high=values["high"],
            low=values["low"],
            close=values["close"],
            name=f"{timeframe} completed OHLC",
        ),
        row=1,
        col=1,
    )
    figure.add_trace(
        go.Bar(x=values["start_time"], y=values["volume"], name="Volume"),
        row=2,
        col=1,
    )
    figure.update_layout(
        title=f"{timeframe} completed candles",
        height=620,
        xaxis_rangeslider_visible=False,
        legend_orientation="h",
    )
    figure.update_yaxes(title_text="Price", row=1, col=1)
    figure.update_yaxes(title_text="Volume", row=2, col=1)
    return figure


def indicators_figure(data: pd.DataFrame) -> go.Figure | None:
    if data.empty:
        return None
    required = {"generated_at", "atr", "ema_fast", "ema_slow"}
    _require_columns(data, required)
    values = data.copy()
    values["generated_at"] = _timestamp(values, "generated_at")
    for column in ("atr", "ema_fast", "ema_slow"):
        values[column] = _numeric(values, column, nullable=True)
    if values[["atr", "ema_fast", "ema_slow"]].isna().all().all():
        return None
    values = values.sort_values("generated_at")
    figure = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.08,
        row_heights=[0.68, 0.32],
    )
    for column, label in (("ema_fast", "EMA fast"), ("ema_slow", "EMA slow")):
        if values[column].notna().any():
            figure.add_trace(
                go.Scatter(x=values["generated_at"], y=values[column], mode="lines", name=label),
                row=1,
                col=1,
            )
    if values["atr"].notna().any():
        figure.add_trace(
            go.Scatter(x=values["generated_at"], y=values["atr"], mode="lines", name="ATR"),
            row=2,
            col=1,
        )
    figure.update_layout(title="Deterministic indicator history", height=480)
    figure.update_yaxes(title_text="Price", row=1, col=1)
    figure.update_yaxes(title_text="ATR", row=2, col=1)
    return figure


def market_quality_figure(data: pd.DataFrame) -> go.Figure | None:
    if data.empty:
        return None
    required = {
        "source_time",
        "spread",
        "age_ms",
        "imbalance_top5",
        "imbalance_top10",
        "imbalance_top20",
        "discontinuity",
    }
    _require_columns(data, required)
    values = data.copy()
    values["source_time"] = _timestamp(values, "source_time")
    values["spread"] = _numeric(values, "spread")
    values["age_ms"] = _numeric(values, "age_ms")
    for column in ("imbalance_top5", "imbalance_top10", "imbalance_top20"):
        values[column] = _numeric(values, column, nullable=True)
        present = values[column].dropna()
        if ((present < -1) | (present > 1)).any():
            raise ChartDataError(f"CHART_IMBALANCE_INVALID:{column}")
    if (values["spread"] < 0).any() or (values["age_ms"] < 0).any():
        raise ChartDataError("CHART_MARKET_QUALITY_NEGATIVE")
    values = values.sort_values("source_time")
    figure = make_subplots(
        rows=3,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.06,
        row_heights=[0.38, 0.28, 0.34],
    )
    figure.add_trace(
        go.Scatter(x=values["source_time"], y=values["spread"], mode="lines", name="Spread"),
        row=1,
        col=1,
    )
    figure.add_trace(
        go.Scatter(x=values["source_time"], y=values["age_ms"], mode="lines", name="Age ms"),
        row=2,
        col=1,
    )
    for column, label in (
        ("imbalance_top5", "Top 5 imbalance"),
        ("imbalance_top10", "Top 10 imbalance"),
        ("imbalance_top20", "Top 20 imbalance"),
    ):
        if values[column].notna().any():
            figure.add_trace(
                go.Scatter(x=values["source_time"], y=values[column], mode="lines", name=label),
                row=3,
                col=1,
            )
    discontinuities = values[values["discontinuity"].eq(True)]
    if not discontinuities.empty:
        figure.add_trace(
            go.Scatter(
                x=discontinuities["source_time"],
                y=discontinuities["spread"],
                mode="markers",
                marker={"color": "red", "size": 9, "symbol": "x"},
                name="Discontinuity",
            ),
            row=1,
            col=1,
        )
    figure.update_layout(title="Spread, freshness, and depth imbalance", height=620)
    figure.update_yaxes(title_text="Spread", row=1, col=1)
    figure.update_yaxes(title_text="Age ms", row=2, col=1)
    figure.update_yaxes(title_text="Imbalance", range=[-1, 1], row=3, col=1)
    return figure


def daily_risk_figure(data: pd.DataFrame) -> go.Figure | None:
    if data.empty:
        return None
    required = {
        "trading_day",
        "mode",
        "baseline_equity",
        "current_equity",
        "loss_percent",
        "locked_out",
    }
    _require_columns(data, required)
    values = data.copy()
    values["trading_day"] = _timestamp(values, "trading_day")
    for column in ("baseline_equity", "current_equity", "loss_percent"):
        values[column] = _numeric(values, column)
    if (values[["baseline_equity", "current_equity", "loss_percent"]] < 0).any().any():
        raise ChartDataError("CHART_RISK_VALUE_NEGATIVE")
    allowed_modes = {"replay", "backtest", "paper", "demo", "shadow", "live"}
    modes = values["mode"].astype(str).str.lower()
    if not set(modes).issubset(allowed_modes):
        raise ChartDataError("CHART_MODE_INVALID")
    values["mode"] = modes
    values = values.sort_values("trading_day")
    figure = make_subplots(
        rows=2,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=0.08,
        row_heights=[0.65, 0.35],
    )
    for selected_mode, group in values.groupby("mode", sort=True):
        figure.add_trace(
            go.Scatter(
                x=group["trading_day"],
                y=group["baseline_equity"],
                mode="lines",
                name=f"{selected_mode} baseline",
                line={"dash": "dot"},
            ),
            row=1,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=group["trading_day"],
                y=group["current_equity"],
                mode="lines+markers",
                name=f"{selected_mode} equity",
            ),
            row=1,
            col=1,
        )
        figure.add_trace(
            go.Scatter(
                x=group["trading_day"],
                y=group["loss_percent"],
                mode="lines+markers",
                name=f"{selected_mode} loss %",
            ),
            row=2,
            col=1,
        )
    lockouts = values[values["locked_out"].eq(True)]
    if not lockouts.empty:
        figure.add_trace(
            go.Scatter(
                x=lockouts["trading_day"],
                y=lockouts["loss_percent"],
                mode="markers",
                marker={"color": "red", "size": 10, "symbol": "x"},
                name="Lockout",
            ),
            row=2,
            col=1,
        )
    figure.update_layout(title="Mode-separated daily equity and loss", height=520)
    figure.update_yaxes(title_text="Account currency", row=1, col=1)
    figure.update_yaxes(title_text="Loss %", row=2, col=1)
    return figure


def execution_events_figure(data: pd.DataFrame) -> go.Figure | None:
    if data.empty:
        return None
    required = {"occurred_at", "mapping_state"}
    _require_columns(data, required)
    values = data.copy()
    values["occurred_at"] = _timestamp(values, "occurred_at")
    allowed_states = {"MAPPED", "UNMATCHED", "CONFLICT"}
    if not set(values["mapping_state"].astype(str)).issubset(allowed_states):
        raise ChartDataError("CHART_MAPPING_STATE_INVALID")
    values["bucket"] = values["occurred_at"].dt.floor("h")
    grouped = (
        values.groupby(["bucket", "mapping_state"], as_index=False)
        .size()
        .rename(columns={"size": "events"})
    )
    figure = go.Figure()
    for state, group in grouped.groupby("mapping_state", sort=True):
        figure.add_trace(go.Bar(x=group["bucket"], y=group["events"], name=str(state)))
    figure.update_layout(
        title="cTrader execution-event mapping",
        barmode="stack",
        xaxis_title="UTC hour",
        yaxis_title="Events",
        height=360,
    )
    return figure


def audit_events_figure(data: pd.DataFrame) -> go.Figure | None:
    if data.empty:
        return None
    required = {"occurred_at", "severity"}
    _require_columns(data, required)
    values = data.copy()
    values["occurred_at"] = _timestamp(values, "occurred_at")
    allowed = {"debug", "info", "warn", "error", "fatal"}
    severities = values["severity"].astype(str).str.lower()
    if not set(severities).issubset(allowed):
        raise ChartDataError("CHART_SEVERITY_INVALID")
    values["severity"] = severities
    values["bucket"] = values["occurred_at"].dt.floor("h")
    grouped = (
        values.groupby(["bucket", "severity"], as_index=False)
        .size()
        .rename(columns={"size": "events"})
    )
    figure = go.Figure()
    for severity, group in grouped.groupby("severity", sort=True):
        figure.add_trace(go.Bar(x=group["bucket"], y=group["events"], name=str(severity)))
    figure.update_layout(
        title="Operational events by severity",
        barmode="stack",
        xaxis_title="UTC hour",
        yaxis_title="Events",
        height=360,
    )
    return figure
