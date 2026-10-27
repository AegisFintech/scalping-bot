from __future__ import annotations

import hashlib
import json
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from pathlib import Path

from python.analytics.service import TIMEFRAME_SECONDS, quality_reasons
from python.technical import levels
from python.technical.models import (
    ContextEvidence,
    ContextEvidenceV11,
    ContextRequest,
    ContextRequestV11,
    ContextRequestV12,
    ContextResponse,
    ContextResponseV11,
    DepthContext,
    FrameContextV11,
)
from python.technical.structure import TARGET_COUNTS, frame_context, text

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts/research/entry-context-v1.md"
LEVEL_CANDIDATE_LIMIT = 64000


def context_reasons(source: ContextRequest | ContextRequestV11) -> list[str]:
    request = source.request
    book = request.order_book
    snapshot_time = (
        source.snapshot_time if isinstance(source, ContextRequestV11) else request.server_time
    )
    reasons: list[str] = []
    if book.source_time.tzinfo is None or book.received_at.tzinfo is None:
        return ["DEPTH_TIMEZONE_MISSING"]
    reasons.extend(quality_reasons(request))
    if not 0 <= (snapshot_time - request.server_time).total_seconds() <= 3:
        reasons.append("SNAPSHOT_BROKER_CLOCK_SKEW_INVALID")
    if request.symbol != "XAUUSD":
        reasons.append("SYMBOL_UNSUPPORTED")
    if not 0 <= (request.server_time - request.analysis_time).total_seconds() <= 3:
        reasons.append("ANALYSIS_SNAPSHOT_TIME_INVALID")
    for name, sourced, received in (
        ("QUOTE", source.quote.source_time, source.quote.received_at),
        ("DEPTH", book.source_time, book.received_at),
    ):
        if not sourced <= received <= snapshot_time:
            reasons.append(f"{name}_TIME_ORDER_INVALID")
        if not 0 <= (snapshot_time - sourced).total_seconds() <= 3:
            reasons.append(f"{name}_STALE_AT_SNAPSHOT")
    if Decimal(source.quote.bid) >= Decimal(source.quote.ask):
        reasons.append("QUOTE_CROSSED")
    for series in request.candles:
        age = (request.server_time - series.candles[-1].end_time).total_seconds()
        if not 0 <= age < TIMEFRAME_SECONDS[series.timeframe]:
            reasons.append(f"{series.timeframe}_STALE_AT_SNAPSHOT")
        if len(series.candles) < 40:
            reasons.append(f"{series.timeframe}_WARMUP_UNAVAILABLE")
    if len({x.price for x in book.bids}) != len(book.bids) or (
        len({x.price for x in book.asks}) != len(book.asks)
    ):
        reasons.append("DEPTH_DUPLICATE_PRICE")
    return sorted(set(reasons))


def prepare_context(source: ContextRequest | ContextRequestV11) -> ContextResponse:
    request = source.request
    raw = json.dumps(source.model_dump(mode="json", by_alias=True), sort_keys=True)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    common = dict(
        request_id=request.request_id,
        analysis_id=request.analysis_id,
        input_sha256=digest,
        captured_at=request.analysis_time,
    )
    reasons = context_reasons(source)
    if reasons:
        return ContextResponse(
            **common, acceptable=False, reasons=reasons, evidence=None, codex_payload=None
        )
    quote_mid = (Decimal(source.quote.bid) + Decimal(source.quote.ask)) / 2
    frames = [
        frame_context(series, quote_mid, Decimal(source.tick_size))
        for series in sorted(
            request.candles, key=lambda s: TIMEFRAME_SECONDS[s.timeframe], reverse=True
        )
    ]
    book = request.order_book
    bid_total = sum((Decimal(x.size) for x in book.bids), Decimal(0))
    ask_total = sum((Decimal(x.size) for x in book.asks), Decimal(0))
    top_bid, top_ask = book.bids[0], book.asks[0]
    top_size = Decimal(top_bid.size) + Decimal(top_ask.size)
    spread = Decimal(top_ask.price) - Decimal(top_bid.price)
    midpoint = (Decimal(top_ask.price) + Decimal(top_bid.price)) / 2
    microprice = (
        (
            Decimal(top_ask.price) * Decimal(top_bid.size)
            + Decimal(top_bid.price) * Decimal(top_ask.size)
        )
        / top_size
        if top_size
        else None
    )
    symmetric = [x.size for x in book.bids] == [x.size for x in book.asks]
    warnings = ["SAMPLED_BROKER_DEPTH_NOT_EXECUTED_ORDER_FLOW"]
    if min(len(book.bids), len(book.asks)) < 5:
        warnings.append("SHALLOW_BOOK")
    if symmetric:
        warnings.append("SYMMETRIC_SIZE_LADDER")
    rolling = next(a for a in book.aggregates if a.window_ms == 60000)
    depth = DepthContext(
        source_at=book.source_time.isoformat(),
        received_at=book.received_at.isoformat(),
        bid_levels=len(book.bids),
        ask_levels=len(book.asks),
        symmetric_sizes=symmetric,
        spread=text(spread),
        imbalance=text((bid_total - ask_total) / (bid_total + ask_total))
        if bid_total + ask_total
        else None,
        microprice_bias=text((microprice - midpoint) / (spread / 2))
        if microprice is not None and spread > 0
        else None,
        bid_liquidity_change_60s=rolling.bid_liquidity_change if rolling.sample_count else None,
        ask_liquidity_change_60s=rolling.ask_liquidity_change if rolling.sample_count else None,
        rolling_sample_count_60s=rolling.sample_count,
        warnings=warnings,
    )
    atr = Decimal(next(f for f in frames if f.timeframe == "M1").atr)
    if atr <= 0:
        return ContextResponse(
            **common,
            acceptable=False,
            reasons=["M1_ATR_NONPOSITIVE"],
            evidence=None,
            codex_payload=None,
        )
    evidence = ContextEvidence(
        frames=frames,
        depth=depth,
        spread_to_m1_atr=text((Decimal(source.quote.ask) - Decimal(source.quote.bid)) / atr),
        history_targets_met=all(
            len(s.candles) >= TARGET_COUNTS[s.timeframe] for s in request.candles
        ),
    )
    tick = Decimal(source.tick_size)
    distance = max(tick, Decimal(source.minimum_entry_distance))
    buy_min = ((Decimal(source.quote.ask) + distance) / tick).to_integral_value(
        rounding=ROUND_CEILING
    ) * tick
    sell_max = ((Decimal(source.quote.bid) - distance) / tick).to_integral_value(
        rounding=ROUND_FLOOR
    ) * tick
    if sell_max <= 0:
        return ContextResponse(
            **common,
            acceptable=False,
            reasons=["ENTRY_BOUNDS_NONPOSITIVE"],
            evidence=None,
            codex_payload=None,
        )
    payload: dict[str, object] = {
        "version": "entry-context-candidate-1.0",
        "execution_authority": False,
        "input_sha256": digest,
        "prompt_sha256": hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest(),
        "captured_at": request.analysis_time.isoformat(),
        "quote": source.quote.model_dump(mode="json", by_alias=True),
        "tick_size": source.tick_size,
        "entry_boundaries": {
            "buy_stop_minimum": text(buy_min),
            "sell_stop_maximum": text(sell_max),
        },
        "technical_context": evidence.model_dump(mode="json"),
        **(
            {"snapshot_time": source.snapshot_time.isoformat()}
            if isinstance(source, ContextRequestV11)
            else {}
        ),
        "recent_candles": [
            {
                "timeframe": s.timeframe,
                "candles": [c.model_dump(mode="json", by_alias=True) for c in s.candles[-12:]],
            }
            for s in request.candles
        ],
    }
    # Bounded candidate material only. No model call, order proposal or risk authority.
    if len(json.dumps(payload).encode()) > 64000:
        return ContextResponse(
            **common,
            acceptable=False,
            reasons=["CANDIDATE_PAYLOAD_OVERSIZED"],
            evidence=None,
            codex_payload=None,
        )
    return ContextResponse(
        **common,
        acceptable=True,
        reasons=[],
        evidence=evidence,
        codex_payload=payload,
    )


def prepare_context_v11(source: ContextRequestV12) -> ContextResponseV11:
    """causal-smc-1.1: the unchanged 1.0 evidence plus a deterministic level map.

    Every 1.0 gate still applies first; a rejected or oversized context withholds all
    evidence. Levels describe completed candles only and never authorize an order.
    """
    base = prepare_context(source)
    common = dict(
        request_id=base.request_id,
        analysis_id=base.analysis_id,
        input_sha256=base.input_sha256,
        captured_at=base.captured_at,
    )
    if not base.acceptable or base.evidence is None or base.codex_payload is None:
        return ContextResponseV11(
            **common, acceptable=False, reasons=base.reasons, evidence=None, codex_payload=None
        )
    tick = Decimal(source.tick_size)
    mid = (Decimal(source.quote.bid) + Decimal(source.quote.ask)) / 2
    series = {s.timeframe: s.candles for s in source.request.candles}
    frames = []
    for frame in base.evidence.frames:
        bars = series[frame.timeframe]
        first = levels.segment_start(bars)
        current = bars[first:]
        pivots = levels.swing_pivots(current)
        frames.append(
            FrameContextV11.model_validate(
                {
                    **frame.model_dump(),
                    "nearest_active_zones": [
                        {**z.model_dump(), **levels.zone_extension(z, current, tick)}
                        for z in frame.nearest_active_zones
                    ],
                    "recent_resolved_zones": [
                        {**z.model_dump(), **levels.zone_extension(z, current, tick)}
                        for z in frame.recent_resolved_zones
                    ],
                    "support_resistance": levels.support_resistance(
                        frame.timeframe, current, pivots, mid, Decimal(frame.atr), tick
                    ),
                    "dealing_range": levels.dealing_range(pivots, mid, tick),
                    "candle_anatomy": levels.anatomy(frame.timeframe, bars, first),
                }
            )
        )
    m1 = series["M1"]
    m1_atr = Decimal(next(f.atr for f in base.evidence.frames if f.timeframe == "M1"))
    evidence = ContextEvidenceV11.model_validate(
        {
            **base.evidence.model_dump(exclude={"definitions_version", "frames"}),
            "frames": frames,
            "m1_envelopes": levels.envelopes(m1[levels.segment_start(m1) :], m1_atr),
            "sessions": levels.sessions(series["M5"]),
            "round_levels": levels.round_levels(mid),
        }
    )
    payload: dict[str, object] = {
        **base.codex_payload,
        "version": "entry-context-candidate-1.1",
        "technical_context": evidence.model_dump(mode="json"),
    }
    if len(json.dumps(payload).encode()) > LEVEL_CANDIDATE_LIMIT:
        return ContextResponseV11(
            **common,
            acceptable=False,
            reasons=["CANDIDATE_PAYLOAD_OVERSIZED"],
            evidence=None,
            codex_payload=None,
        )
    return ContextResponseV11(
        **common, acceptable=True, reasons=[], evidence=evidence, codex_payload=payload
    )
