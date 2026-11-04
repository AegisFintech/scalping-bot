"""Separate journal position-state clocks; native protection observations remain untouched."""

from __future__ import annotations

from decimal import localcontext
from typing import Literal

from pydantic import model_validator

from python.backtest.current_scalp import Reconstruction, _reconstruct
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import Digest, Identity, Instant, LearningEvidence, digest


class PositionClockEvidence(StrictModel):
    schemaVersion: Literal["position-clock-evidence-1.0"] = "position-clock-evidence-1.0"
    packet: LearningEvidence
    packetSha256: Digest
    positionUpdatedAt: dict[Identity, Instant]
    basis: Literal["SAME_REPEATABLE_READ_POSITION_UPDATED_AT"] = (
        "SAME_REPEATABLE_READ_POSITION_UPDATED_AT"
    )
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False

    @model_validator(mode="after")
    def binding(self) -> PositionClockEvidence:
        positions = [p.positionId for g in self.packet.setups for p in g.currentProtection]
        if (
            self.packetSha256 != digest(self.packet.model_dump())
            or len(set(positions)) != len(positions)
            or set(self.positionUpdatedAt) != set(positions)
            or any(
                timestamp(at) > timestamp(self.packet.journalSnapshotAt)
                for at in self.positionUpdatedAt.values()
            )
        ):
            raise ValueError("POSITION_CLOCK_PACKET_BINDING_INVALID")
        return self

    @classmethod
    def bind(cls, packet: LearningEvidence, clocks: dict[str, str]) -> PositionClockEvidence:
        return cls(
            packet=packet, packetSha256=digest(packet.model_dump()), positionUpdatedAt=clocks
        )


def reconstruct_current(evidence: PositionClockEvidence) -> list[Reconstruction]:
    """Versioned caller supplies same-snapshot clocks; historical default stays unchanged."""
    evidence = PositionClockEvidence.model_validate(evidence.model_dump())
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        return _reconstruct(evidence.packet, evidence.positionUpdatedAt)
