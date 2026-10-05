"""Prospectively registered, read-only daily research; never a trading controller."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any, TypedDict, cast

from python.backtest.paired import compare, input_window, load_tape
from python.evaluation.engine import timestamp

DAY = 86_400_000
DAYS = 30
SETTLE = 600_000
RELEASE = "0.3.0-fade-limit.3"
CANDIDATES = ["approved_entries", "model_levels", "tp_original", "tp_0_75", "tp_1_25"]
ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    "python/backtest/forward.py",
    "python/backtest/paired.py",
    "python/evaluation/engine.py",
    "scripts/export-paired-replay.ts",
    "scripts/review-demo-learning.ts",
    "packages/evaluation/src/demo-learning.ts",
    "packages/evaluation/src/paired-input.ts",
    "packages/risk-engine/src/decimal.ts",
    "packages/config/src/policy.ts",
    "prompts/entry-pair-v4.md",
    "schemas/forward-study-1.0.json",
    "schemas/forward-daily-1.0.json",
    "schemas/paired-replay-input-1.0.json",
    "package-lock.json",
    "requirements.lock",
)


class Study(TypedDict):
    label: str
    registered_at: str
    start: str
    until: str
    release: str
    days: int
    window_ms: int
    settlement_delay_ms: int
    candidates: list[str]
    source_sha256: str
    decision: str
    broker_authority: bool


DailyReport = TypedDict(
    "DailyReport",
    {
        "label": str,
        "study_sha256": str,
        "window_index": int,
        "from": str,
        "until": str,
        "observed_at": str,
        "elapsed_ms": int,
        "decision": str,
        "broker_authority": bool,
        "production_changed": bool,
        "counterfactual_net_pnl": None,
        "limitations": list[str],
        "evidence": dict[str, Any],
    },
)


def iso(ms: int) -> str:
    return (
        datetime.fromtimestamp(ms / 1000, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def encoded(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), default=str) + "\n").encode()


def digest(value: object) -> str:
    return hashlib.sha256(encoded(value)).hexdigest()


def fingerprint(root: Path = ROOT) -> str:
    return digest(
        {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in SOURCES}
    )


def read_json(path: Path, limit: int = 32_000_000) -> dict[str, Any]:
    if path.is_symlink() or path.stat().st_size > limit:
        raise ValueError("FORWARD_FILE_INVALID")
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError("FORWARD_FILE_INVALID")
    return value


def publish(path: Path, value: object) -> None:
    """Flush a private complete file, then link exclusively; never replace evidence."""
    raw = encoded(value)
    if len(raw) > 32_000_000:
        raise ValueError("FORWARD_OUTPUT_TOO_LARGE")
    fd, temporary = tempfile.mkstemp(prefix=".forward-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        os.unlink(temporary)


def validate_study(value: dict[str, Any], source_hash: str) -> Study:
    if set(value) != set(Study.__annotations__):
        raise ValueError("FORWARD_CONTRACT_INVALID")
    if (
        value["label"] != "PROSPECTIVE_CONDITIONAL_STUDY_V1"
        or value["release"] != RELEASE
        or type(value["days"]) is not int
        or value["days"] != DAYS
        or type(value["window_ms"]) is not int
        or value["window_ms"] != DAY
        or type(value["settlement_delay_ms"]) is not int
        or value["settlement_delay_ms"] != SETTLE
        or value["candidates"] != CANDIDATES
        or value["decision"] != "HOLD"
        or value["broker_authority"] is not False
    ):
        raise ValueError("FORWARD_CONTRACT_INVALID")
    for key in ("registered_at", "start", "until"):
        if not isinstance(value[key], str) or iso(timestamp(value[key])) != value[key]:
            raise ValueError("FORWARD_TIME_INVALID")
    registered, start, end = (timestamp(value[k]) for k in ("registered_at", "start", "until"))
    if not 0 < start - registered <= DAY or end - start != DAYS * DAY:
        raise ValueError("FORWARD_NOT_PROSPECTIVE")
    if (
        not isinstance(value["source_sha256"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", value["source_sha256"])
        or value["source_sha256"] != source_hash
    ):
        raise ValueError("FORWARD_SOURCE_DRIFT")
    return cast(Study, value)


def register(directory: Path, start: int, now: int, source_hash: str) -> Study:
    study: Study = {
        "label": "PROSPECTIVE_CONDITIONAL_STUDY_V1",
        "registered_at": iso(now),
        "start": iso(start),
        "until": iso(start + DAYS * DAY),
        "release": RELEASE,
        "days": DAYS,
        "window_ms": DAY,
        "settlement_delay_ms": SETTLE,
        "candidates": CANDIDATES.copy(),
        "source_sha256": source_hash,
        "decision": "HOLD",
        "broker_authority": False,
    }
    validate_study(dict(study), source_hash)
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    publish(directory / "study.json", study)
    return study


def export_json(script: str, start: str, end: str, node: Path) -> dict[str, Any]:
    """Offline file contract, not analytics service IPC. No shell or broker client."""
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            result = subprocess.run(
                [str(node), "node_modules/tsx/dist/cli.mjs", script, RELEASE, start, end],
                cwd=ROOT,
                stdout=output,
                stderr=errors,
                timeout=60,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise ValueError("FORWARD_EXPORT_TIMEOUT") from None
        if result.returncode:
            errors.seek(0)
            code = errors.read(1024).decode("utf-8", errors="replace").strip().split(":")[0]
            if not re.fullmatch(r"(?:PAIRED|LEARNING)_[A-Z_]{1,80}", code):
                code = "EXPORT_FAILED"
            raise ValueError("FORWARD_" + code)
        output.seek(0)
        raw = output.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("FORWARD_EXPORT_TOO_LARGE")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("FORWARD_EXPORT_INVALID")
    return value


def collect(start: str, end: str, node: Path) -> dict[str, Any]:
    # Separate read-only snapshots; not claimed to be one atomic database snapshot.
    payload = export_json("scripts/export-paired-replay.ts", start, end, node)
    actual = export_json("scripts/review-demo-learning.ts", start, end, node)
    if (
        input_window(payload) != (timestamp(start), timestamp(end))
        or payload["release"] != RELEASE
        or actual.get("reportVersion") != "demo-learning-1.0"
        or actual.get("from") != start
        or actual.get("until") != end
        or actual.get("strategyVersion") != RELEASE
        or actual.get("label") != "OBSERVED_DEMO_NOT_BACKTEST_OR_PROFITABILITY_EVIDENCE"
    ):
        raise ValueError("FORWARD_EXPORT_MISMATCH")
    tape = load_tape(
        ROOT / ".runtime/market-data",
        timestamp(start),
        timestamp(end),
        (ROOT / ".runtime/market-evidence",),
    )
    replay = compare(payload, tape)
    return {"input": payload, "actual_closed_trades": actual, "conditional_replay": replay}


def verified_report(path: Path, study: Study, index: int) -> dict[str, Any]:
    envelope = read_json(path)
    body = envelope.get("body")
    if (
        set(envelope) != {"body", "sha256"}
        or not isinstance(body, dict)
        or set(body) != set(DailyReport.__annotations__)
        or body.get("label") != "PROSPECTIVE_CONDITIONAL_DAILY_V1"
        or envelope["sha256"] != digest(body)
        or body.get("study_sha256") != digest(study)
        or body.get("window_index") != index
        or body.get("from") != iso(timestamp(study["start"]) + index * DAY)
        or body.get("until") != iso(timestamp(study["start"]) + (index + 1) * DAY)
        or body.get("decision") != "HOLD"
        or body.get("broker_authority") is not False
        or body.get("production_changed") is not False
        or body.get("counterfactual_net_pnl") is not None
    ):
        raise ValueError("FORWARD_REPORT_INVALID")
    return body


def run_once(
    directory: Path,
    now: int,
    source_hash: str,
    collector: Callable[[str, str], dict[str, Any]],
) -> dict[str, Any]:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("FORWARD_DIRECTORY_INVALID")
    # Kernel releases this lock on crash. Timer and manual invocations cannot overlap.
    fd = os.open(directory / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "ALREADY_RUNNING", "decision": "HOLD"}
        study = validate_study(read_json(directory / "study.json", 16_384), source_hash)
        start = timestamp(study["start"])
        if now < timestamp(study["registered_at"]):
            raise ValueError("FORWARD_CLOCK_REGRESSED")
        done = 0
        for index in range(DAYS):
            output = directory / f"day-{index + 1:02d}.json"
            end = start + (index + 1) * DAY
            if output.exists() or output.is_symlink():
                verified_report(output, study, index)
                if now < end + SETTLE:
                    raise ValueError("FORWARD_PREMATURE_REPORT")
                done += 1
                continue
            if now < end + SETTLE:
                return {
                    "status": "WAITING_FOR_WINDOW",
                    "completed_windows": done,
                    "next_report_not_before": iso(end + SETTLE),
                    "decision": "HOLD",
                }
            disk = shutil.disk_usage(directory)
            if disk.free < max(2 * 1024**3, disk.total * 0.15):
                raise ValueError("FORWARD_DISK_RESERVE")
            began = perf_counter()
            evidence = collector(iso(end - DAY), iso(end))
            body: DailyReport = {
                "label": "PROSPECTIVE_CONDITIONAL_DAILY_V1",
                "study_sha256": digest(study),
                "window_index": index,
                "from": iso(end - DAY),
                "until": iso(end),
                "observed_at": iso(now_ms()),
                "elapsed_ms": int((perf_counter() - began) * 1000),
                "decision": "HOLD",
                "broker_authority": False,
                "production_changed": False,
                "counterfactual_net_pnl": None,
                "limitations": [
                    "DAILY_PATH_CUTOFF_CENSORS_CARRY_NOT_A_FORCED_TRADE_EXIT",
                    "LATE_JOURNAL_EVIDENCE_AFTER_EXPORT_NOT_INCLUDED",
                    "ACTUAL_CLOSE_COHORT_DIFFERS_FROM_INTENT_CREATION_COHORT",
                    "THIRTY_DAYS_IS_COLLECTION_WINDOW_NOT_STRATEGY_VALIDATION",
                    "FIXED_RELEASE_ONLY_OTHER_RELEASES_NOT_COMBINED",
                ],
                "evidence": evidence,
            }
            publish(output, {"body": body, "sha256": digest(body)})
            return {"status": "REPORT_WRITTEN", "completed_windows": done + 1, "decision": "HOLD"}
        return {
            "status": "COLLECTION_COMPLETE_NOT_QUALIFIED",
            "completed_windows": done,
            "decision": "HOLD",
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("register", "run"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--start", help="Canonical future UTC timestamp, registration only")
    parser.add_argument("--node", type=Path, default=Path("/opt/scalper-node22/bin/node"))
    args = parser.parse_args()
    try:
        source_hash = fingerprint()
        now = now_ms()
        if args.action == "register":
            if args.start is None:
                raise ValueError("FORWARD_START_REQUIRED")
            study = register(args.directory, timestamp(args.start), now, source_hash)
            print(
                json.dumps(
                    {
                        "status": "REGISTERED",
                        "start": study["start"],
                        "until": study["until"],
                        "decision": "HOLD",
                    }
                )
            )
        else:
            if args.start is not None or not args.node.is_absolute():
                raise ValueError("FORWARD_ARGUMENT_INVALID")

            def pinned_collect(start: str, end: str) -> dict[str, Any]:
                evidence = collect(start, end, args.node)
                if fingerprint() != source_hash:
                    raise ValueError("FORWARD_SOURCE_DRIFT")
                return evidence

            result = run_once(args.directory, now, source_hash, pinned_collect)
            print(json.dumps(result))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error)
        if not re.fullmatch(r"FORWARD_[A-Z_]+", code):
            code = "FORWARD_RESEARCH_FAILED"
        raise SystemExit(code) from None


if __name__ == "__main__":
    main()
