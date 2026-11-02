"""Three fixed causal candle hypotheses. Threshold observations are never fills."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from decimal import Decimal, localcontext
from typing import Any, Final, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import Digest, Identity, Instant, LearningEvidence

VERSION: Final = "causal-breakout-hypotheses-1.0"
CANDIDATES = ("RANGE_BREAK", "BAR_CONFIRM", "BREAK_RETEST")


class CandidateObservation(StrictModel):
    contextId: Identity
    candidate: Literal["RANGE_BREAK", "BAR_CONFIRM", "BREAK_RETEST"]
    direction: Literal["BUY", "SELL"] | None
    boundary: str | None
    modeledOutcomeCostPrice: str | None
    structuralStop: str | None
    costBalancedTarget: str | None
    status: Literal["OBSERVED", "NO_EVENT", "CENSORED", "UNAVAILABLE"]
    reason: str
    eventBarEnd: Instant | None
    firstRecordedAt: Instant | None
    usableForwardBars: int = Field(ge=0, le=5)
    observedFavorablePrice: str | None
    observedAdversePrice: str | None
    levelSequence: Literal[
        "TARGET_LEVEL_FIRST", "STOP_LEVEL_FIRST", "SAME_BAR_AMBIGUOUS", "NO_LEVEL", "UNAVAILABLE"
    ]
    counterfactualFill: None = None
    counterfactualNet: None = None


class BreakoutMeasurement(StrictModel):
    schemaVersion: Literal["causal-breakout-hypotheses-1.0"]
    packetSha256: Digest
    start: Instant
    until: Instant
    contextsInPacket: int = Field(ge=0)
    availabilityWindowContexts: int = Field(ge=0)
    contextStates: dict[str, int]
    sourceReleases: dict[str, int]
    counts: dict[str, dict[str, int]]
    levelCounts: dict[str, dict[str, int]]
    rows: list[CandidateObservation]
    conflictingCandles: int = Field(ge=0)
    pathInputStates: dict[str, int]
    coverage: Literal["RETAINED_COMPLETED_BARS_NOT_TICKS_OR_EXECUTABLE_FILLS"]
    costBasis: Literal["RECORDED_MIN_VOLUME_COST_PLUS_EXIT_RESERVE_NOT_ACTUAL_FEES"]
    counterfactualNet: None = None
    economicQualification: Literal[False] = False
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False

    @model_validator(mode="after")
    def denominators(self) -> BreakoutMeasurement:
        if (
            len(self.rows) != self.availabilityWindowContexts * 3
            or sum(self.contextStates.values()) != self.contextsInPacket
            or sum(self.sourceReleases.values()) != self.contextsInPacket
            or sum(self.pathInputStates.values()) != self.contextsInPacket
            or self.counts
            != {
                name: dict(Counter(r.status for r in self.rows if r.candidate == name))
                for name in CANDIDATES
            }
            or self.levelCounts
            != {
                name: dict(Counter(r.levelSequence for r in self.rows if r.candidate == name))
                for name in CANDIDATES
            }
        ):
            raise ValueError("BREAKOUT_DENOMINATORS")
        return self


def bars(context: Any, timeframe: str) -> list[list[Any]]:
    if context.market is None:
        return []
    frame = next((f for f in context.market.candles if f.timeframe == timeframe), None)
    return [] if frame is None else frame.rows


def measure(packet: LearningEvidence, packet_sha: str) -> BreakoutMeasurement:
    """Use only first retained completed-bar receipts before this window's cutoff."""
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        return _measure(packet, packet_sha)


def _measure(packet: LearningEvidence, packet_sha: str) -> BreakoutMeasurement:
    cutoff = timestamp(packet.until)
    observed: dict[str, tuple[list[Any], str]] = {}
    conflicts: set[str] = set()
    inputs: Counter[str] = Counter()
    for context in packet.contexts:
        if context.market is None:
            inputs["MARKET_UNAVAILABLE"] += 1
            continue
        if context.clockStatus == "UNORDERED" or timestamp(context.capturedAt) > timestamp(
            context.requestedAt
        ):
            inputs["UNORDERED_RECEIPT"] += 1
            continue
        if timestamp(context.requestedAt) > cutoff:
            inputs["RECEIPT_AFTER_CUTOFF"] += 1
            continue
        inputs["USABLE_CAPTURE_REQUEST_CLOCKS"] += 1
        for row in bars(context, "M1"):
            if timestamp(row[1]) > timestamp(context.capturedAt) or timestamp(row[1]) > cutoff:
                continue
            previous = observed.get(row[0])
            if previous is not None and previous[0] != row:
                conflicts.add(row[0])
            if previous is None or timestamp(context.requestedAt) < timestamp(previous[1]):
                observed[row[0]] = (row, context.requestedAt)
    timeline = sorted(observed.values(), key=lambda pair: timestamp(pair[0][0]))
    origins = [
        c
        for c in packet.contexts
        if c.availableAt is not None
        and timestamp(packet.start) <= timestamp(c.availableAt) < cutoff
    ]
    observations = []
    for context in origins:
        history = bars(context, "M1")[-5:]
        trend = bars(context, "M5")[-3:]
        direction = None
        if len(trend) == 3 and not any(row[8] for row in trend):
            change = Decimal(trend[-1][5]) - Decimal(trend[0][5])
            direction = "BUY" if change > 0 else "SELL" if change < 0 else None
        boundary = None
        stop = None
        target = None
        cost = None
        invalid = ""
        if context.clockStatus != "CAUSAL" or context.market is None:
            invalid = "CONTEXT_CLOCK_OR_MARKET_UNAVAILABLE"
        elif len(history) != 5 or any(row[8] or row[0] in conflicts for row in history):
            invalid = "ANCHOR_HISTORY_GAP_OR_CONFLICT"
        elif direction is None:
            invalid = "M5_DIRECTION_UNAVAILABLE"
        else:
            tick = Decimal(context.market.tick_size)
            boundary = (
                max(Decimal(row[3]) for row in history) + tick
                if direction == "BUY"
                else min(Decimal(row[4]) for row in history) - tick
            )
            cost = str(context.market.execution_context.modeled_round_trip_cost_price)
            stop = (
                min(Decimal(row[4]) for row in history) - tick
                if direction == "BUY"
                else max(Decimal(row[3]) for row in history) + tick
            )
            distance = abs(boundary - stop) + 2 * Decimal(cost)
            target = boundary + distance if direction == "BUY" else boundary - distance
            if distance > 7 or abs(boundary - stop) > 7 or target <= 0:
                invalid = "STRUCTURE_AND_RECORDED_COST_EXCEED_SEVEN_PRICE_BOUND"
        assert context.availableAt is not None
        # A bar already forming when a plan is available cannot confirm a new plan.
        first = timestamp(context.availableAt)
        first = first.replace(second=0, microsecond=0) + (
            timedelta(minutes=1) if first.second or first.microsecond else timedelta(0)
        )
        forward = [
            pair
            for pair in timeline
            if first <= timestamp(pair[0][0]) < first + timedelta(minutes=5)
        ]
        expected = [first + timedelta(minutes=i) for i in range(5)]
        complete = [timestamp(pair[0][0]) for pair in forward] == expected
        corrupt = any(pair[0][8] or pair[0][0] in conflicts for pair in forward)
        for candidate in CANDIDATES:
            item: dict[str, Any] = {
                "contextId": context.id,
                "candidate": candidate,
                "direction": direction,
                "boundary": None if boundary is None else format(boundary, "f"),
                "modeledOutcomeCostPrice": cost,
                "structuralStop": None if stop is None else format(stop, "f"),
                "costBalancedTarget": None if target is None else format(target, "f"),
                "status": "UNAVAILABLE" if invalid else "CENSORED",
                "reason": invalid or "FORWARD_PATH_INCOMPLETE",
                "eventBarEnd": None,
                "firstRecordedAt": None,
                "usableForwardBars": len(forward),
                "observedFavorablePrice": None,
                "observedAdversePrice": None,
                "levelSequence": "UNAVAILABLE",
            }
            if not invalid and complete and not corrupt:
                assert boundary is not None and direction is not None
                sign = Decimal(1) if direction == "BUY" else Decimal(-1)
                broken = False
                event = None
                for i, (bar, recorded_at) in enumerate(forward):
                    close = sign * (Decimal(bar[5]) - boundary)
                    extreme = Decimal(bar[3 if direction == "BUY" else 4])
                    crossed = sign * (extreme - boundary) >= 0
                    touches = Decimal(bar[4]) <= boundary <= Decimal(bar[3])
                    if (
                        (candidate == "RANGE_BREAK" and crossed)
                        or (candidate == "BAR_CONFIRM" and close > 0)
                        or (candidate == "BREAK_RETEST" and broken and touches and close > 0)
                    ):
                        event = (i, bar, recorded_at)
                        break
                    broken = broken or close > 0
                item.update(status="NO_EVENT", reason="COMPLETE_FIVE_BAR_PATH_NO_EVENT")
                if event is not None:
                    index, bar, recorded_at = event
                    later = forward[index + 1 :]
                    moves = [sign * (Decimal(r[k]) - boundary) for r, _ in later for k in (3, 4)]
                    item.update(
                        status="OBSERVED",
                        reason="CANDLE_THRESHOLD_NOT_AN_EXECUTABLE_ENTRY",
                        eventBarEnd=bar[1],
                        firstRecordedAt=recorded_at,
                        observedFavorablePrice=format(max(moves), "f") if moves else None,
                        observedAdversePrice=format(min(moves), "f") if moves else None,
                    )
                    assert stop is not None and target is not None
                    item["levelSequence"] = "NO_LEVEL" if later else "UNAVAILABLE"
                    # Event-bar price ordering is unknown; never assume an entry then exit.
                    for exit_bar, _ in forward[index:]:
                        target_touch = (
                            Decimal(exit_bar[3]) >= target
                            if direction == "BUY"
                            else Decimal(exit_bar[4]) <= target
                        )
                        stop_touch = (
                            Decimal(exit_bar[4]) <= stop
                            if direction == "BUY"
                            else Decimal(exit_bar[3]) >= stop
                        )
                        if target_touch or stop_touch:
                            item["levelSequence"] = (
                                "SAME_BAR_AMBIGUOUS"
                                if exit_bar is bar or (target_touch and stop_touch)
                                else "TARGET_LEVEL_FIRST"
                                if target_touch
                                else "STOP_LEVEL_FIRST"
                            )
                            break
            elif not invalid and corrupt:
                item.update(status="UNAVAILABLE", reason="FORWARD_PATH_GAP_OR_CONFLICT")
            observations.append(CandidateObservation.model_validate(item))
    return BreakoutMeasurement(
        schemaVersion=VERSION,
        packetSha256=packet_sha,
        start=packet.start,
        until=packet.until,
        contextsInPacket=len(packet.contexts),
        availabilityWindowContexts=len(origins),
        contextStates=dict(Counter(c.state for c in packet.contexts)),
        sourceReleases=dict(Counter(c.originRelease for c in packet.contexts)),
        counts={
            name: dict(Counter(r.status for r in observations if r.candidate == name))
            for name in CANDIDATES
        },
        levelCounts={
            name: dict(Counter(r.levelSequence for r in observations if r.candidate == name))
            for name in CANDIDATES
        },
        rows=observations,
        conflictingCandles=len(conflicts),
        pathInputStates=dict(inputs),
        coverage="RETAINED_COMPLETED_BARS_NOT_TICKS_OR_EXECUTABLE_FILLS",
        costBasis="RECORDED_MIN_VOLUME_COST_PLUS_EXIT_RESERVE_NOT_ACTUAL_FEES",
    )
