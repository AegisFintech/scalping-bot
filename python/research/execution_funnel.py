"""Whole-window execution measurements; never a trade recommendation or fill census."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_archive import parse
from python.research.learning_evidence import Code, Digest, Instant, Name

Count = Annotated[int, Field(ge=0)]
Counts = dict[Code, Count]
Family = Literal["contexts", "analyses", "setups", "flight"]
Micros = Annotated[str, Field(pattern=r"^[0-9]{1,20}$")]


class Latency(StrictModel):
    known: Count
    unknown: Count
    p50Micros: Micros | None
    p95Micros: Micros | None
    maximumMicros: Micros | None

    @model_validator(mode="after")
    def complete(self) -> Latency:
        values = (self.p50Micros, self.p95Micros, self.maximumMicros)
        if self.known == 0:
            if any(v is not None for v in values):
                raise ValueError("FUNNEL_LATENCY_UNKNOWN")
        elif any(v is None for v in values):
            raise ValueError("FUNNEL_LATENCY_MISSING")
        else:
            assert all(v is not None for v in values)
            numbers = [Decimal(v) for v in values if v is not None]
            if numbers != sorted(numbers) or any(v < 0 for v in numbers):
                raise ValueError("FUNNEL_LATENCY_ORDER")
        return self


class ExecutionFunnel(StrictModel):
    schemaVersion: Literal["execution-funnel-1.0"]
    packetSha256: Digest
    sourceId: Name
    start: Instant
    until: Instant
    journalSnapshotAt: Instant
    contexts: Count
    analyses: Count
    setups: Count
    orderRecords: Count
    brokerAcceptedOrderRecords: Count
    filledOrderRecords: Count
    partialOrderRecords: Count
    recordedFillRows: Count
    windowClosedRows: Count
    decisionCounts: Counts
    researchBaselineDefinition: Name
    researchBaselineDecisions: Counts
    researchBaselineReasons: Counts
    researchBaselineCounterfactualFill: None
    analysisStates: Counts
    analysisReasons: Counts
    setupStates: Counts
    orderStates: Counts
    roleCounts: dict[Family, Counts]
    requestToAvailability: Latency
    availabilityToAcceptance: Latency
    latencyBasis: Literal["LOCAL_CONTEXT_CLOCKS_AND_MAPPED_CAUSAL_BROKER_ACCEPTANCE"]
    quantiles: Literal["NEAREST_RANK"]
    coverage: Literal["ALL_PACKET_ROWS_WITH_ROLES_NOT_NEW_TRADES_OR_MARKET_OPPORTUNITIES"]
    counterfactualNet: None
    economicQualification: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="after")
    def totals(self) -> ExecutionFunnel:
        families: dict[Family, int] = {
            "contexts": self.contexts,
            "analyses": self.analyses,
            "setups": self.setups,
        }
        if (
            not timestamp(self.start) < timestamp(self.until) <= timestamp(self.journalSnapshotAt)
            or set(self.roleCounts) != {"contexts", "analyses", "setups", "flight"}
            or sum(self.decisionCounts.values()) != self.contexts
            or sum(self.researchBaselineDecisions.values()) != self.contexts
            or sum(self.analysisStates.values()) != self.analyses
            or sum(self.setupStates.values()) != self.setups
            or sum(self.orderStates.values()) != self.orderRecords
            or self.requestToAvailability.known + self.requestToAvailability.unknown
            != self.contexts
            or self.availabilityToAcceptance.known + self.availabilityToAcceptance.unknown
            != self.orderRecords
            or self.brokerAcceptedOrderRecords > self.orderRecords
            or self.filledOrderRecords > self.orderRecords
            or self.partialOrderRecords > self.filledOrderRecords
            or any(sum(self.roleCounts.get(k, {}).values()) != v for k, v in families.items())
        ):
            raise ValueError("FUNNEL_DENOMINATORS")
        return self

    def observation_state(self, now: datetime) -> Literal["CURRENT", "STALE", "UNAVAILABLE"]:
        if (
            timestamp(self.journalSnapshotAt) > now + timedelta(seconds=5)
            or timestamp(self.until) > now
        ):
            return "UNAVAILABLE"
        return "STALE" if now - timestamp(self.until) > timedelta(hours=1) else "CURRENT"


def latency(values: list[str | None]) -> dict[str, Any]:
    known = sorted(int(v) for v in values if v is not None)
    return {
        "known": len(known),
        "unknown": len(values) - len(known),
        "p50Micros": str(known[(len(known) - 1) // 2]) if known else None,
        "p95Micros": str(known[(95 * len(known) + 99) // 100 - 1]) if known else None,
        "maximumMicros": str(known[-1]) if known else None,
    }


def measure(raw: bytes) -> ExecutionFunnel:
    # The existing scorer imports observation contracts, so load it after initialization.
    from python.backtest.scalp_replay import BASELINE, replay
    from python.research.experiment_execution import independently_measure

    digest = sha256(raw).hexdigest()
    packet = parse(raw, digest)
    recorded = independently_measure(raw)
    benchmarks = replay(packet, digest).benchmark
    durations = []
    for context in packet.contexts:
        duration = None
        if context.availableAt and context.clockStatus == "CAUSAL":
            delta = timestamp(context.availableAt) - timestamp(context.requestedAt)
            if delta >= timedelta(0):
                duration = str(
                    (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
                )
        durations.append(duration)
    orders = [o for group in packet.setups for o in group.orders]
    accepted = sum(
        any(
            e.orderId == order.id
            and e.executionType == 2
            and not e.closingOrder
            and e.mappingState == "MAPPED"
            and e.clockStatus == "CAUSAL"
            for e in group.brokerEvents
        )
        for group in packet.setups
        for order in group.orders
    )
    return ExecutionFunnel.model_validate(
        {
            "schemaVersion": "execution-funnel-1.0",
            "packetSha256": digest,
            "sourceId": packet.sourceId,
            "start": packet.start,
            "until": packet.until,
            "journalSnapshotAt": packet.journalSnapshotAt,
            "contexts": len(packet.contexts),
            "analyses": len(packet.analyses),
            "setups": len(packet.setups),
            "orderRecords": len(orders),
            "brokerAcceptedOrderRecords": accepted,
            "filledOrderRecords": sum(Decimal(o.filledVolume) > 0 for o in orders),
            "partialOrderRecords": recorded["recordedPartialOrders"],
            "recordedFillRows": recorded["recordedFillRows"],
            "windowClosedRows": recorded["closedInWindow"],
            "decisionCounts": recorded["decisions"],
            "researchBaselineDefinition": BASELINE,
            "researchBaselineDecisions": dict(Counter(b.decision for b in benchmarks)),
            "researchBaselineReasons": dict(Counter(r for b in benchmarks for r in b.reasons)),
            "researchBaselineCounterfactualFill": None,
            "analysisStates": dict(Counter(a.state for a in packet.analyses)),
            "analysisReasons": recorded["analysisReasons"],
            "setupStates": recorded["setupStates"],
            "orderStates": recorded["orderStates"],
            "roleCounts": recorded["roles"],
            "requestToAvailability": latency(durations),
            "availabilityToAcceptance": latency(
                [v["availabilityToAcceptanceMicros"] for v in recorded["acceptanceClocks"]]
            ),
            "latencyBasis": "LOCAL_CONTEXT_CLOCKS_AND_MAPPED_CAUSAL_BROKER_ACCEPTANCE",
            "quantiles": "NEAREST_RANK",
            "coverage": "ALL_PACKET_ROWS_WITH_ROLES_NOT_NEW_TRADES_OR_MARKET_OPPORTUNITIES",
            "counterfactualNet": None,
            "economicQualification": False,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
    )
