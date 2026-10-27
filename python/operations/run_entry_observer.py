"""One settled prospective daily trigger report per invocation; SELECT-only, never orders."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.rows import dict_row

from python.backtest.breakout_entry_review import (
    CANDIDATES,
    PROTOCOL,
    fingerprint,
    review,
    write_new,
)
from python.operations.entry_context import timestamp
from python.operations.export_entry_evidence import export


def run_once(directory: Path, recordings: Path, now: datetime) -> dict[str, Any]:
    if directory.is_symlink() or recordings.is_symlink():
        raise ValueError("ENTRY_OBSERVER_DIRECTORY_INVALID")
    with (directory / ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"state": "ALREADY_RUNNING"}
        raw = (directory / "registration.json").read_bytes()
        registration = json.loads(raw)
        code = fingerprint()
        start, until = timestamp(registration["from"]), timestamp(registration["until"])
        if (
            registration["protocol"] != PROTOCOL
            or registration["sourceSha256"] != code
            or registration["candidates"] != CANDIDATES
            or registration["brokerAuthority"] is not False
            or registration["promotion"] != "HOLD"
            or registration["counterfactualNet"] is not None
            or not timestamp(registration["registeredAt"]) < start
            or until != start + timedelta(days=30)
            or registration["maxQuoteGapMs"] != 3000
            or registration["cancelAmbiguityMs"] != 500
        ):
            raise ValueError("ENTRY_OBSERVER_SOURCE_OR_REGISTRATION_DRIFT")
        digest = hashlib.sha256(raw).hexdigest()
        for index in range(30):
            lower, upper = start + timedelta(days=index), start + timedelta(days=index + 1)
            output = directory / f"day-{index + 1:02d}.json"
            if output.exists():
                old = json.loads(output.read_bytes())
                if (
                    old["registrationSha256"] != digest
                    or old["sourceSha256"] != code
                    or timestamp(old["from"]) != lower
                    or timestamp(old["until"]) != upper
                    or old["brokerAuthority"] is not False
                    or old["promotion"] != "HOLD"
                    or old["counterfactualNet"] is not None
                ):
                    raise ValueError("ENTRY_OBSERVER_PRIOR_REPORT_INVALID")
                continue
            if now < upper + timedelta(minutes=10):
                return {"state": "WAITING_FOR_SETTLED_WINDOW", "nextCutoff": upper.isoformat()}
            if (
                sum(p.stat().st_size for p in directory.rglob("*") if p.is_file()) > 464 * 1024**2
                or shutil.disk_usage(directory).free < 2 * 1024**3
            ):
                raise ValueError("ENTRY_OBSERVER_STORAGE_FULL")
            response = httpx.get(
                "http://127.0.0.1:8080/v1/flight-source", timeout=5, trust_env=False
            )
            response.raise_for_status()
            live = response.json()
            if live.get("mode") != "demo" or live.get("strategyVersion") != registration["release"]:
                raise ValueError("ENTRY_OBSERVER_RUNNING_SOURCE_DRIFT")
            source = directory / f"day-{index + 1:02d}.input.json"
            if source.exists():
                bundle = json.loads(source.read_bytes())
                if (
                    bundle["release"] != registration["release"]
                    or timestamp(bundle["from"]) != lower
                    or timestamp(bundle["until"]) != upper
                ):
                    raise ValueError("ENTRY_OBSERVER_PRIOR_INPUT_INVALID")
            else:
                with psycopg.connect(
                    os.environ["DATABASE_URL"],
                    autocommit=True,
                    row_factory=dict_row,
                    options="-c default_transaction_read_only=on -c statement_timeout=15000",
                ) as connection:
                    bundle = export(
                        connection,
                        os.environ["ACCOUNT_KEY_HASH"],
                        os.environ.get("TRADING_SYMBOL", "XAUUSD"),
                        registration["release"],
                        lower,
                        upper,
                    )
                write_new(source, bundle)
            report = review(recordings, bundle, upper)
            if fingerprint() != code or (directory / "registration.json").read_bytes() != raw:
                raise ValueError("ENTRY_OBSERVER_SOURCE_OR_REGISTRATION_DRIFT")
            report["registrationSha256"] = digest
            report["prospective"] = True
            report["bundleSha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
            write_new(output, report)
            return {"state": "REPORT_WRITTEN", "window": index + 1}
        return {"state": "COLLECTION_COMPLETE_NOT_QUALIFICATION"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--recordings", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run_once(args.study, args.recordings, datetime.now(UTC))))


if __name__ == "__main__":
    main()
