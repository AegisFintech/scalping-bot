"""Recorded trend decisions and broker outcomes, without legacy exit hypotheses."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal, localcontext
from typing import Any, Literal

from python.backtest.current_scalp import TREND_RELEASE
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import digest
from python.research.position_clock_evidence import PositionClockEvidence, reconstruct_current

CANDIDATES = {"RECORDED_TREND": "absolute-structural-prices-no-exit-simulation"}


class TrendObservationReport(StrictModel):
    schemaVersion: Literal["trend-observation-1.0"] = "trend-observation-1.0"
    packetSha256: str
    positionEvidenceSha256: str
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


def report(evidence: PositionClockEvidence) -> TrendObservationReport:
    evidence = PositionClockEvidence.model_validate(evidence.model_dump())
    packet = evidence.packet
    cutoff = timestamp(packet.until)
    contexts: list[dict[str, Any]] = []
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        for c in packet.contexts:
            state, ratio = "UNAVAILABLE", None
            if c.originRelease != TREND_RELEASE:
                state = "UNSUPPORTED"
            elif any(timestamp(at) > cutoff for at in (c.requestedAt, c.capturedAt)):
                state = "NOT_KNOWN_AT_CUTOFF"
            elif c.state in {"FAILED", "REQUESTING"}:
                state = (
                    "NOT_KNOWN_AT_CUTOFF"
                    if c.completedAt is not None and timestamp(c.completedAt) > cutoff
                    else c.state
                )
            elif (
                c.clockStatus == "CAUSAL"
                and c.availableAt is not None
                and c.completedAt is not None
                and max(timestamp(c.availableAt), timestamp(c.completedAt)) <= cutoff
            ):
                if c.decision == "WAIT":
                    state = "WAIT"
                elif timestamp(c.availableAt) >= timestamp(c.validUntil):
                    state = "EXPIRED_BEFORE_AVAILABILITY"
                elif c.market is not None and c.decision in {"BUY", "SELL"}:
                    assert c.entryPrice is not None and c.stopLoss is not None
                    assert c.takeProfit is not None
                    entry, stop, target = map(Decimal, (c.entryPrice, c.stopLoss, c.takeProfit))
                    tick, sign = Decimal(c.market.tick_size), 1 if c.decision == "BUY" else -1
                    if all(value % tick == 0 for value in (entry, stop, target)):
                        ratio = format((target - entry) * sign / ((entry - stop) * sign), "f")
                        state = "RECORDED_GEOMETRY_NOT_COST_OR_EXECUTION_QUALIFIED"
            contexts.append(
                {
                    "contextId": c.id,
                    "cohortRole": c.cohortRole,
                    "state": state,
                    "plannedGrossRewardToRisk": ratio,
                    "actualStopRisk": None,
                }
            )
    facts = reconstruct_current(evidence)
    warnings = set(packet.coverageWarnings)
    if any(c.market is None for c in packet.contexts):
        warnings.add("MARKET_CONTEXT_MISSING")
    if any(c["state"] == "UNSUPPORTED" for c in contexts):
        warnings.add("CONTEXT_RELEASE_UNSUPPORTED")
    if not packet.scopeComplete or packet.unscopedBrokerEvents:
        warnings.add("JOURNAL_SCOPE_INCOMPLETE")
    if any(f.unavailableReason or f.gaps or not f.metrics for f in packet.flight):
        warnings.add("FLIGHT_PATH_INCOMPLETE")
    return TrendObservationReport(
        packetSha256=digest(packet.model_dump()),
        positionEvidenceSha256=digest(evidence.model_dump()),
        candidates=CANDIDATES,
        contexts=contexts,
        setups=[fact.model_dump() for fact in facts],
        contextCounts=dict(Counter(c["state"] for c in contexts)),
        setupCounts=dict(Counter(f.status for f in facts)),
        coverageWarnings=sorted(warnings),
        recommendation="REPAIR"
        if warnings
        & {"CONTEXT_RELEASE_UNSUPPORTED", "MARKET_CONTEXT_MISSING", "JOURNAL_SCOPE_INCOMPLETE"}
        else "COLLECT_MORE",
    )
