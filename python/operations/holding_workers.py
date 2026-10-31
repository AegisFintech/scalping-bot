"""Provisioned research-only receivers/workers. No signing, GitHub or broker secrets."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from python.codex_entry.memory import invoke_daily
from python.research import holding_task as task
from python.research.experiment_registry import read
from python.research.holding_mailbox import MAX_TRANSFER, Mailbox, discover
from python.research.isolated_worker import WorkerTrust, trusted_path
from python.research.learning_archive import unique
from python.research.learning_evidence import encoded
from python.research.observation_cycle import MODEL


def invoke(prompt: str, job: Path) -> bytes:
    return invoke_daily(
        prompt,
        job,
        schema=task.Draft.model_json_schema(),
        model=MODEL,
        timeout=180,
        purpose="research_code",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["receive", "work"])
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise ValueError("HOLDING_WORKER_DEDICATED_USER_REQUIRED")
    trusted_path(args.config)
    config = read(args.config)
    box = Mailbox(Path(config["root"]), config["kind"])
    result: dict[str, Any]
    if args.action == "receive":
        raw = sys.stdin.buffer.read(MAX_TRANSFER + 1)
        if len(raw) > MAX_TRANSFER:
            raise ValueError("HOLDING_RECEIVE_LIMIT")
        request = json.loads(raw, object_pairs_hook=unique)
        if set(request) == {"action", "request"} and request["action"] == "submit":
            result = box.submit(encoded(request["request"]))
        elif set(request) == {"action", "job"} and request["action"] == "query":
            result = box.query(request["job"])
        elif request == {"action": "discover"} and box.kind == "generation":
            result = discover(Path(config["experiments"]))
        else:
            raise ValueError("HOLDING_RECEIVE_ACTION")
    elif box.kind == "generation":
        result = box.work(invoke=invoke)
    else:
        worker = config["worker"]
        trust = WorkerTrust(
            **{**worker, "runtime": Path(worker["runtime"]), "verifier": Path(worker["verifier"])}
        )
        result = box.work(trust=trust, oracle=config["oracleSha256"])
    raw = encoded(result)
    if len(raw) > MAX_TRANSFER:
        raise ValueError("HOLDING_RECEIVE_OUTPUT_LIMIT")
    print(raw.decode())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("HOLDING_WORKER_FAILED_OR_UNKNOWN", file=sys.stderr)
        raise SystemExit(1) from None
