"""Version-aware descriptive facts; frozen replay applicability is never a trading gate."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal, localcontext
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.execution_funnel import Count, Counts
from python.research.learning_evidence import (
    Digest,
    Instant,
    LearningEvidence,
    MetricNumber,
    Name,
    encoded,
)

if TYPE_CHECKING:
    from python.backtest.scalp_replay import EntryBenchmark


class WindowOutcomes(StrictModel):
    originRelease: Name
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3,8}$")]
    rows: Count
    positive: Count
    negative: Count
    flat: Count
    realizedNet: MetricNumber
    signedFees: MetricNumber

    @model_validator(mode="after")
    def counts(self) -> WindowOutcomes:
        if self.rows != self.positive + self.negative + self.flat:
            raise ValueError("OBSERVATION_OUTCOME_DENOMINATORS")
        return self


class ObservationScope(StrictModel):
    schemaVersion: Literal["research-observation-scope-1.0"]
    packetSha256: Digest
    sourceId: Name
    start: Instant
    until: Instant
    legacyBaselineRelease: Literal["0.8.0-model-scalp.1-codex.1"]
    contextReleaseCounts: dict[Name, Count]
    supportedContexts: Count
    unsupportedContexts: Count
    decisions: Counts
    reasons: Counts
    unsupportedIsTradingGate: Literal[False]
    unsupportedIsProviderWait: Literal[False]
    closedRowsInPacket: Count
    uniqueClosedRowsInPacket: Count
    duplicateClosedRows: Count
    windowClosedRows: Count
    windowOutcomes: list[WindowOutcomes]
    outcomeBasis: Literal["RECORDED_WINDOW_CLOSES_BY_RELEASE_CURRENCY_NOT_COHORT_RETURN"]
    baselineBasis: Literal["SUPPORTED_HISTORICAL_RELEASE_ONLY_UNEXECUTED_HYPOTHESES"]
    counterfactualFill: None
    counterfactualNet: None
    economicQualification: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="after")
    def counts(self) -> ObservationScope:
        supported = self.contextReleaseCounts.get(self.legacyBaselineRelease, 0)
        if (
            self.supportedContexts != supported
            or self.unsupportedContexts != sum(self.contextReleaseCounts.values()) - supported
            or sum(self.decisions.values()) != supported
            or self.closedRowsInPacket != self.uniqueClosedRowsInPacket + self.duplicateClosedRows
            or self.windowClosedRows != sum(v.rows for v in self.windowOutcomes)
            or self.windowClosedRows > self.uniqueClosedRowsInPacket
            or len({(v.originRelease, v.currency) for v in self.windowOutcomes})
            != len(self.windowOutcomes)
            or not timestamp(self.start) < timestamp(self.until)
        ):
            raise ValueError("OBSERVATION_SCOPE_DENOMINATORS")
        return self


def measure(
    packet: LearningEvidence, packet_sha: str, benchmark: list[EntryBenchmark]
) -> ObservationScope:
    supported = {v.id for v in packet.contexts if v.originRelease == "0.8.0-model-scalp.1-codex.1"}
    eligible = [v for v in benchmark if v.contextId in supported]
    if {v.contextId for v in eligible} != supported or len(eligible) != len(supported):
        raise ValueError("OBSERVATION_BASELINE_IDENTITY")
    seen: dict[str, bytes] = {}
    outcomes: dict[tuple[str, str], list[tuple[Decimal, Decimal]]] = {}
    row_count = 0
    for group in packet.setups:
        for trade in group.closedTrades:
            row_count += 1
            identity = encoded(
                {
                    "trade": trade.model_dump(),
                    "release": group.originRelease,
                    "currency": group.accountCurrency,
                }
            )
            if trade.id in seen:
                if seen[trade.id] != identity:
                    raise ValueError("OBSERVATION_CLOSED_IDENTITY_CONFLICT")
                continue
            seen[trade.id] = identity
            if timestamp(packet.start) <= timestamp(trade.closedAt) < timestamp(packet.until):
                outcomes.setdefault((group.originRelease, group.accountCurrency), []).append(
                    (Decimal(trade.realizedNet), Decimal(trade.signedFees))
                )
    summaries = []
    with localcontext() as precision:
        precision.prec = 100
        for (release, currency), values in sorted(outcomes.items()):
            summaries.append(
                WindowOutcomes(
                    originRelease=release,
                    currency=currency,
                    rows=len(values),
                    positive=sum(net > 0 for net, _ in values),
                    negative=sum(net < 0 for net, _ in values),
                    flat=sum(net == 0 for net, _ in values),
                    realizedNet=format(sum((net for net, _ in values), Decimal(0)), "f"),
                    signedFees=format(sum((fees for _, fees in values), Decimal(0)), "f"),
                )
            )
    return ObservationScope(
        schemaVersion="research-observation-scope-1.0",
        packetSha256=packet_sha,
        sourceId=packet.sourceId,
        start=packet.start,
        until=packet.until,
        legacyBaselineRelease="0.8.0-model-scalp.1-codex.1",
        contextReleaseCounts=dict(Counter(v.originRelease for v in packet.contexts)),
        supportedContexts=len(supported),
        unsupportedContexts=len(packet.contexts) - len(supported),
        decisions=dict(Counter(v.decision for v in eligible)),
        reasons=dict(Counter(r for v in eligible for r in v.reasons)),
        unsupportedIsTradingGate=False,
        unsupportedIsProviderWait=False,
        closedRowsInPacket=row_count,
        uniqueClosedRowsInPacket=len(seen),
        duplicateClosedRows=row_count - len(seen),
        windowClosedRows=sum(v.rows for v in summaries),
        windowOutcomes=summaries,
        outcomeBasis="RECORDED_WINDOW_CLOSES_BY_RELEASE_CURRENCY_NOT_COHORT_RETURN",
        baselineBasis="SUPPORTED_HISTORICAL_RELEASE_ONLY_UNEXECUTED_HYPOTHESES",
        counterfactualFill=None,
        counterfactualNet=None,
        economicQualification=False,
        brokerAuthority=False,
        promotionAuthority=False,
    )
