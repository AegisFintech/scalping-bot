"""Fixed-method tc01 coordinator and forced-command tc02 mailbox; no provider calls."""

from __future__ import annotations

import argparse
import json
import os
import re
import resource
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from python.research.codex_loop import timestamp
from python.research.experiment_execution import (
    MAX_RECEIPT,
    MAX_REQUEST,
    Mailbox,
    provisioned,
    reconcile,
    request,
    verify_source,
)
from python.research.experiment_registry import Registration, Registry, read
from python.research.learning_archive import durable_json, unique
from python.research.learning_evidence import encoded
from python.research.source_verifier import MirrorTrust


def transfer(payload: dict[str, Any]) -> dict[str, Any]:
    raw = encoded(payload)
    if len(raw) > MAX_REQUEST + 1024:
        raise ValueError("RESEARCH_TRANSFER_REQUEST_LIMIT")

    def limit() -> None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_RECEIPT + 1, MAX_RECEIPT + 1))

    with tempfile.TemporaryFile() as output:
        subprocess.run(
            ["ssh", "-F", str(Path.home() / ".ssh/experiments.conf"), "scalper-experiments"],
            input=raw,
            stdout=output,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=True,
            preexec_fn=limit,
            close_fds=True,
            env={"HOME": str(Path.home()), "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
        )
        output.seek(0)
        response = output.read(MAX_RECEIPT + 1)
    if len(response) > MAX_RECEIPT:
        raise ValueError("RESEARCH_TRANSFER_RESPONSE_LIMIT")
    return dict(json.loads(response, object_pairs_hook=unique))


def cycle(root: Path, agenda: Path, config: Path) -> dict[str, Any]:
    import fcntl

    approved = provisioned(config)
    registry = Registry(root)
    lock = root / "coordinator.lock"
    if lock.is_symlink():
        raise ValueError("RESEARCH_COORDINATOR_PATH")
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        policy = read(config)
        mirror = MirrorTrust(
            **{**policy["mirror"], "directory": Path(policy["mirror"]["directory"])}
        )
        verify_source(approved, mirror)
        now = datetime.now(UTC)
        agenda_status = read(agenda / "status.json")
        plan = agenda_status.get("planId", "")
        admission_blocker = None
        fresh = (
            agenda_status.get("lastCompletedWindow") is not None
            and now - timedelta(hours=1) <= timestamp(agenda_status["lastCompletedWindow"]) <= now
        )
        if fresh and re.fullmatch(r"[a-f0-9]{64}", plan) and agenda_status["status"] == "CLOSED":
            # No provider request or synthetic finding: register from the real completed review.
            try:
                registry.register(agenda / plan, approved.method(), approved.files, now)
            except (OSError, ValueError, KeyError, TypeError) as error:
                admission_blocker = (
                    "RESEARCH_REGISTRY_TRIAL_BUDGET"
                    if isinstance(error, ValueError)
                    and str(error) == "RESEARCH_REGISTRY_TRIAL_BUDGET"
                    else "RESEARCH_NEW_REGISTRATION_FAILED"
                )
        jobs: list[Registration] = []
        for path in sorted(root.glob("*/*/registration.json")):
            if (path.parent / "experiment-closed.json").exists():
                continue
            _, reg = registry.load(path.parent.parent.name, path.parent.name)
            jobs.append(reg)
        # Unknown jobs remain visible; a rotating cursor prevents them starving new work.
        state_path = root / "health.json"
        previous = read(state_path) if state_path.exists() else {}
        cursor = int(previous.get("cursor", 0)) % max(1, len(jobs))
        ordered = jobs[cursor:] + jobs[:cursor]
        selected = ordered[:4]
        outcomes = []
        for reg in selected:
            claim = registry.claim(reg.questionId, reg.trialId, datetime.now(UTC))
            try:
                payload = (
                    {"action": "submit", "request": request(registry, reg, approved)}
                    if claim is not None
                    else {"action": "query", "trialId": reg.trialId}
                )
                result = transfer(payload)
                status = reconcile(registry, reg, approved, result)
            except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
                status = "TRANSFER_OR_RESULT_UNKNOWN"  # Keep claim; next cycle queries only.
            outcomes.append({"trialId": reg.trialId, "status": status})
        result = {
            "checkedAt": datetime.now(UTC).isoformat(),
            "status": "CHECKED" if fresh else "STALE_OBSERVATION",
            "observationWindow": agenda_status.get("lastCompletedWindow"),
            "admissionBlocker": admission_blocker,
            "pendingAtStart": len(jobs),
            "cursor": cursor + len(selected),
            "recent": outcomes,
            "sourceCommit": approved.source_commit,
            "brokerAuthority": False,
            "promotionAuthority": False,
            "generatedExperimentsEnabled": False,
        }
        durable_json(state_path, result)
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["receive", "work", "coordinate"])
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--agenda", type=Path)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise ValueError("RESEARCH_DEDICATED_USER_REQUIRED")
    if args.action == "coordinate":
        if args.agenda is None:
            raise ValueError("RESEARCH_AGENDA_REQUIRED")
        result = cycle(args.root, args.agenda, args.config)
    else:
        approved = provisioned(args.config)
        mailbox = Mailbox(args.root)
        if args.action == "work":
            result = mailbox.execute_one(approved)
        else:
            # sshd forces this executable; client-supplied SSH commands have no authority.
            raw = sys.stdin.buffer.read(MAX_REQUEST + 1025)
            if len(raw) > MAX_REQUEST + 1024:
                raise ValueError("RESEARCH_TRANSFER_LIMIT")
            value = json.loads(raw, object_pairs_hook=unique)
            if value.get("action") == "submit" and set(value) == {"action", "request"}:
                result = mailbox.submit(encoded(value["request"]), approved)
            elif value.get("action") == "query" and set(value) == {"action", "trialId"}:
                result = mailbox.query(value["trialId"])
            else:
                raise ValueError("RESEARCH_TRANSFER_ACTION")
    print(encoded(result).decode())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("RESEARCH_EXPERIMENT_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
