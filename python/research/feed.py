"""Trusted exporter: publishes only allowlisted aggregates, never invokes Codex."""

from __future__ import annotations

import argparse
import grp
import json
import os
import signal
import stat
import subprocess
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from python.research.codex_loop import Evidence, digest, encoded, publish, timestamp
from python.research.prepare_evidence import project

RELEASE = "0.3.0-fade-limit.3"
MAX_EXPORT = 8_000_000


class EpochNotComplete(ValueError):
    """No closed UTC reporting interval exists in the new accounting epoch yet."""


def window(now: datetime, epoch_start: datetime | None = None) -> tuple[str, str]:
    if now.tzinfo is None or now.utcoffset() != timedelta(0):
        raise ValueError("RESEARCH_UTC_REQUIRED")
    end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=7)
    if epoch_start is not None:
        if epoch_start.tzinfo is None or epoch_start.utcoffset() != timedelta(0):
            raise ValueError("RESEARCH_UTC_REQUIRED")
        if epoch_start > now:
            raise ValueError("RESEARCH_EPOCH_FUTURE")
        if epoch_start >= end:
            raise EpochNotComplete("RESEARCH_EPOCH_NOT_COMPLETE")
        start = max(start, epoch_start)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z")


def collect(
    source: Path, environment_file: Path, now: datetime, epoch_start: datetime | None = None
) -> Evidence:
    start, end = window(now, epoch_start)
    command = [
        "/opt/scalper-node22/bin/node",
        str(source / "node_modules/tsx/dist/cli.mjs"),
        str(source / "scripts/review-demo-learning.ts"),
        RELEASE,
        start,
        end,
    ]
    # No inherited environment. Database/broker configuration remains in this trusted
    # export process, never the separately running Codex worker.
    environment = {
        "PATH": "/opt/scalper-node22/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "DOTENV_CONFIG_PATH": str(environment_file),
        "TSX_DISABLE_CACHE": "1",
    }
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(
            command,
            cwd=source,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise ValueError("RESEARCH_EXPORT_TIMEOUT") from None
        if process.returncode != 0:
            raise ValueError("RESEARCH_EXPORT_FAILED")
        output.seek(0)
        raw = output.read(MAX_EXPORT + 1)
    if len(raw) > MAX_EXPORT:
        raise ValueError("RESEARCH_EXPORT_TOO_LARGE")
    result = project(json.loads(raw))
    # ISO timestamps can be rendered as Z by the existing exporter.
    if result.release != RELEASE or (timestamp(result.start), timestamp(result.end)) != (
        timestamp(start),
        timestamp(end),
    ):
        raise ValueError("RESEARCH_EXPORT_WINDOW_MISMATCH")
    return result


def publish_latest(directory: Path, evidence: Evidence, group: int) -> str:
    """The inbox is root-owned outside the model user's writable home."""
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("RESEARCH_INBOX_NOT_PROTECTED")
    body = encoded(evidence.model_dump())
    checksum = digest(body)
    archive = directory / f"aggregate-{checksum}.json"
    try:
        publish(archive, evidence.model_dump())
    except FileExistsError:
        if archive.read_bytes() != body:
            raise ValueError("RESEARCH_ARCHIVE_CONFLICT") from None
    descriptor, name = tempfile.mkstemp(prefix=".latest-", dir=directory)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            os.fchown(handle.fileno(), 0, group)
            os.fchmod(handle.fileno(), 0o640)
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, directory / "latest.json")
        parent = os.open(directory, os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(name).unlink(missing_ok=True)
    return checksum


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--environment-pointer", type=Path, required=True)
    parser.add_argument("--inbox", type=Path, required=True)
    parser.add_argument(
        "--epoch-start", help="Explicit UTC start of the selected accounting database"
    )
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise ValueError("RESEARCH_TRUSTED_FEED_USER_REQUIRED")
        environment = Path(args.environment_pointer.read_text().strip())
        result = collect(
            args.source,
            environment,
            datetime.now(UTC),
            timestamp(args.epoch_start) if args.epoch_start is not None else None,
        )
        checksum = publish_latest(args.inbox, result, grp.getgrnam("scalper-research").gr_gid)
        print("RESEARCH_AGGREGATE_PUBLISHED " + checksum)
    except EpochNotComplete:
        print("RESEARCH_FEED_WAIT_NEW_EPOCH")
    except (ValueError, OSError, KeyError, TypeError):
        raise SystemExit("RESEARCH_FEED_FAILED") from None


if __name__ == "__main__":
    main()
