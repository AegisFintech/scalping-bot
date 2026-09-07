"""Chronological, Decimal sampled-quote experiments. Not a tick-execution backtest."""

from __future__ import annotations

import gzip
import hashlib
import json
import random
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from itertools import pairwise
from pathlib import Path
from typing import Any

D = Decimal


def decimal(value: object) -> Decimal:
    if not isinstance(value, str):
        raise ValueError("DECIMAL_STRING_REQUIRED")
    number = D(value)
    if not number.is_finite():
        raise ValueError("DECIMAL_NONFINITE")
    return number


def timestamp(value: object) -> int:
    if not isinstance(value, str):
        raise ValueError("TIMESTAMP_REQUIRED")
    result = datetime.fromisoformat(value)
    if result.tzinfo is None:
        raise ValueError("TIMESTAMP_TIMEZONE_REQUIRED")
    return int(result.timestamp() * 1000)


@dataclass(frozen=True)
class Quote:
    time: int
    source_time: int
    bid: Decimal
    ask: Decimal

    @property
    def mid(self) -> Decimal:
        return (self.bid + self.ask) / 2


def load_recordings(
    directory: Path, until_ms: int | None = None
) -> tuple[list[Quote], dict[str, Any]]:
    """Checksums, ordering and freshness precede any evaluation. No silent sorting."""
    quotes: list[Quote] = []
    dropped: Counter[str] = Counter()
    previous_capture = -1
    previous_source = -1
    fingerprints: list[str] = []
    for path in sorted(directory.glob("*.jsonl.gz")):
        manifest = json.loads(Path(str(path) + ".manifest.json").read_text())
        if until_ms is not None and timestamp(manifest["completedAt"]) > until_ms:
            continue
        contents = path.read_bytes()
        digest = hashlib.sha256(contents).hexdigest()
        if digest != manifest["sha256"]:
            raise ValueError("SEGMENT_CHECKSUM_MISMATCH")
        fingerprints.append(digest)
        lines = gzip.decompress(contents).splitlines()
        if len(lines) != manifest["sampleCount"]:
            raise ValueError("SEGMENT_COUNT_MISMATCH")
        for line in lines:
            row = json.loads(line)
            if row.get("schemaVersion") not in {"1.0", "1.1"} or row.get("symbol") != "XAUUSD":
                raise ValueError("RECORDING_CONTRACT_INVALID")
            capture = timestamp(row["capturedAt"])
            if capture < previous_capture:
                raise ValueError("CAPTURE_NOT_STRICTLY_ORDERED")
            if capture == previous_capture:
                # Conflicting samples have no authoritative within-timestamp
                # order. Exclude the entire tie instead of choosing a price.
                if quotes and quotes[-1].time == capture:
                    quotes.pop()
                    dropped["ambiguous_capture"] += 1
                dropped["ambiguous_capture"] += 1
                continue
            previous_capture = capture
            source = timestamp(row["quote"]["sourceTime"])
            received = timestamp(row["quote"]["receivedAt"])
            bid, ask = decimal(row["quote"]["bid"]), decimal(row["quote"]["ask"])
            if source < previous_source:
                dropped["source_regression"] += 1
                continue
            previous_source = source
            if not 0 <= capture - source <= 3000 or not source <= received <= capture:
                dropped["stale_or_future"] += 1
                continue
            if bid <= 0 or ask <= bid:
                raise ValueError("QUOTE_GEOMETRY_INVALID")
            book = row["orderBook"]
            if not book["complete"] or book["discontinuity"]:
                dropped["depth_discontinuity"] += 1
                continue
            if quotes and (source, bid, ask) == (
                quotes[-1].source_time,
                quotes[-1].bid,
                quotes[-1].ask,
            ):
                dropped["duplicate_sample"] += 1
                continue
            quotes.append(Quote(capture, source, bid, ask))
    if not quotes:
        raise ValueError("NO_USABLE_QUOTES")
    return quotes, {
        "segments": len(fingerprints),
        "dataset_sha256": hashlib.sha256("".join(fingerprints).encode()).hexdigest(),
        "quotes": len(quotes),
        "dropped": dict(dropped),
        "start": quotes[0].time,
        "end": quotes[-1].time,
        "kind": "sampled broker quotes; incomplete tick path",
    }


@dataclass(frozen=True)
class Scenario:
    latency_ms: int = 500
    entry_slippage: Decimal = field(default_factory=lambda: D("0.02"))
    exit_slippage: Decimal = field(default_factory=lambda: D("0.05"))
    spread_multiplier: Decimal = field(default_factory=lambda: D("1"))
    commission_per_million: Decimal = field(default_factory=lambda: D("30"))
    fill_fraction: Decimal = field(default_factory=lambda: D("1"))
    model_cost_per_request: Decimal = field(default_factory=lambda: D("0"))
    oco_cancel_latency_ms: int = 500


@dataclass(frozen=True)
class Plan:
    created: int
    available: int
    expires: int
    legs: tuple[tuple[int, Decimal, Decimal, Decimal], ...]
    # legs: side (+1/-1), stop entry, relative TP, relative SL


@dataclass
class Position:
    side: int
    entry: Decimal
    target: Decimal
    stop: Decimal
    opened: int
    volume: Decimal
    opening_fee: Decimal


def candidates(
    quotes: list[Quote], cadence_ms: int, directional: bool, reward_ratio: Decimal | None = None
) -> list[Plan]:
    """Frozen rules use only fully completed sampled M1 bars; never the forming bar."""
    reward_ratio = reward_ratio if reward_ratio is not None else D("0.5")
    completed: deque[tuple[int, Decimal, Decimal, Decimal, Decimal]] = deque(maxlen=20)
    bucket: int | None = None
    forming: tuple[int, Decimal, Decimal, Decimal, Decimal] | None = None
    last_decision = -1
    previous_time: int | None = None
    full_minute = False
    plans: list[Plan] = []
    for q in quotes:
        if previous_time is not None and q.time - previous_time > 3000:
            forming = None
            full_minute = False
            completed.clear()
        previous_time = q.time
        current = q.time // 60_000
        if current != bucket:
            if forming and full_minute and bucket is not None and current == bucket + 1:
                completed.append(forming)
            forming = (current, q.mid, q.mid, q.mid, q.mid)
            bucket = current
            full_minute = q.time % 60_000 <= 3000
        elif forming:
            forming = (current, forming[1], max(forming[2], q.mid), min(forming[3], q.mid), q.mid)
        decision = q.time // cadence_ms
        if decision == last_decision or len(completed) < 5:
            continue
        last_decision = decision
        # No new exposure around UTC rollover: financing is not silently priced at zero.
        utc = datetime.fromtimestamp(q.time / 1000, UTC)
        if utc.hour == 23 and utc.minute >= 55:
            continue
        ranges = [bar[2] - bar[3] for bar in completed]
        atr_proxy = sum(ranges[-5:], D(0)) / 5
        if atr_proxy <= 0 or q.ask - q.bid > D("0.10") or (q.ask - q.bid) / atr_proxy > D("0.10"):
            continue
        buffer = max(D("0.10"), atr_proxy * D("0.25"))
        tp = max(D("0.60"), atr_proxy * D("0.25")).quantize(D("0.01"), rounding=ROUND_CEILING)
        stop = tp / reward_ratio
        if stop > 10:
            continue
        direction = (
            1
            if completed[-1][4] > completed[-5][4]
            else -1
            if completed[-1][4] < completed[-5][4]
            else 0
        )
        legs: tuple[tuple[int, Decimal, Decimal, Decimal], ...] = (
            (1, (q.ask + buffer).quantize(D("0.01"), rounding=ROUND_CEILING), tp, stop),
            (-1, (q.bid - buffer).quantize(D("0.01"), rounding=ROUND_FLOOR), tp, stop),
        )
        if directional:
            legs = tuple(leg for leg in legs if leg[0] == direction)
        if legs:
            plans.append(Plan(q.time, q.time, q.time + 60_000, legs))
    return plans


def evaluate(quotes: list[Quote], plans: list[Plan], scenario: Scenario) -> dict[str, Any]:
    if (
        not 0 < scenario.fill_fraction <= 1
        or scenario.latency_ms < 0
        or scenario.oco_cancel_latency_ms < 0
        or any(
            v < 0 or not v.is_finite()
            for v in [
                scenario.entry_slippage,
                scenario.exit_slippage,
                scenario.commission_per_million,
                scenario.model_cost_per_request,
            ]
        )
        or not scenario.spread_multiplier.is_finite()
        or scenario.spread_multiplier < 1
    ):
        raise ValueError("SCENARIO_INVALID")
    if any(b.created < a.created for a, b in pairwise(plans)):
        raise ValueError("PLANS_NOT_ORDERED")
    if any(p.available < p.created or p.expires <= p.available for p in plans):
        raise ValueError("PLAN_VALIDITY_INVALID")
    pending: list[tuple[int, Decimal, Decimal, Decimal]] = []
    expiry = 0
    cancel_at: int | None = None
    positions: list[Position] = []
    index = 0
    counters: Counter[str] = Counter()
    outcomes: list[Decimal] = []
    latencies: list[int] = []
    net = D(0)
    high = D(0)
    drawdown = D(0)
    fees = D(0)
    exposure_ms = D(0)
    observed_ms = 0
    prior: Quote | None = None
    model_cost = D(0)
    for quote in quotes:
        half = (quote.ask - quote.bid) * scenario.spread_multiplier / 2
        bid, ask = quote.mid - half, quote.mid + half
        if prior:
            interval = quote.time - prior.time
            if interval > 3000:
                # Unknown path, so neither fills nor protective exits are invented.
                counters["censored_positions"] += len(positions)
                counters["gap_cancelled_orders"] += len(pending)
                positions.clear()
                pending.clear()
            else:
                observed_ms += interval
                exposure_ms += sum((p.volume for p in positions), D(0)) * interval
        prior = quote
        for position in positions[:]:
            mark = bid if position.side == 1 else ask
            hit = (
                mark >= position.target or mark <= position.stop
                if position.side == 1
                else mark <= position.target or mark >= position.stop
            )
            if hit or quote.time - position.opened >= 120_000:
                # Gap stop executions use the observed executable side, never the nominal SL.
                exit_price = mark - position.side * scenario.exit_slippage
                closing_fee = (
                    exit_price * position.volume * scenario.commission_per_million / 1_000_000
                )
                pnl = (
                    (exit_price - position.entry) * position.side * position.volume
                    - position.opening_fee
                    - closing_fee
                )
                outcomes.append(pnl)
                fees += position.opening_fee + closing_fee
                net += pnl
                positions.remove(position)
        if pending and quote.time >= expiry:
            counters["expired_orders"] += len(pending)
            pending.clear()
        if cancel_at is not None and quote.time >= cancel_at:
            counters["oco_cancelled_orders"] += len(pending)
            pending.clear()
            cancel_at = None
        # The peer remains race-exposed during the explicit cancellation delay.
        filled = False
        for side, entry, tp, stop in pending[:]:
            executable = ask if side == 1 else bid
            triggered = executable >= entry if side == 1 else executable <= entry
            fill = executable + side * scenario.entry_slippage
            inside_limit = (fill - entry) * side <= D("0.05")
            if triggered and inside_limit:
                opening_fee = (
                    fill * scenario.fill_fraction * scenario.commission_per_million / 1_000_000
                )
                positions.append(
                    Position(
                        side,
                        fill,
                        fill + side * tp,
                        fill - side * stop,
                        quote.time,
                        scenario.fill_fraction,
                        opening_fee,
                    )
                )
                pending.remove((side, entry, tp, stop))
                counters["fills"] += 1
                counters["partial_fills"] += int(scenario.fill_fraction < 1)
                filled = True
            elif triggered:
                counters["stop_limit_unfilled_observations"] += 1
        if filled:
            cancel_at = quote.time + scenario.oco_cancel_latency_ms
        while (
            index < len(plans)
            and max(plans[index].available, plans[index].created + scenario.latency_ms)
            <= quote.time
        ):
            plan = plans[index]
            index += 1
            counters["decisions"] += 1
            model_cost += scenario.model_cost_per_request
            if pending or positions:
                counters["existing_exposure_rejections"] += 1
                continue
            if (
                quote.time >= plan.expires
                or quote.time - max(plan.available, plan.created + scenario.latency_ms) > 3000
            ):
                counters["stale_plan_rejections"] += 1
                continue
            # Quote moved through an entry during inference: fail closed, no chased price.
            if any(
                (side == 1 and entry <= ask) or (side == -1 and entry >= bid)
                for side, entry, _, _ in plan.legs
            ):
                counters["entry_validation_rejections"] += 1
                continue
            pending = list(plan.legs)
            expiry = plan.expires
            counters["submitted_orders"] += len(pending)
            latencies.append(quote.time - plan.created)
        unrealized = sum(
            ((bid if p.side == 1 else ask) - p.entry) * p.side * p.volume - p.opening_fee
            for p in positions
        )
        equity = net + unrealized - model_cost
        high = max(high, equity)
        drawdown = max(drawdown, high - equity)
    counters["censored_positions"] += len(positions)
    wins = sum((x for x in outcomes if x > 0), D(0))
    losses = -sum((x for x in outcomes if x < 0), D(0))
    hours = D(observed_ms) / 3_600_000
    mean = sum(outcomes, D(0)) / len(outcomes) if outcomes else None
    rng = random.Random(69)
    bootstrap = (
        sorted(
            sum((outcomes[rng.randrange(len(outcomes))] for _ in outcomes), D(0)) / len(outcomes)
            for _ in range(500)
        )
        if outcomes
        else []
    )
    latencies.sort()
    return {
        "closed_trades": len(outcomes),
        "net_pnl_before_model": str(net),
        "model_cost_assumption": str(model_cost),
        "net_pnl": str(net - model_cost) if not counters["censored_positions"] else None,
        "fees": str(fees),
        "net_expectancy_before_model": str(mean) if mean is not None else None,
        "max_marked_drawdown": str(drawdown),
        "drawdown_scope": "observed paths only; gaps can understate drawdown",
        "profit_factor": str(wins / losses) if losses else None,
        "trades_per_observed_hour": str(D(len(outcomes)) / hours) if hours else None,
        "unit_exposure_fraction": str(exposure_ms / observed_ms) if observed_ms else None,
        "fill_rate": str(D(counters["fills"]) / counters["submitted_orders"])
        if counters["submitted_orders"]
        else None,
        "latency_p50_ms": latencies[len(latencies) // 2] if latencies else None,
        "latency_p95_ms": latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))]
        if latencies
        else None,
        "iid_expectancy_interval_95": [str(bootstrap[12]), str(bootstrap[487])]
        if bootstrap
        else None,
        "uncertainty": (
            "IID interval is exploratory; serial dependence, censored paths and few "
            "independent days prevent significance claims"
        ),
        "counters": dict(counters),
        "closed_pnls": [str(x) for x in outcomes],
    }
