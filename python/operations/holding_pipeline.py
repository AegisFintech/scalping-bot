"""Protected parent for one bounded research task; never invokes a model or candidate code."""

from __future__ import annotations

import json
import os
import re
import resource
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.operations import research_delivery as delivery
from python.operations import research_publisher as github
from python.research import holding_authority as authority
from python.research import holding_task as task
from python.research.codex_loop import timestamp
from python.research.experiment_registry import Registry, read
from python.research.holding_mailbox import MAX_TRANSFER, Generation, Scoring, unpack
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import bounded, durable_json, immutable, unique
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha
from python.research.source_verifier import MirrorTrust

ROOT = Path("/var/lib/scalper-candidate-authority")
POLICY = Path("/etc/scalper-candidate-authority/policy.json")
SSH = Path("/etc/scalper-candidate-authority/ssh.conf")


def main_sha() -> str:
    value = github.api("git/ref/heads/main")["object"]["sha"]
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("HOLDING_REMOTE_MAIN_ID")
    return str(value)


def transfer(role: str, payload: dict[str, Any]) -> dict[str, Any]:
    if role not in {"generation", "scoring"}:
        raise ValueError("HOLDING_TRANSFER_ROLE")
    raw = encoded(payload)
    if len(raw) > MAX_TRANSFER:
        raise ValueError("HOLDING_TRANSFER_LIMIT")

    def limits() -> None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_TRANSFER + 1, MAX_TRANSFER + 1))

    with tempfile.TemporaryFile() as output:
        subprocess.run(
            ["ssh", "-F", str(SSH), "holding-" + role],
            input=raw,
            stdout=output,
            stderr=subprocess.DEVNULL,
            timeout=30,
            check=True,
            preexec_fn=limits,
            close_fds=True,
            env={"HOME": "/root", "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
        )
        output.seek(0)
        reply = output.read(MAX_TRANSFER + 1)
    if len(reply) > MAX_TRANSFER:
        raise ValueError("HOLDING_TRANSFER_REPLY_LIMIT")
    return dict(json.loads(reply, object_pairs_hook=unique))


def remote(job: Path, role: str, request: dict[str, Any]) -> dict[str, Any]:
    key = sha(encoded(request))
    path = job / role
    path.mkdir(mode=0o700, exist_ok=True)
    immutable(path / "request.json", request)
    if (path / "response.json").exists():
        return dict(read(path / "response.json", MAX_TRANSFER))
    if not (path / "claim.json").exists():
        immutable(
            path / "claim.json", {"requestSha256": key, "claimedAt": datetime.now(UTC).isoformat()}
        )
        reply = transfer(role, {"action": "submit", "request": request})
    else:
        reply = transfer(role, {"action": "query", "job": key})
    if reply.get("job") != key:
        raise ValueError("HOLDING_REMOTE_JOB_MISMATCH")
    if reply["status"] not in {"NOT_RECEIVED", "QUEUED_OR_UNKNOWN"}:
        if reply.get("requestSha256") != key:
            raise ValueError("HOLDING_REMOTE_REQUEST_MISMATCH")
        immutable(path / "response.json", reply)
    return reply


def refresh(config: dict[str, Any]) -> MirrorTrust:
    mirror = Path(config["mirror"])
    trusted_path(mirror)
    before = main_sha()
    trust = MirrorTrust(mirror, before, config["gitSha256"], config["prlimitSha256"])
    trust.verify()
    subprocess.run(
        [
            "/usr/bin/git",
            "--git-dir=" + str(mirror),
            "-c",
            "core.hooksPath=/dev/null",
            "fetch",
            "--no-tags",
            "origin",
            "+refs/heads/main:refs/heads/main",
        ],
        capture_output=True,
        check=True,
        timeout=60,
    )
    if main_sha() != before:
        raise ValueError("HOLDING_MAIN_DRIFT_DURING_CAPTURE")
    trust.verify()
    return trust


def cycle(root: Path, config: dict[str, Any]) -> dict[str, Any]:
    registry = Registry(root)
    with registry.locked():
        trust = refresh(config)
        admission = task.admission(trust)
        state_path = root / "state.json"
        prior = read(state_path) if state_path.exists() else {}
        if admission["status"] != "ELIGIBLE":
            result = {**prior, **admission, "brokerAuthority": False, "promotionAuthority": False}
            # Source drift stops new work, while existing transport claims remain query-only.
            if prior.get("job"):
                job = registry.directory(prior["job"])
                observed = {}
                for role in ("generation", "scoring"):
                    claim = job / role / "claim.json"
                    if claim.exists():
                        key = read(claim)["requestSha256"]
                        reply = transfer(role, {"action": "query", "job": key})
                        if reply.get("job") != key:
                            raise ValueError("HOLDING_REMOTE_JOB_MISMATCH")
                        observed[role] = reply["status"]
                result["existingClaims"] = observed
        elif prior.get("status") == "SIGNED" and prior.get("baseCommit") == trust.expected_main:
            result = {**prior, "reason": "HOLDING_AWAITING_PUBLICATION"}
        else:
            active = prior.get("job")
            if not active or prior.get("status") in {"SIGNED", "REJECTED", "SOURCE_DRIFT"}:
                selected = transfer("generation", {"action": "discover"})
                if selected["status"] != "ELIGIBLE":
                    result = {
                        "status": selected["status"],
                        "invalidArchives": selected.get("invalidArchives"),
                        "checkedAt": datetime.now(UTC).isoformat(),
                        "brokerAuthority": False,
                        "promotionAuthority": False,
                    }
                    durable_json(state_path, result)
                    return result
                request = Generation(
                    version="holding-generation-request-1.0",
                    task=task.TASK,
                    baseCommit=trust.expected_main,
                    experiment=selected["experiment"],
                )
                active = sha(encoded(request.model_dump()))
                job = registry.directory(active)
                if not job.exists():
                    if (
                        sum(
                            p.is_dir() and bool(re.fullmatch(r"[a-f0-9]{64}", p.name))
                            for p in root.iterdir()
                        )
                        >= 4
                    ):
                        raise ValueError("HOLDING_AUTHORITY_TASK_BUDGET")
                    job.mkdir(mode=0o700)
                immutable(job / "request.json", request.model_dump())
                selection = {"invalidArchives": selected.get("invalidArchives", 0)}
                immutable(job / ("selection-" + sha(encoded(selection)) + ".json"), selection)
                durable_json(
                    state_path,
                    {
                        "job": active,
                        "status": "CLAIMED",
                        "baseCommit": request.baseCommit,
                        "invalidArchives": selected.get("invalidArchives", 0),
                        "checkedAt": datetime.now(UTC).isoformat(),
                    },
                )
            job = registry.directory(active)
            request = Generation.model_validate(read(job / "request.json", MAX_TRANSFER))
            generation = remote(job, "generation", request.model_dump())
            result = {
                "invalidArchives": read(state_path).get("invalidArchives", 0),
                "job": active,
                "status": generation["status"],
                "phase": "GENERATION",
                "baseCommit": request.baseCommit,
            }
            if generation["status"] == "GENERATED_UNVERIFIED":
                if request.baseCommit != trust.expected_main:
                    result["status"] = "SOURCE_DRIFT"
                else:
                    unpack(request.experiment, job / "experiment")
                    facts, _ = task.evidence(job / "experiment")
                    generated = authority.artifacts(
                        generation,
                        {
                            "binding.json",
                            "request.json",
                            "claim.json",
                            "response.json",
                            "draft.json",
                        },
                    )
                    draft = task.Draft.model_validate_json(generated["draft.json"])
                    # Bind original response and provider claim before static preparation.
                    response = json.loads(generated["response.json"], object_pairs_hook=unique)[
                        "raw"
                    ]
                    if task.Draft.model_validate_json(response) != draft:
                        raise ValueError("HOLDING_GENERATED_RESPONSE_CHANGED")
                    provider = json.loads(generated["request.json"], object_pairs_hook=unique)
                    captured = provider["payload"]["captured_at"]
                    claim = json.loads(generated["claim.json"], object_pairs_hook=unique)
                    binding = {"task": task.TASK, "baseCommit": request.baseCommit, **facts}
                    if (
                        set(provider) != {"promptSha256", "payload"}
                        or provider["promptSha256"] != sha(task.PROMPT.encode())
                        or provider["payload"] != {"captured_at": captured, **binding}
                        or set(claim) != {"bindingSha256", "claimedAt"}
                        or not timestamp(captured)
                        <= timestamp(claim["claimedAt"])
                        <= datetime.now(UTC)
                    ):
                        raise ValueError("HOLDING_PROVIDER_REQUEST_BINDING")
                    if json.loads(generated["binding.json"]) != binding or json.loads(
                        generated["claim.json"]
                    )["bindingSha256"] != sha(encoded(binding)):
                        raise ValueError("HOLDING_GENERATED_BINDING")
                    verified = authority.prepare(
                        draft, facts, trust, job / "prepared", Path(config["formatter"])
                    )
                    challenge_path = job / "challenge.json"
                    if not challenge_path.exists():
                        immutable(
                            challenge_path,
                            {"module": task.MODULE, "cases": task.challenges(facts["rows"])},
                        )
                    challenge = bounded(challenge_path, 8 * 1024 * 1024)
                    scoring = Scoring(
                        version="holding-scoring-request-1.0",
                        task=task.TASK,
                        inputHex=challenge.hex(),
                        source=verified.receipt,
                        facts=facts,
                        files={name: raw.hex() for name, raw in verified.files.items()},
                    )
                    reply = remote(job, "scoring", scoring.model_dump())
                    result["status"] = reply["status"]
                    result["phase"] = "SCORING"
                    if reply["status"] == "AWAITING_INDEPENDENT_REVIEW":
                        publication = authority.publication(
                            reply,
                            sha(encoded(scoring.model_dump())),
                            verified,
                            facts,
                            config["pins"],
                            challenge,
                        )
                        digest = authority.queue(
                            publication,
                            job,
                            Path(config["queue"]),
                            Path(config["signingKey"]),
                            main_sha,
                        )
                        acknowledgement = transfer(
                            "generation",
                            {
                                "action": "publication",
                                "envelope": bounded(
                                    Path(config["queue"]) / (digest + ".json"), github.MAX_REQUEST
                                ).decode(),
                            },
                        )
                        if acknowledgement != {
                            "status": "PUBLICATION_CACHED",
                            "publicationSha256": digest,
                        }:
                            raise ValueError("HOLDING_REVIEW_RELAY_UNCONFIRMED")
                        result.update(status="SIGNED", phase="PUBLISHING", publicationSha256=digest)
        result.update(
            checkedAt=datetime.now(UTC).isoformat(), brokerAuthority=False, promotionAuthority=False
        )
        durable_json(state_path, result)
        return result


def main() -> None:
    if os.geteuid() != 0:
        raise ValueError("HOLDING_PROTECTED_PARENT_REQUIRED")
    trusted_path(POLICY)
    trusted_path(SSH)
    credentials = Path(os.environ["CREDENTIALS_DIRECTORY"]) / "github-token"
    token = bounded(credentials, 4096).decode().strip()
    if not token or any(c.isspace() for c in token):
        raise ValueError("HOLDING_GITHUB_CREDENTIAL_INVALID")
    os.environ["GH_TOKEN"] = token
    try:
        result = cycle(ROOT, read(POLICY))
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        reason = str(error)
        result = {
            "reason": reason
            if re.fullmatch(r"(?:HOLDING|SOURCE|WORKER|CANDIDATE)_[A-Z_]{1,100}", reason)
            else "HOLDING_DEPENDENCY_OR_OUTCOME_UNKNOWN",
            "status": "BLOCKED_OR_UNKNOWN",
            "checkedAt": datetime.now(UTC).isoformat(),
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
        durable_json(ROOT / "health.json", result)
        delivery.publish(delivery.GENERATION, delivery.generation(ROOT, result))
        raise
    durable_json(ROOT / "health.json", result)
    delivery.publish(delivery.GENERATION, delivery.generation(ROOT, result))
    print(encoded(result).decode())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("HOLDING_PIPELINE_BLOCKED_OR_UNKNOWN") from None
