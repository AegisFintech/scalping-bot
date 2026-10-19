"""Frozen conditional fast-exit experiments; no broker or promotion authority."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
from bisect import bisect_right
from collections import Counter
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path
from typing import Any

from python.backtest.forward import DAY, digest, iso, now_ms, publish, read_json
from python.backtest.paired import (
    Assumptions,
    Leg,
    Outcome,
    Setup,
    Tape,
    input_window,
    load_tape,
    parse_setup,
    positive,
    prices,
)
from python.evaluation.engine import timestamp

D = Decimal
RELEASE = "0.3.0-fade-limit.3-codex.1"
ROOT = Path(__file__).resolve().parents[2]
# These are experiments, not recommended live parameters. Never optimize them
# against a selected completed subset or modify an existing registration.
CANDIDATES = {
    "baseline": {},
    "quick": {"net_price_over_sl": "0.10"},
    "giveback": {"arm_over_sl": "0.25", "giveback_over_sl": "0.10", "floor_over_sl": "0.05"},
}
SOURCES = (
    "python/backtest/fast_exits.py",
    "python/backtest/paired.py",
    "python/backtest/forward.py",
    "python/evaluation/engine.py",
    "scripts/export-fast-exits.ts",
    "packages/evaluation/src/fast-exit-input.ts",
    "packages/evaluation/src/demo-learning.ts",
    "packages/evaluation/src/paired-input.ts",
    "schemas/fast-exit-input-1.0.json",
    "package-lock.json",
    "requirements.lock",
)


def fingerprint() -> str:
    return digest(
        {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}
    )


def window(payload: dict[str, Any]) -> tuple[int, int]:
    if payload.get("label") != "FAST_EXIT_INPUT_V1" or payload.get("release") != RELEASE:
        raise ValueError("FAST_EXIT_INPUT_INVALID")
    return input_window(
        {**payload, "label": "PAIRED_REPLAY_INPUT_V1", "release": "0.3.0-fade-limit.3"}
    )


def cost_distance(row: dict[str, Any], setup: Setup, leg: Leg) -> Decimal:
    evidence = row["fee_evidence"]
    if not isinstance(evidence, list) or len(evidence) != 1:
        raise ValueError("FEE_EVIDENCE_MISSING_OR_AMBIGUOUS")
    fee = evidence[0]
    if timestamp(fee["at"]) > setup.created or positive(fee["volume"]) != leg.volume:
        raise ValueError("FEE_EVIDENCE_PROVENANCE_INVALID")
    # Price-equivalent fee estimate known before intent; not realized future fees.
    distance = positive(fee["pips"]) * positive(fee["pip_size"])
    if distance != leg.tp:
        raise ValueError("FEE_TARGET_MISMATCH")
    return positive(fee["fees"]) * distance / positive(fee["gross"])


def replay_exit(
    setup: Setup,
    anchor: Leg,
    tape: Tape,
    end: int,
    assumptions: Assumptions,
    mode: str,
    fee: Decimal,
    peer_cancelled: int,
) -> Outcome:
    if (
        mode not in CANDIDATES
        or fee < 0
        or assumptions.latency_ms < 0
        or assumptions.stop_slippage < 0
    ):
        raise ValueError("FAST_EXIT_ASSUMPTIONS_INVALID")
    if assumptions.max_gap_ms <= 0 or assumptions.spread_multiplier < 1:
        raise ValueError("FAST_EXIT_ASSUMPTIONS_INVALID")
    start, entry = anchor.fill_time, anchor.fill_price
    if start is None or entry is None or start >= end:
        return Outcome("NO_START_EVIDENCE", end)
    index = bisect_right(tape.times, start) - 1
    if (
        index < 0
        or start in tape.invalid
        or tape.broken(tape.times[index], start, assumptions.max_gap_ms)
    ):
        return Outcome("NO_START_EVIDENCE", start)
    previous, peak = start, D(0)
    due: int | None = None
    for quote in tape.quotes[index + 1 :]:
        if quote.time >= end:
            break
        if tape.broken(previous, quote.time, assumptions.max_gap_ms):
            return Outcome("CENSORED_GAP", quote.time, anchor.side, start)
        previous = quote.time
        if quote.source_time < start:
            continue
        bid, ask = prices(quote, assumptions)
        move = ((bid if anchor.side == 1 else ask) - entry) * anchor.side
        # Native protection remains independent of and precedes local exit work.
        if move <= -anchor.sl:
            return Outcome(
                "SL", quote.time, anchor.side, start, (move - assumptions.stop_slippage) / anchor.sl
            )
        if move >= anchor.tp:
            return Outcome("TP", quote.time, anchor.side, start, anchor.tp / anchor.sl)
        if due is not None and quote.time >= due:
            # First observed executable quote after dispatch latency, not the
            # trigger/peak price. A fast exit may consequently realize a loss.
            return Outcome(
                "FAST_EXIT",
                quote.time,
                anchor.side,
                start,
                (move - assumptions.stop_slippage) / anchor.sl,
            )
        if mode == "baseline" or quote.time < peer_cancelled:
            continue
        peak = max(peak, move)
        threshold = fee + assumptions.stop_slippage + D("0.10") * anchor.sl
        if mode == "giveback":
            armed = peak >= fee + assumptions.stop_slippage + D("0.25") * anchor.sl
            threshold = max(
                fee + assumptions.stop_slippage + D("0.05") * anchor.sl,
                peak - D("0.10") * anchor.sl,
            )
            trigger = armed and move <= threshold
        else:
            trigger = move >= threshold
        if trigger and due is None:
            due = quote.time + assumptions.latency_ms
    if tape.broken(previous, end, assumptions.max_gap_ms):
        return Outcome("CENSORED_GAP", end, anchor.side, start)
    return Outcome(
        "EXIT_PENDING_AT_CUTOFF" if due is not None else "OPEN_AT_CUTOFF", end, anchor.side, start
    )


def compare(payload: dict[str, Any], tape: Tape) -> dict[str, Any]:
    start, end = window(payload)
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
        cases: list[dict[str, Any]] = []
        excluded: Counter[str] = Counter()
        seen: set[int] = set()
        for row in payload["setups"]:
            try:
                setup = parse_setup(row)
                if not start <= setup.created < end or setup.created in seen:
                    raise ValueError("INTENT_TIME_INVALID_OR_DUPLICATE")
                seen.add(setup.created)
                if any(
                    type(x["fill_count"]) is not int or x["fill_count"] < 0 for x in row["legs"]
                ):
                    raise ValueError("FILL_COUNT_INVALID")
                if sum(x["fill_count"] for x in row["legs"]) != 1:
                    raise ValueError("NOT_SINGLE_FULL_FILL_OR_OCO_RACE")
                fills = [x for x in setup.legs if x.fill_time is not None]
                if len(fills) != 1:
                    raise ValueError("NOT_SINGLE_FULL_FILL_OR_OCO_RACE")
                anchor = fills[0]
                source = next(
                    x for x in row["legs"] if x["side"] == ("BUY" if anchor.side == 1 else "SELL")
                )
                peer = next(x for x in row["legs"] if x is not source)
                if peer["fill_count"] != 0 or peer["cancelled_at"] is None:
                    raise ValueError("PEER_CANCELLATION_UNPROVEN")
                cancelled = timestamp(peer["cancelled_at"])
                if not max(x.accepted for x in setup.legs) <= cancelled < end:
                    raise ValueError("PEER_CANCELLATION_TIME_INVALID")
                fee = cost_distance(source, setup, anchor)
                results = {
                    mode: asdict(
                        replay_exit(setup, anchor, tape, end, assumptions, mode, fee, cancelled)
                    )
                    for mode in CANDIDATES
                }
                cases.append(
                    {"created": setup.created, "fee_price_estimate": str(fee), "outcomes": results}
                )
            except (ValueError, KeyError, TypeError, StopIteration) as error:
                code = str(error)
                excluded[
                    code if code.isupper() and len(code) < 80 else "INVALID_OR_INCOMPLETE_INTENT"
                ] += 1
        summaries = {}
        for mode in CANDIDATES:
            outcomes = [x["outcomes"][mode] for x in cases]
            summaries[mode] = {
                "statuses": dict(Counter(x["status"] for x in outcomes)),
                "experiments": len(outcomes),
                "complete": sum(x["gross_price_over_sl"] is not None for x in outcomes),
                "net_pnl": None,
            }
        pairs = {}
        for mode in ("quick", "giveback"):
            complete = [
                x
                for x in cases
                if all(
                    x["outcomes"][m]["gross_price_over_sl"] is not None for m in ("baseline", mode)
                )
            ]
            pairs[mode] = {
                "complete_pairs": len(complete),
                "unresolved_pairs": len(cases) - len(complete),
                "gross_delta_over_sl_complete_subset": str(
                    sum(
                        (
                            x["outcomes"][mode]["gross_price_over_sl"]
                            - x["outcomes"]["baseline"]["gross_price_over_sl"]
                            for x in complete
                        ),
                        D(0),
                    )
                ),
                "warning": "SELECTED_COMPLETE_SUBSET_NOT_NET_EXPECTANCY",
            }
        reports.append(
            {
                "assumptions": asdict(assumptions),
                "excluded": dict(excluded),
                "summaries": summaries,
                "pairs": pairs,
                "cases": cases,
            }
        )
    return {
        "label": "FAST_EXIT_RESEARCH_V1",
        "decision": "HOLD",
        "release": RELEASE,
        "from": payload["from"],
        "until": payload["until"],
        "input_setups": len(payload["setups"]),
        "candidates": CANDIDATES,
        "comparisons": reports,
        "tape": tape.evidence,
        "broker_authority": False,
        "production_changed": False,
        "counterfactual_net_pnl": None,
        "limitations": [
            "SAMPLED_PATH_NOT_EXECUTION_PROOF",
            "UNKNOWN_COUNTERFACTUAL_FEES_SWAP_FX_MARGIN",
            "FROZEN_QUANTITIES_NOT_DYNAMIC_PORTFOLIO",
            "CONDITIONAL_ON_OBSERVED_FILLS_AND_PEER_CANCELLATION",
            "DAILY_CUTOFF_CENSORS_OPEN_PATHS",
            "NO_AUTOMATIC_PROMOTION",
        ],
    }


def register(start: int, now: int) -> dict[str, Any]:
    if not now < start <= now + DAY:
        raise ValueError("FUTURE_WINDOW_REQUIRED")
    return {
        "label": "FAST_EXIT_REGISTRATION_V1",
        "registered_at": iso(now),
        "start": iso(start),
        "until": iso(start + 30 * DAY),
        "days": 30,
        "release": RELEASE,
        "candidates": CANDIDATES,
        "source_sha256": fingerprint(),
        "decision": "HOLD",
        "broker_authority": False,
    }


def validate_registration(study: dict[str, Any], start: int, end: int, now: int) -> None:
    beginning = timestamp(study["start"])
    if (
        study["label"] != "FAST_EXIT_REGISTRATION_V1"
        or study["release"] != RELEASE
        or study["source_sha256"] != fingerprint()
        or study["candidates"] != CANDIDATES
        or study["decision"] != "HOLD"
        or study["broker_authority"] is not False
        or study["days"] != 30
        or timestamp(study["until"]) != beginning + 30 * DAY
        or not timestamp(study["registered_at"]) < beginning
        or not beginning <= start < end <= beginning + 30 * DAY
        or (start - beginning) % DAY
        or end - start != DAY
        or now < end + 600_000
    ):
        raise ValueError("REGISTRATION_OR_WINDOW_INVALID")


def collect(directory: Path, recordings: list[Path], now: int) -> str:
    """At most one completed daily window, under a process lock; no trading writes."""
    study = read_json(directory / "registration.json")
    start = timestamp(study["start"])
    if study["source_sha256"] != fingerprint():
        raise ValueError("SOURCE_DRIFT")
    disk = shutil.disk_usage(directory)
    if disk.free < max(2 * 1024**3, disk.total * 0.15):
        raise ValueError("RESEARCH_DISK_RESERVE")
    with (directory / ".collection.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for index in range(30):
            begin, end = start + index * DAY, start + (index + 1) * DAY
            output = directory / f"daily-{index:02d}.json"
            if output.exists():
                envelope = read_json(output)
                body = envelope["body"]
                if (
                    envelope["sha256"] != digest(body)
                    or body["registration_sha256"] != digest(study)
                    or body["from"] != iso(begin)
                    or body["until"] != iso(end)
                ):
                    raise ValueError("EXISTING_REPORT_INVALID")
                continue
            if now < end + 600_000:
                return "WAITING_FOR_WINDOW"
            validate_registration(study, begin, end, now)
            before = fingerprint()
            # Trusted read-only exporter. SQL has repeatable-read/read-only and
            # 15s statement bounds; its stdout contains no broker/account IDs.
            exported = subprocess.run(
                [
                    "/opt/scalper-node22/bin/node",
                    "--import",
                    "tsx",
                    "scripts/export-fast-exits.ts",
                    RELEASE,
                    iso(begin),
                    iso(end),
                ],
                cwd=ROOT,
                capture_output=True,
                timeout=60,
                check=False,
            )
            if exported.returncode != 0 or len(exported.stdout) > 8_000_000:
                raise ValueError("READ_ONLY_EXPORT_FAILED")
            payload = json.loads(exported.stdout)
            if window(payload) != (begin, end):
                raise ValueError("EXPORT_WINDOW_MISMATCH")
            data = load_tape(recordings[0], begin, end, tuple(recordings[1:]))
            report = compare(payload, data)
            if fingerprint() != before:
                raise ValueError("SOURCE_DRIFT")
            report.update(
                {
                    "evidence_kind": "PROSPECTIVE_CONDITIONAL",
                    "source_sha256": before,
                    "registration_sha256": digest(study),
                    "input_sha256": digest(payload),
                    "input": payload,
                }
            )
            publish(output, {"body": report, "sha256": digest(report)})
            return "RECORDED_HOLD"
    return "BATCH_COMPLETE_HOLD"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    reg = sub.add_parser("register")
    reg.add_argument("--start", required=True)
    reg.add_argument("--output", type=Path, required=True)
    run = sub.add_parser("report")
    run.add_argument("--input", type=Path, required=True)
    run.add_argument("--recordings", type=Path, nargs="+", required=True)
    run.add_argument("--output", type=Path, required=True)
    kind = run.add_mutually_exclusive_group(required=True)
    kind.add_argument("--registration", type=Path)
    kind.add_argument("--exploratory", action="store_true")
    collection = sub.add_parser("collect")
    collection.add_argument("--directory", type=Path, required=True)
    collection.add_argument("--recordings", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    try:
        if args.command == "collect":
            print(collect(args.directory, args.recordings, now_ms()))
            return
        if args.command == "register":
            publish(args.output, register(timestamp(args.start), now_ms()))
            print("REGISTERED_RESEARCH_ONLY")
            return
        payload = read_json(args.input, 8_000_000)
        start, end = window(payload)
        if end > now_ms():
            raise ValueError("FUTURE_OUTCOMES_UNAVAILABLE")
        study = read_json(args.registration) if args.registration else None
        if study is not None:
            validate_registration(study, start, end, now_ms())
        before = fingerprint()
        tape = load_tape(args.recordings[0], start, end, tuple(args.recordings[1:]))
        result = compare(payload, tape)
        if before != fingerprint():
            raise ValueError("SOURCE_DRIFT")
        result.update(
            {
                "evidence_kind": "PROSPECTIVE_CONDITIONAL"
                if study
                else "EXPLORATORY_NOT_VALIDATION",
                "source_sha256": before,
                "input_sha256": digest(payload),
                "registration_sha256": digest(study) if study else None,
            }
        )
        publish(args.output, result)
        print(json.dumps({"decision": "HOLD", "input_setups": result["input_setups"]}))
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        raise SystemExit("FAST_EXIT_RESEARCH_FAILED: invalid or unavailable evidence") from None


if __name__ == "__main__":
    main()
