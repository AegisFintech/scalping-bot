"""Conditional sampled-path comparisons, never a trading or promotion authority.

Each observed intent is an independent paired experiment, NOT a compounded
portfolio. Quantities/budgets are frozen from the approved demo intent; unknown
cost/FX/margin/swap counterfactuals stay unknown. No dollar returns are fabricated.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import resource
from bisect import bisect_right
from collections import Counter
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from decimal import ROUND_FLOOR, Decimal
from io import BytesIO
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

from python.evaluation.engine import Quote, decimal, timestamp

D = Decimal
ONE = D(1)
STOP_RESERVE = D("0.65")


@dataclass(frozen=True)
class Leg:
    side: int
    accepted: int
    entry: Decimal
    sl: Decimal
    tp: Decimal
    volume: Decimal
    budget: Decimal
    equity: Decimal
    fill_time: int | None
    fill_price: Decimal | None


@dataclass(frozen=True)
class Setup:
    created: int
    available: int
    deadline: int
    tick: Decimal
    model_buy: Decimal
    model_sell: Decimal
    legs: tuple[Leg, ...]


@dataclass(frozen=True)
class Assumptions:
    name: str = "base"
    latency_ms: int = 500
    cancel_ms: int = 500
    max_gap_ms: int = 3000
    spread_multiplier: Decimal = ONE
    stop_slippage: Decimal = STOP_RESERVE


@dataclass(frozen=True)
class Outcome:
    status: str
    at: int
    side: int | None = None
    filled_at: int | None = None
    # Price move / original SL distance, not money, net return or risk-budget R.
    gross_price_over_sl: Decimal | None = None


def positive(value: object) -> Decimal:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,20}(?:\.[0-9]{1,10})?", value):
        raise ValueError("DECIMAL_FORMAT_INVALID")
    number = decimal(value)
    if number <= 0:
        raise ValueError("POSITIVE_DECIMAL_REQUIRED")
    return number


def parse_setup(row: dict[str, Any]) -> Setup:
    if row["model_schema"] != "entry-pair-1.0":
        raise ValueError("MODEL_SCHEMA_INVALID")
    created, captured, available, valid, deadline = (
        timestamp(row[k])
        for k in ("created", "captured", "available", "valid_until", "submission_valid_until")
    )
    if not captured <= available <= created <= deadline <= valid:
        raise ValueError("SETUP_TIME_INVALID")
    tick, buy, sell = (positive(row[k]) for k in ("tick_size", "model_buy", "model_sell"))
    if buy >= sell or buy % tick or sell % tick:
        raise ValueError("MODEL_GEOMETRY_INVALID")
    legs: list[Leg] = []
    for item in row["legs"]:
        if item["order_type"] != "LIMIT" or item["tif"] != "GTC":
            raise ValueError("LIFETIME_OR_ORDER_TYPE_INVALID")
        if item["side"] not in {"BUY", "SELL"}:
            raise ValueError("SIDE_INVALID")
        accepted = timestamp(item["accepted"])
        if not created <= accepted <= deadline:
            raise ValueError("ACCEPTANCE_TIME_INVALID")
        entry, sl, tp, volume, budget, equity = (
            positive(item[k]) for k in ("entry", "sl", "tp", "volume", "budget", "equity")
        )
        if any(value % tick for value in (entry, sl, tp)) or entry <= sl or entry <= tp:
            raise ValueError("LEG_GEOMETRY_INVALID")
        fill = item["fill"]
        fill_time = timestamp(fill["time"]) if fill else None
        fill_price = positive(fill["price"]) if fill else None
        if fill_time is not None and fill_time < accepted:
            raise ValueError("FILL_TIME_INVALID")
        legs.append(
            Leg(
                1 if item["side"] == "BUY" else -1,
                accepted,
                entry,
                sl,
                tp,
                volume,
                budget,
                equity,
                fill_time,
                fill_price,
            )
        )
    if len(legs) != 2 or {leg.side for leg in legs} != {1, -1}:
        raise ValueError("PAIR_REQUIRED")
    if legs[0].equity != legs[1].equity or sum(x.budget for x in legs) > legs[0].equity / 100:
        raise ValueError("SHARED_BUDGET_INVALID")
    return Setup(created, available, deadline, tick, buy, sell, tuple(legs))


@dataclass
class Tape:
    quotes: list[Quote]
    times: list[int]
    invalid: list[int]
    evidence: dict[str, Any]

    def broken(self, after: int, through: int, max_gap: int) -> bool:
        index = bisect_right(self.invalid, after)
        return through - after > max_gap or (
            index < len(self.invalid) and self.invalid[index] <= through
        )


def load_tape(directory: Path, start: int, end: int, archives: tuple[Path, ...] = ()) -> Tape:
    """Bounded segment-at-a-time reads; retain unchanged fresh observations.

    A rejected/tied observation creates an explicit discontinuity. Sorting is
    permitted across segments but conflicting timestamps are never selected.
    """
    quotes: dict[int, Quote] = {}
    invalid: set[int] = set()
    rejected: Counter[str] = Counter()
    hashes: list[str] = []
    sealed: dict[str, tuple[int, int, int]] = {}
    names: dict[str, str] = {}
    paths = sorted(
        (p for root in (directory, *archives) for p in root.glob("*.jsonl.gz")),
        key=lambda p: (p.name, str(p)),
    )
    for path in paths:
        manifest_path = Path(str(path) + ".manifest.json")
        if not manifest_path.exists():
            # Unsealed segments cannot supply evidence. Resulting holes censor.
            rejected["UNSEALED_SEGMENT"] += 1
            continue
        if manifest_path.stat().st_size > 16384:
            raise ValueError("MANIFEST_TOO_LARGE")
        manifest = json.loads(manifest_path.read_text())
        segment_start, segment_end = (
            timestamp(manifest["startedAt"]),
            timestamp(manifest["completedAt"]),
        )
        if segment_end < start - 3000 or segment_start >= end:
            continue
        if path.stat().st_size > 8_000_000:
            raise ValueError("SEGMENT_TOO_LARGE")
        contents = path.read_bytes()
        if len(contents) > 8_000_000:
            raise ValueError("SEGMENT_TOO_LARGE")
        digest = hashlib.sha256(contents).hexdigest()
        if digest != manifest["sha256"]:
            raise ValueError("SEGMENT_CHECKSUM_MISMATCH")
        identity = (segment_start, segment_end, manifest["sampleCount"])
        if path.name in names and names[path.name] != digest:
            raise ValueError("SEGMENT_IDENTITY_CONFLICT")
        names[path.name] = digest
        if digest in sealed:
            if sealed[digest] != identity:
                raise ValueError("SEGMENT_MANIFEST_CONFLICT")
            continue
        sealed[digest] = identity
        hashes.append(digest)
        if len(hashes) > 10000:
            raise ValueError("TOO_MANY_SEGMENTS")
        count, previous, previous_source = 0, -1, -1
        # Parse exactly the verified bytes, never re-open a potentially replaced
        # file between checksum verification and decompression.
        with gzip.open(BytesIO(contents), "rt") as stream:
            while line := stream.readline(100_001):
                count += 1
                if count > 100_000 or len(line) > 100_000:
                    raise ValueError("SEGMENT_EXPANSION_LIMIT")
                row = json.loads(line)
                at = timestamp(row["capturedAt"])
                if at < previous or not segment_start <= at <= segment_end:
                    raise ValueError("SEGMENT_TIME_INVALID")
                previous = at
                if not start - 3000 <= at < end:
                    continue
                if row.get("schemaVersion") not in {"1.0", "1.1"} or row.get("symbol") != "XAUUSD":
                    raise ValueError("QUOTE_CONTRACT_INVALID")
                raw = row["quote"]
                source, received = timestamp(raw["sourceTime"]), timestamp(raw["receivedAt"])
                bid, ask = positive(raw["bid"]), positive(raw["ask"])
                book = row["orderBook"]
                reason = None
                if (
                    source < previous_source
                    or not source <= received <= at
                    or not 0 <= at - source <= 3000
                ):
                    reason = "QUOTE_TIME_INVALID"
                elif (
                    bid >= ask or book["complete"] is not True or book["discontinuity"] is not False
                ):
                    reason = "QUOTE_OR_BOOK_INVALID"
                elif at in quotes or at in invalid:
                    reason = "AMBIGUOUS_CAPTURE"
                previous_source = max(previous_source, source)
                if reason:
                    invalid.add(at)
                    quotes.pop(at, None)
                    rejected[reason] += 1
                else:
                    quotes[at] = Quote(at, source, bid, ask)
                if len(quotes) + len(invalid) > 3_000_000:
                    raise ValueError("TAPE_TOO_LARGE")
        if count != manifest["sampleCount"]:
            raise ValueError("SEGMENT_COUNT_MISMATCH")
    ordered = [quotes[key] for key in sorted(quotes)]
    # Source-clock regression across otherwise ordered segment boundaries also
    # invalidates the path rather than choosing a newer source retrospectively.
    previous_source = -1
    valid_quotes = []
    for quote in ordered:
        if quote.source_time < previous_source:
            invalid.add(quote.time)
            rejected["SOURCE_REGRESSION"] += 1
        else:
            valid_quotes.append(quote)
        previous_source = max(previous_source, quote.source_time)
    return Tape(
        valid_quotes,
        [q.time for q in valid_quotes],
        sorted(invalid),
        {
            "segments": len(hashes),
            "quotes": len(valid_quotes),
            "rejected": dict(rejected),
            "sha256": hashlib.sha256("".join(hashes).encode()).hexdigest(),
            "kind": "SAMPLED_QUOTES_NOT_COMPLETE_TICKS",
        },
    )


def prices(quote: Quote, assumptions: Assumptions) -> tuple[Decimal, Decimal]:
    half = (quote.ask - quote.bid) * assumptions.spread_multiplier / 2
    return quote.mid - half, quote.mid + half


def replay(
    setup: Setup,
    tape: Tape,
    end: int,
    assumptions: Assumptions,
    *,
    preserve_entries: bool = False,
    tp_factor: Decimal = ONE,
    anchor: Leg | None = None,
) -> Outcome:
    """Per-intent GTC experiment or actual-fill-anchored TP experiment.

    A filled peer within assumed cancellation latency censors the pair. There
    is no implicit cancellation on plan expiry, time exit, loss pause or rearm.
    Limits require one-tick penetration; fills use limit price (no improvement).
    TP uses target price (no improvement); stops use worse observed price plus
    an explicit adverse reserve. All remain assumptions, not broker executions.
    """
    if (
        tp_factor <= 0
        or assumptions.max_gap_ms <= 0
        or assumptions.latency_ms < 0
        or assumptions.cancel_ms < 0
        or assumptions.spread_multiplier < 1
        or assumptions.stop_slippage < 0
    ):
        raise ValueError("ASSUMPTIONS_INVALID")
    legs = tuple(
        replace(leg, entry=setup.model_buy if leg.side == 1 else setup.model_sell)
        if preserve_entries
        else leg
        for leg in setup.legs
    )
    start = anchor.fill_time if anchor else min(x.accepted for x in legs)
    if start is None or start >= end:
        return Outcome("NO_START_EVIDENCE", end)
    index = bisect_right(tape.times, start) - 1
    if index < 0 or tape.broken(tape.times[index], start, assumptions.max_gap_ms):
        return Outcome("NO_START_EVIDENCE", start)
    if start in tape.invalid:
        return Outcome("NO_START_EVIDENCE", start)
    position: Leg | None = anchor
    fill_at = anchor.fill_time if anchor else None
    fill_price = anchor.fill_price if anchor else None
    activated: set[int] = set()
    previous = start
    deferred_close: Outcome | None = None
    for quote_index in range(index + 1, len(tape.quotes)):
        quote = tape.quotes[quote_index]
        if quote.time >= end:
            break
        if tape.broken(previous, quote.time, assumptions.max_gap_ms):
            return Outcome("CENSORED_GAP", quote.time, position.side if position else None, fill_at)
        previous = quote.time
        bid, ask = prices(quote, assumptions)
        for leg in legs if anchor is None else ():
            active_at = leg.accepted + assumptions.latency_ms
            if quote.time < active_at:
                continue
            if leg.side not in activated:
                # Validate against a quote known at broker acceptance, not the future
                # quote that happens to reveal a subsequent fill.
                prior = bisect_right(tape.times, leg.accepted) - 1
                if prior < 0 or tape.broken(
                    tape.times[prior], leg.accepted, assumptions.max_gap_ms
                ):
                    return Outcome("NO_ACCEPTANCE_EVIDENCE", quote.time)
                pbid, pask = prices(tape.quotes[prior], assumptions)
                if (leg.side == 1 and leg.entry >= pask) or (leg.side == -1 and leg.entry <= pbid):
                    return Outcome("CENSORED_ENTRY_QUOTE_MISMATCH", quote.time)
                activated.add(leg.side)
            if position and (
                leg.side == position.side or quote.time > (fill_at or 0) + assumptions.cancel_ms
            ):
                continue
            hit = ask <= leg.entry - setup.tick if leg.side == 1 else bid >= leg.entry + setup.tick
            if hit:
                if position:
                    return Outcome("CENSORED_OCO_RACE", quote.time, position.side, fill_at)
                if quote.time < max(x.accepted + assumptions.latency_ms for x in legs):
                    return Outcome("CENSORED_INCOMPLETE_PAIR", quote.time, leg.side, quote.time)
                position, fill_at, fill_price = leg, quote.time, leg.entry
        if position is None or fill_at is None or fill_price is None:
            continue
        cancel_proven = anchor is not None or quote.time > fill_at + assumptions.cancel_ms
        if deferred_close is not None:
            if cancel_proven:
                return deferred_close
            continue
        executable = bid if position.side == 1 else ask
        move = (executable - fill_price) * position.side
        target = (position.tp * tp_factor / setup.tick).to_integral_value(
            rounding=ROUND_FLOOR
        ) * setup.tick
        if target <= 0:
            raise ValueError("TARGET_TOO_SMALL")
        status: Literal["SL", "TP"] | None = (
            "SL" if move <= -position.sl else "TP" if move >= target else None
        )
        if status:
            pnl = move - assumptions.stop_slippage if status == "SL" else target
            result = Outcome(status, quote.time, position.side, fill_at, pnl / position.sl)
            if cancel_proven:
                return result
            deferred_close = result
    if tape.broken(previous, end, assumptions.max_gap_ms):
        return Outcome("CENSORED_GAP", end, position.side if position else None, fill_at)
    return Outcome(
        "OPEN_AT_CUTOFF" if position else "PENDING_AT_CUTOFF",
        end,
        position.side if position else None,
        fill_at,
    )


def summary(outcomes: list[Outcome]) -> dict[str, Any]:
    closed = [o for o in outcomes if o.status in {"SL", "TP"}]
    return {
        "experiments": len(outcomes),
        "statuses": dict(Counter(o.status for o in outcomes)),
        "observed_path_closes": len(closed),
        "gross_price_over_sl_sum_closed_subset": str(
            sum((o.gross_price_over_sl or D(0) for o in closed), D(0))
        ),
        "cohort_net_pnl": None,
        "cohort_win_rate": None,
    }


def input_window(payload: dict[str, Any]) -> tuple[int, int]:
    if (
        not isinstance(payload, dict)
        or set(payload) != {"label", "release", "from", "until", "cohort", "economics", "setups"}
        or payload["label"] != "PAIRED_REPLAY_INPUT_V1"
        or payload["economics"] is not None
        or payload["cohort"] != "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST"
        or not isinstance(payload["release"], str)
        or not re.fullmatch(r"0\.3\.0-fade-limit\.[123]", payload["release"])
        or not isinstance(payload["setups"], list)
    ):
        raise ValueError("INPUT_CONTRACT_INVALID")
    start, end = timestamp(payload["from"]), timestamp(payload["until"])
    if not 0 < end - start <= 31 * 86400000 or len(payload["setups"]) > 1000:
        raise ValueError("WINDOW_INVALID")
    return start, end


def compare(payload: dict[str, Any], tape: Tape) -> dict[str, Any]:
    start, end = input_window(payload)
    setups: list[Setup] = []
    seen: set[int] = set()
    excluded: Counter[str] = Counter()
    for row in payload["setups"]:
        try:
            setup = parse_setup(row)
            if not start <= setup.created < end:
                raise ValueError("SETUP_OUTSIDE_WINDOW")
            if setup.created in seen:
                raise ValueError("DUPLICATE_INTENT_TIME")
            seen.add(setup.created)
            setups.append(setup)
        except (ValueError, KeyError, TypeError) as error:
            code = str(error)
            excluded[
                code if re.fullmatch(r"[A-Z_]{1,80}", code) else "INVALID_OR_INCOMPLETE_INTENT"
            ] += 1
    reports = []
    for assumptions in (
        Assumptions(),
        Assumptions(
            name="stress",
            latency_ms=1000,
            cancel_ms=1000,
            spread_multiplier=D(2),
            stop_slippage=D("1.30"),
        ),
    ):
        entry_base, entry_model = [], []
        tp_base: list[Outcome] = []
        tp_lower: list[Outcome] = []
        tp_higher: list[Outcome] = []
        entry_cases = []
        tp_cases = []
        for setup in setups:
            entry_base.append(replay(setup, tape, end, assumptions))
            entry_model.append(replay(setup, tape, end, assumptions, preserve_entries=True))
            entry_cases.append(
                {
                    "created": setup.created,
                    "baseline": asdict(entry_base[-1]),
                    "model_levels": asdict(entry_model[-1]),
                }
            )
            fills = [leg for leg in setup.legs if leg.fill_time is not None]
            if len(fills) == 1:
                for result, factor in (
                    (tp_base, D(1)),
                    (tp_lower, D("0.75")),
                    (tp_higher, D("1.25")),
                ):
                    result.append(
                        replay(setup, tape, end, assumptions, tp_factor=factor, anchor=fills[0])
                    )
                tp_cases.append(
                    {
                        "created": setup.created,
                        "baseline": asdict(tp_base[-1]),
                        "factor_0_75": asdict(tp_lower[-1]),
                        "factor_1_25": asdict(tp_higher[-1]),
                    }
                )

        def paired(a: list[Outcome], b: list[Outcome]) -> dict[str, Any]:
            both = [
                (x, y)
                for x, y in zip(a, b, strict=True)
                if x.gross_price_over_sl is not None and y.gross_price_over_sl is not None
            ]
            return {
                "complete_pairs": len(both),
                "unresolved_pairs": len(a) - len(both),
                "gross_delta_over_sl_complete_subset": str(
                    sum(
                        (
                            y.gross_price_over_sl - x.gross_price_over_sl
                            for x, y in both
                            if x.gross_price_over_sl is not None
                            and y.gross_price_over_sl is not None
                        ),
                        D(0),
                    )
                ),
                "selection_warning": "COMPLETE_SUBSET_NOT_FULL_COHORT_EXPECTANCY",
            }

        reports.append(
            {
                "assumptions": asdict(assumptions),
                "entry": {
                    "baseline": summary(entry_base),
                    "model_levels": summary(entry_model),
                    "paired": paired(entry_base, entry_model),
                    "cases": entry_cases,
                },
                "tp": {
                    "policy_note": (
                        "FACTOR_0_75_IS_RESEARCH_ONLY_BELOW_CURRENT_0_75_MIN_REWARD_RISK"
                    ),
                    "baseline": summary(tp_base),
                    "factor_0_75": summary(tp_lower),
                    "factor_1_25": summary(tp_higher),
                    "lower_paired": paired(tp_base, tp_lower),
                    "higher_paired": paired(tp_base, tp_higher),
                    "not_single_full_fill": len(setups) - len(tp_base),
                    "cases": tp_cases,
                },
            }
        )
    return {
        "label": "CONDITIONAL_PAIRED_REPLAY_V1",
        "decision": "HOLD",
        "candidate": None,
        "from": payload["from"],
        "until": payload["until"],
        "release": payload["release"],
        "input_setups": len(payload["setups"]),
        "valid_setups": len(setups),
        "excluded": dict(excluded),
        "tape": tape.evidence,
        "comparisons": reports,
        "limitations": [
            "INCOMPLETE_TICK_PATH_AND_ASSUMED_EXECUTION",
            "FROZEN_OBSERVED_INTENTS_NOT_COUNTERFACTUAL_REQUEST_STREAM",
            "FROZEN_APPROVED_QUANTITY_NOT_DYNAMIC_PORTFOLIO_RESIZING",
            "COUNTERFACTUAL_FEES_SWAP_FX_MARGIN_UNAVAILABLE",
        ],
        "broker_authority": False,
        "production_changed": False,
        "net_pnl": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--recordings", required=True, type=Path, nargs="+")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        began = perf_counter()
        if args.output.exists():
            raise ValueError("OUTPUT_ALREADY_EXISTS")
        if args.input.stat().st_size > 8_000_000:
            raise ValueError("INPUT_TOO_LARGE")
        raw = args.input.read_bytes()
        payload = json.loads(raw)
        start, end = input_window(payload)
        tape = load_tape(args.recordings[0], start, end, tuple(args.recordings[1:]))
        report = compare(payload, tape)
        report["input_sha256"] = hashlib.sha256(raw).hexdigest()
        report["generated_at"] = datetime.now(UTC).isoformat()
        report["resources"] = {
            "elapsed_seconds": round(perf_counter() - began, 3),
            "max_rss_kib_linux": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        }
        # Exclusive creation: never overwrite prior evidence.
        with args.output.open("x", encoding="utf-8") as output:
            output.write(json.dumps(report, indent=2, default=str) + "\n")
        args.output.chmod(0o600)
        print(json.dumps({"decision": report["decision"], "valid_setups": report["valid_setups"]}))
    except (OSError, ValueError, KeyError, TypeError):
        raise SystemExit("PAIRED_REPLAY_FAILED: invalid or unavailable evidence") from None


if __name__ == "__main__":
    main()
