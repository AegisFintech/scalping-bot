"""Fixed retrospective measurement; standalone stdlib, no strategy or exit simulation."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Any


def audit(packet: dict[str, Any]) -> dict[str, Any]:
    with localcontext() as context:
        context.prec = 100
        trades = [t for g in packet["setups"] for t in g["closedTrades"]]
        # Linked/carry-in rows remain visible; only actual close clocks select window closes.
        start, until = (datetime.fromisoformat(packet[k]) for k in ("start", "until"))
        closed = [t for t in trades if start <= datetime.fromisoformat(t["closedAt"]) < until]
        nets = [Decimal(t["realizedNet"]) for t in closed]
        clocks = []
        contexts = {c["id"]: c for c in packet["contexts"]}
        for group in packet["setups"]:
            context_row = contexts.get(group["contextId"]) or {}
            available = (
                context_row.get("availableAt")
                if context_row.get("clockStatus") == "CAUSAL"
                else None
            )
            for order in group["orders"]:
                events = [
                    e
                    for e in group["brokerEvents"]
                    if e["orderId"] == order["id"]
                    and not e["closingOrder"]
                    and e["executionType"] == 2
                    and e["mappingState"] == "MAPPED"
                    and e["clockStatus"] == "CAUSAL"
                ]
                accepted = min(
                    (e["occurredAt"] for e in events), key=datetime.fromisoformat, default=None
                )
                delta = None
                if available and accepted:
                    difference = datetime.fromisoformat(accepted) - datetime.fromisoformat(
                        available
                    )
                    if difference.total_seconds() >= 0:
                        delta = str(difference // timedelta(microseconds=1))
                clocks.append({"orderId": order["id"], "availabilityToAcceptanceMicros": delta})
        return {
            "method": "cohort-cost-clock-audit-1.0",
            "roles": {
                family: dict(Counter(r["cohortRole"] for r in packet[family]))
                for family in ("contexts", "analyses", "setups", "flight")
            },
            "decisions": dict(Counter(c["decision"] for c in packet["contexts"])),
            "analysisReasons": dict(
                Counter(r for a in packet["analyses"] for r in a["reasonCodes"])
            ),
            "setupStates": dict(Counter(g["state"] for g in packet["setups"])),
            "orderStates": dict(Counter(o["state"] for g in packet["setups"] for o in g["orders"])),
            "recordedFillRows": sum(len(g["fills"]) for g in packet["setups"]),
            "recordedPartialOrders": sum(
                Decimal("0") < Decimal(o["filledVolume"]) < Decimal(o["approvedVolume"])
                for g in packet["setups"]
                for o in g["orders"]
            ),
            "recordedOpenPositions": sum(
                p["positionState"] != "CLOSED"
                for g in packet["setups"]
                for p in g["currentProtection"]
            ),
            "closedRowsInPacket": len(trades),
            "closedInWindow": len(closed),
            "wins": sum(n > 0 for n in nets),
            "losses": sum(n < 0 for n in nets),
            "net": format(sum(nets, Decimal(0)), "f"),
            "signedFees": format(sum((Decimal(t["signedFees"]) for t in closed), Decimal(0)), "f"),
            "acceptanceClocks": clocks,
            "flightUnavailable": sum(f["unavailableReason"] is not None for f in packet["flight"]),
            "flightGaps": sum(f["gaps"] or 0 for f in packet["flight"]),
            "coverageWarnings": packet["coverageWarnings"],
            "counterfactualNet": None,
            "economicQualification": False,
        }


if __name__ == "__main__":
    print(json.dumps(audit(json.loads(Path("/input.json").read_bytes())), sort_keys=True))
