"""Versioned gross R:R hypotheses; no fill simulation, resizing or close authority."""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, localcontext
from typing import Any, Literal

from python.backtest.loss_control import CANDIDATES, LossControlReport, _report
from python.research.codex_loop import timestamp
from python.research.learning_evidence import digest
from python.research.position_clock_evidence import PositionClockEvidence, reconstruct_current

RR_CANDIDATES = {**CANDIDATES, "GROSS_RR_1": "1", "GROSS_RR_1_5": "1.5"}


class RRReport(LossControlReport):
    schemaVersion: Literal["loss-control-screen-1.1"] = "loss-control-screen-1.1"  # type: ignore[assignment]
    positionEvidenceSha256: str
    rrScreens: list[dict[str, Any]]
    netRewardToRisk: None = None


def report(evidence: PositionClockEvidence) -> RRReport:
    evidence = PositionClockEvidence.model_validate(evidence.model_dump())
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        base = _report(evidence.packet, reconstruct_current(evidence)).model_dump()
        rows = []
        for c, baseline in zip(evidence.packet.contexts, base["contexts"], strict=True):
            for ratio in ("1", "1.5"):
                row: dict[str, Any] = {
                    "contextId": c.id,
                    "cohortRole": c.cohortRole,
                    "risk": "1",
                    "requestedGrossReward": ratio,
                    "roundedGrossRewardToRisk": None,
                    "state": "UNAVAILABLE",
                    "entry": c.entryPrice,
                    "stop": c.stopLoss,
                    "target": None,
                    "counterfactualNet": None,
                }
                rows.append(row)
                if baseline["state"] not in ("PASS_GEOMETRY", "REJECT_GEOMETRY"):
                    row["state"] = baseline["state"]
                    continue
                if (
                    c.market is None
                    or c.availableAt is None
                    or timestamp(c.availableAt) >= timestamp(c.validUntil)
                ):
                    continue
                assert c.entryPrice is not None and c.stopLoss is not None
                sign = Decimal(1 if c.decision == "BUY" else -1)
                entry, stop, tick = (
                    Decimal(c.entryPrice),
                    Decimal(c.stopLoss),
                    Decimal(c.market.tick_size),
                )
                if entry % tick or stop % tick:
                    continue
                distance = (entry - stop) * sign
                target = entry + distance * Decimal(ratio) * sign
                target = (target / tick).to_integral_value(
                    rounding=ROUND_FLOOR if sign > 0 else ROUND_CEILING
                ) * tick
                if target <= 0 or (target - entry) * sign <= 0:
                    continue
                row["target"] = format(target, "f")
                row["roundedGrossRewardToRisk"] = format((target - entry) * sign / distance, "f")
                row["state"] = "CONDITIONAL_GEOMETRY_NOT_COST_OR_EXECUTION_QUALIFIED"
        return RRReport.model_validate(
            {
                **base,
                "schemaVersion": "loss-control-screen-1.1",
                "candidates": RR_CANDIDATES,
                "positionEvidenceSha256": digest(evidence.model_dump()),
                "rrScreens": rows,
                "netRewardToRisk": None,
            }
        )
