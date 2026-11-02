"""Fixed10-vs30 native-point observations. No hypothetical fill or order authority."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from python.backtest.fill_gap_review import flight_points, plain
from python.research.broker_acknowledgement_evidence import AcknowledgementPacket
from python.research.broker_metadata_evidence import MetadataObservation, observation
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import Digest, Identity, Instant, LearningEvidence, encoded
from python.research.observation_cycle import sha

RELEASE = "0.9.0-cost-balanced.1-codex.1"
SOURCE_FILES = (
    "python/research/entry_range_study.py",
    "python/operations/entry_range_study.py",
    "python/operations/export_learning_evidence.py",
    "python/operations/export_broker_acknowledgements.py",
    "python/research/learning_evidence.py",
    "python/research/broker_acknowledgement_evidence.py",
    "python/research/broker_metadata_evidence.py",
    "python/backtest/fill_gap_review.py",
    "python/backtest/breakout_entry_review.py",
    "packages/config/src/policy.ts",
    "python/research/codex_loop.py",
    "python/research/learning_archive.py",
    "python/research/isolated_worker.py",
    "python/research/observation_cycle.py",
    "python/operations/entry_context.py",
    "python/operations/setup_flight_recorder.py",
    "python/codex_entry/service.py",
    "requirements.lock",
)


class Registration(StrictModel):
    schemaVersion: Literal["entry-range-registration-1.0"]
    registeredAt: Instant
    start: Instant
    until: Instant
    economicRelease: Literal["0.9.0-cost-balanced.1-codex.1"]
    baselinePoints: Literal[30]
    candidatePoints: Literal[10]
    sourceFiles: dict[str, Digest]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]
    economicQualification: Literal[False]

    @model_validator(mode="after")
    def future(self) -> Registration:
        start, until = timestamp(self.start), timestamp(self.until)
        if not timestamp(self.registeredAt) < start < until or until - start > timedelta(days=7):
            raise ValueError("RANGE_REGISTRATION_WINDOW")
        if any(v.minute or v.second or v.microsecond for v in (start, until)):
            raise ValueError("RANGE_REGISTRATION_HOUR")
        if set(self.sourceFiles) != set(SOURCE_FILES):
            raise ValueError("RANGE_REGISTRATION_SOURCE_SET")
        return self


class PointReceipt(StrictModel):
    schemaVersion: Literal["entry-range-point-receipt-1.0"]
    metadata: MetadataObservation
    digits: Annotated[int, Field(strict=True, ge=0, le=12)] | None
    brokerSourceTime: None
    originalAcknowledgementMetadata: Literal[False]
    evidenceSha256: Digest

    @model_validator(mode="after")
    def binding(self) -> PointReceipt:
        if sha(encoded(self.model_dump(exclude={"evidenceSha256"}))) != self.evidenceSha256:
            raise ValueError("RANGE_POINT_HASH")
        return self


def point_receipt(raw: dict[str, Any], symbol: str, start: datetime, end: datetime) -> PointReceipt:
    digits = raw.get("digits")
    value = {
        "schemaVersion": "entry-range-point-receipt-1.0",
        "metadata": observation(raw, symbol, start, end).model_dump(),
        "digits": digits if type(digits) is int and 0 <= digits <= 12 else None,
        "brokerSourceTime": None,
        "originalAcknowledgementMetadata": False,
    }
    return PointReceipt.model_validate(value | {"evidenceSha256": sha(encoded(value))})


class RangeRow(StrictModel):
    setupId: Identity
    orderId: Identity
    cohortRole: Literal["OBSERVED_WINDOW", "CARRY_IN", "LINKED_REFERENCE"]
    orderStateAtSnapshot: str
    contextAvailableAt: Instant | None
    acknowledgedAt: Instant | None
    metadataSha256: Digest | None
    pointSize: str | None
    eligibility: Literal["OBSERVABLE", "UNAVAILABLE"]
    unavailableReasons: list[str]
    expiresAt: Instant | None
    originalFillRowsBeforeCutoff: int = Field(ge=0)
    originalFillClockUnknownRows: int = Field(ge=0)
    originalPartialAtCutoff: bool | None
    originalDealInsideCandidateBand: int = Field(ge=0)
    originalDealOutsideCandidateBand: int = Field(ge=0)
    originalDealRangeUnknown: int = Field(ge=0)
    originalClosedRowsBeforeCutoff: int = Field(ge=0)
    originalFillWithoutClosedTradeAtCutoff: bool
    flightGapRecords: int = Field(ge=0)
    flightStatus: Literal["VERIFIED_SAMPLED_PREFIX", "UNAVAILABLE"]
    usableExecutableSamples: int = Field(ge=0)
    sampledPricesInBaselineBand: int = Field(ge=0)
    sampledPricesInCandidateBand: int = Field(ge=0)
    pathCoverage: Literal["INCOMPLETE_SAMPLED_PATH_NO_NONFILL_OR_TRIGGER_PROOF"]
    candidateFill: None
    candidateNet: None
    candidateCosts: None
    candidateMargin: None

    @model_validator(mode="after")
    def counts(self) -> RangeRow:
        if self.originalFillRowsBeforeCutoff != (
            self.originalDealInsideCandidateBand
            + self.originalDealOutsideCandidateBand
            + self.originalDealRangeUnknown
        ) or not (
            self.sampledPricesInCandidateBand
            <= self.sampledPricesInBaselineBand
            <= self.usableExecutableSamples
        ):
            raise ValueError("RANGE_ROW_DENOMINATOR")
        if (self.eligibility == "UNAVAILABLE") != bool(self.unavailableReasons):
            raise ValueError("RANGE_ROW_AVAILABILITY")
        return self


class RangeReport(StrictModel):
    schemaVersion: Literal["entry-range-report-1.0"]
    registrationSha256: Digest
    inputSha256: Digest
    start: Instant
    until: Instant
    journalSnapshotAt: Instant
    acknowledgementSnapshotAt: Instant
    baselinePoints: Literal[30]
    candidatePoints: Literal[10]
    rows: list[RangeRow]
    allContextRecords: int = Field(ge=0)
    waitContextRecords: int = Field(ge=0)
    setupRoleCounts: dict[str, int]
    orderRecords: int = Field(ge=0)
    filledOrderRecords: int = Field(ge=0)
    noRecordedFillOrderRecords: int = Field(ge=0)
    unavailableOrderRecords: int = Field(ge=0)
    coverage: Literal["BOUNDED_OBSERVATION_WITH_OPEN_GAP_AND_UNKNOWN_DENOMINATORS"]
    originalBrokerMetadataProven: Literal[False]
    economicQualification: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="after")
    def counts(self) -> RangeReport:
        if (
            self.orderRecords != len(self.rows)
            or self.filledOrderRecords != sum(v.originalFillRowsBeforeCutoff > 0 for v in self.rows)
            or self.noRecordedFillOrderRecords != self.orderRecords - self.filledOrderRecords
            or self.unavailableOrderRecords
            != sum(v.eligibility == "UNAVAILABLE" for v in self.rows)
            or self.waitContextRecords > self.allContextRecords
        ):
            raise ValueError("RANGE_REPORT_DENOMINATOR")
        return self


def review(inputs: dict[str, Any], frozen: Registration, registration_sha: str) -> RangeReport:
    packet = LearningEvidence.model_validate(inputs["journal"])
    acknowledgements = AcknowledgementPacket.model_validate(inputs["acknowledgements"])
    if (packet.start, packet.until, packet.sourceId) != (
        acknowledgements.start,
        acknowledgements.until,
        acknowledgements.source,
    ) or not (
        timestamp(frozen.start)
        <= timestamp(packet.start)
        < timestamp(packet.until)
        <= timestamp(frozen.until)
    ):
        raise ValueError("RANGE_INPUT_WINDOW")
    cutoff = timestamp(packet.until)
    metadata = [PointReceipt.model_validate(v) for v in inputs["pointReceipts"]]
    contexts = {v.id: v for v in packet.contexts}
    acks = {v.eventId: v for v in acknowledgements.observations}
    rows = []
    for setup in packet.setups:
        context = contexts.get(setup.contextId or "")
        for order in setup.orders:
            reasons = []
            if setup.originRelease != frozen.economicRelease:
                reasons.append("OTHER_RELEASE")
            if order.orderType != "STOP_LIMIT" or order.timeInForce != "GTD":
                reasons.append("OTHER_ORDER_CONTRACT")
            available = context.availableAt if context else None
            if not context or context.clockStatus != "CAUSAL" or available is None:
                reasons.append("PROVIDER_AVAILABILITY_UNKNOWN")
            events = sorted(
                (
                    v
                    for v in setup.brokerEvents
                    if v.orderId == order.id
                    and v.executionType == 2
                    and v.mappingState == "MAPPED"
                    and not v.closingOrder
                    and v.orderType == 6
                    and v.clockStatus == "CAUSAL"
                    and timestamp(v.persistedAt) < cutoff
                ),
                key=lambda v: timestamp(v.persistedAt),
            )
            event = events[0] if events else None
            ack = acks.get(event.id) if event else None
            if (
                ack is None
                or event is None
                or ack.orderType != 6
                or ack.invalidFields
                or ack.clockStatus != "ORDERED"
                or ack.eventPayloadSha256 != event.payloadSha256
                or ack.receivedAt != event.receivedAt
                or (ack.stopPrice is None or Decimal(ack.stopPrice) != Decimal(order.entryPrice))
                or ack.timeInForce != 1
                or ack.expirationAt != order.expiresAt
                or order.expiresAt is None
                or timestamp(ack.persistedAt) >= cutoff
                or available is None
                or timestamp(available) > timestamp(event.occurredAt)
            ):
                reasons.append("NATIVE_ACK_UNAVAILABLE_OR_CONFLICT")
            if ack is not None and ack.slippageInPoints != "30":
                reasons.append("BASELINE_RANGE_DIFFERS")
            receipts = [
                v
                for v in metadata
                if ack is not None
                and v.metadata.symbol == packet.symbol
                and v.metadata.reportedSymbol == packet.symbol
                and timedelta(0)
                <= timestamp(ack.receivedAt) - timestamp(v.metadata.responseReceivedAt)
                <= timedelta(seconds=30)
            ]
            receipt = (
                max(receipts, key=lambda v: v.metadata.responseReceivedAt) if receipts else None
            )
            point = (
                Decimal(10) ** -receipt.digits if receipt and receipt.digits is not None else None
            )
            if point is None:
                reasons.append("PRIOR_POINT_METADATA_UNAVAILABLE")
            entry = Decimal(order.entryPrice)
            direction = 1 if order.side == "BUY" else -1
            fills = [
                v for v in setup.fills if v.orderId == order.id and timestamp(v.receivedAt) < cutoff
            ]
            unknown_fill_clocks = sum(v.clockStatus != "CAUSAL" for v in fills)
            deals = [
                direction * (Decimal(v.price) - entry) for v in fills if v.clockStatus == "CAUSAL"
            ]
            flight = inputs["flight"].get(setup.id, {"records": [], "status": "UNAVAILABLE"})
            records = flight["records"]
            if len(records) > 100000:
                raise ValueError("RANGE_PATH_LIMIT")
            quotes = []
            for record in records:
                if record["kind"] == "GAP":
                    quotes.append(record)
                elif record["kind"] == "BROKER_QUOTE":
                    q = record["payload"]
                    if (
                        q.get("sourceTime")
                        and q.get("receivedAt")
                        and record.get("observedAt")
                        and timestamp(q["sourceTime"])
                        <= timestamp(q["receivedAt"])
                        <= timestamp(record["observedAt"])
                        < cutoff
                    ):
                        quotes.append(record)
                    else:
                        quotes.append({"kind": "GAP", "payload": {"reason": "INVALID_QUOTE_CLOCK"}})
            samples = []
            if not reasons:
                assert (
                    ack is not None
                    and event is not None
                    and available is not None
                    and order.expiresAt is not None
                )
                earliest = max(
                    timestamp(available), timestamp(ack.persistedAt), timestamp(event.persistedAt)
                )
                end = min(cutoff, timestamp(order.expiresAt))
                terminal = [
                    timestamp(v.persistedAt)
                    for v in setup.brokerEvents
                    if v.orderId == order.id
                    and v.mappingState == "MAPPED"
                    and not v.closingOrder
                    and v.executionType in {3, 5, 6, 7}
                    and v.clockStatus == "CAUSAL"
                    and timestamp(v.persistedAt) >= earliest
                ]
                if terminal:
                    end = min(end, min(terminal))
                for p in flight_points(quotes):
                    side_at = p.ask_at if order.side == "BUY" else p.bid_at
                    if (
                        earliest <= p.source <= p.received < end
                        and p.received - side_at <= timedelta(seconds=3)
                    ):
                        samples.append(
                            direction * ((p.ask if order.side == "BUY" else p.bid) - entry)
                        )
            observable = not reasons
            rows.append(
                RangeRow(
                    setupId=setup.id,
                    orderId=order.id,
                    cohortRole=setup.cohortRole,
                    orderStateAtSnapshot=order.state,
                    contextAvailableAt=available,
                    acknowledgedAt=event.occurredAt if event else None,
                    metadataSha256=receipt.evidenceSha256 if receipt else None,
                    pointSize=plain(point) if point is not None else None,
                    eligibility="OBSERVABLE" if observable else "UNAVAILABLE",
                    unavailableReasons=reasons,
                    expiresAt=order.expiresAt,
                    originalFillRowsBeforeCutoff=len(fills),
                    originalFillClockUnknownRows=unknown_fill_clocks,
                    originalPartialAtCutoff=None
                    if unknown_fill_clocks
                    else (
                        0
                        < sum((Decimal(v.volume) for v in fills), Decimal(0))
                        < Decimal(order.approvedVolume)
                    ),
                    originalDealInsideCandidateBand=sum(d <= 10 * point for d in deals)
                    if observable and point
                    else 0,
                    originalDealOutsideCandidateBand=sum(d > 10 * point for d in deals)
                    if observable and point
                    else 0,
                    originalDealRangeUnknown=unknown_fill_clocks if observable else len(fills),
                    originalClosedRowsBeforeCutoff=sum(
                        timestamp(v.closedAt) < cutoff for v in setup.closedTrades
                    ),
                    originalFillWithoutClosedTradeAtCutoff=bool(fills)
                    and not any(timestamp(v.closedAt) < cutoff for v in setup.closedTrades),
                    flightGapRecords=sum(v["kind"] == "GAP" for v in records),
                    flightStatus=flight["status"],
                    usableExecutableSamples=len(samples),
                    sampledPricesInBaselineBand=sum(0 <= d <= 30 * point for d in samples)
                    if point
                    else 0,
                    sampledPricesInCandidateBand=sum(0 <= d <= 10 * point for d in samples)
                    if point
                    else 0,
                    pathCoverage="INCOMPLETE_SAMPLED_PATH_NO_NONFILL_OR_TRIGGER_PROOF",
                    candidateFill=None,
                    candidateNet=None,
                    candidateCosts=None,
                    candidateMargin=None,
                )
            )
    roles = {
        role: sum(v.cohortRole == role for v in packet.setups)
        for role in ("OBSERVED_WINDOW", "CARRY_IN", "LINKED_REFERENCE")
    }
    return RangeReport(
        schemaVersion="entry-range-report-1.0",
        registrationSha256=registration_sha,
        inputSha256=sha(encoded(inputs)),
        start=packet.start,
        until=packet.until,
        journalSnapshotAt=packet.journalSnapshotAt,
        acknowledgementSnapshotAt=acknowledgements.snapshotAt,
        baselinePoints=30,
        candidatePoints=10,
        rows=rows,
        allContextRecords=len(packet.contexts),
        waitContextRecords=sum(v.decision == "WAIT" for v in packet.contexts),
        setupRoleCounts=roles,
        orderRecords=len(rows),
        filledOrderRecords=sum(v.originalFillRowsBeforeCutoff > 0 for v in rows),
        noRecordedFillOrderRecords=sum(v.originalFillRowsBeforeCutoff == 0 for v in rows),
        unavailableOrderRecords=sum(v.eligibility == "UNAVAILABLE" for v in rows),
        coverage="BOUNDED_OBSERVATION_WITH_OPEN_GAP_AND_UNKNOWN_DENOMINATORS",
        originalBrokerMetadataProven=False,
        economicQualification=False,
        brokerAuthority=False,
        promotionAuthority=False,
    )
