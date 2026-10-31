"""Separately authenticated review adapter; only exact signed research may advance."""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.operations import publisher_service as admission
from python.operations import research_publisher as publisher
from python.research import candidate_attestation as payoff
from python.research import holding_task as holding
from python.research.experiment_registry import Registry, read
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import bounded, durable_json, immutable, unique
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha
from python.research.source_review import Review, ReviewInput
from python.research.source_verifier import GitObjects, MirrorTrust

ROOT = Path("/var/lib/scalper-research-reviewer")
ARTIFACT = Path("/opt/scalper-research-reviewer")
POLICY = Path("/etc/scalper-research-reviewer/policy.json")
REVIEWER = "aloycwl"


def mutation(path: str, method: str, payload: dict[str, Any]) -> Any:
    return json.loads(
        publisher.command(
            [
                "gh",
                "api",
                "repos/" + publisher.REPOSITORY + "/" + path,
                "--method",
                method,
                "--input",
                "-",
            ],
            data=encoded(payload),
        )
    )


def rules(config: dict[str, Any]) -> None:
    if set(config["protectedFiles"]) != {
        ".github/workflows/qualification.yml",
        ".github/CODEOWNERS",
    }:
        raise ValueError("REVIEW_PROTECTED_PINS_MISSING")
    value = publisher.api("branches/main/protection")
    reviews = value["required_pull_request_reviews"]
    checks = value["required_status_checks"]
    if (
        value["enforce_admins"]["enabled"] is not True
        or value["allow_force_pushes"]["enabled"] is not False
        or value["allow_deletions"]["enabled"] is not False
        or checks["strict"] is not True
        or reviews["required_approving_review_count"] < 1
        or reviews["dismiss_stale_reviews"] is not True
        or reviews["require_code_owner_reviews"] is not True
        or reviews["require_last_push_approval"] is not True
        or {"context": "qualify-exact-head", "app_id": 15368} not in checks["checks"]
    ):
        raise ValueError("REVIEW_BRANCH_RULES_CHANGED")
    for path, pin in config["protectedFiles"].items():
        raw = publisher.command(["git", "show", "refs/heads/main:" + path])
        if sha(raw) != pin:
            raise ValueError("REVIEW_PROTECTED_SOURCE_CHANGED")


def guard(
    number: int,
    payload: publisher.SignedPublication,
    digest: str,
    head: str,
    config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    pr = publisher.api(f"pulls/{number}")
    publisher.confirm_pr(pr, head)
    if pr["head"]["ref"] != "research/" + digest:
        raise ValueError("REVIEW_BRANCH_IDENTITY")
    if pr.get("merged") is True:
        return pr, {"status": "MERGED"}
    if pr["state"] != "open":
        return pr, {"status": "CLOSED"}
    rules(config)
    if (
        pr["base"]["sha"] != payload.baseCommit
        or publisher.api("git/ref/heads/main")["object"]["sha"] != payload.baseCommit
    ):
        raise ValueError("REVIEW_MAIN_DRIFT")
    status = admission.review_status(number, head)
    reviews = publisher.api(f"pulls/{number}/reviews?per_page=100")
    if not isinstance(reviews, list) or len(reviews) >= 100:
        raise ValueError("REVIEW_HISTORY_INCOMPLETE")
    for review in reviews:
        if review.get("user", {}).get("login") == REVIEWER and (
            review.get("state") == "PENDING"
            or (
                review.get("commit_id") == head
                and review.get("state") in {"DISMISSED", "CHANGES_REQUESTED"}
                and status.get("reason") != "PUBLICATION_INDEPENDENT_REVIEW_APPROVED"
            )
        ):
            return pr, {"status": "BLOCKED", "reason": "REVIEW_EXISTING_VETO_OR_PENDING"}
    return pr, status


def fetch_envelope(digest: str, config: dict[str, Any]) -> bytes:
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("REVIEW_PUBLICATION_ID")
    root = Path(config["publications"])
    if any(p.is_symlink() for p in (root, *root.parents)):
        raise ValueError("REVIEW_CACHE_PATH")
    return bounded(root / (digest + ".json"), publisher.MAX_REQUEST)


def model_review(value: ReviewInput) -> dict[str, Any]:
    raw = encoded(value.model_dump())
    if len(raw) > 64000:
        raise ValueError("REVIEW_INPUT_OVERSIZED")
    result = publisher.command(
        [
            "runuser",
            "-u",
            "scalper-learning",
            "--",
            "env",
            "-i",
            "--chdir=" + str(ARTIFACT),
            "HOME=/var/lib/scalper-learning-evidence",
            "PATH=/usr/local/bin:/usr/bin:/bin",
            "PYTHONPATH=" + str(ARTIFACT),
            "PYTHONDONTWRITEBYTECODE=1",
            str(ARTIFACT / ".venv/bin/python"),
            "-P",
            "-m",
            "python.operations.source_review_worker",
        ],
        data=raw,
        timeout=210,
    )
    return dict(json.loads(result))


def saved_model(value: ReviewInput) -> dict[str, Any]:
    key = sha(encoded(value.model_dump()))
    root = Path("/var/lib/scalper-learning-evidence/source-reviews465")
    if not root.exists():
        return {"status": "OUTCOME_UNKNOWN", "job": key}
    job = Registry(root).directory(key)
    if not (job / "binding.json").exists():
        return {"status": "OUTCOME_UNKNOWN", "job": key}
    if read(job / "binding.json", 64000) != value.model_dump():
        raise ValueError("REVIEW_SAVED_INPUT_CHANGED")
    if (job / "review.json").exists():
        review = Review.model_validate(read(job / "review.json"))
    elif (job / "response.json").exists():
        review = Review.model_validate(
            json.loads(read(job / "response.json")["raw"], object_pairs_hook=unique)
        )
    else:
        return {"status": "OUTCOME_UNKNOWN", "job": key}
    return {"status": "REVIEWED", "job": key, "review": review.model_dump()}


def inspect_models(job: Path, payload: publisher.SignedPublication, digest: str, head: str) -> str:
    for axis in ("standards", "spec"):
        value = ReviewInput(
            version="research-source-review-input-1.0",
            axis=axis,
            publicationSha256=digest,
            headCommit=head,
            contract=holding.PROMPT
            if isinstance(payload, publisher.HoldingPublication)
            else payoff.PROMPT,
            source={name: raw.decode() for name, raw in payload.files().items()},
            attestation=payload.attestation,
        )
        immutable(job / (axis + "-input.json"), value.model_dump())
        if not (job / (axis + "-result.json")).exists():
            if (job / (axis + "-claim.json")).exists():
                result = saved_model(value)
            else:
                immutable(
                    job / (axis + "-claim.json"), {"inputSha256": sha(encoded(value.model_dump()))}
                )
                result = model_review(value)
            if result.get("job") != sha(encoded(value.model_dump())):
                raise ValueError("REVIEW_MODEL_JOB_CHANGED")
            if result["status"] != "REVIEWED":
                return str(result["status"])
            immutable(job / (axis + "-result.json"), result)
        result = read(job / (axis + "-result.json"))
        review = Review.model_validate(result["review"])
        if review.axis != axis or review.publicationSha256 != digest or review.headCommit != head:
            raise ValueError("REVIEW_MODEL_SOURCE_CHANGED")
        if review.decision != "APPROVE" or review.findings:
            return "MODEL_" + review.decision
    return "APPROVED"


def process(number: int, envelope: bytes, config: dict[str, Any], root: Path) -> dict[str, Any]:
    payload, digest = publisher.authenticate(envelope, Path(config["signers"]))
    head = publisher.expected_commit(payload, digest)
    job = Registry(root).directory(digest)
    job.mkdir(mode=0o700, parents=True, exist_ok=True)
    immutable(job / "publication.json", payload.model_dump())
    immutable(
        job / "context.json",
        {"number": number, "digest": digest, "head": head, "baseCommit": payload.baseCommit},
    )
    pr, status = guard(number, payload, digest, head, config)
    terminal = job / "terminal.json"
    if terminal.exists() and status["status"] != read(terminal)["status"]:
        return {
            "pullRequest": number,
            "status": "BLOCKED",
            "reason": "REVIEW_TERMINAL_HISTORY_CHANGED",
        }
    if status["status"] in {"MERGED", "CLOSED", "BLOCKED"}:
        return {"pullRequest": number, **status}
    if status.get("reason") == "PUBLICATION_CI_PENDING":
        return {"pullRequest": number, "status": "WAITING_CI"}
    decision = inspect_models(job, payload, digest, head)
    if decision != "APPROVED":
        return {"pullRequest": number, "status": decision}
    pr, status = guard(number, payload, digest, head, config)
    if (
        status["status"] in {"MERGED", "CLOSED", "BLOCKED"}
        or status.get("reason") == "PUBLICATION_CI_PENDING"
    ):
        return {"pullRequest": number, **status}
    if pr["draft"]:
        if (job / "ready-claim.json").exists():
            return {"pullRequest": number, "status": "READY_OUTCOME_UNKNOWN"}
        immutable(job / "ready-claim.json", {"headCommit": head})
        publisher.command(
            ["gh", "api", "graphql", "--input", "-"],
            data=encoded(
                {
                    "query": (
                        "mutation($id:ID!){markPullRequestReadyForReview("
                        "input:{pullRequestId:$id}){pullRequest{isDraft}}}"
                    ),
                    "variables": {"id": pr["node_id"]},
                }
            ),
        )
        return {"pullRequest": number, "status": "READY_PENDING_RECHECK"}
    if status.get("reason") != "PUBLICATION_INDEPENDENT_REVIEW_APPROVED":
        if (job / "approval-claim.json").exists():
            return {"pullRequest": number, "status": "APPROVAL_OUTCOME_UNKNOWN"}
        immutable(job / "approval-claim.json", {"headCommit": head})
        mutation(
            f"pulls/{number}/reviews",
            "POST",
            {
                "commit_id": head,
                "event": "APPROVE",
                "body": "Automated operator-authorized independent research review by aloycwl. "
                "Two tool-disabled source-review contexts approved this exact signed source; "
                "protected scope, current rules and trusted CI were independently verified. "
                "No economic promotion. Marker scalper-review:" + digest + ":" + head,
            },
        )
        return {"pullRequest": number, "status": "APPROVED_PENDING_RECHECK"}
    if pr.get("mergeable") is not True or pr.get("mergeable_state") != "clean":
        return {"pullRequest": number, "status": "WAITING_MERGEABILITY"}
    if (job / "merge-claim.json").exists():
        return {"pullRequest": number, "status": "MERGE_OUTCOME_UNKNOWN"}
    # Late guard is separate from API receipt; GitHub also enforces exact-head and branch rules.
    pr, status = guard(number, payload, digest, head, config)
    if (
        status.get("reason") != "PUBLICATION_INDEPENDENT_REVIEW_APPROVED"
        or pr["draft"]
        or pr.get("mergeable") is not True
        or pr.get("mergeable_state") != "clean"
    ):
        return {"pullRequest": number, "status": "LATE_GATE_CHANGED"}
    immutable(job / "merge-claim.json", {"headCommit": head})
    result = mutation(f"pulls/{number}/merge", "PUT", {"sha": head, "merge_method": "merge"})
    immutable(job / "merge-response.json", result)
    return {"pullRequest": number, "status": "MERGE_PENDING_RECHECK"}


def cycle(config: dict[str, Any], root: Path) -> dict[str, Any]:
    if json.loads(publisher.command(["gh", "api", "user"]))["login"] != REVIEWER:
        raise ValueError("REVIEW_GITHUB_IDENTITY")
    with Registry(root).locked():
        mirror = Path(config["mirror"])
        before = publisher.api("git/ref/heads/main")["object"]["sha"]
        trust = MirrorTrust(mirror, before, config["gitSha256"], config["prlimitSha256"])
        trust.verify()
        publisher.command(
            [
                "git",
                "--git-dir=" + str(mirror),
                "fetch",
                "--no-tags",
                "origin",
                "+refs/heads/main:refs/heads/main",
            ],
            timeout=60,
        )
        GitObjects(trust).main()
        if publisher.api("git/ref/heads/main")["object"]["sha"] != before:
            raise ValueError("REVIEW_CAPTURE_MAIN_DRIFT")
        os.chdir(mirror)
        pulls = publisher.api("pulls?state=open&base=main&per_page=100")
        if not isinstance(pulls, list) or len(pulls) >= 100:
            raise ValueError("REVIEW_PULLS_INCOMPLETE")
        selected = []
        for pr in pulls:
            branch = pr.get("head", {}).get("ref", "")
            if pr.get("user", {}).get("login") == publisher.PUBLISHER_LOGIN and re.fullmatch(
                r"research/[a-f0-9]{64}", branch
            ):
                selected.append(pr)
        existing = {pr["number"] for pr in selected}
        for context in sorted(root.glob("*/context.json")):
            if (context.parent / "terminal.json").exists():
                continue
            prior = read(context)
            if prior["number"] not in existing:
                selected.append(
                    {"number": prior["number"], "head": {"ref": "research/" + prior["digest"]}}
                )
        outcomes = []
        for pr in selected[:4]:
            digest = pr["head"]["ref"].split("/")[1]
            try:
                outcome = process(pr["number"], fetch_envelope(digest, config), config, root)
            except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
                reason = str(error)
                outcome = {
                    "pullRequest": pr["number"],
                    "status": "BLOCKED_OR_UNKNOWN",
                    "reason": reason
                    if re.fullmatch(r"(?:REVIEW|SOURCE|PUBLICATION)_[A-Z_]{1,100}", reason)
                    else "REVIEW_DEPENDENCY_OR_OUTCOME_UNKNOWN",
                }
            if outcome["status"] in {"MERGED", "CLOSED"}:
                immutable(root / digest / "terminal.json", outcome)
            outcomes.append(outcome)
        terminals = list(root.glob("*/terminal.json"))
        latest = max(terminals, key=lambda p: p.stat().st_mtime_ns) if terminals else None
        result = {
            "checkedAt": datetime.now(UTC).isoformat(),
            "status": "IDLE" if not outcomes else "CHECKED",
            "recent": outcomes,
            "lastTerminal": (
                {
                    **read(latest),
                    "publicationSha256": latest.parent.name,
                    "headCommit": read(latest.parent / "context.json").get("head"),
                }
                if latest
                else None
            ),
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
        durable_json(root / "health.json", result)
        return result


def main() -> None:
    if os.geteuid() != 0:
        raise ValueError("REVIEW_PROTECTED_PARENT_REQUIRED")
    trusted_path(POLICY)
    config = read(POLICY)
    for name in ("signers",):
        trusted_path(Path(config[name]))
    token = (
        bounded(Path(os.environ["CREDENTIALS_DIRECTORY"]) / "github-token", 4096).decode().strip()
    )
    if not token or any(c.isspace() for c in token):
        raise ValueError("REVIEW_CREDENTIAL_INVALID")
    os.environ["GH_TOKEN"] = token
    try:
        cycle(config, ROOT)
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        reason = str(error)
        durable_json(
            ROOT / "health.json",
            {
                "checkedAt": datetime.now(UTC).isoformat(),
                "status": "BLOCKED_OR_UNKNOWN",
                "reason": reason
                if re.fullmatch(r"(?:REVIEW|SOURCE|PUBLICATION)_[A-Z_]{1,100}", reason)
                else "REVIEW_DEPENDENCY_OR_OUTCOME_UNKNOWN",
                "brokerAuthority": False,
                "promotionAuthority": False,
            },
        )
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("REVIEW_FAILED_OR_UNKNOWN") from None
