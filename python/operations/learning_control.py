"""Fixed research resource receiver and quota meter, without execution credentials."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.codex_entry.memory import Rpc, server_command
from python.learning import governor
from python.learning.budget import Policy
from python.research.learning_archive import atomic_bytes, bounded, unique


def meter() -> dict[str, Any]:
    work = Path.home() / "control-meter"
    work.mkdir(mode=0o700, exist_ok=True)
    process = subprocess.Popen(
        server_command("gpt-6.1-sol"),
        cwd=work,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=0,
        start_new_session=True,
        env={"HOME": str(Path.home()), "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"},
    )
    rpc = Rpc(process, time.monotonic() + 30)
    try:
        rpc.request(
            "initialize", {"clientInfo": {"name": "learning_usage_meter", "version": "1.0.0"}}
        )
        rpc.send({"method": "initialized"})
        data = rpc.request("account/rateLimits/read", {})
        windows: list[dict[str, Any]] = []
        limits = data.get("rateLimits", {})
        for name in ("primary", "secondary"):
            item = limits.get(name)
            if not isinstance(item, dict):
                continue
            used = item.get("usedPercent")
            if not isinstance(used, (int, float)) or isinstance(used, bool) or not 0 <= used <= 100:
                continue
            windows.append(
                {
                    "window": name,
                    "usedPercent": used,
                    "resetsAt": item.get("resetsAt") if type(item.get("resetsAt")) is int else None,
                }
            )
        return {
            "checkedAt": datetime.now(UTC).isoformat(),
            "remainingPercent": min(100 - w["usedPercent"] for w in windows) if windows else None,
            "windows": windows,
            "status": "AVAILABLE" if windows else "UNAVAILABLE",
        }
    finally:
        rpc.close()


def status() -> dict[str, Any]:
    budget = governor.configured()
    if budget is None:
        raise ValueError("LEARNING_NOT_ENABLED")
    result = budget.snapshot()
    try:
        result["quota"] = json.loads(bounded(budget.path.parent / "quota.json", 8192))
    except (OSError, ValueError):
        result["quota"] = None
    result["model"] = "gpt-6.1-sol"
    result["contextPolicy"] = "bounded-turns-v2"
    result["unit"] = "reported_tokens_including_cache"
    result["usageTotals"] = None
    keys = (
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "reasoningOutputTokens",
        "totalTokens",
    )
    totals = dict.fromkeys(keys, 0)
    receipts: list[Path] = []
    for pattern in (
        "holding464/attempts/*/token-usage.json",
        "source-reviews465/*/token-usage.json",
        "archive/*/current-observation-agenda/*/token-usage.json",
    ):
        receipts.extend(Path.home().glob(pattern))
    observed = 0
    for path in sorted(receipts, key=lambda p: p.stat().st_mtime_ns, reverse=True)[:2000]:
        if datetime.fromtimestamp(path.stat().st_mtime, UTC).date() != datetime.now(UTC).date():
            continue
        try:
            value = json.loads(bounded(path, 8192))
            usage = value.get("tokens")
            if isinstance(usage, dict) and all(
                type(usage.get(k)) is int and usage[k] >= 0 for k in keys
            ):
                for k in keys:
                    totals[k] += usage[k]
                observed += 1
        except (OSError, ValueError):
            pass
    if observed:
        result["usageTotals"] = {
            **totals,
            "knownReceipts": observed,
            "maximumReceiptsScanned": 2000,
        }
    result["tasks"] = []
    for role, root in [
        ("generation", Path.home() / "holding464"),
        ("review", Path.home() / "source-reviews465"),
    ]:
        paths = list(root.glob("*/request.json" if role == "generation" else "*/binding.json"))
        if not paths:
            continue
        path = max(paths, key=lambda p: p.stat().st_mtime_ns)
        receipt = path.parent / ("receipt.json" if role == "generation" else "review.json")
        task = {
            "role": role,
            "status": "QUEUED_OR_UNKNOWN",
            "updatedAt": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
        }
        if receipt.exists():
            r = json.loads(bounded(receipt, 17 * 1024 * 1024))
            task["status"] = r.get("status", r.get("decision", "UNKNOWN"))
        if not receipt.exists():
            waiting = path.parent / "waiting-status.json"
            if waiting.exists():
                task["status"] = json.loads(bounded(waiting, 32768))["status"]
            waits = list(path.parent.glob("**/learning-admission.json"))
            if waits:
                last = max(waits, key=lambda p: p.stat().st_mtime_ns)
                admission = json.loads(bounded(last, 8192))
                task["admission"] = admission
                if admission.get("status", "").startswith("WAITING_"):
                    task["status"] = admission["status"]
        result["tasks"].append(task)
    agenda = Path.home() / "archive" / "scalper-epoch314" / "current-observation-agenda"
    try:
        observation = json.loads(bounded(agenda / "status.json", 32768))
        result["observation"] = {
            k: observation.get(k)
            for k in ("status", "blocker", "scheduledNextReviewAt", "lastCompletedWindow")
        }
    except (OSError, ValueError):
        result["observation"] = None
    try:
        review = json.loads(bounded(Path("/var/lib/scalper-review-observation/status.json"), 65536))
        rows = [*review.get("recent", []), review.get("lastTerminal")]
        result["publications"] = [
            {k: r.get(k) for k in ("pullRequest", "status", "reason", "headCommit", "mergeCommit")}
            for r in rows
            if isinstance(r, dict) and type(r.get("pullRequest")) is int
        ][:5]
    except (OSError, ValueError):
        result["publications"] = []
    paths = list(agenda.glob("*/finding.json"))
    if paths:
        path = max(paths, key=lambda p: p.stat().st_mtime_ns)
        finding = json.loads(bounded(path, 32768))
        result["findingRecordedAt"] = finding.get("recordedAt")
        plan = json.loads(bounded(path.parent / "plan.json", 32768))
        result["findingWindow"] = {k: plan.get(k) for k in ("start", "until")}
        result["finding"] = {
            k: v
            for k, v in finding.get("interpretation", {}).items()
            if k
            in (
                "summary",
                "limitations",
                "nextTopic",
                "nextQuestion",
                "requiredEvidence",
                "falsificationTest",
            )
        }
    else:
        result["finding"] = None
    return result


def receive(value: dict[str, Any]) -> dict[str, Any]:
    if set(value) - {"action", "policy"}:
        raise ValueError("LEARNING_CONTROL_FIELDS")
    if value.get("action") == "status":
        return status()
    if value.get("action") != "update":
        raise ValueError("LEARNING_CONTROL_ACTION")
    policy = Policy.model_validate(value.get("policy"))
    if "sk-" in policy.guidance or "PRIVATE KEY" in policy.guidance:
        raise ValueError("LEARNING_GUIDANCE_SECRET")
    budget = governor.configured()
    if budget is None:
        raise ValueError("LEARNING_NOT_ENABLED")
    budget.update(policy)
    return status()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["receive", "meter"])
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise ValueError("LEARNING_DEDICATED_USER_REQUIRED")
    if args.action == "meter":
        budget = governor.configured()
        if budget is None:
            raise ValueError("LEARNING_NOT_ENABLED")
        try:
            report = meter()
        except Exception:
            report = {
                "checkedAt": datetime.now(UTC).isoformat(),
                "remainingPercent": None,
                "status": "UNAVAILABLE",
            }
        atomic_bytes(budget.path.parent / "quota.json", json.dumps(report).encode(), replace=True)
        print("LEARNING_QUOTA_RECORDED")
        return
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise ValueError("LEARNING_CONTROL_OVERSIZED")
    result = receive(json.loads(raw, object_pairs_hook=unique))
    data = json.dumps(result).encode()
    if len(data) > 65536:
        raise ValueError("LEARNING_STATUS_OVERSIZED")
    print(data.decode())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("LEARNING_CONTROL_UNAVAILABLE") from None
