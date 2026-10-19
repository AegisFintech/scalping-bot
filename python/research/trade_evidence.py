"""Offline market-context brief. No trading, provider, database or network authority."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field

from python.analytics.models import AnalyticsRequest, ApiModel
from python.analytics.service import TIMEFRAME_SECONDS, quality_reasons
from python.features import build_features
from python.features.builder import decimal_text

MAX_INPUT_BYTES = 4 * 1024 * 1024


class FrameEvidence(ApiModel):
    timeframe: Literal["M1", "M5", "M15"]
    completed_at: str
    age_seconds: float
    ema_alignment: Literal["BULLISH", "BEARISH", "FLAT"]
    atr: str
    rsi: str | None
    adx: str | None
    five_bar_low: str
    five_bar_high: str
    ten_bar_low: str
    ten_bar_high: str


class DepthEvidence(ApiModel):
    scope: Literal["BROKER_SNAPSHOT_NOT_GLOBAL_ORDER_FLOW"] = (
        "BROKER_SNAPSHOT_NOT_GLOBAL_ORDER_FLOW"
    )
    source_at: str
    received_at: str
    source_age_seconds: float
    bid_levels: int
    ask_levels: int
    spread: str
    top_five_imbalance: str | None
    microprice_bias: str | None


class EvidenceBrief(ApiModel):
    schema_version: Literal["trade-evidence-1.0"] = "trade-evidence-1.0"
    authority: Literal["OFFLINE_CONTEXT_ONLY"] = "OFFLINE_CONTEXT_ONLY"
    status: Literal["CONTEXT_AVAILABLE", "REJECTED"]
    input_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    analysis_time: str
    snapshot_time: str
    reasons: list[str]
    frames: list[FrameEvidence]
    depth: DepthEvidence | None
    ema_agreement: Literal["ALL_BULLISH", "ALL_BEARISH", "MIXED_OR_FLAT", "UNKNOWN"]
    # Intentionally unavailable: no retrospective reasoning, costs or trade prescription.
    news_status: Literal["NOT_COLLECTED"] = "NOT_COLLECTED"
    round_trip_cost: None = None
    manual_holding_range: None = None
    entry_rationale: None = None
    invalidation_rule: None = None
    profit_exit_rule: None = None
    needs: list[str]


def build_brief(request: AnalyticsRequest) -> EvidenceBrief:
    """Recompute context at recorded server time; never label it fresh for current trading."""
    reasons: list[str] = []
    book = request.order_book
    if book.source_time.tzinfo is None or book.received_at.tzinfo is None:
        reasons.append("BOOK_TIMEZONE_MISSING")
    else:
        reasons.extend(quality_reasons(request))
        if book.source_time > book.received_at or book.received_at > request.server_time:
            reasons.append("BOOK_TIME_ORDER_INVALID")
        if (request.server_time - book.source_time).total_seconds() > 5:
            reasons.append("BOOK_STALE_AT_SNAPSHOT")
    if request.analysis_time > request.server_time:
        reasons.append("ANALYSIS_AFTER_SNAPSHOT")
    config = request.config
    warmup = max(
        10,
        config.ema_slow_period,
        config.atr_period,
        config.rsi_period + 1 if config.rsi_enabled else 0,
        2 * config.adx_period + 1 if config.adx_enabled else 0,
        config.bollinger_period if config.bollinger_enabled else 0,
    )
    for series in request.candles:
        age = (request.server_time - series.candles[-1].end_time).total_seconds()
        if not 0 <= age < TIMEFRAME_SECONDS[series.timeframe]:
            reasons.append(f"{series.timeframe}_STALE_OR_FUTURE_AT_SNAPSHOT")
        if len(series.candles) < warmup:
            reasons.append(f"{series.timeframe}_INSUFFICIENT_WARMUP")
    digest = hashlib.sha256(
        json.dumps(request.model_dump(mode="json", by_alias=True), sort_keys=True).encode()
    ).hexdigest()
    common = {
        "input_sha256": digest,
        "analysis_time": request.analysis_time.isoformat(),
        "snapshot_time": request.server_time.isoformat(),
        "needs": [
            "EXACT_MANUAL_RANGE_AND_EXIT_RULES",
            "ORIGINAL_DECISION_AND_EFFECTIVE_ENTRY_PROVENANCE",
            "PRE_DECISION_EXACT_VOLUME_COST_AND_EXECUTION_ESTIMATES",
            "TIMESTAMPED_ECONOMIC_CALENDAR",
            "DEPTH_COVERAGE_AND_INCREMENTAL_VALUE_STUDY",
        ],
    }
    if reasons:
        return EvidenceBrief.model_validate(
            {
                **common,
                "status": "REJECTED",
                "reasons": sorted(set(reasons)),
                "frames": [],
                "depth": None,
                "ema_agreement": "UNKNOWN",
            }
        )
    features = build_features(request)
    # Feature builder has a flexible internal mapping; output is validated again below.
    timeframes = features["timeframes"]
    depth = features["order_book"]
    assert isinstance(timeframes, dict) and isinstance(depth, dict)
    frames: list[FrameEvidence] = []
    for series in sorted(request.candles, key=lambda s: TIMEFRAME_SECONDS[s.timeframe]):
        feature = timeframes[series.timeframe]
        frames.append(
            FrameEvidence.model_validate(
                {
                    "timeframe": series.timeframe,
                    "completed_at": series.candles[-1].end_time.isoformat(),
                    "age_seconds": (
                        request.server_time - series.candles[-1].end_time
                    ).total_seconds(),
                    "ema_alignment": feature["ema_alignment"],
                    "atr": feature["atr"],
                    "rsi": feature.get("rsi"),
                    "adx": feature.get("adx"),
                    "five_bar_low": decimal_text(min(c.low_decimal for c in series.candles[-5:])),
                    "five_bar_high": decimal_text(max(c.high_decimal for c in series.candles[-5:])),
                    "ten_bar_low": decimal_text(min(c.low_decimal for c in series.candles[-10:])),
                    "ten_bar_high": decimal_text(max(c.high_decimal for c in series.candles[-10:])),
                }
            )
        )
    alignments = {frame.ema_alignment for frame in frames}
    agreement = (
        "ALL_BULLISH"
        if alignments == {"BULLISH"}
        else "ALL_BEARISH"
        if alignments == {"BEARISH"}
        else "MIXED_OR_FLAT"
    )
    return EvidenceBrief.model_validate(
        {
            **common,
            "status": "CONTEXT_AVAILABLE",
            "reasons": [],
            "frames": frames,
            "ema_agreement": agreement,
            "depth": {
                "source_at": book.source_time.isoformat(),
                "received_at": book.received_at.isoformat(),
                "source_age_seconds": (request.server_time - book.source_time).total_seconds(),
                "bid_levels": len(book.bids),
                "ask_levels": len(book.asks),
                "spread": depth["spread"],
                "top_five_imbalance": depth["top_5"]["imbalance"],
                "microprice_bias": depth["microprice_bias"],
            },
        }
    )


def main(args: list[str] | None = None) -> int:
    args = sys.argv[1:] if args is None else args
    if len(args) != 1:
        print("EVIDENCE_INPUT_FILE_REQUIRED", file=sys.stderr)
        return 2
    try:
        with Path(args[0]).open("rb") as stream:
            raw = stream.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise ValueError("oversized")
        request = AnalyticsRequest.model_validate_json(raw)
        brief = build_brief(request)
        print(brief.model_dump_json(indent=2))
        return 0 if brief.status == "CONTEXT_AVAILABLE" else 1
    except (OSError, ValueError, TypeError, ArithmeticError, KeyError, IndexError):
        # Input paths, payloads, validation messages and identifiers stay private.
        print("EVIDENCE_INPUT_INVALID_OR_UNAVAILABLE", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
