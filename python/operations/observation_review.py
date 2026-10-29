"""Fixed read-only evidence feed and restricted-SSH research intake."""

from __future__ import annotations

import argparse
import os
import resource
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from python.research.learning_archive import atomic_bytes, durable_json
from python.research.learning_evidence import MAX_BYTES, encoded
from python.research.observation_cycle import run, safe_reason


def feed(destination: Path, now: datetime) -> None:
    import psycopg
    from psycopg.rows import dict_row

    from python.operations.export_learning_evidence import export

    # Closed half-hour windows; delays never backdate the repeatable-read snapshot.
    until = now.replace(minute=(now.minute // 30) * 30, second=0, microsecond=0)
    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=10000",
    ) as connection:
        packet = export(
            connection,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            "scalper-epoch314",
            until - timedelta(minutes=30),
            until,
            flight_directory=Path("/var/lib/scalper-flight/recordings"),
        )
    atomic_bytes(destination, encoded(packet.model_dump()), replace=True)
    destination.chmod(0o640)


def limit_transfer_file() -> None:
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES + 1, MAX_BYTES + 1))


def fetch() -> bytes:
    # The SSH key's server-side forced command can only read the sanitized feed.
    # This single-threaded CLI caps the SSH child output file before exec.
    with tempfile.TemporaryFile() as output:
        subprocess.run(
            ["ssh", "-F", str(Path.home() / ".ssh/config"), "scalper-evidence"],
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,
            preexec_fn=limit_transfer_file,
            env={"HOME": str(Path.home()), "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
        )
        output.seek(0)
        raw = output.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("RESEARCH_FEED_OVERSIZED")
    return raw


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["feed", "review"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise ValueError("RESEARCH_DEDICATED_USER_REQUIRED")
    now = datetime.now(UTC)
    if args.action == "feed":
        feed(args.path, now)
        print("RESEARCH_FEED_EXPORTED")
        return
    try:
        raw = fetch()
        status = run(args.path, raw, "scalper-epoch314", datetime.now(UTC))
        durable_json(
            Path.home() / "health.json", {"checkedAt": datetime.now(UTC).isoformat(), **status}
        )
        print(status["status"])
        if status["status"] not in {"CLOSED", "REVIEW_COOLDOWN"}:
            raise SystemExit(1)
    except Exception as error:
        reason = (
            "RESEARCH_TRANSFER_FAILED"
            if isinstance(error, subprocess.SubprocessError)
            else safe_reason(error)
        )
        durable_json(
            Path.home() / "health.json",
            {
                "checkedAt": datetime.now(UTC).isoformat(),
                "status": "RESEARCH_INTAKE_FAILED",
                "blocker": reason,
                "lastCompleted": "See durable archive agenda/status.json; never inferred zero",
            },
        )
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("RESEARCH_REVIEW_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
