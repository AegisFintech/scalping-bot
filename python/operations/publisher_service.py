"""Local signed-request publisher. No provider, candidate execution, review or merge."""

from __future__ import annotations

import fcntl
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.operations import research_publisher as publisher
from python.operations.harness_health import PublisherHealth
from python.research.codex_loop import timestamp
from python.research.learning_archive import atomic_bytes, bounded, immutable
from python.research.learning_evidence import encoded

ROOT = Path("/var/lib/scalper-publisher")
QUEUE = Path("/var/lib/scalper-publisher-queue")
ARTIFACT = Path("/opt/scalper-publisher")
MAX_JOBS = 4


def review_status(number: int, head: str) -> dict[str, str]:
    """Observe prerequisites; only the separate review controller may advance a PR."""
    checks = publisher.api(f"commits/{head}/check-runs?per_page=100")
    count = checks.get("total_count")
    runs = checks.get("check_runs")
    if type(count) is not int or not isinstance(runs, list) or count != len(runs) or count > 100:
        raise ValueError("PUBLICATION_CHECKS_INCOMPLETE")
    required = [r for r in runs if r.get("name") == "qualify-exact-head"]
    for run in required:
        if run.get("head_sha") != head or run.get("app", {}).get("id") != 15368:
            raise ValueError("PUBLICATION_CHECK_IDENTITY_MISMATCH")
        if run.get("status") not in {"queued", "in_progress", "completed"}:
            raise ValueError("PUBLICATION_CHECK_STATE_UNKNOWN")
    if any(r.get("status") == "completed" and r.get("conclusion") != "success" for r in required):
        return {"status": "BLOCKED", "reason": "PUBLICATION_CI_FAILED"}
    if not required or any(r.get("status") != "completed" for r in required):
        return {"status": "CHECKING", "reason": "PUBLICATION_CI_PENDING"}
    reviews = publisher.api(f"pulls/{number}/reviews?per_page=100")
    if not isinstance(reviews, list) or len(reviews) >= 100:
        raise ValueError("PUBLICATION_REVIEWS_INCOMPLETE")
    binding = []
    for review in reviews:
        if review.get("user", {}).get("login") != "aloycwl" or review.get("commit_id") != head:
            continue
        state = review.get("state")
        if state in {"COMMENTED", "PENDING"}:
            continue
        if state not in {"APPROVED", "CHANGES_REQUESTED", "DISMISSED"}:
            raise ValueError("PUBLICATION_REVIEW_STATE_UNKNOWN")
        if type(review.get("id")) is not int or review["id"] <= 0:
            raise ValueError("PUBLICATION_REVIEW_ID_INVALID")
        if not isinstance(review.get("submitted_at"), str):
            raise ValueError("PUBLICATION_REVIEW_TIME_INVALID")
        try:
            submitted = timestamp(review["submitted_at"])
        except ValueError:
            raise ValueError("PUBLICATION_REVIEW_TIME_INVALID") from None
        if submitted > datetime.now(UTC):
            raise ValueError("PUBLICATION_REVIEW_TIME_INVALID")
        binding.append((submitted, review))
    if len({r["id"] for _, r in binding}) != len(binding):
        raise ValueError("PUBLICATION_REVIEW_ID_CONFLICT")
    last_time = max((t for t, _ in binding), default=None)
    last_reviews = [r for t, r in binding if t == last_time]
    if len({r["state"] for r in last_reviews}) > 1:
        raise ValueError("PUBLICATION_REVIEW_ORDER_AMBIGUOUS")
    latest = last_reviews[0] if last_reviews else None
    if latest is not None and latest["state"] == "CHANGES_REQUESTED":
        return {"status": "BLOCKED", "reason": "PUBLICATION_CHANGES_REQUESTED"}
    if latest is not None and latest["state"] == "APPROVED":
        return {"status": "CHECKING", "reason": "PUBLICATION_INDEPENDENT_REVIEW_APPROVED"}
    return {"status": "AWAITING_REVIEW", "reason": "PUBLICATION_INDEPENDENT_REVIEW_REQUIRED"}


def protected(path: Path) -> None:
    """A request/signing policy cannot be replaceable by the publishing user."""
    for entry in (path, *path.parents):
        if entry.is_symlink():
            raise ValueError("PUBLICATION_UNPROTECTED_PATH")
        info = entry.stat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("PUBLICATION_UNPROTECTED_PATH")


def credentials(root: Path) -> None:
    if os.geteuid() == 0:
        raise ValueError("PUBLICATION_ROOT_FORBIDDEN")
    directory = os.environ.get("CREDENTIALS_DIRECTORY")
    if not directory:
        raise ValueError("PUBLICATION_CREDENTIAL_UNAVAILABLE")
    token = bounded(Path(directory) / "github-token", 4096).decode().strip()
    if not token or any(character.isspace() for character in token):
        raise ValueError("PUBLICATION_CREDENTIAL_INVALID")
    # Only the dedicated service and trusted subprocesses inherit this credential.
    os.environ.update(
        GH_TOKEN=token,
        GH_HOST="github.com",
        GH_CONFIG_DIR=str(root / ".config" / "gh"),
        GIT_TERMINAL_PROMPT="0",
    )
    actor = json.loads(publisher.command(["gh", "api", "user"]))
    if actor.get("login") != publisher.PUBLISHER_LOGIN:
        raise ValueError("PUBLICATION_IDENTITY_MISMATCH")
    publisher.command(["gh", "auth", "setup-git", "--hostname", "github.com"])


def checkout(job: Path, payload: publisher.SignedPublication, artifact: Path) -> Path:
    repository = job / "repo"
    if not repository.exists():
        publisher.command(
            [
                "git",
                "clone",
                "--no-checkout",
                "--single-branch",
                "--branch",
                "main",
                "https://github.com/" + publisher.REPOSITORY + ".git",
                str(repository),
            ]
        )
        publisher.command(
            ["git", "-C", str(repository), "checkout", "--detach", payload.baseCommit]
        )
    if repository.is_symlink() or not (repository / ".git").is_dir():
        raise ValueError("PUBLICATION_CHECKOUT_INVALID")
    origin = publisher.command(["git", "-C", str(repository), "remote", "get-url", "origin"])
    if origin.decode().strip() != "https://github.com/" + publisher.REPOSITORY + ".git":
        raise ValueError("PUBLICATION_ORIGIN_MISMATCH")
    environment = repository / ".venv"
    if not environment.exists():
        environment.symlink_to(artifact / ".venv", target_is_directory=True)
    if environment.resolve() != (artifact / ".venv").resolve():
        raise ValueError("PUBLICATION_TOOLCHAIN_DRIFT")
    publisher.command(["git", "-C", str(repository), "config", "core.hooksPath", ".githooks"])
    return repository


def process(request: Path, root: Path, artifact: Path, now: datetime) -> dict[str, Any]:
    protected(request)
    payload, digest = publisher.authenticate(
        bounded(request, publisher.MAX_REQUEST), artifact / "policy/research-publisher-signers"
    )
    if request.name != digest + ".json":
        raise ValueError("PUBLICATION_QUEUE_DIGEST_MISMATCH")
    job = root / "jobs" / digest
    job.mkdir(parents=True, mode=0o700, exist_ok=True)
    immutable(job / "request.json", json.loads(request.read_bytes()))
    repository = checkout(job, payload, artifact)
    previous = Path.cwd()
    try:
        os.chdir(repository)
        result = publisher.publish(payload, digest, now, journal=job / "phases")
    finally:
        os.chdir(previous)
    observation = {
        "status": "MERGED"
        if result["remoteState"] == "MERGED"
        else "BLOCKED"
        if result["remoteState"] == "CLOSED"
        else "AWAITING_REVIEW",
        "reason": "PUBLICATION_" + result["remoteState"],
        "pullRequest": result["pullRequest"],
        "headCommit": result["headCommit"],
    }
    if result["remoteState"] == "OPEN":
        observation.update(review_status(result["pullRequest"], result["headCommit"]))
    return observation


def error_code(error: Exception) -> str:
    text = str(error)
    return (
        text if re.fullmatch(r"PUBLICATION_[A-Z_]{1,80}", text) else "PUBLICATION_OPERATION_FAILED"
    )


def cycle(root: Path, queue: Path, artifact: Path, now: datetime) -> PublisherHealth:
    protected(queue)
    protected(artifact)
    protected(artifact / "policy/research-publisher-signers")
    requests = sorted(queue.iterdir())
    if len(requests) > MAX_JOBS:
        raise ValueError("PUBLICATION_QUEUE_LIMIT")
    if any(not re.fullmatch(r"[a-f0-9]{64}\.json", item.name) for item in requests):
        raise ValueError("PUBLICATION_QUEUE_ENTRY_INVALID")
    credentials(root)
    observations = []
    for request in requests:
        try:
            observations.append(process(request, root, artifact, now))
        except Exception as error:
            observations.append({"status": "BLOCKED", "reason": error_code(error)})
    # One failure remains visible even if another job is awaiting review or merged.
    priority = {"BLOCKED": 0, "CHECKING": 1, "AWAITING_REVIEW": 2, "MERGED": 3}
    result = (
        min(observations, key=lambda item: priority[item["status"]])
        if observations
        else {"status": "IDLE", "reason": "PUBLICATION_QUEUE_EMPTY"}
    )
    return PublisherHealth.model_validate(
        {"checkedAt": now.isoformat(), "pullRequest": None, "headCommit": None, **result}
    )


def main() -> None:
    ROOT.mkdir(mode=0o755, exist_ok=True)
    with (ROOT / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            status = cycle(ROOT, QUEUE, ARTIFACT, datetime.now(UTC))
        except Exception as error:
            status = PublisherHealth(
                checkedAt=datetime.now(UTC).isoformat(),
                status="BLOCKED",
                reason=error_code(error),
                pullRequest=None,
                headCommit=None,
            )
        atomic_bytes(ROOT / "status.json", encoded(status.model_dump()), replace=True)
        (ROOT / "status.json").chmod(0o644)
        print(status.status + " " + status.reason)


if __name__ == "__main__":
    main()
