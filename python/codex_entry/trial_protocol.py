"""Version-bound finite demo prompt metadata, separate from broker authority."""

from __future__ import annotations

from decimal import Decimal, localcontext
from itertools import pairwise
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from pydantic import Field, model_validator

from python.codex_entry.trend_protocol import TrendBinding
from python.research.codex_loop import StrictModel, encoded, timestamp
from python.research.demo_catalogue import Profile, load

if TYPE_CHECKING:
    from python.codex_entry.service import PayloadScalp, ScalpDecision


class TrialBinding(StrictModel):
    trialId: str
    profileId: str
    profileSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    catalogueSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    strategyVersion: Literal["0.10.0-demo-trials.1-codex.1"]
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    registeredAt: str
    startsAt: str

    @model_validator(mode="after")
    def registered(self) -> TrialBinding:
        from hashlib import sha256

        catalogue = load()
        profile = next((p for p in catalogue.profiles if p.id == self.profileId), None)
        if (
            str(UUID(self.trialId)) != self.trialId
            or not timestamp(self.registeredAt) < timestamp(self.startsAt)
            or profile is None
            or profile.digest() != self.profileSha256
            or sha256(encoded(catalogue.model_dump())).hexdigest() != self.catalogueSha256
        ):
            raise ValueError("CODEX_DEMO_TRIAL_BINDING_INVALID")
        return self

    def profile(self) -> Profile:
        return next(p for p in load().profiles if p.id == self.profileId)


def prompt(template: str, binding: TrialBinding | TrendBinding) -> str:
    return (
        template.strip()
        + "\n\nREGISTERED_DEMO_TRIAL\n"
        + encoded(binding.model_dump() | {"profile": binding.profile().model_dump()}).decode()
    )


def validate_geometry(
    payload: PayloadScalp, binding: TrialBinding, decision: ScalpDecision
) -> None:
    if timestamp(payload.captured_at) < timestamp(binding.startsAt):
        raise ValueError("CODEX_DEMO_TRIAL_NOT_STARTED")
    if decision.decision == "WAIT":
        return
    profile = binding.profile()
    if profile.proposalSource != "CODEX":
        raise ValueError("CODEX_DEMO_PROPOSAL_SOURCE_INVALID")
    m1 = next(f.rows for f in payload.candles if f.timeframe == "M1")[-5:]
    m5 = next(f.rows for f in payload.candles if f.timeframe == "M5")[-3:]
    if len(m1) != 5 or len(m5) != 3 or any(not r[7] or r[8] for r in m1 + m5):
        raise ValueError("CODEX_DEMO_HISTORY_UNAVAILABLE")
    for frame in (m1, m5):
        for a, b in pairwise(frame):
            if timestamp(a[1]) != timestamp(b[0]):
                raise ValueError("CODEX_DEMO_HISTORY_GAP")
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        changes = [Decimal(b[5]) - Decimal(a[5]) for a, b in pairwise(m5)]
        side = (
            "BUY"
            if all(d > 0 for d in changes)
            else "SELL"
            if all(d < 0 for d in changes)
            else None
        )
        if (
            side is None
            or side != decision.decision
            or decision.entry_price is None
            or decision.stop_loss is None
            or decision.take_profit is None
        ):
            raise ValueError("CODEX_DEMO_DIRECTION_INVALID")
        sign = Decimal(1 if side == "BUY" else -1)
        entry, tick = Decimal(decision.entry_price), Decimal(payload.tick_size)
        anchor = min(Decimal(r[4]) for r in m1) if side == "BUY" else max(Decimal(r[3]) for r in m1)
        stop = anchor - tick * profile.stopBufferTicks * sign
        target = entry + Decimal(profile.targetDistance) * sign
        if (
            Decimal(decision.stop_loss) != stop
            or Decimal(decision.take_profit) != target
            or decision.pending_seconds != profile.pendingSeconds
            or not 0
            < (entry - stop) * sign
            <= min(Decimal(7), Decimal(payload.maximum_stop_distance))
            or min(entry, stop, target) <= 0
            or any(v % tick for v in (entry, stop, target))
        ):
            raise ValueError("CODEX_DEMO_GEOMETRY_MISMATCH")
        if (side == "BUY" and entry < Decimal(payload.entry_boundaries.buy_stop_minimum)) or (
            side == "SELL" and entry > Decimal(payload.entry_boundaries.sell_stop_maximum)
        ):
            raise ValueError("CODEX_DEMO_ENTRY_BOUNDARY_INVALID")
