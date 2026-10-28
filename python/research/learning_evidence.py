"""Versioned broker observations for research. Never order, finding or promotion authority."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, model_validator

from python.codex_entry.service import PayloadScalp
from python.operations.entry_context import timestamp
from python.research.codex_loop import StrictModel

MAX_RECORDS = 2000
MAX_BYTES = 8 * 1024 * 1024
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Identity = Annotated[str, Field(pattern=r"^[0-9a-f]{24}$")]
Name = Annotated[str, Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$")]
Code = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_:.-]{0,159}$")]
Number = Annotated[str, Field(pattern=r"^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,10})?$", max_length=32)]
MetricNumber = Annotated[
    str, Field(pattern=r"^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,40})?$", max_length=64)
]
ClockStatus = Literal["CAUSAL", "UNORDERED", "INCOMPLETE"]


def clock_status(*values: str | None) -> ClockStatus:
    known = [timestamp(v) for v in values if v is not None]
    if known != sorted(known):
        return "UNORDERED"
    return "INCOMPLETE" if len(known) != len(values) else "CAUSAL"


def context_clock(
    captured: str, requested: str, available: str | None, completed: str | None, valid: str
) -> ClockStatus:
    statuses = (
        clock_status(captured, requested, completed, available),
        clock_status(captured, valid),
    )
    if "UNORDERED" in statuses:
        return "UNORDERED"
    return "INCOMPLETE" if "INCOMPLETE" in statuses else "CAUSAL"


def utc(value: str) -> str:
    return timestamp(value).isoformat()


Instant = Annotated[str, AfterValidator(utc)]


def encoded(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(encoded(value)).hexdigest()


def identity(value: object) -> str:
    return hashlib.sha256(str(value).encode()).hexdigest()[:24]


class Record(StrictModel):
    id: Identity
    originRelease: Name
    recordedCodeHash: Digest | None
    recordedConfigHash: Digest | None
    revisionSha256: Digest
    cohortRole: Literal["OBSERVED_WINDOW", "CARRY_IN", "LINKED_REFERENCE"]

    @model_validator(mode="after")
    def revision(self) -> Record:
        if self.revisionSha256 != digest(self.model_dump(exclude={"revisionSha256"})):
            raise ValueError("LEARNING_REVISION_MISMATCH")
        return self


class ContextObservation(Record):
    sourceAnalysisId: Identity
    refreshAfterContextId: Identity | None
    refreshAfterEntryContextId: Identity | None
    refreshAfterWaitContextId: Identity | None
    consumedBySetupId: Identity | None
    retiredAt: Instant | None
    retirementReasonCodes: Annotated[list[Code], Field(max_length=2)]
    state: Literal["REQUESTING", "READY", "FAILED"]
    requestedAt: Instant
    capturedAt: Instant
    availableAt: Instant | None
    completedAt: Instant | None
    validUntil: Instant
    clockStatus: ClockStatus
    decision: Literal["BUY", "SELL", "WAIT", "UNKNOWN"]
    requestedModel: Annotated[str, Field(pattern=r"^[a-zA-Z0-9._/-]{1,80}$")]
    returnedModel: None
    providerCost: None
    failureCode: Code | None
    narrativeSha256: Digest | None
    promptVersion: Name | None
    promptSha256: Digest | None
    requestSha256: Digest | None
    responseSha256: Digest | None
    planSchema: Name | None
    entryPrice: Number | None
    takeProfit: Number | None
    stopLoss: Number | None
    pendingSeconds: Annotated[int, Field(ge=60, le=300)] | None
    market: PayloadScalp | None
    unavailableReasons: Annotated[list[Code], Field(max_length=20)]

    @model_validator(mode="after")
    def observation(self) -> ContextObservation:
        values = (self.entryPrice, self.takeProfit, self.stopLoss, self.pendingSeconds)
        if self.state == "READY":
            if self.availableAt is None or self.completedAt is None:
                raise ValueError("LEARNING_CONTEXT_STATE_INVALID")
        elif self.decision != "UNKNOWN" or self.availableAt is not None:
            raise ValueError("LEARNING_CONTEXT_STATE_INVALID")
        if self.decision in {"WAIT", "UNKNOWN"} and any(v is not None for v in values):
            raise ValueError("LEARNING_WAIT_HAS_NO_ENTRY_AUTHORITY")
        if self.decision == "WAIT" and self.planSchema != "entry-wait-1.0":
            raise ValueError("LEARNING_WAIT_SCHEMA_INVALID")
        if self.decision in {"BUY", "SELL"}:
            if (
                self.planSchema != "entry-scalp-1.0"
                or any(v is None for v in values)
                or self.state != "READY"
            ):
                raise ValueError("LEARNING_SCALP_PROPOSAL_INCOMPLETE")
            assert self.entryPrice is not None and self.takeProfit is not None
            assert self.stopLoss is not None and self.pendingSeconds is not None
            entry, tp, sl = map(Decimal, (self.entryPrice, self.takeProfit, self.stopLoss))
            if min(entry, tp, sl) <= 0 or not (
                sl < entry < tp if self.decision == "BUY" else tp < entry < sl
            ):
                raise ValueError("LEARNING_SCALP_GEOMETRY_INVALID")
            if timestamp(self.validUntil) != timestamp(self.capturedAt) + timedelta(
                seconds=self.pendingSeconds
            ):
                raise ValueError("LEARNING_SCALP_DEADLINE_INVALID")
        if self.market is not None and timestamp(self.market.captured_at) != timestamp(
            self.capturedAt
        ):
            raise ValueError("LEARNING_MARKET_CAPTURE_MISMATCH")
        expected = context_clock(
            self.capturedAt, self.requestedAt, self.availableAt, self.completedAt, self.validUntil
        )
        if self.clockStatus != expected:
            raise ValueError("LEARNING_CONTEXT_CLOCK_CLASSIFICATION")
        return self


class RiskObservation(StrictModel):
    side: Literal["BUY", "SELL"]
    approved: bool
    equity: Number | None
    riskPercent: Number | None
    approvedBudget: Number | None
    entryPrice: Number | None
    stopLoss: Number | None
    stopDistance: Number | None
    normalizedVolume: Number | None
    estimatedMargin: Number | None
    decidedAt: Instant
    reasonCodes: Annotated[list[Code], Field(max_length=100)]
    actualFilledStopRisk: None = None


class AnalysisObservation(Record):
    state: Name
    analysisAt: Instant
    persistedAt: Instant
    updatedAt: Instant
    contextIds: Annotated[list[Identity], Field(max_length=20)]
    reasonCodes: Annotated[list[Code], Field(max_length=100)]
    risk: Annotated[list[RiskObservation], Field(max_length=2)]


class OrderObservation(StrictModel):
    id: Identity
    side: Literal["BUY", "SELL"]
    state: Name
    orderType: Literal["STOP", "STOP_LIMIT", "LIMIT"]
    timeInForce: Literal["GTC", "GTD"]
    entryPrice: Number
    stopLoss: Number
    takeProfit: Number
    approvedVolume: Number
    filledVolume: Number
    expiresAt: Instant | None
    submissionValidUntil: Instant | None
    placementResultPersistedAt: Instant | None
    updatedAt: Instant


class FillObservation(StrictModel):
    id: Identity
    orderId: Identity | None
    positionId: Identity | None
    price: Number
    volume: Number
    commission: Number
    occurredAt: Instant
    receivedAt: Instant
    clockStatus: ClockStatus

    @model_validator(mode="after")
    def clocks(self) -> FillObservation:
        if self.clockStatus != clock_status(self.occurredAt, self.receivedAt):
            raise ValueError("LEARNING_FILL_CLOCK_CLASSIFICATION")
        return self


class BrokerObservation(StrictModel):
    id: Identity
    payloadSha256: Digest
    executionType: int
    mappingState: Literal["MAPPED", "UNMATCHED", "CONFLICT"]
    closingOrder: bool
    orderType: int | None
    orderId: Identity | None
    positionId: Identity | None
    occurredAt: Instant
    receivedAt: Instant
    persistedAt: Instant
    resolvedAt: Instant | None
    reasonCodes: Annotated[list[Code], Field(max_length=100)]
    clockStatus: ClockStatus

    @model_validator(mode="after")
    def clocks(self) -> BrokerObservation:
        if self.clockStatus != clock_status(self.occurredAt, self.receivedAt, self.persistedAt):
            raise ValueError("LEARNING_BROKER_CLOCK_CLASSIFICATION")
        return self


class ProtectionObservation(StrictModel):
    positionId: Identity
    side: Literal["BUY", "SELL"]
    positionState: Name
    volume: Number
    entryPrice: Number
    brokerStopLoss: Number | None
    brokerTakeProfit: Number | None
    status: Name | None
    observedAt: Instant | None
    basis: Literal["CURRENT_OBSERVATION_NOT_HISTORICAL_FILL_ATTRIBUTION"]


class ProtectionHistoryObservation(StrictModel):
    id: Identity
    positionId: Identity
    kind: Literal["OBSERVATION", "REPAIR_CLAIM", "CLOSE_CLAIM", "CLOSE_ACK"]
    status: Name | None
    stopLoss: Number | None
    takeProfit: Number | None
    observedAt: Instant | None
    persistedAt: Instant
    detailsSha256: Digest


class VariantObservation(StrictModel):
    id: Identity
    eventId: Identity
    payloadSha256: Digest
    source: Literal["ORIGINAL_JOURNAL", "BROKER_CALLBACK", "HISTORY_RECONSTRUCTION", "UNSPECIFIED"]
    originalMappingState: Literal["MAPPED", "UNMATCHED", "CONFLICT"]
    originalResolvedAt: Instant | None
    receivedAt: Instant
    persistedAt: Instant


class CloseObservation(StrictModel):
    id: Identity
    positionId: Identity
    closedVolume: Number
    entryPrice: Number
    gross: Number
    commission: Number
    swap: Number
    conversionFee: Number
    occurredAt: Instant
    recordedAt: Instant
    externalIntervention: bool
    evidenceSha256: Digest
    exitCause: None = None


class TradeObservation(StrictModel):
    id: Identity
    direction: Literal["LONG", "SHORT"]
    realizedNet: Number
    signedFees: Number
    openedAt: Instant
    closedAt: Instant


class SetupObservation(Record):
    analysisId: Identity
    contextId: Identity | None
    state: Name
    executionMode: Name | None
    timeInForce: Literal["GTC", "GTD"]
    createdAt: Instant
    updatedAt: Instant
    expiresAt: Instant | None
    submissionValidUntil: Instant | None
    accountCurrency: Annotated[str, Field(pattern=r"^[A-Z]{3,8}$")]
    volumeScaleAsOfExport: Number | None
    metadataObservedAt: Instant
    orders: Annotated[list[OrderObservation], Field(max_length=2)]
    fills: Annotated[list[FillObservation], Field(max_length=500)]
    brokerEvents: Annotated[list[BrokerObservation], Field(max_length=500)]
    currentProtection: Annotated[list[ProtectionObservation], Field(max_length=10)]
    protectionHistory: Annotated[list[ProtectionHistoryObservation], Field(max_length=2000)]
    protectionHistoryStart: Instant
    protectionHistoryComplete: bool
    brokerVariants: Annotated[list[VariantObservation], Field(max_length=500)]
    variantCoverage: Literal["RETAINED_ONLY_MISSING_LEGACY_VARIANTS_NOT_RECONSTRUCTED"]
    closeDeals: Annotated[list[CloseObservation], Field(max_length=500)]
    closedTrades: Annotated[list[TradeObservation], Field(max_length=10)]


class FlightMetric(StrictModel):
    side: Literal["BUY", "SELL"]
    samples: Annotated[int, Field(ge=0)]
    entry: MetricNumber
    volume: Number
    mfePips: MetricNumber | None
    maePips: MetricNumber | None
    bestModeledNetPips: MetricNumber | None
    closestTpPips: MetricNumber | None
    closestSlPips: MetricNumber | None
    timeProfitableSeconds: MetricNumber


class FlightObservation(Record):
    setupId: Identity
    checkedAt: Instant | None
    observedAt: Instant
    coverageStart: Instant | None
    quoteAt: Instant | None
    final: bool | None
    gaps: Annotated[int, Field(ge=0)] | None
    records: Annotated[int, Field(ge=0)] | None
    snapshotSha256: Digest | None
    metrics: Annotated[list[FlightMetric], Field(max_length=2)]
    unavailableReason: Code | None
    basis: Literal["RECORDER_SUMMARY_NOT_VERIFIED_TICK_PATH"]
    chainVerified: Literal[False]
    counterfactualNet: None

    @model_validator(mode="after")
    def snapshot(self) -> FlightObservation:
        if self.unavailableReason is not None:
            if self.metrics:
                raise ValueError("LEARNING_UNAVAILABLE_FLIGHT_METRICS")
            return self
        if any(
            v is None
            for v in (
                self.checkedAt,
                self.coverageStart,
                self.final,
                self.gaps,
                self.records,
                self.snapshotSha256,
            )
        ):
            raise ValueError("LEARNING_FLIGHT_SNAPSHOT_INCOMPLETE")
        assert self.coverageStart is not None and self.checkedAt is not None
        if clock_status(self.coverageStart, self.checkedAt, self.observedAt) != "CAUSAL":
            raise ValueError("LEARNING_FLIGHT_CLOCK_INVALID")
        if self.quoteAt is not None and timestamp(self.quoteAt) > timestamp(self.checkedAt):
            raise ValueError("LEARNING_FLIGHT_CLOCK_INVALID")
        return self


class LearningEvidence(StrictModel):
    schemaVersion: Literal["scalper-learning-evidence-1.0"]
    sourceId: Name
    mode: Literal["demo"]
    symbol: Annotated[str, Field(pattern=r"^[A-Z0-9._-]{1,32}$")]
    exporterSourceSha256: Digest
    start: Instant
    until: Instant
    journalSnapshotAt: Instant
    exportedAt: Instant
    snapshotScope: Literal["ONE_REPEATABLE_READ_JOURNAL"]
    cohortBasis: Literal["OBSERVED_OR_CHANGED_IN_WINDOW_PLUS_ACTIVE_AND_LINKED"]
    dataUse: Literal["EXTERNAL_OBSERVATIONS_NOT_A_DATASET_PARTITION"]
    contexts: Annotated[list[ContextObservation], Field(max_length=MAX_RECORDS)]
    analyses: Annotated[list[AnalysisObservation], Field(max_length=MAX_RECORDS)]
    setups: Annotated[list[SetupObservation], Field(max_length=MAX_RECORDS)]
    flight: Annotated[list[FlightObservation], Field(max_length=MAX_RECORDS)]
    unscopedBrokerEvents: Annotated[list[BrokerObservation], Field(max_length=500)]
    coverageWarnings: Annotated[list[Code], Field(max_length=30)]
    scopeComplete: Literal[True]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]
    autonomousFinding: Literal[False]
    completeTickTape: Literal[False]
    counterfactualNet: None

    @model_validator(mode="before")
    @classmethod
    def exact_authority_flags(cls, value: Any) -> Any:
        expected = {
            "scopeComplete": True,
            "brokerAuthority": False,
            "promotionAuthority": False,
            "autonomousFinding": False,
            "completeTickTape": False,
        }
        if isinstance(value, dict) and any(
            value.get(k) is not flag for k, flag in expected.items()
        ):
            raise ValueError("LEARNING_AUTHORITY_INVALID")
        return value

    @model_validator(mode="after")
    def cohort(self) -> LearningEvidence:
        start, until, snapshot, exported = map(
            timestamp, (self.start, self.until, self.journalSnapshotAt, self.exportedAt)
        )
        if not start < until <= snapshot <= exported or until - start > timedelta(hours=1):
            raise ValueError("LEARNING_COHORT_CLOCK_INVALID")
        if exported > datetime.now(UTC) + timedelta(seconds=3):
            raise ValueError("LEARNING_EXPORT_CLOCK_FUTURE")
        local_times = [t for a in self.analyses for t in (a.persistedAt, a.updatedAt)]
        local_times += [r.decidedAt for a in self.analyses for r in a.risk]
        local_times += [t for g in self.setups for t in (g.createdAt, g.updatedAt)]
        local_times += [
            t
            for g in self.setups
            for o in g.orders
            for t in (o.placementResultPersistedAt, o.updatedAt)
            if t
        ]
        local_times += [f.receivedAt for g in self.setups for f in g.fills]
        for c in self.contexts:
            local_times += [
                t for t in (c.requestedAt, c.completedAt, c.availableAt, c.retiredAt) if t
            ]
        events = self.unscopedBrokerEvents + [e for g in self.setups for e in g.brokerEvents]
        local_times += [e.persistedAt for e in events]
        local_times += [p.persistedAt for g in self.setups for p in g.protectionHistory]
        local_times += [v.persistedAt for g in self.setups for v in g.brokerVariants]
        local_times += [d.recordedAt for g in self.setups for d in g.closeDeals]
        if any(timestamp(t) > snapshot for t in local_times):
            raise ValueError("LEARNING_JOURNAL_AFTER_SNAPSHOT")
        if any(timestamp(f.observedAt) > exported for f in self.flight):
            raise ValueError("LEARNING_RECORDER_AFTER_EXPORT")
        if (
            len(self.contexts) + len(self.analyses) + len(self.setups) + len(self.flight)
            > MAX_RECORDS
        ):
            raise ValueError("LEARNING_RECORD_LIMIT")
        for rows in (self.contexts, self.analyses, self.setups, self.flight):
            if len({r.id for r in rows}) != len(rows):
                raise ValueError("LEARNING_DUPLICATE_RECORD")
        # Reserve the trailing newline used by the exclusive file writer.
        if len(encoded(self.model_dump())) + 1 > MAX_BYTES:
            raise ValueError("LEARNING_BYTE_LIMIT")
        return self


def revised(value: dict[str, Any]) -> dict[str, Any]:
    return {**value, "revisionSha256": digest(value)}
