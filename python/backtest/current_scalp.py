"""Current-contract causal screening. Recorded broker facts and hypotheses stay separate."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from decimal import Decimal, localcontext
from hashlib import sha256
from itertools import pairwise
from typing import Any, Literal

from pydantic import model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.demo_catalogue import Profile
from python.research.learning_evidence import (
    ContextObservation,
    Digest,
    Identity,
    Instant,
    LearningEvidence,
    encoded,
)

CURRENT = {"0.9.0-cost-balanced.1-codex.1", "0.9.0-cost-balanced.1-codex.2"}


class EntryScreen(StrictModel):
    contextId: Identity
    profileSha256: Digest
    proposalSource: Literal["CODEX", "LOCAL_RANGE"]
    status: Literal["PROPOSED", "WAIT", "UNAVAILABLE"]
    reason: str
    availableAt: Instant | None
    side: Literal["BUY", "SELL"] | None = None
    entry: str | None = None
    target: str | None = None
    stop: str | None = None
    expiresAt: Instant | None = None
    modeledTargetNet: None = None
    counterfactualFill: None = None
    counterfactualNet: None = None


def screen(context: ContextObservation, profile: Profile) -> EntryScreen:
    result = EntryScreen(
        contextId=context.id,
        profileSha256=profile.digest(),
        proposalSource=profile.proposalSource,
        status="UNAVAILABLE",
        reason="CONTEXT_UNAVAILABLE",
        availableAt=context.availableAt,
    )
    if (
        context.originRelease not in CURRENT
        or context.state != "READY"
        or context.clockStatus != "CAUSAL"
        or context.market is None
        or context.availableAt is None
    ):
        return result
    market = context.market
    rows = {f.timeframe: f.rows for f in market.candles}
    if len(rows.get("M1", [])) < 5 or len(rows.get("M5", [])) < 3:
        result.reason = "HISTORY_INSUFFICIENT"
        return result
    m1, m5 = rows["M1"][-5:], rows["M5"][-3:]
    if any(
        not r[7] or r[8] or timestamp(r[1]) > timestamp(context.capturedAt) for r in m1 + m5
    ) or any(timestamp(a[1]) != timestamp(b[0]) for frame in (m1, m5) for a, b in pairwise(frame)):
        result.reason = "COMPLETED_HISTORY_GAP_OR_UNAVAILABLE"
        return result
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        changes = [Decimal(b[5]) - Decimal(a[5]) for a, b in pairwise(m5)]
        side: Literal["BUY", "SELL"] | None = (
            "BUY"
            if all(v > 0 for v in changes)
            else "SELL"
            if all(v < 0 for v in changes)
            else None
        )
        result.status = "WAIT"
        if side is None:
            result.reason = "M5_DIRECTION_UNRESOLVED"
            return result
        if profile.proposalSource == "CODEX" and (
            context.decision != side or context.entryPrice is None
        ):
            result.reason = "RECORDED_CODEX_WAIT_OR_DIRECTION_DISAGREES"
            return result
        tick, sign = Decimal(market.tick_size), Decimal(1 if side == "BUY" else -1)
        working = m1[-profile.rangeBars :]
        level = (
            max(Decimal(r[3]) for r in working) + tick
            if side == "BUY"
            else min(Decimal(r[4]) for r in working) - tick
        )
        entry = (
            Decimal(context.entryPrice)
            if profile.proposalSource == "CODEX" and context.entryPrice
            else level
        )
        # No quote-adjacent clamping: a crossed original boundary is a non-proposal.
        if (side == "BUY" and entry < Decimal(market.entry_boundaries.buy_stop_minimum)) or (
            side == "SELL" and entry > Decimal(market.entry_boundaries.sell_stop_maximum)
        ):
            result.reason = "ORIGINAL_BOUNDARY_NOT_EXECUTABLE_AT_CAPTURE"
            return result
        stop = (
            min(Decimal(r[4]) for r in m1) - tick * profile.stopBufferTicks
            if side == "BUY"
            else max(Decimal(r[3]) for r in m1) + tick * profile.stopBufferTicks
        )
        risk = (entry - stop) * sign
        if not 0 < risk <= 7:
            result.reason = "STRUCTURAL_STOP_OUTSIDE_FINITE_BOUND"
            return result
        expiry = timestamp(context.capturedAt) + timedelta(seconds=profile.pendingSeconds)
        if timestamp(context.availableAt) >= expiry:
            result.reason = "PROPOSAL_EXPIRED_BEFORE_AVAILABILITY"
            return result
        result.status = "PROPOSED"
        result.reason = "CONDITIONAL_ON_RECORDED_AVAILABILITY_NOT_EXECUTABLE_OR_COST_QUALIFIED"
        result.side, result.entry = side, format(entry, "f")
        result.target = format(entry + Decimal(profile.targetDistance) * sign, "f")
        result.stop, result.expiresAt = format(stop, "f"), expiry.isoformat()
    return result


class Reconstruction(StrictModel):
    setupId: Identity
    status: Literal[
        "UNSUPPORTED", "UNKNOWN", "PENDING", "OPEN", "PARTIAL_OPEN", "CLOSED", "ZERO_FILL_TERMINAL"
    ]
    reasons: list[str]
    recordedEntryFills: int = 0
    filledVolume: str = "0"
    providerAvailableAt: Instant | None = None
    brokerAcceptedAt: Instant | None = None
    recordedClosedNet: str | None = None
    signedFees: str | None = None
    nativeProtectionHistoryAvailable: bool = False
    counterfactualFill: None = None
    counterfactualNet: None = None


def reconstruct(packet: LearningEvidence) -> list[Reconstruction]:
    contexts = {c.id: c for c in packet.contexts}
    cutoff = timestamp(packet.until)
    results = []
    for group in packet.setups:
        row = Reconstruction(setupId=group.id, status="UNKNOWN", reasons=[])
        results.append(row)
        if (
            group.originRelease not in CURRENT
            or len(group.orders) != 1
            or group.timeInForce != "GTD"
            or group.executionMode != "SINGLE_STOP_LIMIT"
        ):
            row.status, row.reasons = "UNSUPPORTED", ["VERSION_OR_CARDINALITY_UNSUPPORTED"]
            continue
        order = group.orders[0]
        if timestamp(group.updatedAt) > cutoff:
            row.reasons.append("GROUP_STATE_NOT_KNOWN_AT_CUTOFF")
        context = contexts.get(group.contextId or "")
        if (
            order.orderType != "STOP_LIMIT"
            or order.timeInForce != "GTD"
            or order.expiresAt != group.expiresAt
            or group.submissionValidUntil != order.submissionValidUntil
            or order.submissionValidUntil != order.expiresAt
        ):
            row.reasons.append("ORDER_LIFETIME_MISMATCH")
        if (
            context is None
            or context.originRelease != group.originRelease
            or context.clockStatus != "CAUSAL"
            or context.availableAt is None
        ):
            row.reasons.append("CONTEXT_AVAILABILITY_UNAVAILABLE")
        else:
            row.providerAvailableAt = context.availableAt
            if (
                context.decision != order.side
                or any(
                    value is None or Decimal(value) != Decimal(expected)
                    for value, expected in (
                        (context.entryPrice, order.entryPrice),
                        (context.stopLoss, order.stopLoss),
                        (context.takeProfit, order.takeProfit),
                    )
                )
                or context.validUntil != order.expiresAt
            ):
                row.reasons.append("CONTEXT_INTENT_MISMATCH")
        accepts = [
            e
            for e in group.brokerEvents
            if e.orderId == order.id
            and not e.closingOrder
            and e.executionType == 2
            and e.mappingState == "MAPPED"
            and not e.reasonCodes
            and e.clockStatus == "CAUSAL"
            and timestamp(e.persistedAt) <= cutoff
        ]
        if accepts:
            row.brokerAcceptedAt = min((e.occurredAt for e in accepts), key=timestamp)
        else:
            row.reasons.append("ORIGINAL_ACCEPTANCE_UNAVAILABLE")
        if (
            row.providerAvailableAt
            and row.brokerAcceptedAt
            and timestamp(row.brokerAcceptedAt) < timestamp(row.providerAvailableAt)
        ):
            row.reasons.append("ACCEPTANCE_PRECEDES_PROVIDER")
        fills = {
            f.id: f
            for f in group.fills
            if f.orderId == order.id and timestamp(f.receivedAt) <= cutoff
        }
        if len(fills) != len(group.fills) or any(
            f.clockStatus != "CAUSAL"
            or Decimal(f.volume) <= 0
            or Decimal(f.price) <= 0
            or (
                row.brokerAcceptedAt is not None
                and timestamp(f.occurredAt) < timestamp(row.brokerAcceptedAt)
            )
            for f in fills.values()
        ):
            row.reasons.append("FILL_COVERAGE_OR_CHRONOLOGY_INVALID")
        volume = sum((Decimal(f.volume) for f in fills.values()), Decimal(0))
        row.recordedEntryFills, row.filledVolume = len(fills), format(volume, "f")
        if volume != Decimal(order.filledVolume) or volume > Decimal(order.approvedVolume):
            row.reasons.append("FILL_VOLUME_MISMATCH")
        if any(
            e.resolvedAt is None and (e.mappingState != "MAPPED" or e.reasonCodes)
            for e in group.brokerEvents
        ):
            row.reasons.append("BROKER_UNRESOLVED")
        row.nativeProtectionHistoryAvailable = group.protectionHistoryComplete and bool(
            group.protectionHistory
        )
        terminal = any(
            e.orderId == order.id
            and not e.closingOrder
            and (e.executionType, order.state)
            in {(5, "CANCELLED"), (6, "EXPIRED"), (7, "REJECTED")}
            and e.mappingState == "MAPPED"
            and not e.reasonCodes
            and e.clockStatus == "CAUSAL"
            and timestamp(e.persistedAt) <= cutoff
            for e in group.brokerEvents
        )
        if row.reasons:
            continue
        if volume == 0:
            if (
                terminal
                and not group.closeDeals
                and not group.closedTrades
                and not group.currentProtection
            ):
                row.status = "ZERO_FILL_TERMINAL"
            elif order.state == "PENDING":
                row.status = "PENDING"
            else:
                row.reasons.append("ZERO_FILL_TERMINAL_PROOF_MISSING")
            continue
        positions = {f.positionId for f in fills.values()}
        closes = {
            d.id: d
            for d in group.closeDeals
            if timestamp(d.recordedAt) <= cutoff and timestamp(d.occurredAt) <= cutoff
        }
        trades = {t.id: t for t in group.closedTrades if timestamp(t.closedAt) <= cutoff}
        if (
            None in positions
            or len(closes) != len(group.closeDeals)
            or len(trades) != len(group.closedTrades)
            or len({p.positionId for p in group.currentProtection}) != len(group.currentProtection)
        ):
            row.reasons.append("POSITION_OR_CLOSE_IDENTITY_INCOMPLETE")
            continue
        closed_volume = sum((Decimal(d.closedVolume) for d in closes.values()), Decimal(0))
        if (
            group.state == "CLOSED"
            and trades
            and closed_volume == volume
            and all(
                sum(
                    (Decimal(d.closedVolume) for d in closes.values() if d.positionId == p),
                    Decimal(0),
                )
                == sum((Decimal(f.volume) for f in fills.values() if f.positionId == p), Decimal(0))
                for p in positions
            )
            and positions == {p.positionId for p in group.currentProtection}
            and all(p.positionState == "CLOSED" for p in group.currentProtection)
        ):
            net = sum((Decimal(t.realizedNet) for t in trades.values()), Decimal(0))
            gross_and_costs = sum(
                (
                    Decimal(d.gross)
                    + Decimal(d.commission)
                    + Decimal(d.swap)
                    + Decimal(d.conversionFee)
                    for d in closes.values()
                ),
                Decimal(0),
            )
            fees = sum(
                (
                    Decimal(d.commission) + Decimal(d.swap) + Decimal(d.conversionFee)
                    for d in closes.values()
                ),
                Decimal(0),
            )
            if net != gross_and_costs or fees != sum(
                (Decimal(t.signedFees) for t in trades.values()), Decimal(0)
            ):
                row.reasons.append("ACTUAL_SIGNED_COST_RECONCILIATION_MISMATCH")
                continue
            row.status, row.recordedClosedNet, row.signedFees = (
                "CLOSED",
                format(net, "f"),
                format(fees, "f"),
            )
        elif group.state == "CLOSED" or trades or closed_volume > volume:
            row.reasons.append("CLOSE_PROOF_INCOMPLETE")
        else:
            row.status = (
                "PARTIAL_OPEN"
                if volume < Decimal(order.approvedVolume) or closed_volume > 0
                else "OPEN"
            )
    return results


class CurrentReport(StrictModel):
    schemaVersion: Literal["current-scalp-screen-1.0"]
    packetSha256: Digest
    profileSha256: Digest
    classification: Literal["CONDITIONAL_SCREENING_AND_RECORDED_RECONSTRUCTION"]
    screens: list[EntryScreen]
    counts: dict[str, int]
    reconstruction: list[Reconstruction]
    actualStates: dict[str, int]
    counterfactualFill: None = None
    counterfactualNet: None = None
    economicQualification: Literal[False] = False
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False

    @model_validator(mode="after")
    def counts_match(self) -> CurrentReport:
        if self.counts != dict(
            Counter(r.status for r in self.screens)
        ) or self.actualStates != dict(Counter(r.status for r in self.reconstruction)):
            raise ValueError("CURRENT_SCALP_DENOMINATORS")
        return self


def report(packet: LearningEvidence, profile: Profile) -> dict[str, Any]:
    rows = [screen(c, profile) for c in packet.contexts]
    facts = reconstruct(packet)
    return CurrentReport(
        schemaVersion="current-scalp-screen-1.0",
        packetSha256=sha256(encoded(packet.model_dump())).hexdigest(),
        profileSha256=profile.digest(),
        classification="CONDITIONAL_SCREENING_AND_RECORDED_RECONSTRUCTION",
        screens=rows,
        counts=dict(Counter(r.status for r in rows)),
        reconstruction=facts,
        actualStates=dict(Counter(r.status for r in facts)),
    ).model_dump()
