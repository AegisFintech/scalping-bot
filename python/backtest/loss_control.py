"""Prospective loss-control diagnostics over the existing current-contract runner.

Signals are conditional observations, never counterfactual fills or close authority.
"""

from __future__ import annotations

import itertools
from collections import Counter
from datetime import timedelta
from decimal import Decimal, localcontext
from typing import Any, Literal

from python.backtest.current_scalp import CURRENT, reconstruct
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import LearningEvidence, digest

METHOD = "loss-control-screen-1.0"
CANDIDATES = {
    "STRUCTURAL_2R": "2",
    "HOLD_180": "180",
    "FAILED_M1": "completed-close-inside-original-five-M1-range",
}


class LossControlReport(StrictModel):
    schemaVersion: Literal["loss-control-screen-1.0"] = "loss-control-screen-1.0"
    packetSha256: str
    candidates: dict[str, str]
    contexts: list[dict[str, Any]]
    setups: list[dict[str, Any]]
    contextCounts: dict[str, int]
    setupCounts: dict[str, int]
    coverageWarnings: list[str]
    recommendation: Literal["REPAIR", "COLLECT_MORE"]
    counterfactualNet: None = None
    counterfactualFees: None = None
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False
    economicQualification: Literal[False] = False


def report(packet: LearningEvidence) -> LossControlReport:
    """Preserve every input context/setup; never select only completed winning paths."""
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        return _report(packet)


def _report(packet: LearningEvidence) -> LossControlReport:
    cutoff = timestamp(packet.until)
    contexts: list[dict[str, Any]] = []
    by_id = {c.id: c for c in packet.contexts}
    # Availability belongs to the recorded snapshot, not the candle's end time.
    bars: dict[str, list[tuple[str, str]]] = {}
    for c in packet.contexts:
        if c.market is None or c.clockStatus != "CAUSAL" or c.availableAt is None:
            continue
        known = max(timestamp(c.availableAt), timestamp(c.capturedAt))
        if known > cutoff:
            continue
        for frame in c.market.candles:
            if frame.timeframe != "M1":
                continue
            for b in frame.rows:
                if (
                    b[7]
                    and not b[8]
                    and timestamp(b[1]) <= timestamp(c.capturedAt)
                    and timestamp(b[1]) - timestamp(b[0]) == timedelta(minutes=1)
                ):
                    bars.setdefault(b[0], []).append((b[5], known.isoformat()))
    for c in packet.contexts:
        state, ratio = "UNAVAILABLE", None
        if c.originRelease not in CURRENT:
            state = "UNSUPPORTED"
        elif c.state == "FAILED":
            state = "FAILED"
        elif c.state == "REQUESTING":
            state = "REQUESTING"
        elif c.clockStatus == "CAUSAL" and c.availableAt and timestamp(c.availableAt) <= cutoff:
            if c.decision == "WAIT":
                state = "WAIT"
            elif c.decision in ("BUY", "SELL") and all(
                v is not None for v in (c.entryPrice, c.stopLoss, c.takeProfit)
            ):
                sign = Decimal(1 if c.decision == "BUY" else -1)
                risk = (Decimal(c.entryPrice or "0") - Decimal(c.stopLoss or "0")) * sign
                reward = (Decimal(c.takeProfit or "0") - Decimal(c.entryPrice or "0")) * sign
                if risk > 0 and reward > 0:
                    ratio = format(risk / reward, "f")
                    state = "REJECT_GEOMETRY" if risk > reward * 2 else "PASS_GEOMETRY"
        contexts.append(
            {
                "contextId": c.id,
                "cohortRole": c.cohortRole,
                "state": state,
                "plannedStopToTarget": ratio,
                "actualStopRisk": None,
            }
        )
    reconstructed = {r.setupId: r for r in reconstruct(packet)}
    setups = []
    for g in packet.setups:
        fact = reconstructed[g.id]
        row: dict[str, Any] = {
            "setupId": g.id,
            "cohortRole": g.cohortRole,
            "actualState": fact.status,
            "recordedClosedNet": fact.recordedClosedNet,
            "reasons": fact.reasons,
            "holding": "UNAVAILABLE",
            "holdingDueAt": None,
            "failedBreakout": "UNAVAILABLE",
            "observedSignalAvailableAt": None,
            "counterfactualNet": None,
        }
        setups.append(row)
        if fact.status == "ZERO_FILL_TERMINAL":
            row["holding"] = row["failedBreakout"] = "NO_FILL"
            continue
        if fact.status not in {"OPEN", "CLOSED"} or not g.fills:
            continue
        # Partial fills/partial closes require a separate volume-aware exit study.
        if (
            len(g.fills) != 1
            or len(g.closeDeals) > 1
            or Decimal(fact.filledVolume) != Decimal(g.orders[0].approvedVolume)
        ):
            row["holding"] = row["failedBreakout"] = "PARTIAL_PATH_UNSUPPORTED"
            continue
        fill = g.fills[0]
        if fill.clockStatus != "CAUSAL" or timestamp(fill.receivedAt) > cutoff:
            continue
        due = max(timestamp(fill.occurredAt) + timedelta(seconds=180), timestamp(fill.receivedAt))
        closed = min((timestamp(d.occurredAt) for d in g.closeDeals), default=cutoff)
        row["holdingDueAt"] = due.isoformat()
        row["holding"] = (
            "CLOSED_AT_OR_BEFORE_TIMER"
            if g.closeDeals and closed <= due
            else "TIMER_OBSERVED_NOT_EXECUTED"
            if due < cutoff
            else "OPEN_CENSORED"
        )
        context = by_id.get(g.contextId or "")
        if context is None or context.market is None or context.availableAt is None:
            continue
        original = next((f.rows[-5:] for f in context.market.candles if f.timeframe == "M1"), [])
        if len(original) != 5 or any(not b[7] or b[8] for b in original):
            continue
        if any(timestamp(a[1]) != timestamp(b[0]) for a, b in itertools.pairwise(original)):
            continue
        if any(timestamp(b[1]) > timestamp(context.capturedAt) for b in original):
            continue
        lower = min(Decimal(b[4]) for b in original)
        upper = max(Decimal(b[3]) for b in original)
        # Require an actual breakout fill beyond the unchanged original range.
        if (g.orders[0].side == "BUY" and Decimal(fill.price) <= upper) or (
            g.orders[0].side == "SELL" and Decimal(fill.price) >= lower
        ):
            row["failedBreakout"] = "FILL_NOT_OUTSIDE_ORIGINAL_RANGE"
            continue
        eligible = []
        conflict = False
        for start, observations in bars.items():
            if timestamp(start) + timedelta(minutes=1) <= timestamp(fill.occurredAt):
                continue
            if len({Decimal(price) for price, _ in observations}) != 1:
                conflict = True
                continue
            known = min(timestamp(at) for _, at in observations)
            if (
                max(timestamp(fill.receivedAt), timestamp(context.availableAt))
                <= known
                < min(closed, cutoff)
            ):
                eligible.append((known, Decimal(observations[0][0])))
        signals = sorted(at for at, price in eligible if lower <= price <= upper)
        row["failedBreakout"] = "CANDLE_CONFLICT" if conflict else "INSUFFICIENT_PATH"
        if signals and not conflict:
            row["failedBreakout"] = "OBSERVED_SIGNAL_NOT_EXECUTED"
            row["observedSignalAvailableAt"] = signals[0].isoformat()
        # Absence in intermittent context snapshots never proves no failed breakout.
    warnings = list(packet.coverageWarnings)
    if any(c.market is None for c in packet.contexts):
        warnings.append("MARKET_CONTEXT_MISSING")
    if any(bool(f.unavailableReason) or bool(f.gaps) or not f.metrics for f in packet.flight):
        warnings.append("FLIGHT_PATH_INCOMPLETE")
    return LossControlReport(
        packetSha256=digest(packet.model_dump()),
        candidates=CANDIDATES,
        contexts=contexts,
        setups=setups,
        contextCounts=dict(Counter(r["state"] for r in contexts)),
        setupCounts=dict(Counter(r["actualState"] for r in setups)),
        coverageWarnings=sorted(set(warnings)),
        recommendation="REPAIR" if "MARKET_CONTEXT_MISSING" in warnings else "COLLECT_MORE",
    )
