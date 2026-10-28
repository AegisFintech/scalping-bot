"""Offline single STOP_LIMIT/GTD reconstruction. Sampled eligibility is never a fill."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import timedelta
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from itertools import pairwise
from pathlib import Path
from typing import Annotated, Any, Final, Literal, cast

from pydantic import Field, model_validator

from python.backtest.breakout_entry_review import verify_records, write_new
from python.backtest.fill_gap_review import MAX_AGE, flight_points
from python.operations.entry_context import timestamp
from python.research.codex_loop import StrictModel
from python.research.learning_archive import bounded, parse, unique
from python.research.learning_evidence import (
    Code,
    ContextObservation,
    Digest,
    FillObservation,
    Identity,
    Instant,
    LearningEvidence,
    MetricNumber,
    Number,
    SetupObservation,
    encoded,
)

RELEASE = "0.8.0-model-scalp.1-codex.1"
MAX_PATH_BYTES = 32 * 1024**2
BASELINE: Final = "completed-m15-m5-trend-m1-five-bars-one-tick-1.0"


def plain(value: Decimal) -> str:
    return format(value, "f")


class FileReference(StrictModel):
    name: Annotated[str, Field(pattern=r"^flight-[a-f0-9]{24}-[0-9T]+-[0-9]{4}\.jsonl(\.gz)?$")]
    sha256: Digest


class PathSession(StrictModel):
    setupId: Identity
    files: Annotated[list[FileReference], Field(min_length=1, max_length=128)]


class PathCompanion(StrictModel):
    schemaVersion: Literal["scalp-replay-paths-1.0"]
    packetSha256: Digest
    sessions: Annotated[list[PathSession], Field(max_length=16)]
    # A declared range is a research hypothesis, never reconstructed broker acknowledgement.
    declaredRangeTicks: Annotated[int, Field(ge=0, le=1000)] | None
    rangeBasis: Literal["DECLARED_HYPOTHESIS_NOT_BROKER_ACK"]
    brokerAuthority: Literal[False]

    @model_validator(mode="after")
    def names(self) -> PathCompanion:
        seen: set[str] = set()
        for session in self.sessions:
            names = [f.name for f in session.files]
            stems = {name.rsplit("-", 1)[0] for name in names}
            if (
                len(stems) != 1
                or names != sorted(names)
                or any(
                    name in seen or not name.startswith("flight-" + session.setupId + "-")
                    for name in names
                )
            ):
                raise ValueError("SCALP_PATH_SESSION_INVALID")
            seen.update(names)
        return self


class EntryBenchmark(StrictModel):
    contextId: Identity
    definition: Literal["completed-m15-m5-trend-m1-five-bars-one-tick-1.0"] = BASELINE
    decision: Literal["BUY", "SELL", "WAIT"]
    entry: Number | None
    availableAt: Instant | None
    originalDecision: Literal["BUY", "SELL", "WAIT", "UNKNOWN"]
    directionAgreement: bool | None
    reasons: list[Code]
    entryOnlyTakeProfit: Number | None = None
    entryOnlyStopLoss: Number | None = None
    frozenApprovedVolume: Number | None = None
    counterfactualFill: None = None
    counterfactualNet: None = None


class PathDiagnostic(StrictModel):
    status: Literal["UNAVAILABLE", "OBSERVED", "CENSORED"]
    acceptedBrokerAt: Instant | None = None
    activationAt: Instant | None = None
    limitEligibleAt: Instant | None = None
    declaredLimit: MetricNumber | None = None
    declaredRangeBasis: Literal["DECLARED_HYPOTHESIS_NOT_BROKER_ACK"] | None = None
    usableSamples: Annotated[int, Field(ge=0)] = 0
    reasons: list[Code]
    completeTickTape: Literal[False] = False
    brokerRangeAcknowledgement: Literal["NOT_RETAINED"] = "NOT_RETAINED"
    counterfactualFill: None = None
    counterfactualNet: None = None


class ExposurePath(StrictModel):
    positionId: Identity
    basis: Literal["SAMPLED_EXECUTABLE_SIDE_KNOWN_FILL_VWAP"] = (
        "SAMPLED_EXECUTABLE_SIDE_KNOWN_FILL_VWAP"
    )
    samples: int = 0
    observedMfePrice: MetricNumber | None = None
    observedMaePrice: MetricNumber | None = None
    firstObservedGrossPositiveAt: Instant | None = None
    firstObservedTpCrossingAt: Instant | None = None
    firstObservedSlCrossingAt: Instant | None = None
    afterCostTimeToProfit: None = None
    exitCause: None = None
    counterfactualNet: None = None
    reasons: list[Code] = Field(default_factory=list)


def exposure_paths(
    group: SetupObservation, sessions: list[list[dict[str, Any]]], cutoff: str
) -> list[ExposurePath]:
    if len(group.orders) != 1 or not sessions:
        return []
    order = group.orders[0]
    fills = {
        f.id: f
        for f in group.fills
        if f.orderId == order.id and f.positionId is not None and f.clockStatus == "CAUSAL"
    }
    result = []
    for position in sorted({f.positionId for f in fills.values() if f.positionId is not None}):
        row = ExposurePath(positionId=position)
        reasons = {
            "SAMPLED_EXCURSIONS_NOT_COMPLETE_PATH",
            "AFTER_COST_PROFIT_UNKNOWN_FX_AND_FUTURE_FEES",
        }
        previous = None
        for records in sorted(sessions, key=lambda rows: timestamp(rows[0]["observedAt"])):
            if records[0]["payload"].get("carryIn") is not False:
                reasons.add("EXPOSURE_CARRY_IN_OR_UNDECLARED")
            known = [r for r in records if timestamp(r["observedAt"]) <= timestamp(cutoff)]
            if any(r["kind"] == "GAP" for r in known):
                reasons.add("EXPOSURE_GAP")
            for point in flight_points(known):
                position_fills = [
                    f
                    for f in fills.values()
                    if f.positionId == position
                    and timestamp(f.occurredAt) <= point.source
                    and timestamp(f.receivedAt) <= point.received
                ]
                quantity = sum((Decimal(f.volume) for f in position_fills), Decimal(0))
                if quantity <= 0:
                    continue
                if any(
                    d.positionId == position and timestamp(d.occurredAt) <= point.source
                    for d in group.closeDeals
                ):
                    reasons.add("EXPOSURE_AFTER_PARTIAL_OR_FULL_CLOSE_CENSORED")
                    continue
                if previous is not None and (
                    point.source <= previous or point.source - previous > MAX_AGE
                ):
                    reasons.add("EXPOSURE_GAP_OR_UNORDERED")
                previous = point.source
                side_at = point.bid_at if order.side == "BUY" else point.ask_at
                if point.received - side_at > MAX_AGE:
                    reasons.add("EXPOSURE_SIDE_STALE")
                    continue
                entry = (
                    sum((Decimal(f.price) * Decimal(f.volume) for f in position_fills), Decimal(0))
                    / quantity
                )
                mark = point.bid if order.side == "BUY" else point.ask
                move = (mark - entry) * (1 if order.side == "BUY" else -1)
                row.samples += 1
                row.observedMfePrice = plain(
                    max(Decimal(row.observedMfePrice or "0"), move, Decimal(0))
                )
                row.observedMaePrice = plain(
                    max(Decimal(row.observedMaePrice or "0"), -move, Decimal(0))
                )
                if move > 0 and row.firstObservedGrossPositiveAt is None:
                    row.firstObservedGrossPositiveAt = point.source.isoformat()
                observations = [
                    p
                    for p in group.protectionHistory
                    if p.positionId == position
                    and p.kind == "OBSERVATION"
                    and timestamp(p.persistedAt) <= point.received
                ]
                if not observations:
                    reasons.add("HISTORICAL_PROTECTION_UNAVAILABLE")
                    continue
                latest = max(timestamp(p.persistedAt) for p in observations)
                tied = [p for p in observations if timestamp(p.persistedAt) == latest]
                geometries = {(p.status, p.stopLoss, p.takeProfit, p.observedAt) for p in tied}
                if len(geometries) != 1:
                    reasons.add("HISTORICAL_PROTECTION_CONFLICT")
                    continue
                protected = tied[0]
                if (
                    protected.status != "VERIFIED"
                    or protected.observedAt is None
                    or timestamp(protected.observedAt) > point.source
                    or point.source - timestamp(protected.observedAt) > MAX_AGE
                ):
                    reasons.add("HISTORICAL_PROTECTION_STALE_OR_UNVERIFIED")
                    continue
                if protected.takeProfit is not None:
                    target = Decimal(protected.takeProfit)
                    crossed = mark >= target if order.side == "BUY" else mark <= target
                    if crossed and row.firstObservedTpCrossingAt is None:
                        row.firstObservedTpCrossingAt = point.source.isoformat()
                if protected.stopLoss is not None:
                    stop = Decimal(protected.stopLoss)
                    crossed = mark <= stop if order.side == "BUY" else mark >= stop
                    if crossed and row.firstObservedSlCrossingAt is None:
                        row.firstObservedSlCrossingAt = point.source.isoformat()
        row.reasons = sorted(reasons)
        result.append(row)
    return result


class SetupReconstruction(StrictModel):
    setupId: Identity
    supported: bool
    state: Literal[
        "UNKNOWN", "UNFILLED_PENDING", "ZERO_FILL_TERMINAL", "PARTIAL_OPEN", "OPEN", "CLOSED"
    ]
    rawFillRows: Annotated[int, Field(ge=0)]
    uniqueEntryFills: Annotated[int, Field(ge=0)]
    filledVolume: MetricNumber
    weightedEntry: MetricNumber | None
    partialCloseVolume: MetricNumber
    recordedClosedTrades: Annotated[int, Field(ge=0)]
    recordedClosedNet: MetricNumber | None
    currency: str
    reasons: list[Code]
    path: PathDiagnostic
    exposure: list[ExposurePath] = Field(default_factory=list)
    gtdAcknowledgement: Literal["NOT_RETAINED"] = "NOT_RETAINED"
    actualFilledStopRisk: None = None
    counterfactualNet: None = None


class EvaluationPeriod(StrictModel):
    partition: Literal["DEVELOPMENT", "VALIDATION", "HOLDOUT"]
    start: Instant
    until: Instant


class DraftCandidate(StrictModel):
    id: Annotated[str, Field(pattern=r"^[a-zA-Z0-9._-]{1,80}$")]
    codeSha256: Digest
    changedRule: Literal["ENTRY_ONLY"]
    hypothesis: Annotated[str, Field(min_length=1, max_length=1000)]


class EvaluationDraft(StrictModel):
    schemaVersion: Literal["scalp-evaluation-draft-1.0"]
    status: Literal["DRAFT_NOT_REGISTERED"]
    sourceSha256: Digest
    periods: Annotated[list[EvaluationPeriod], Field(min_length=3, max_length=3)]
    purgeSeconds: Annotated[int, Field(ge=0, le=1209600)]
    embargoSeconds: Annotated[int, Field(ge=0, le=1209600)]
    candidates: Annotated[list[DraftCandidate], Field(min_length=1, max_length=20)]
    declaredAttemptIds: Annotated[list[str], Field(min_length=1, max_length=1000)]
    primaryMetric: Literal["AFTER_COST_EXPECTANCY_WHEN_IDENTIFIABLE"]
    uncertainty: Literal["CORRELATED_CONTEXT_BLOCKS_REQUIRES_REVIEW"]
    multipleTesting: Literal["ALL_DECLARED_ATTEMPTS_REQUIRES_REVIEW"]
    numericalThresholds: None
    operatorThresholdReview: Literal["PENDING"]
    registrationAuthority: Literal[False]
    promotionAuthority: Literal[False]
    brokerAuthority: Literal[False]

    @model_validator(mode="after")
    def chronology(self) -> EvaluationDraft:
        if [p.partition for p in self.periods] != ["DEVELOPMENT", "VALIDATION", "HOLDOUT"]:
            raise ValueError("SCALP_DRAFT_PARTITIONS_INVALID")
        separation = timedelta(seconds=self.purgeSeconds + self.embargoSeconds)
        if any(timestamp(p.start) >= timestamp(p.until) for p in self.periods) or any(
            timestamp(a.until) + separation > timestamp(b.start) for a, b in pairwise(self.periods)
        ):
            raise ValueError("SCALP_DRAFT_CHRONOLOGY_INVALID")
        ids = [c.id for c in self.candidates]
        if (
            len(set(ids)) != len(ids)
            or len(set(self.declaredAttemptIds)) != len(self.declaredAttemptIds)
            or not set(ids) <= set(self.declaredAttemptIds)
        ):
            raise ValueError("SCALP_DRAFT_ATTEMPT_INVENTORY_INVALID")
        return self


class ClosedStatistics(StrictModel):
    currency: str
    basis: Literal["RECORDED_CLOSED_ROWS_NOT_COMPLETE_COHORT"] = (
        "RECORDED_CLOSED_ROWS_NOT_COMPLETE_COHORT"
    )
    records: int
    wins: int
    losses: int
    breakeven: int
    recordedNet: MetricNumber
    meanNet: MetricNumber
    meanWin: MetricNumber | None
    meanLoss: MetricNumber | None
    largestWin: MetricNumber | None
    worstLoss: MetricNumber | None
    withoutLargestWinnerDiagnostic: MetricNumber
    providerCost: None = None
    actualStopRiskR: None = None
    preIntentEquityNormalizedReturn: None = None
    portfolioDrawdown: None = None


class ReplayReport(StrictModel):
    schemaVersion: Literal["scalp-replay-report-1.0"]
    classification: Literal["RECONSTRUCTION_ONLY"]
    packetSha256: Digest
    sourceId: str
    replaySourceSha256: Digest
    sourceHashScope: Literal["MODULE_FILE_ONLY_NOT_CLOSURE_OR_DEPLOYMENT_ATTESTATION"] = (
        "MODULE_FILE_ONLY_NOT_CLOSURE_OR_DEPLOYMENT_ATTESTATION"
    )
    knowledgeCutoff: Instant
    counts: dict[str, int]
    setups: list[SetupReconstruction]
    benchmark: list[EntryBenchmark]
    recordedClosedStatistics: list[ClosedStatistics]
    draftProtocolSha256: Digest | None
    recommendation: Literal["HOLD"]
    reasons: list[Code]
    providerCost: None
    counterfactualNet: None
    portfolioDrawdown: None
    promotionAuthority: Literal[False]
    brokerAuthority: Literal[False]


def benchmark(context: ContextObservation) -> EntryBenchmark:
    result = EntryBenchmark(
        contextId=context.id,
        decision="WAIT",
        entry=None,
        availableAt=context.availableAt,
        originalDecision=context.decision,
        directionAgreement=None,
        reasons=[],
    )
    market = context.market
    if context.clockStatus != "CAUSAL" or context.state != "READY" or market is None:
        result.reasons = ["CONTEXT_UNAVAILABLE_OR_UNORDERED"]
        return result
    series: dict[str, list[list[Any]]] = {s.timeframe: s.rows for s in market.candles}
    if any(len(series[t]) < n for t, n in (("M1", 5), ("M5", 2), ("M15", 2))):
        result.reasons = ["BASELINE_HISTORY_INSUFFICIENT"]
        return result
    rows = series["M1"][-5:]
    if any(timestamp(a[1]) != timestamp(b[0]) for a, b in pairwise(rows)):
        result.reasons = ["BASELINE_M1_GAP"]
        return result
    if any(timestamp(series[t][-2][1]) != timestamp(series[t][-1][0]) for t in ("M5", "M15")):
        result.reasons = ["BASELINE_TREND_SESSION_GAP"]
        return result
    changes = [Decimal(series[t][-1][5]) - Decimal(series[t][-2][5]) for t in ("M5", "M15")]
    side = "BUY" if all(v > 0 for v in changes) else "SELL" if all(v < 0 for v in changes) else None
    if side is None:
        result.reasons = ["BASELINE_TREND_DISAGREES"]
        return result
    tick = Decimal(market.tick_size)
    if side == "BUY":
        level = max(Decimal(r[3]) for r in rows) + tick
        entry = max(level, Decimal(market.entry_boundaries.buy_stop_minimum))
        entry = (entry / tick).to_integral_value(rounding=ROUND_CEILING) * tick
    else:
        level = min(Decimal(r[4]) for r in rows) - tick
        entry = min(level, Decimal(market.entry_boundaries.sell_stop_maximum))
        entry = (entry / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
    if entry <= 0:
        result.reasons = ["BASELINE_ENTRY_INVALID"]
        return result
    result.decision = cast('Literal["BUY", "SELL"]', side)
    result.entry = plain(entry)
    result.directionAgreement = (
        context.decision == side if context.decision in {"BUY", "SELL"} else None
    )
    result.reasons = ["SAME_RECORDED_AVAILABILITY_NOT_AN_ALTERNATE_REQUEST_STREAM"]
    return result


def load_paths(
    companion: PathCompanion, directory: Path, packet: LearningEvidence
) -> dict[str, list[list[dict[str, Any]]]]:
    groups = {g.id: g for g in packet.setups}
    result: dict[str, list[list[dict[str, Any]]]] = {}
    used = decoded = 0
    for session in companion.sessions:
        if session.setupId not in groups:
            raise ValueError("SCALP_PATH_SETUP_UNKNOWN")
        paths = []
        for reference in session.files:
            path = directory / reference.name
            raw = bounded(path, MAX_PATH_BYTES)
            used += len(raw)
            if used > MAX_PATH_BYTES or hashlib.sha256(raw).hexdigest() != reference.sha256:
                raise ValueError("SCALP_PATH_HASH_OR_BOUNDS")
            paths.append(path)
        records = verify_records(paths)
        previous_at = None
        for record in records:
            at = timestamp(record["observedAt"])
            if previous_at is not None and at < previous_at:
                raise ValueError("SCALP_PATH_PERSISTENCE_CLOCK_UNORDERED")
            previous_at = at
            if (
                record["kind"] == "BROKER_QUOTE"
                and record["payload"].get("receivedAt") is not None
                and timestamp(record["payload"]["receivedAt"]) > at
            ):
                raise ValueError("SCALP_PATH_RECEIPT_AFTER_PERSISTENCE")
        decoded += sum(len(encoded(r)) for r in records)
        if (
            decoded > MAX_PATH_BYTES
            or sum(map(len, result.get(session.setupId, []))) + len(records) > 100_000
        ):
            raise ValueError("SCALP_PATH_DECODED_BOUNDS")
        first = records[0]["payload"].get("setup", {})
        if (
            first.get("setup") != session.setupId
            or first.get("originRelease") != groups[session.setupId].originRelease
        ):
            raise ValueError("SCALP_PATH_SCOPE_MISMATCH")
        result.setdefault(session.setupId, []).append(records)
    return result


def path_diagnostic(
    group: SetupObservation,
    context: ContextObservation | None,
    sessions: list[list[dict[str, Any]]],
    cutoff: str,
    range_ticks: int | None,
) -> PathDiagnostic:
    result = PathDiagnostic(status="UNAVAILABLE", reasons=["PATH_NOT_PROVIDED"])
    if not sessions or context is None or context.market is None or context.availableAt is None:
        return result
    if len(group.orders) != 1 or context.clockStatus != "CAUSAL":
        result.reasons = ["PATH_CONTEXT_UNSUPPORTED"]
        return result
    order = group.orders[0]
    accepted = [
        e
        for e in group.brokerEvents
        if e.orderId == order.id
        and e.executionType == 2
        and e.mappingState == "MAPPED"
        and not e.closingOrder
        and e.orderType == 6
        and e.clockStatus == "CAUSAL"
        and timestamp(e.persistedAt) <= timestamp(cutoff)
    ]
    if not accepted:
        result.reasons = ["PENDING_ACK_MISSING"]
        return result
    start = min(timestamp(e.occurredAt) for e in accepted)
    result.acceptedBrokerAt = start.isoformat()
    if start < timestamp(context.availableAt) or order.expiresAt is None:
        result.reasons = ["ACCEPTANCE_BEFORE_MODEL_AVAILABILITY_OR_EXPIRY_UNKNOWN"]
        return result
    end = min(timestamp(order.expiresAt), timestamp(cutoff))
    stop = Decimal(order.entryPrice)
    limit = (
        None
        if range_ticks is None
        else stop
        + Decimal(context.market.tick_size) * range_ticks * (1 if order.side == "BUY" else -1)
    )
    result.declaredLimit = plain(limit) if limit is not None else None
    result.declaredRangeBasis = "DECLARED_HYPOTHESIS_NOT_BROKER_ACK" if limit is not None else None
    result.status = "OBSERVED"
    reasons = {"SAMPLED_ELIGIBILITY_IS_NOT_A_BROKER_FILL", "GTD_ACK_NOT_RETAINED"}
    if limit is None:
        reasons.add("ENTRY_RANGE_ACK_NOT_RETAINED_NO_HYPOTHESIS")
    previous = None
    for records in sorted(sessions, key=lambda rows: timestamp(rows[0]["observedAt"])):
        if records[0]["payload"].get("carryIn") is not False:
            reasons.add("PATH_CARRY_IN_OR_UNDECLARED")
        relevant = [r for r in records if timestamp(r["observedAt"]) <= timestamp(cutoff)]
        if any(r["kind"] == "GAP" for r in relevant) or previous is not None:
            reasons.add("PATH_GAP_OR_RESTART")
        for point in flight_points(relevant):
            if point.source == start or point.source == end or point.received == end:
                reasons.add("PATH_BOUNDARY_ORDER_AMBIGUOUS")
                continue
            if point.source < start or point.source > end or point.received > end:
                continue
            if previous is not None and (
                point.source <= previous or point.source - previous > MAX_AGE
            ):
                reasons.add("PATH_GAP_OR_UNORDERED_SOURCE")
            if previous is None and point.source - start > MAX_AGE:
                reasons.add("PATH_GAP_INITIAL_COVERAGE_UNKNOWN")
            previous = point.source
            side_at = point.ask_at if order.side == "BUY" else point.bid_at
            if point.received - side_at > MAX_AGE:
                reasons.add("EXECUTABLE_SIDE_STALE")
                continue
            value = point.ask if order.side == "BUY" else point.bid
            result.usableSamples += 1
            crossed = value >= stop if order.side == "BUY" else value <= stop
            if result.activationAt is None and crossed:
                result.activationAt = point.source.isoformat()
            eligible = limit is not None and (
                value <= limit if order.side == "BUY" else value >= limit
            )
            if result.activationAt is not None and result.limitEligibleAt is None and eligible:
                result.limitEligibleAt = point.source.isoformat()
    if result.activationAt is None:
        reasons.add("NO_OBSERVED_ACTIVATION_NOT_PROOF_OF_NO_CROSSING")
    if any(
        r.startswith(("PATH_GAP", "PATH_BOUNDARY", "PATH_CARRY", "EXECUTABLE")) for r in reasons
    ):
        result.status = "CENSORED"
    result.reasons = sorted(reasons)
    return result


def reconstruct(
    group: SetupObservation,
    context: ContextObservation | None,
    cutoff: str,
    sessions: list[list[dict[str, Any]]],
    range_ticks: int | None,
) -> SetupReconstruction:
    supported = (
        group.originRelease == RELEASE and group.timeInForce == "GTD" and len(group.orders) == 1
    )
    result = SetupReconstruction(
        setupId=group.id,
        supported=supported,
        state="UNKNOWN",
        rawFillRows=len(group.fills),
        uniqueEntryFills=0,
        filledVolume="0",
        weightedEntry=None,
        partialCloseVolume="0",
        recordedClosedTrades=len(group.closedTrades),
        recordedClosedNet=None,
        currency=group.accountCurrency,
        reasons=[],
        path=PathDiagnostic(status="UNAVAILABLE", reasons=["PATH_NOT_PROVIDED"]),
    )
    reasons = {
        "GTD_ACK_NOT_RETAINED",
        "ENTRY_RANGE_ACK_NOT_RETAINED",
        "HISTORICAL_BROKER_METADATA_NOT_ATTESTED",
    }
    if not supported:
        result.reasons = ["LEGACY_OR_UNSUPPORTED_SETUP"]
        return result
    order = group.orders[0]
    if order.orderType != "STOP_LIMIT" or order.timeInForce != "GTD":
        result.supported = False
        reasons.add("ORDER_TYPE_MISMATCH")
    if (
        context is None
        or context.decision not in {"BUY", "SELL"}
        or context.clockStatus != "CAUSAL"
    ):
        reasons.add("CONTEXT_MISSING_OR_UNORDERED")
    elif (
        context.decision != order.side
        or context.entryPrice is None
        or Decimal(context.entryPrice) != Decimal(order.entryPrice)
        or context.takeProfit is None
        or Decimal(context.takeProfit) != Decimal(order.takeProfit)
        or context.stopLoss is None
        or Decimal(context.stopLoss) != Decimal(order.stopLoss)
        or context.validUntil != order.expiresAt
    ):
        reasons.add("APPROVED_INTENT_CONTEXT_MISMATCH")
    if (
        context is not None
        and context.availableAt is not None
        and (
            timestamp(context.availableAt) > timestamp(group.createdAt)
            or any(
                e.orderId == order.id
                and e.executionType == 2
                and timestamp(e.occurredAt) < timestamp(context.availableAt)
                for e in group.brokerEvents
            )
        )
    ):
        reasons.add("ADMISSION_CHRONOLOGY_INVALID")
    if Decimal(order.approvedVolume) <= 0 or Decimal(order.filledVolume) < 0:
        reasons.add("ORDER_VOLUME_INVALID")
    fills: dict[str, FillObservation] = {}
    for fill in group.fills:
        if fill.orderId != order.id:
            reasons.add("FILL_ORDER_LINK_UNAVAILABLE")
            continue
        if timestamp(fill.receivedAt) > timestamp(cutoff):
            reasons.add("FILL_NOT_KNOWN_AT_CUTOFF")
            continue
        if Decimal(fill.volume) <= 0 or Decimal(fill.price) <= 0:
            reasons.add("FILL_PRICE_OR_VOLUME_INVALID")
            continue
        if (
            context is not None
            and context.availableAt is not None
            and timestamp(fill.occurredAt) < timestamp(context.availableAt)
        ):
            reasons.add("ADMISSION_CHRONOLOGY_INVALID")
        if fill.id in fills and fills[fill.id] != fill:
            reasons.add("FILL_IDENTITY_CONFLICT")
        fills[fill.id] = fill
        if fill.clockStatus != "CAUSAL":
            reasons.add("FILL_CLOCK_UNORDERED")
    quantity = sum((Decimal(f.volume) for f in fills.values()), Decimal(0))
    result.uniqueEntryFills = len(fills)
    result.filledVolume = plain(quantity)
    if quantity:
        result.weightedEntry = plain(
            sum((Decimal(f.volume) * Decimal(f.price) for f in fills.values()), Decimal(0))
            / quantity
        )
    if quantity != Decimal(order.filledVolume) or quantity > Decimal(order.approvedVolume):
        reasons.add("FILL_VOLUME_MISMATCH")
    if any(
        (e.mappingState != "MAPPED" or e.reasonCodes) and e.resolvedAt is None
        for e in group.brokerEvents
    ):
        reasons.add("BROKER_EVENT_UNRESOLVED")
    if any(timestamp(e.persistedAt) > timestamp(cutoff) for e in group.brokerEvents):
        reasons.add("BROKER_EVENT_NOT_KNOWN_AT_CUTOFF")
    closes = [d for d in group.closeDeals if timestamp(d.recordedAt) <= timestamp(cutoff)]
    result.partialCloseVolume = plain(sum((Decimal(d.closedVolume) for d in closes), Decimal(0)))
    terminal = any(
        e.orderId == order.id
        and not e.closingOrder
        and (e.executionType, order.state) in {(5, "CANCELLED"), (6, "EXPIRED"), (7, "REJECTED")}
        and e.mappingState == "MAPPED"
        and not e.reasonCodes
        and e.clockStatus == "CAUSAL"
        and timestamp(e.persistedAt) <= timestamp(cutoff)
        for e in group.brokerEvents
    )
    if any(
        e.orderId == order.id
        and not e.closingOrder
        and e.executionType in {5, 6, 7}
        and e.mappingState == "MAPPED"
        and (e.executionType, order.state)
        not in {(5, "CANCELLED"), (6, "EXPIRED"), (7, "REJECTED")}
        for e in group.brokerEvents
    ):
        reasons.add("TERMINAL_STATE_CONFLICT")
    if quantity:
        positions = {f.positionId for f in fills.values()}
        protected_positions = {p.positionId for p in group.currentProtection}
        closed_positions = {d.positionId for d in closes}
        if (
            None in positions
            or positions != protected_positions
            or any(p.side != order.side for p in group.currentProtection)
        ):
            reasons.add("POSITION_EVIDENCE_INCOMPLETE")
        if (
            group.state == "CLOSED"
            and group.closedTrades
            and group.currentProtection
            and None not in positions
            and positions == protected_positions == closed_positions
            and all(p.positionState == "CLOSED" for p in group.currentProtection)
            and Decimal(result.partialCloseVolume) == quantity
            and all(
                sum(
                    (Decimal(d.closedVolume) for d in closes if d.positionId == position),
                    Decimal(0),
                )
                == sum(
                    (Decimal(f.volume) for f in fills.values() if f.positionId == position),
                    Decimal(0),
                )
                for position in positions
            )
        ):
            result.state = "CLOSED"
        elif (
            group.closedTrades
            or group.state == "CLOSED"
            or any(p.positionState == "CLOSED" for p in group.currentProtection)
        ):
            reasons.add("CLOSURE_PROOF_INCOMPLETE")
        else:
            result.state = "PARTIAL_OPEN" if quantity < Decimal(order.approvedVolume) else "OPEN"
    elif (
        terminal
        and group.state in {"CLOSED", "EXPIRED", "FAILED"}
        and not group.currentProtection
        and not group.closedTrades
        and not group.closeDeals
    ):
        result.state = "ZERO_FILL_TERMINAL"
    elif order.state == "PENDING":
        result.state = "UNFILLED_PENDING"
    else:
        reasons.add("TERMINAL_PROOF_MISSING")
    trades = {t.id: t for t in group.closedTrades}
    if len(trades) != len(group.closedTrades):
        reasons.add("DUPLICATE_CLOSED_TRADE_IDENTITY")
    if any(timestamp(t.closedAt) > timestamp(cutoff) for t in trades.values()):
        reasons.add("CLOSE_NOT_KNOWN_AT_CUTOFF")
    else:
        result.recordedClosedNet = (
            plain(sum((Decimal(t.realizedNet) for t in trades.values()), Decimal(0)))
            if trades
            else None
        )
    # Broker realizedNet already includes signed fees; do not deduct them a second time.
    blockers = {
        "ORDER_TYPE_MISMATCH",
        "CONTEXT_MISSING_OR_UNORDERED",
        "APPROVED_INTENT_CONTEXT_MISMATCH",
        "FILL_ORDER_LINK_UNAVAILABLE",
        "POSITION_EVIDENCE_INCOMPLETE",
        "TERMINAL_STATE_CONFLICT",
        "FILL_NOT_KNOWN_AT_CUTOFF",
        "FILL_IDENTITY_CONFLICT",
        "FILL_CLOCK_UNORDERED",
        "FILL_VOLUME_MISMATCH",
        "BROKER_EVENT_UNRESOLVED",
        "BROKER_EVENT_NOT_KNOWN_AT_CUTOFF",
        "CLOSE_NOT_KNOWN_AT_CUTOFF",
        "DUPLICATE_CLOSED_TRADE_IDENTITY",
        "ADMISSION_CHRONOLOGY_INVALID",
        "ORDER_VOLUME_INVALID",
        "FILL_PRICE_OR_VOLUME_INVALID",
        "CLOSURE_PROOF_INCOMPLETE",
        "TERMINAL_PROOF_MISSING",
    }
    if reasons & blockers:
        result.state = "UNKNOWN"
        result.path = PathDiagnostic(
            status="UNAVAILABLE", reasons=["FACTUAL_EVIDENCE_INCONSISTENT"]
        )
    else:
        result.path = path_diagnostic(group, context, sessions, cutoff, range_ticks)
    if not reasons & blockers:
        result.exposure = exposure_paths(group, sessions, cutoff)
    result.reasons = sorted(reasons)
    return result


def replay(
    packet: LearningEvidence,
    packet_sha: str,
    *,
    cutoff: str | None = None,
    sessions: dict[str, list[list[dict[str, Any]]]] | None = None,
    range_ticks: int | None = None,
    draft: EvaluationDraft | None = None,
) -> ReplayReport:
    cutoff = cutoff or packet.journalSnapshotAt
    if timestamp(cutoff) != timestamp(packet.journalSnapshotAt):
        raise ValueError("SCALP_CUTOFF_OUTSIDE_SNAPSHOT")
    contexts = {c.id: c for c in packet.contexts}
    counts = Counter(
        {"contexts": len(contexts), "analyses": len(packet.analyses), "setups": len(packet.setups)}
    )
    for context in packet.contexts:
        counts["decision_" + context.decision] += 1
        counts["provider_state_" + context.state] += 1
    for analysis in packet.analyses:
        counts["analysis_" + analysis.state] += 1
    results = [
        reconstruct(
            g, contexts.get(g.contextId or ""), cutoff, (sessions or {}).get(g.id, []), range_ticks
        )
        for g in packet.setups
    ]
    counts.update("setup_" + r.state for r in results)
    counts["unsupported_setups"] = sum(not r.supported for r in results)
    amounts: dict[str, list[Decimal]] = {}
    seen_trades: dict[str, bytes] = {}
    report_reasons = [
        "HISTORICAL_RECONSTRUCTION_NOT_PROSPECTIVE_QUALIFICATION",
        "PROVIDER_COST_UNATTESTED",
        "COUNTERFACTUAL_FILLS_COSTS_FX_MARGIN_UNKNOWN",
        "NO_REVIEWED_FUTURE_PROTOCOL",
        "CLOSED_NET_IS_NOT_AN_EQUITY_CURVE",
    ]
    for group, result in zip(packet.setups, results, strict=True):
        if not result.supported:
            continue
        for trade in group.closedTrades:
            if timestamp(trade.closedAt) > timestamp(cutoff):
                continue
            row = encoded(trade.model_dump())
            if trade.id in seen_trades:
                if seen_trades[trade.id] != row:
                    raise ValueError("SCALP_CLOSED_TRADE_IDENTITY_CONFLICT")
                counts["duplicate_closed_rows"] += 1
                continue
            seen_trades[trade.id] = row
            amounts.setdefault(group.accountCurrency, []).append(Decimal(trade.realizedNet))
    summaries = []
    for currency, values in sorted(amounts.items()):
        wins, losses = [v for v in values if v > 0], [v for v in values if v < 0]
        total = sum(values, Decimal(0))
        summaries.append(
            ClosedStatistics(
                currency=currency,
                records=len(values),
                wins=len(wins),
                losses=len(losses),
                breakeven=sum(v == 0 for v in values),
                recordedNet=plain(total),
                meanNet=plain(total / len(values)),
                meanWin=plain(sum(wins, Decimal(0)) / len(wins)) if wins else None,
                meanLoss=plain(sum(losses, Decimal(0)) / len(losses)) if losses else None,
                largestWin=plain(max(wins)) if wins else None,
                worstLoss=plain(min(losses)) if losses else None,
                withoutLargestWinnerDiagnostic=plain(total - max(wins)) if wins else plain(total),
            )
        )
    source_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    comparisons = [benchmark(c) for c in packet.contexts]
    for comparison in comparisons:
        matches = [
            g
            for g, r in zip(packet.setups, results, strict=True)
            if r.supported and r.state != "UNKNOWN" and g.contextId == comparison.contextId
        ]
        context = contexts[comparison.contextId]
        if len(matches) != 1 or comparison.entry is None or context.decision != comparison.decision:
            continue
        order = matches[0].orders[0]
        if order.side != comparison.decision or Decimal(order.approvedVolume) <= 0:
            continue
        entry = Decimal(comparison.entry)
        comparison.entryOnlyTakeProfit = plain(
            entry + Decimal(order.takeProfit) - Decimal(order.entryPrice)
        )
        comparison.entryOnlyStopLoss = plain(
            entry + Decimal(order.stopLoss) - Decimal(order.entryPrice)
        )
        comparison.frozenApprovedVolume = order.approvedVolume
        comparison.reasons.append("FROZEN_ORIGINAL_INTENT_QUANTITY_NOT_DYNAMIC_PORTFOLIO")
    if draft is not None and draft.sourceSha256 != source_sha:
        report_reasons.append("DRAFT_SOURCE_DRIFT_RESEARCH_HALTED")
        comparisons = []
    return ReplayReport(
        schemaVersion="scalp-replay-report-1.0",
        classification="RECONSTRUCTION_ONLY",
        packetSha256=packet_sha,
        sourceId=packet.sourceId,
        replaySourceSha256=source_sha,
        knowledgeCutoff=cutoff,
        counts=dict(counts),
        setups=results,
        benchmark=comparisons,
        recordedClosedStatistics=summaries,
        draftProtocolSha256=hashlib.sha256(encoded(draft.model_dump())).hexdigest()
        if draft
        else None,
        recommendation="HOLD",
        reasons=report_reasons,
        providerCost=None,
        counterfactualNet=None,
        portfolioDrawdown=None,
        promotionAuthority=False,
        brokerAuthority=False,
    )


def main() -> None:
    raise RuntimeError("SCALP_REPLAY_DRAFT_INCOMPLETE")


def draft_main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--paths", type=Path)
    parser.add_argument("--path-root", type=Path)
    parser.add_argument("--draft", type=Path)
    args = parser.parse_args()
    packet = parse(bounded(args.input, 8 * 1024**2), args.sha256)
    sessions = None
    ticks = None
    if args.paths:
        if args.path_root is None:
            raise ValueError("SCALP_PATH_ROOT_REQUIRED")
        companion = PathCompanion.model_validate(
            json.loads(bounded(args.paths, 128_000), object_pairs_hook=unique)
        )
        if companion.packetSha256 != args.sha256:
            raise ValueError("SCALP_PATH_PACKET_MISMATCH")
        sessions = load_paths(companion, args.path_root, packet)
        ticks = companion.declaredRangeTicks
    draft = (
        EvaluationDraft.model_validate(
            json.loads(bounded(args.draft, 128_000), object_pairs_hook=unique)
        )
        if args.draft
        else None
    )
    report = replay(packet, args.sha256, sessions=sessions, range_ticks=ticks, draft=draft)
    write_new(args.output, report.model_dump())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("SCALP_REPLAY_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
