"""Explicit presentation boundary: Decimal money, verified candles, safe bounded events."""

import hashlib
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from apps.dashboard.command_model import action, cumulative_net, direction, levels, number
from apps.dashboard.overview import fresh, money, position_rows, risk_summary
from apps.dashboard.time_display import format_gmt8_timestamp


def price(value: object) -> str:
    n = number(value)
    if n is None or n <= 0:
        return "Unavailable"
    text = format(n, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def signed(value: object) -> str:
    return ("+" if direction(value) == "positive" else "") + money(value)


def stamp(value: object) -> datetime | None:
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
        return result.astimezone(UTC) if result.tzinfo else None
    except (ValueError, TypeError):
        return None


def deadline(value: object, seconds: int) -> str | None:
    at = stamp(value)
    return (at + timedelta(seconds=seconds)).isoformat() if at else None


def codes(values: object) -> str:
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, list):
        return ""
    return " · ".join(
        v for v in values[:5] if isinstance(v, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,119}", v)
    )


def event_tape(rows: list[dict[str, Any]], now: datetime) -> list[dict[str, str]]:
    output = []

    def emit(row: dict[str, Any], at: object, source: str, title: str, detail: str) -> None:
        timestamp = stamp(at)
        if timestamp is None or timestamp > now or not row.get("id"):
            return
        identity = f"{row.get('kind')}:{row['id']}:{timestamp.isoformat()}:{title}"
        output.append(
            {
                "id": hashlib.sha256(identity.encode()).hexdigest(),
                "at": timestamp.isoformat(),
                "time": timestamp.astimezone(ZoneInfo("Asia/Singapore")).strftime("%d %b %H:%M:%S"),
                "source": source,
                "title": title,
                "detail": detail,
            }
        )

    for row in rows[:100]:
        kind = row.get("kind")
        if kind == "mode":
            emit(
                row,
                row.get("recorded_at"),
                "engine",
                f"Operator mode · {row.get('entry_mode')}",
                "Applies to new setups only; accepted orders retain their recorded mode.",
            )
        if kind == "context":
            emit(
                row,
                row.get("requested_at"),
                "codex",
                "Provider request claimed",
                "Durable local claim; not proof of provider receipt.",
            )
            if row.get("state") == "READY":
                emit(
                    row,
                    row.get("available_at"),
                    "codex",
                    "Codex chose WAIT"
                    if row.get("plan_schema") == "entry-wait-1.0"
                    else f"Codex range · {row.get('entry_side')} trend judgment"
                    if row.get("plan_schema") in {"entry-direction-1.0", "entry-modes-1.0"}
                    and row.get("entry_side") in {"BUY", "SELL"}
                    else "Entry prices available",
                    (
                        str(row.get("wait_reason") or "No setup proposed.")[:1200]
                        if row.get("plan_schema")
                        in {"entry-wait-1.0", "entry-direction-1.0", "entry-modes-1.0"}
                        else (
                            "Recorded provider result; deterministic validation "
                            "still owns execution."
                        )
                    ),
                )
            elif row.get("state") == "FAILED":
                emit(
                    row,
                    row.get("completed_at"),
                    "codex",
                    "Provider request failed",
                    codes(row.get("reason"))
                    or "Recorded failure; no valid result authorizes a new order.",
                )
        elif kind == "analysis":
            state = str(row.get("state"))
            if state not in {
                "DEFERRED",
                "ACCEPTED",
                "REJECTED",
                "EXPIRED",
                "VALIDATING",
                "MODEL_PENDING",
                "COLLECTING",
                "FEATURED",
                "PENDING",
            }:
                continue
            emit(
                row,
                row.get("updated_at"),
                "engine",
                f"Execution check · {state}",
                codes(row.get("deferral_reason"))
                or codes(row.get("rejection_reasons"))
                or "Recorded local check; not a paid provider request or a fill.",
            )
        elif kind == "broker":
            order = row.get("order_state")
            position = row.get("position_state")
            allowed = {
                "PENDING",
                "FILLED",
                "PARTIALLY_FILLED",
                "CANCELLED",
                "REJECTED",
                "EXPIRED",
                "OPEN",
                "CLOSING",
                "CLOSED",
                "UNKNOWN",
                "RECONCILIATION_PENDING",
            }
            detail = (
                " / ".join(str(v) for v in [order, position] if v in allowed)
                or "Broker lifecycle message recorded."
            )
            if row.get("mapping_state") != "MAPPED":
                detail = "Mapping unresolved; this message is not proof of recovered ownership."
            emit(
                row,
                row.get("received_at"),
                "broker",
                "Broker event received",
                detail + " Broker time: " + format_gmt8_timestamp(row.get("occurred_at")),
            )
        elif kind == "close":
            emit(
                row,
                row.get("closed_at"),
                "broker",
                "Closed outcome recorded",
                "Realized net "
                + signed(row.get("realized_pnl"))
                + "; signed broker fees already included. Exit cause is not inferred from P/L.",
            )
    return sorted({v["id"]: v for v in output}.values(), key=lambda v: (v["at"], v["id"]))[-100:]


def completed_series(rows: list[dict[str, Any]], now: datetime) -> dict[str, list[dict[str, str]]]:
    result: dict[str, list[dict[str, str]]] = {f: [] for f in ["M1", "M5", "M15"]}
    for frame in result:
        selected = [r for r in rows if r.get("timeframe") == frame]
        try:
            seen: set[datetime] = set()
            for row in selected[-80:]:
                start, end = stamp(row.get("start_time")), stamp(row.get("end_time"))
                values = {k: number(row.get(k)) for k in ["open", "high", "low", "close"]}
                if (
                    row.get("complete") is not True
                    or start is None
                    or end is None
                    or not start < end <= now
                    or start in seen
                ):
                    raise ValueError("CANDLE_TIME_INVALID")
                if any(v is None or v <= 0 for v in values.values()):
                    raise ValueError("CANDLE_PRICE_INVALID")
                o, h, lo, c = (values[k] for k in ["open", "high", "low", "close"])
                assert o is not None and h is not None and lo is not None and c is not None
                if h < max(o, lo, c) or lo > min(o, h, c):
                    raise ValueError("CANDLE_GEOMETRY_INVALID")
                seen.add(start)
                result[frame].append(
                    {
                        "at": start.isoformat(),
                        "label": format_gmt8_timestamp(start),
                        **{k: str(v) for k, v in values.items()},
                    }
                )
            result[frame].sort(key=lambda r: r["at"])
        except (ValueError, TypeError):
            result[frame] = []
    return result


def landscape_model(snapshot: dict[str, Any], poll_state: str, now: datetime) -> dict[str, Any]:
    if poll_state != "ready" or not fresh(snapshot.get("captured_at"), now):
        snapshot = {}
    status = snapshot.get("status") or {"unavailable": True}
    available = not status.get("unavailable") and bool(status.get("mode"))
    current = action(status, now)
    if not available:
        current.update(
            title="Connecting" if poll_state == "loading" else "Data unavailable", active=None
        )
        snapshot = {}  # No current financial/exposure inference from a failed status read.
    captured = snapshot.get("captured_at")
    daily, capital = snapshot.get("daily", {}), snapshot.get("capital", {})
    if str(daily.get("trading_day")) != now.date().isoformat():
        daily = {}
    summary = risk_summary(daily, capital, now)
    values: dict[str, Any] = {}

    def value(key: str, text: object, tone: str = "neutral", until: str | None = None) -> None:
        values[key] = {"text": str(text), "tone": tone, "until": until or deadline(captured, 30)}

    value("equity", summary["equity"], until=deadline(daily.get("reconciled_at"), 30))
    value(
        "day-net",
        signed(daily.get("realized_pnl"))
        if summary["realized"] != "Unavailable"
        else "Unavailable",
        direction(daily.get("realized_pnl")),
        deadline(daily.get("reconciled_at"), 30),
    )
    value(
        "ceiling",
        summary["setup_budget"],
        until=min(
            filter(
                None,
                [deadline(daily.get("reconciled_at"), 30), deadline(capital.get("updated_at"), 30)],
            ),
            default=None,
        ),
    )
    monitor = snapshot.get("monitor") or {}
    monitor_ok = monitor.get("status") == "AVAILABLE" and all(
        fresh(monitor.get(k), now, 10)
        for k in ["pnlCapturedAt", "quoteSourceTime", "quoteReceivedAt"]
    )
    net = signed(monitor.get("netUnrealizedPnl")) if monitor_ok else "Unavailable"
    pnl_until = min(
        filter(
            None,
            [
                deadline(monitor.get(k), 10)
                for k in ["pnlCapturedAt", "quoteSourceTime", "quoteReceivedAt"]
            ],
        ),
        default=None,
    )
    value(
        "open-net",
        net,
        direction(monitor.get("netUnrealizedPnl")) if monitor_ok else "neutral",
        pnl_until,
    )
    value(
        "position-pnl",
        net,
        direction(monitor.get("netUnrealizedPnl")) if monitor_ok else "neutral",
        pnl_until,
    )
    market = (snapshot.get("market") or [{}])[0]
    market_ok = (
        market.get("complete") is True
        and not market.get("discontinuity")
        and fresh(market.get("source_time"), now, 10)
    )
    quote_source = market if market_ok else {}
    quote_until = deadline(market.get("source_time"), 10) if market_ok else None
    if (
        not market_ok
        and monitor.get("status") == "AVAILABLE"
        and all(fresh(monitor.get(k), now, 10) for k in ["quoteSourceTime", "quoteReceivedAt"])
    ):
        quote_source = monitor
        quote_until = min(
            filter(
                None, [deadline(monitor.get(k), 10) for k in ["quoteSourceTime", "quoteReceivedAt"]]
            ),
            default=None,
        )
    bid, ask = number(quote_source.get("bid")), number(quote_source.get("ask"))
    if bid is None or ask is None or not 0 < bid <= ask:
        bid, ask = None, None
    value("quote", price(bid), until=quote_until)
    value("ask", price(ask), until=quote_until)
    evidence = snapshot.get("evidence") or {}
    features = (evidence.get("features") or {}).get("timeframes") or {}
    factors = [
        (
            f"{f} EMA alignment",
            str((features.get(f) or {}).get("ema_alignment"))
            if (features.get(f) or {}).get("ema_alignment") in {"BULLISH", "BEARISH", "FLAT"}
            else "Unavailable",
        )
        for f in ["M15", "M5", "M1"]
    ]
    factors += [
        (
            "Analytics quality",
            "PASS · recorded"
            if evidence.get("analytics_acceptable") is True
            else "REJECT · recorded"
            if evidence.get("analytics_acceptable") is False
            else "Unavailable",
        ),
        ("Recorded M1 ATR", price((features.get("M1") or {}).get("atr"))),
        (
            "Current spread",
            str(ask - bid) if ask is not None and bid is not None else "Unavailable",
        ),
        ("Current drawdown", summary["drawdown"]),
        ("Risk policy", summary["policy"]),
    ]
    factors += [
        (
            "Validation · " + str(v.get("stage")),
            "PASS · recorded" if v.get("accepted") is True else "REJECT · recorded",
        )
        for v in snapshot.get("validations", [])[:4]
    ]
    for r in snapshot.get("risks", [])[:2]:
        factors.append((str(r.get("side")) + " modeled allocation", money(r.get("risk_budget"))))
    positions = position_rows(snapshot.get("positions", []), now)
    rendered_positions = []
    for p in positions[:20]:
        verified = p.get("protection_status") == "VERIFIED" and fresh(
            p.get("protection_observed_at"), now, 10
        )
        simulated = status.get("mode") == "paper" and p.get("protection_status") == "SIMULATED"
        rendered_positions.append(
            {
                "side": str(p.get("side")),
                "state": str(p.get("state")),
                "volume": str(p.get("volume")),
                "entry": price(p.get("entry_price")),
                "sl": price(p.get("stop_loss")) if verified or simulated else "Unavailable",
                "tp": price(p.get("take_profit")) if verified or simulated else "Unavailable",
                "protection": "Verified broker"
                if verified
                else "Simulated"
                if simulated
                else "Unverified / stale",
                "until": deadline(p.get("protection_observed_at"), 10)
                if verified
                else deadline(captured, 30),
            }
        )
    curve_rows = snapshot.get("curve", [])[:300]
    curve = []
    try:
        ordered = sorted(curve_rows, key=lambda r: str(r.get("closed_at")))
        accumulated = cumulative_net([r.get("net_pnl") for r in ordered])
        timestamps = [stamp(r.get("closed_at")) for r in ordered]
        if any(t is None or t > now for t in timestamps):
            raise ValueError("CURVE_TIME_INVALID")
        curve = [
            {"at": str(r["closed_at"]), "net": n} for r, n in zip(ordered, accumulated, strict=True)
        ]
    except (ValueError, TypeError):
        pass
    value(
        "closed-net",
        signed(curve[-1]["net"]) if curve else "Unavailable",
        direction(curve[-1]["net"]) if curve else "neutral",
    )
    capture_stamp = stamp(captured)
    overlays = levels(snapshot, now)
    broker_deadline = min(
        (
            p["until"]
            for p in rendered_positions
            if p["protection"] == "Verified broker" and p["until"]
        ),
        default=None,
    )
    for overlay in overlays:
        if overlay["label"].startswith("broker") and broker_deadline:
            overlay["until"] = broker_deadline
    cycle = (status.get("lastCycle") or {}).get("outcome")
    if cycle in {"DEFERRED", "REJECTED", "PLACED"}:
        current["detail"] += (
            " Latest execution check: "
            + cycle
            + (" (waiting; no order attempted)." if cycle == "DEFERRED" else ".")
        )
    return {
        "capturedAt": capture_stamp.isoformat() if capture_stamp else None,
        "expiresAt": deadline(captured, 30),
        "available": available,
        "mode": str(status.get("mode", "unknown")).upper(),
        "symbol": str(status.get("symbol", "Unavailable")),
        "currency": str(snapshot.get("currency", "Currency unavailable")),
        "session": str((status.get("marketSession") or {}).get("state", "UNAVAILABLE")),
        "sessionUntil": deadline((status.get("marketSession") or {}).get("checkedAt"), 30),
        "strategy": str(status.get("strategyVersion", "Unavailable")),
        "title": current["title"],
        "detail": current["detail"],
        "next": current["next"],
        "stage": {"codex": "ai", "protect": "position"}.get(current["active"], current["active"]),
        "reasons": codes(current["reasons"]),
        "warnings": [str(v) for v in snapshot.get("warnings", [])[:3]],
        "values": values,
        "factors": factors,
        "factorUntil": {
            "Current spread": quote_until,
            "Current drawdown": deadline(capital.get("updated_at"), 30),
            "Risk policy": min(
                filter(
                    None,
                    [
                        deadline(capital.get("updated_at"), 30),
                        deadline(daily.get("reconciled_at"), 30),
                    ],
                ),
                default=None,
            ),
        },
        "positions": rendered_positions,
        "orders": [
            {
                "side": str(o.get("side")),
                "state": str(o.get("state")),
                "entry": price(o.get("entry_price")),
                "sl": price(o.get("stop_loss")),
                "tp": price(o.get("take_profit")),
                "tif": str(o.get("time_in_force")),
                "orderType": str(o.get("execution_order_type") or "Unknown type"),
            }
            for o in snapshot.get("orders", [])[:20]
        ],
        "exposureKnown": "positions" in snapshot and "orders" in snapshot,
        "gross": money(monitor.get("grossUnrealizedPnl")) if monitor_ok else "Unavailable",
        "commission": money(monitor.get("recordedCommission")) if monitor_ok else "Unavailable",
        "pnlUntil": pnl_until,
        "charts": completed_series(snapshot.get("candles", []), now),
        "chartSource": str(evidence.get("chart_source", "Recorded setup snapshot")),
        "chartAt": format_gmt8_timestamp(evidence.get("chart_at")),
        "overlays": overlays,
        "curve": curve,
        "events": event_tape(snapshot.get("events", []), now),
        "entryMode": status.get("entryMode") if available else None,
        "flight": snapshot.get("flight", {"available": False})
        if available
        else {"available": False},
        "setupRiskPercent": str(
            (status.get("riskPolicy") or {}).get("setupRiskPercent", "Unavailable")
        ),
        "eventWindow": "Latest bounded journal window; not a complete event stream.",
    }
