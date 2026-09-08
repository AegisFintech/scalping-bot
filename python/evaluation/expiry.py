"""Frozen-order expiry cohorts. Research only: no broker or production policy authority."""

from __future__ import annotations

import argparse
import hashlib
import json
from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal as D
from pathlib import Path
from typing import Any

from python.evaluation.engine import Plan, Quote, Scenario, decimal, load_recordings, timestamp


@dataclass(frozen=True)
class FrozenSetup:
    plan: Plan
    map_expires: int
    decision_at: int


def load_setups(path: Path) -> list[FrozenSetup]:
    setups = []
    previous = -1
    for row in json.loads(path.read_text()):
        created, available, expires, captured, ready, deadline = (
            timestamp(row[key])
            for key in (
                "created",
                "available",
                "expires",
                "map_captured",
                "map_available",
                "map_expires",
            )
        )
        decision_at = timestamp(row["decision_at"])
        legs = tuple(
            (leg["side"], decimal(leg["entry"]), decimal(leg["tp"]), decimal(leg["sl"]))
            for leg in row["legs"]
        )
        if (
            not captured <= ready <= created <= available < expires <= deadline
            or not created <= decision_at <= available
            or deadline - captured != 300_000
            or created <= previous
            or len(legs) != 2
            or {leg[0] for leg in legs} != {-1, 1}
            or any(value <= 0 for leg in legs for value in leg[1:])
        ):
            raise ValueError("FROZEN_SETUP_INVALID")
        previous = created
        setups.append(FrozenSetup(Plan(created, available, expires, legs), deadline, decision_at))
    if not setups:
        raise ValueError("NO_FROZEN_SETUPS")
    return setups


def window(
    quotes: list[Quote],
    setup: FrozenSetup,
    lifetime_ms: int,
    respect_map: bool,
    scenario: Scenario,
    cancel_on_miss: bool = False,
) -> dict[str, Any]:
    """One isolated pair, one base unit/leg; no overlapping-cohort portfolio P/L."""
    if (
        not 0 < lifetime_ms <= 900_000
        or scenario.latency_ms < 0
        or scenario.oco_cancel_latency_ms < 0
        or not 0 < scenario.fill_fraction <= 1
        or any(
            not v.is_finite() or v < 0
            for v in (
                scenario.entry_slippage,
                scenario.exit_slippage,
                scenario.commission_per_million,
            )
        )
        or not scenario.spread_multiplier.is_finite()
        or scenario.spread_multiplier < 1
    ):
        raise ValueError("EXPIRY_SCENARIO_INVALID")
    plan = setup.plan
    # Original journaled local snapshot; no inference from a release's expiry policy.
    capture = setup.decision_at
    start = plan.available
    expiry = capture + lifetime_ms
    if respect_map:
        expiry = min(expiry, setup.map_expires)
    end = expiry + 600_000  # Observation only; never manufacture a ten-minute close.
    pending = {side: (entry, tp, sl) for side, entry, tp, sl in plan.legs}
    triggered: dict[int, int] = {}
    positions: dict[int, tuple[D, D, D, int]] = {}
    exits: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    cancel_at: int | None = None
    prior = start
    fees = D(0)
    fills = 0
    max_adverse = D(0)
    censor: str | None = None
    last = start
    for q in quotes:
        if q.time < start:
            continue
        if q.time - prior > 3000:
            censor = "missing_quote_path"
            break
        if q.time >= end or any(q.time - p[3] >= 600_000 for p in positions.values()):
            censor = "open_at_observation_limit" if positions else "pending_at_observation_limit"
            break
        if q.time // 86_400_000 != start // 86_400_000:
            censor = "financing_unknown"
            break
        prior = last = q.time
        half = (q.ask - q.bid) * scenario.spread_multiplier / 2
        bid, ask = q.mid - half, q.mid + half
        # Pending expiry and OCO cancellation do not close an already-filled position.
        if q.time >= expiry:
            counts["expired_legs"] += len(pending)
            pending.clear()
        if cancel_at is not None and q.time >= cancel_at:
            counts["oco_cancelled_legs"] += len(pending)
            pending.clear()
        for side, (fill, tp, sl, opened) in list(positions.items()):
            mark = bid if side == 1 else ask
            delta = (mark - fill) * side
            max_adverse = max(max_adverse, -delta * scenario.fill_fraction)
            if delta >= tp or delta <= -sl:
                # No sampled overshoot windfall at TP; adverse observed gaps still hit SL.
                exit_price = (
                    fill + side * tp if delta >= tp else mark
                ) - side * scenario.exit_slippage
                fee = (fill + exit_price) * scenario.commission_per_million / 1_000_000
                fee *= scenario.fill_fraction
                fees += fee
                pnl = (exit_price - fill) * side * scenario.fill_fraction - fee
                exits.append(
                    {
                        "reason": "TP" if delta >= tp else "SL",
                        "net": str(pnl),
                        "hold_ms": q.time - opened,
                    }
                )
                del positions[side]
        for side, (entry, tp, sl) in list(pending.items()):
            mark = ask if side == 1 else bid
            if side not in triggered and (mark - entry) * side >= 0:
                triggered[side] = q.time
                counts["triggered_legs"] += 1
            if side not in triggered or q.time < triggered[side] + scenario.latency_ms:
                continue
            fill = mark + side * scenario.entry_slippage
            if (fill - entry) * side > D("0.05"):
                counts["outside_limit_observations"] += 1
                if cancel_on_miss:
                    del pending[side]
                    counts["cancel_on_miss_legs"] += 1
                continue
            # A triggered stop-limit can fill on a retracement, even through its entry.
            positions[side] = (fill, tp, sl, q.time)
            del pending[side]
            fills += 1
            counts["partial_fill_legs"] += int(scenario.fill_fraction < 1)
            if cancel_at is None:
                cancel_at = q.time + scenario.oco_cancel_latency_ms
        if not pending and not positions:
            break
    else:
        censor = "recording_ended" if pending or positions else None
    pnl = sum((D(e["net"]) for e in exits), D(0))
    return {
        "start": start,
        "expiry": expiry,
        "outside_map_ms": max(0, expiry - setup.map_expires),
        "effective_pending_ms": max(0, expiry - start),
        "fills": fills,
        "exits": exits,
        "fees_closed": str(fees),
        "closed_net_before_model": str(pnl),
        "complete_pair_net_before_model": str(pnl) if censor is None else None,
        "censored": censor,
        "maximum_observed_adverse_per_leg": str(max_adverse),
        "observed_ms": last - start,
        "counts": dict(counts),
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    exits = [e for row in rows for e in row["exits"]]
    pnls = [D(e["net"]) for e in exits]
    losses = -sum((x for x in pnls if x < 0), D(0))
    wins = sum((x for x in pnls if x > 0), D(0))
    counts: Counter[str] = Counter()
    for row in rows:
        counts.update(row["counts"])
    return {
        "pairs": len(rows),
        "pairs_with_assumed_fill": sum(row["fills"] > 0 for row in rows),
        "pairs_with_oco_race": sum(row["fills"] > 1 for row in rows),
        "censored_pairs": sum(row["censored"] is not None for row in rows),
        "outside_map_pairs": sum(row["outside_map_ms"] > 0 for row in rows),
        "closed_legs": len(exits),
        "tp": sum(e["reason"] == "TP" for e in exits),
        "sl": sum(e["reason"] == "SL" for e in exits),
        "closed_leg_mean_before_model": str(sum(pnls, D(0)) / len(pnls)) if pnls else None,
        "closed_leg_profit_factor": str(wins / losses) if losses else None,
        "model_cost": None,
        "portfolio_net_pnl": None,
        "counts": dict(counts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recordings", type=Path)
    parser.add_argument("plans", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    setups = load_setups(args.plans)
    quotes, evidence = load_recordings(args.recordings)
    times = [q.time for q in quotes]
    scenarios = {
        "base": (Scenario(), False),
        "worse_costs_and_latency": (
            Scenario(
                latency_ms=1500,
                entry_slippage=D("0.04"),
                exit_slippage=D("0.10"),
                spread_multiplier=D("1.5"),
                commission_per_million=D("45"),
                oco_cancel_latency_ms=1500,
            ),
            False,
        ),
        "cancel_first_miss": (Scenario(), True),
        "half_fill_cancel_remainder": (Scenario(fill_fraction=D("0.5")), False),
    }
    results = {}
    for name, (scenario, cancel_on_miss) in scenarios.items():
        for minutes, bounded in [
            (1, True),
            (3, True),
            (5, True),
            (5, False),
            (10, False),
            (15, False),
        ]:
            rows = []
            for setup in setups:
                lo = bisect_left(times, setup.plan.available)
                hi = bisect_left(times, setup.plan.available + 1_500_001)
                rows.append(
                    window(
                        quotes[lo:hi], setup, minutes * 60_000, bounded, scenario, cancel_on_miss
                    )
                )
            split = len(rows) * 2 // 3
            results[
                f"{name}/{minutes}min/{'map_bounded' if bounded else 'stale_map_hypothesis'}"
            ] = {
                "all": summarize(rows),
                "earlier_two_thirds": summarize(rows[:split]),
                "later_third": summarize(rows[split:]),
                "details": rows,
            }
    report = {
        "label": "COUNTERFACTUAL_SAMPLED_QUOTE_EXPIRY_COHORTS_NOT_BROKER_FILLS",
        "data": evidence,
        "plans_sha256": hashlib.sha256(args.plans.read_bytes()).hexdigest(),
        "assumptions": [
            (
                "Original submitted demo pairs only; same prices and actual submission times in "
                "every window."
            ),
            (
                "One base unit per leg. Each pair isolated; overlapping cohorts cannot be "
                "summed as account returns."
            ),
            (
                "No broker liquidity, queue, margin or rejection reconstruction; observed fills "
                "may be zero even when simulated fills occur."
            ),
            (
                "Side-correct bid/ask, USD 0.05 limit, relative SL/TP, delayed trigger "
                "execution/OCO cancellation, fees once."
            ),
            (
                "Gap >3s censors path. Open positions at ten-minute follow-up remain unknown; "
                "no invented time exit."
            ),
            (
                "Sub-sample paths/partial residuals remain unknown. Half-fill scenario assumes "
                "confirmed remainder cancellation."
            ),
            (
                "Model costs unavailable; net after AI, account P/L/drawdown/frequency and "
                "optimum expiry are unestablished."
            ),
            (
                "5/10/15-minute unbounded maps violate current validity. These are research "
                "hypotheses, never execution permission."
            ),
            (
                "Chronological split is descriptive, not independent multi-day holdout; no "
                "candidate fitted or promoted by this tool."
            ),
        ],
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"quotes": len(quotes), "pairs": len(setups), "report": str(args.output)}))


if __name__ == "__main__":
    main()
