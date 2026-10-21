"""Offline causal setup scanner. No inference, broker, sizing or promotion authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timedelta
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from itertools import pairwise
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator

from python.analytics.models import ApiModel, Candle, parse_decimal_string
from python.technical.models import ContextEvidence, ContextRequestV11, FrameContext
from python.technical.service import prepare_context

D = Decimal
VERSION = "scalp-candidates-1.0"


class ScanRequest(ApiModel):
    schema_version: Literal["scalp-scan-request-1.0"] = Field(alias="schemaVersion")
    source: ContextRequestV11
    # Price distance per unit: modeled round-trip fees plus adverse execution
    # reserve, EXCLUDING spread (added independently). Unknown is never zero.
    round_trip_cost_price: str | None

    @field_validator("round_trip_cost_price")
    @classmethod
    def cost(cls, value: str | None) -> str | None:
        if value is not None and parse_decimal_string(value) <= 0:
            raise ValueError("positive cost distance required")
        return value


class Candidate(ApiModel):
    setup: Literal["TREND_PULLBACK", "SWEEP_RECLAIM", "COMPRESSION_BREAKOUT"]
    side: Literal["BUY", "SELL"]
    order_type: Literal["LIMIT", "STOP_LIMIT"]
    entry: str
    invalidation: str
    target: str
    gross_reward_to_stop: str
    modeled_net_reward_to_cost: str
    source_available_at: str
    admission_until: str
    reasons: list[str]


class ScanReport(ApiModel):
    schema_version: Literal["scalp-scan-report-1.0"] = Field(
        alias="schemaVersion", default="scalp-scan-report-1.0"
    )
    definitions_version: Literal["scalp-candidates-1.0"] = "scalp-candidates-1.0"
    execution_authority: Literal[False] = False
    promotion: Literal["HOLD"] = "HOLD"
    input_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    observed_at: str
    status: Literal["OCO_CANDIDATE", "NO_PAIR", "REJECTED"]
    reasons: list[str]
    candidates: list[Candidate] = Field(max_length=6)
    # Exactly two deterministic indices, or no pair. Never broker permission.
    pair: tuple[int, int] | None
    counterfactual_net_pnl: None = None
    limitations: tuple[str, ...] = (
        "RESEARCH_ONLY_NOT_EXECUTABLE",
        "MODELED_COSTS_NOT_EXACT_VOLUME_BROKER_EVIDENCE",
        "BROKER_DEPTH_NOT_CONSOLIDATED_ORDER_FLOW",
        "NO_FILLS_OR_PROFITABILITY_INFERRED",
        "ADMISSION_EXPIRY_DOES_NOT_CANCEL_ACCEPTED_GTC",
    )


def text(value: Decimal) -> str:
    return format(value, "f")


def aligned(value: Decimal, tick: Decimal, up: bool) -> Decimal:
    return (value / tick).to_integral_value(rounding=ROUND_CEILING if up else ROUND_FLOOR) * tick


def scan_evidence(
    source: ContextRequestV11, evidence: ContextEvidence, costs: Decimal
) -> list[Candidate]:
    """Internal pure scanner; public scan() recomputes evidence from validated OHLC."""
    frames = {frame.timeframe: frame for frame in evidence.frames}
    m1, m5, m15 = (frames[name] for name in ("M1", "M5", "M15"))
    tick = D(source.tick_size)
    bid, ask = D(source.quote.bid), D(source.quote.ask)
    spread, atr = ask - bid, D(m1.atr)
    now = source.snapshot_time
    if atr <= 0 or spread <= 0 or spread > atr * D("0.15"):
        return []
    distance = max(tick, D(source.minimum_entry_distance))
    buffer = max(tick * 2, spread)
    total_cost = costs + spread
    candles = next(s.candles for s in source.request.candles if s.timeframe == "M1")
    # Do not bridge closures or unverified missing bars for these short patterns.
    recent: list[Candle] = candles[-7:]
    if len(recent) < 7 or any(a.end_time != b.start_time for a, b in pairwise(recent)):
        return []
    candidates: list[Candidate] = []

    def add(
        setup: Literal["TREND_PULLBACK", "SWEEP_RECLAIM", "COMPRESSION_BREAKOUT"],
        side: Literal["BUY", "SELL"],
        entry: Decimal,
        stop: Decimal,
        available: datetime,
        reasons: list[str],
    ) -> None:
        buy = side == "BUY"
        limit = setup != "COMPRESSION_BREAKOUT"
        # Buy limits round down, sell limits up; stop entries round outward.
        entry = aligned(entry, tick, buy != limit)
        stop = aligned(stop, tick, buy)
        risk = (entry - stop) if buy else (stop - entry)
        if min(entry, stop) <= 0 or risk < max(5 * tick, 2 * spread) or risk > atr * D("1.5"):
            return
        if not 0 <= (now - available).total_seconds() < 120:
            return
        bound = (
            (bid - distance if buy else ask + distance)
            if limit
            else (ask + distance if buy else bid - distance)
        )
        if (limit and ((buy and entry > bound) or (not buy and entry < bound))) or (
            not limit and ((buy and entry < bound) or (not buy and entry > bound))
        ):
            return
        # Fixed 1:1 gross candidate, never fitted to observed outcomes. Reject
        # when costs consume >1/3 of gross reward; do not widen target to pass.
        target = entry + risk if buy else entry - risk
        if target <= 0 or risk < 3 * total_cost:
            return
        candidates.append(
            Candidate(
                setup=setup,
                side=side,
                order_type="LIMIT" if limit else "STOP_LIMIT",
                entry=text(entry),
                invalidation=text(stop),
                target=text(target),
                gross_reward_to_stop="1",
                modeled_net_reward_to_cost=text((risk - total_cost) / total_cost),
                source_available_at=available.isoformat(),
                admission_until=min(
                    now + timedelta(seconds=60), available + timedelta(seconds=120)
                ).isoformat(),
                reasons=reasons,
            )
        )

    def latest_zones(frame: FrameContext, bullish: bool) -> list[tuple[Decimal, Decimal, datetime]]:
        direction = "BULLISH" if bullish else "BEARISH"
        result = []
        for zone in frame.nearest_active_zones:
            at = datetime.fromisoformat(zone.available_at)
            if zone.direction != direction or zone.status != "FRESH" or zone.age_bars > 12:
                continue
            if at.tzinfo is None or not 0 <= (now - at).total_seconds() < 120:
                continue
            low, high = D(zone.lower), D(zone.upper)
            if 0 < low < high:
                result.append((low, high, at))
        return sorted(result, key=lambda z: z[2], reverse=True)

    for bullish in (True, False):
        direction = "BULLISH" if bullish else "BEARISH"
        side_typed: Literal["BUY", "SELL"] = "BUY" if bullish else "SELL"
        # Structural and EMA direction must agree in BOTH higher frames.
        aligned_trend = all(
            frame.bias == direction
            and (
                (D(frame.ema_fast) > D(frame.ema_slow))
                if bullish
                else (D(frame.ema_fast) < D(frame.ema_slow))
            )
            for frame in (m5, m15)
        )
        zones = latest_zones(m1, bullish)
        if aligned_trend and zones:
            low, high, at = zones[0]
            add(
                "TREND_PULLBACK",
                side_typed,
                high if bullish else low,
                low - buffer if bullish else high + buffer,
                at,
                ["M15_M5_STRUCTURE_EMA_AGREE", "FRESH_M1_ZONE_RETEST"],
            )

        # A completed sweep must reclaim a known M1 pivot and intersect an
        # existing higher-frame POI; no future reversal candle is consulted.
        events = [e for e in m1.events if e.kind == "SWEEP" and e.direction == direction]
        events.sort(key=lambda e: e.available_at, reverse=True)
        if events:
            event = events[0]
            at = datetime.fromisoformat(event.available_at)
            bar = next((c for c in recent if c.end_time == at), None)
            if bar is not None:
                level = D(event.level)
                swept = (
                    (bar.low_decimal < level < bar.close_decimal)
                    if bullish
                    else (bar.close_decimal < level < bar.high_decimal)
                )
                poi = any(
                    z.direction == direction
                    and z.status in {"FRESH", "TOUCHED"}
                    and datetime.fromisoformat(z.available_at) <= at
                    and D(z.lower) <= bar.high_decimal
                    and D(z.upper) >= bar.low_decimal
                    for frame in (m5, m15)
                    for z in frame.nearest_active_zones
                )
                if swept and poi:
                    add(
                        "SWEEP_RECLAIM",
                        side_typed,
                        level,
                        bar.low_decimal - buffer if bullish else bar.high_decimal + buffer,
                        at,
                        ["COMPLETED_SWEEP_RECLAIM", "HIGHER_FRAME_POI_INTERSECTION"],
                    )

    # Neutral higher structure + six narrow bars creates two independently
    # defined outward entries. No forming candle or future expansion is used.
    box = recent[-6:]
    high, low = max(c.high_decimal for c in box), min(c.low_decimal for c in box)
    width = high - low
    neutral = m5.bias == "UNKNOWN" and m15.bias == "UNKNOWN"
    if (
        neutral
        and 6 * total_cost <= width <= atr * D("1.2")
        and all(c.high_decimal - c.low_decimal <= atr * D("0.8") for c in box)
    ):
        at = box[-1].end_time
        add(
            "COMPRESSION_BREAKOUT",
            "BUY",
            high + buffer,
            low - buffer,
            at,
            ["NEUTRAL_HIGHER_STRUCTURE", "SIX_COMPLETED_BAR_COMPRESSION"],
        )
        add(
            "COMPRESSION_BREAKOUT",
            "SELL",
            low - buffer,
            high + buffer,
            at,
            ["NEUTRAL_HIGHER_STRUCTURE", "SIX_COMPLETED_BAR_COMPRESSION"],
        )
    return candidates


def scan(request: ScanRequest) -> ScanReport:
    raw = request.model_dump_json(by_alias=True)
    common = {
        "input_sha256": hashlib.sha256(raw.encode()).hexdigest(),
        "observed_at": request.source.snapshot_time.isoformat(),
    }
    context = prepare_context(request.source)
    reasons = list(context.reasons)
    if request.round_trip_cost_price is None:
        reasons.append("MODELED_COSTS_UNAVAILABLE")
    if reasons:
        return ScanReport(**common, status="REJECTED", reasons=reasons, candidates=[], pair=None)
    assert context.evidence is not None and request.round_trip_cost_price is not None
    if not context.evidence.history_targets_met:
        return ScanReport(
            **common,
            status="REJECTED",
            reasons=["EXPANDED_HISTORY_REQUIRED"],
            candidates=[],
            pair=None,
        )
    candidates = scan_evidence(request.source, context.evidence, D(request.round_trip_cost_price))
    buys = [i for i, c in enumerate(candidates) if c.side == "BUY"]
    sells = [i for i, c in enumerate(candidates) if c.side == "SELL"]
    # Only same-family pairs are supported by this candidate contract. A valid
    # single directional signal is recorded but never given a fabricated peer.
    pair = next(
        ((b, s) for b in buys for s in sells if candidates[b].setup == candidates[s].setup), None
    )
    return ScanReport(
        **common,
        status="OCO_CANDIDATE" if pair else "NO_PAIR",
        reasons=[] if pair else ["TWO_INDEPENDENT_SIDES_REQUIRED"],
        candidates=candidates,
        pair=pair,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.input.is_symlink():
            raise ValueError("symlink")
        with args.input.open("rb") as handle:
            raw = handle.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("oversized")
        report = scan(ScanRequest.model_validate_json(raw))
        # Exclusive creation, including broken symlinks: never replace evidence.
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(report.model_dump_json(by_alias=True, indent=2) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        print(
            json.dumps({"status": report.status, "executionAuthority": False, "promotion": "HOLD"})
        )
    except (ValueError, OSError, KeyError):
        parser.exit(2, "SCALP_SCAN_FAILED: validate saved input and use an unused output path\n")


if __name__ == "__main__":
    main()
