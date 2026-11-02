"""Bounded future-window range observer. Separate read-only role, no model calls."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.rows import dict_row

from python.backtest.fill_gap_review import chains
from python.operations.export_broker_acknowledgements import export as acknowledgements
from python.operations.export_learning_evidence import export
from python.research.codex_loop import timestamp
from python.research.entry_range_study import (
    RELEASE,
    PointReceipt,
    RangeReport,
    Registration,
    point_receipt,
    review,
)
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import bounded, immutable, unique
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha

MAX_BYTES = 8 * 1024**2


def registration(path: Path, source: Path) -> tuple[Registration, str]:
    trusted_path(path)
    raw = bounded(path, 32768)
    frozen = Registration.model_validate_json(raw)
    if any(sha((source / p).read_bytes()) != digest for p, digest in frozen.sourceFiles.items()):
        raise ValueError("RANGE_SOURCE_DRIFT")
    return frozen, sha(raw)


def retained(path: Path, value: Any) -> None:
    if len(encoded(value)) > MAX_BYTES:
        raise ValueError("RANGE_INPUT_BYTE_LIMIT")
    immutable(path, value)
    path.chmod(0o400)


def capture(directory: Path, now: datetime, client: httpx.Client) -> None:
    started = datetime.now(UTC)
    response = client.post("http://127.0.0.1:8081/v1/session", json={"symbol": "XAUUSD"})
    response.raise_for_status()
    if len(response.content) > 128000:
        raise ValueError("RANGE_METADATA_BYTE_LIMIT")
    receipt = point_receipt(response.json()["metadata"], "XAUUSD", started, datetime.now(UTC))
    name = "point-" + now.strftime("%Y%m%dT%H%M%S%f") + ".json"
    retained(directory / name, receipt.model_dump())


def receipts(directory: Path, start: datetime, until: datetime) -> list[dict[str, Any]]:
    values = []
    for day in sorted({(start - timedelta(seconds=30)).date(), until.date()}):
        paths = sorted(directory.glob("point-" + day.strftime("%Y%m%d") + "T*.json"))
        if len(paths) > 4000:
            raise ValueError("RANGE_METADATA_CAPACITY")
        for path in paths:
            at = datetime.strptime(path.name[6:-5], "%Y%m%dT%H%M%S%f").replace(tzinfo=UTC)
            if start - timedelta(seconds=30) <= at < until:
                value = PointReceipt.model_validate_json(bounded(path, 32768))
                if (
                    start - timedelta(seconds=30)
                    <= timestamp(value.metadata.responseReceivedAt)
                    < until
                ):
                    values.append(value.model_dump())
    return values


def next_window(
    frozen: Registration, output: Path, now: datetime, digest: str
) -> tuple[datetime, datetime] | None:
    start, end = timestamp(frozen.start), timestamp(frozen.until)
    limit = min(end, (now - timedelta(minutes=5)).replace(minute=0, second=0, microsecond=0))
    while start + timedelta(hours=1) <= limit:
        path = output / ("hour-" + start.strftime("%Y%m%dT%H%M") + ".json")
        if not path.exists():
            return start, start + timedelta(hours=1)
        report = RangeReport.model_validate_json(bounded(path, MAX_BYTES))
        if (timestamp(report.start), timestamp(report.until)) != (
            start,
            start + timedelta(hours=1),
        ):
            raise ValueError("RANGE_RETAINED_WINDOW_CONFLICT")
        raw_input = bounded(path.with_name(path.stem + ".input.json"), MAX_BYTES)
        if report.registrationSha256 != digest or report.inputSha256 != sha(raw_input):
            raise ValueError("RANGE_RETAINED_BINDING_CONFLICT")
        start += timedelta(hours=1)
    return None


def collect(
    output: Path, points: Path, recordings: Path, frozen: Registration, digest: str, now: datetime
) -> str:
    window = next_window(frozen, output, now, digest)
    if window is None:
        return "WAITING_FOR_FUTURE_COMPLETED_WINDOW_OR_COLLECTION_COMPLETE"
    start, until = window
    base = "hour-" + start.strftime("%Y%m%dT%H%M")
    input_path = output / (base + ".input.json")
    if input_path.exists():
        inputs = json.loads(bounded(input_path, MAX_BYTES), object_pairs_hook=unique)
    else:
        with psycopg.connect(
            os.environ["DATABASE_URL"],
            autocommit=True,
            row_factory=dict_row,
            options="-c default_transaction_read_only=on -c statement_timeout=10000",
        ) as db:
            account = os.environ["ACCOUNT_KEY_HASH"]
            packet = export(db, account, "XAUUSD", "entry-range499", start, until)
            ack = acknowledgements(db, account, "XAUUSD", "entry-range499", start, until)
        paths = {}
        budget = 0
        for setup in packet.setups:
            try:
                records = chains(recordings, setup.id)
                status = "VERIFIED_SAMPLED_PREFIX" if records else "UNAVAILABLE"
            except (OSError, ValueError, KeyError, TypeError):
                records, status = [], "UNAVAILABLE"
            budget += len(encoded(records))
            if budget > 6 * 1024**2:
                raise ValueError("RANGE_PATH_BYTE_LIMIT")
            paths[setup.id] = {"records": records, "status": status}
        inputs = {
            "journal": packet.model_dump(),
            "acknowledgements": ack.model_dump(),
            "pointReceipts": receipts(points, start, until),
            "flight": paths,
        }
        review(inputs, frozen, digest)
        retained(input_path, inputs)
    result = review(inputs, frozen, digest)
    if (timestamp(result.start), timestamp(result.until)) != (start, until):
        raise ValueError("RANGE_RETRY_WINDOW_CONFLICT")
    retained(output / (base + ".json"), result.model_dump())
    return "RETAINED_READ_ONLY_WINDOW"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("capture", "collect"))
    parser.add_argument("--registration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--recordings", type=Path, default=Path("/var/lib/scalper-flight/recordings")
    )
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise ValueError("RANGE_DEDICATED_USER_REQUIRED")
    frozen, digest = registration(args.registration, Path(__file__).resolve().parents[2])
    now = datetime.now(UTC)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    points = args.output / "points"
    points.mkdir(mode=0o700, exist_ok=True)
    paths = list(args.output.rglob("*"))
    if (
        len(paths) > 50000
        or sum(p.stat().st_size for p in paths if p.is_file()) > 256 * 1024**2
        or shutil.disk_usage(args.output).free < 2 * 1024**3
    ):
        raise ValueError("RANGE_STORAGE_RESERVE")
    if not timestamp(frozen.registeredAt) <= now < timestamp(frozen.until) + timedelta(hours=2):
        print("OUTSIDE_REGISTERED_COLLECTION")
        return
    with (args.output / (args.action + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with httpx.Client(timeout=10, trust_env=False) as client:
            response = client.get("http://127.0.0.1:8080/v1/status")
            response.raise_for_status()
            if len(response.content) > 2 * 1024**2:
                raise ValueError("RANGE_STATUS_BYTE_LIMIT")
            status = response.json()
            if status.get("strategyVersion") != RELEASE or status.get("mode") != "demo":
                raise ValueError("RANGE_ACTIVE_RELEASE_DRIFT")
            if args.action == "capture":
                if now < timestamp(frozen.until):
                    capture(points, now, client)
                    print("READ_ONLY_POINT_RECEIPT")
                else:
                    print("POINT_COLLECTION_COMPLETE")
            else:
                print(collect(args.output, points, args.recordings, frozen, digest, now))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        print(
            code
            if code.startswith("RANGE_") and code.replace("_", "").isalnum()
            else "RANGE_OBSERVER_DEPENDENCY_OR_EVIDENCE_FAILURE",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
