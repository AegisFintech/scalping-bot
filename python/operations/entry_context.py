"""Bounded read-only projection of exact recorded provider input, never entry authority."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from decimal import ROUND_FLOOR, Decimal
from itertools import pairwise
from typing import Any


def number(value: object) -> Decimal:
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError("CONTEXT_NUMBER_INVALID")
    return result


def plain(value: Decimal) -> str:
    return format(value, "f")


def timestamp(value: Any) -> datetime:
    result = (
        value
        if isinstance(value, datetime)
        else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    )
    if result.tzinfo is None:
        raise ValueError("CONTEXT_TIME_INVALID")
    return result.astimezone(UTC)


COLUMNS = [
    "startTime",
    "endTime",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "complete",
    "qualityFlags",
]


def entry_context(request: str | None, plan: Any, captured: Any, available: Any) -> dict[str, Any]:
    """Do not infer the model's exact box from its buffered levels or prose."""
    missing: dict[str, Any] = {"schemaVersion": "1.0", "state": "UNAVAILABLE"}
    try:
        if request is None or len(request.encode()) > 128000 or not isinstance(plan, dict):
            return missing
        payload = json.loads(request)
        tick = number(payload["tick_size"])
        captured_at, available_at = timestamp(captured), timestamp(available)
        if tick <= 0 or captured_at > available_at:
            raise ValueError("CONTEXT_PROVENANCE_INVALID")
        if timestamp(payload["captured_at"]) != captured_at:
            raise ValueError("CONTEXT_CAPTURE_MISMATCH")
        upper, lower = number(plan["buy_stop"]), number(plan["sell_stop"])
        if not 0 < lower < upper or upper % tick or lower % tick:
            raise ValueError("CONTEXT_LEVELS_INVALID")
        side = plan.get("entry_side")
        if side not in {"BUY", "SELL"}:
            raise ValueError("CONTEXT_DIRECTION_INVALID")
        frames = [frame for frame in payload["candles"] if frame["timeframe"] == "M1"]
        if len(frames) != 1 or frames[0]["columns"] != COLUMNS:
            raise ValueError("CONTEXT_M1_INVALID")
        rows = frames[0]["rows"]
        if not isinstance(rows, list) or not 5 <= len(rows) <= 288:
            raise ValueError("CONTEXT_M1_INVALID")
        prior = None
        for row in rows:
            if len(row) != 9 or row[7] is not True or row[8]:
                raise ValueError("CONTEXT_COMPLETED_M1_REQUIRED")
            start, end = timestamp(row[0]), timestamp(row[1])
            o, h, lo, close = (number(row[i]) for i in (2, 3, 4, 5))
            if end - start != timedelta(minutes=1) or end > captured_at:
                raise ValueError("CONTEXT_M1_TIME_INVALID")
            if prior is not None and start != prior:
                raise ValueError("CONTEXT_M1_GAP")
            if not 0 < lo <= min(o, close) <= max(o, close) <= h:
                raise ValueError("CONTEXT_M1_OHLC_INVALID")
            prior = end
        if captured_at - timestamp(rows[-1][1]) > timedelta(minutes=2):
            raise ValueError("CONTEXT_M1_STALE")
        quote = payload["quote"]
        bid, ask = number(quote["bid"]), number(quote["ask"])
        if not 0 < bid <= ask:
            raise ValueError("CONTEXT_QUOTE_INVALID")
        qt, qr = timestamp(quote["sourceTime"]), timestamp(quote["receivedAt"])
        if not qt <= captured_at <= qr <= available_at or qr - qt > timedelta(seconds=3):
            raise ValueError("CONTEXT_QUOTE_TIME_INVALID")
        boxes = []
        for count in (5, 10):
            if len(rows) < count:
                continue
            upper_box = max(number(r[3]) for r in rows[-count:])
            lower_box = min(number(r[4]) for r in rows[-count:])
            boxes.append(
                {
                    "candles": count,
                    "upper": plain(upper_box),
                    "lower": plain(lower_box),
                    "buyOffset": plain(upper - upper_box),
                    "sellOffset": plain(lower_box - lower),
                    "basis": "COMPLETED_M1_ENVELOPE_NOT_MODEL_SELECTED_BOX",
                }
            )
        levels = []
        for step in (Decimal(5), Decimal(10)):
            floor = (bid / step).to_integral_value(rounding=ROUND_FLOOR) * step
            for level in (floor, floor + step):
                if level <= 0:
                    continue
                touches = sum(number(r[4]) <= level <= number(r[3]) for r in rows)
                crosses = sum(
                    (number(a[5]) < level < number(b[5])) or (number(b[5]) < level < number(a[5]))
                    for a, b in pairwise(rows)
                )
                levels.append(
                    {
                        "step": plain(step),
                        "price": plain(level),
                        "fromBuy": plain(level - upper),
                        "fromSell": plain(level - lower),
                        "observedM1Touches": touches,
                        "observedCloseCrosses": crosses,
                    }
                )
        depth = payload.get("technical_context", {}).get("depth")
        # Keep exact bounded numeric/context structure; no invented liquidity at round levels.
        depth_hash = None
        if isinstance(depth, dict):
            depth_hash = hashlib.sha256(json.dumps(depth, sort_keys=True).encode()).hexdigest()
        boundaries = payload.get("entry_boundaries", {})
        buffer = boundaries.get("movement_buffer")
        if buffer is not None:
            buffer = plain(number(buffer))
            if number(buffer) < 0:
                raise ValueError("CONTEXT_BUFFER_INVALID")
        result = {
            "schemaVersion": "1.0",
            "state": "RECORDED",
            "capturedAt": captured_at.isoformat(),
            "availableAt": available_at.isoformat(),
            "tickSize": plain(tick),
            "codexDirection": side,
            "upperEntry": plain(upper),
            "lowerEntry": plain(lower),
            "modelSelectedBox": None,
            "spread": plain(ask - bid),
            "movementBufferGuidance": buffer,
            "completedM1Envelopes": boxes,
            "roundLevels": levels,
            "roundLevelLiquidity": None,
            "depthInputSha256": depth_hash,
            "depthSummary": {
                k: depth[k]
                for k in (
                    "scope",
                    "timestamp_basis",
                    "source_at",
                    "received_at",
                    "bid_levels",
                    "ask_levels",
                    "symmetric_sizes",
                    "spread",
                    "imbalance",
                    "microprice_bias",
                    "bid_liquidity_change_60s",
                    "ask_liquidity_change_60s",
                    "rolling_sample_count_60s",
                    "warnings",
                )
                if k in depth
            }
            if isinstance(depth, dict)
            else None,
            "depthScope": "BROKER_ONLY_NOT_GLOBAL_FLOW",
            "counterfactualNet": None,
            "brokerAuthority": False,
        }
        if plan.get("schema_version") == "entry-scalp-1.0":
            result["schemaVersion"] = "1.1"
            result["referenceBasis"] = "SINGLE_ENTRY_AND_INVALIDATION_NOT_TWO_ENTRIES"
            result["entryPrice"] = result.pop("upperEntry" if side == "BUY" else "lowerEntry")
            result["invalidationPrice"] = result.pop(
                "lowerEntry" if side == "BUY" else "upperEntry"
            )
            result["proposedTakeProfit"] = plan.get("take_profit")
            result["proposedStopLoss"] = plan.get("stop_loss")
            result["pendingExpiresAt"] = plan.get("valid_until")
        return result
    except (ValueError, KeyError, TypeError, ArithmeticError):
        return missing


def context_hash(value: object) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) else None
