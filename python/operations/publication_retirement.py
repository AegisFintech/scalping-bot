"""Protected retirement of proven unsent publications; never refresh an attestation."""

from __future__ import annotations

import base64
import fcntl
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from python.operations import research_publisher as publisher
from python.research.codex_loop import StrictModel, timestamp
from python.research.isolated_worker import trusted_path as protected
from python.research.learning_archive import atomic_bytes, bounded, immutable, unique
from python.research.learning_evidence import Digest, Instant, encoded
from python.research.observation_cycle import sha


class RetirementReceipt(StrictModel):
    version: Literal["research-publication-retirement-1.0"]
    publicationSha256: Digest
    envelopeSha256: Digest
    baseCommit: str
    observedMain: str
    retiredAt: Instant
    reason: Literal["PUBLICATION_ATTESTATION_STALE", "PUBLICATION_MAIN_DRIFT"]
    noDispatchIntent: Literal[True]
    remoteBranchAbsent: Literal[True]
    remotePrAbsent: Literal[True]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


@contextmanager
def queue_lock(queue: Path) -> Iterator[None]:
    protected(queue)
    fd = os.open(queue, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("PUBLICATION_QUEUE_BUSY") from None
        yield
    finally:
        os.close(fd)


def retire(
    job: Path,
    queue: Path,
    publisher_root: Path,
    signers: Path,
    digest: str,
    current_main: str,
    now: datetime,
    git_directory: Path | None = None,
) -> dict[str, Any] | None:
    if os.geteuid() != 0:
        raise ValueError("PUBLICATION_RETIREMENT_ROOT_REQUIRED")
    protected(job)
    protected(signers)
    # The filename and payload identities are validated before joining any path.
    import re

    if not re.fullmatch("[a-f0-9]{64}", digest) or not re.fullmatch("[a-f0-9]{40}", current_main):
        raise ValueError("PUBLICATION_RETIREMENT_IDENTITY")
    with queue_lock(queue):
        queued = queue / (digest + ".json")
        archived = job / "retired-envelope.json"
        retired_directory = queue / "retired"
        if retired_directory.is_symlink():
            raise ValueError("PUBLICATION_RETIREMENT_CONFLICT")
        if retired_directory.exists():
            protected(retired_directory)
        retired_envelope = retired_directory / (digest + ".json")
        receipt = job / "publication-retirement.json"
        signed = json.loads(bounded(job / "signed.json", 8192), object_pairs_hook=unique)
        if signed.get("publicationSha256") != digest:
            raise ValueError("PUBLICATION_RETIREMENT_BINDING")
        if not queued.exists() and (archived.exists() or retired_envelope.exists()):
            if (
                not archived.exists()
                or not retired_envelope.exists()
                or not receipt.exists()
                or sha(bounded(archived, publisher.MAX_REQUEST)) != signed["envelopeSha256"]
                or sha(bounded(retired_envelope, publisher.MAX_REQUEST)) != signed["envelopeSha256"]
            ):
                raise ValueError("PUBLICATION_RETIREMENT_CONFLICT")
            result = RetirementReceipt.model_validate_json(bounded(receipt, 8192)).model_dump()
            if (
                result.get("publicationSha256") != digest
                or result.get("envelopeSha256") != signed["envelopeSha256"]
            ):
                raise ValueError("PUBLICATION_RETIREMENT_CONFLICT")
            return dict(result)
        if not queued.exists():
            raise ValueError("PUBLICATION_QUEUE_MISSING_UNKNOWN")
        raw = bounded(queued, publisher.MAX_REQUEST)
        payload, actual = publisher.authenticate(raw, signers)
        envelope = json.loads(raw, object_pairs_hook=unique)
        if (
            actual != digest
            or sha(raw) != signed["envelopeSha256"]
            or encoded(payload.model_dump())
            != bounded(job / "publication.json", publisher.MAX_REQUEST)
            or base64.b64decode(envelope["signature"], validate=True)
            != bounded(job / "publication.json.sig", 8192)
        ):
            raise ValueError("PUBLICATION_RETIREMENT_BINDING")
        completed = timestamp(payload.attestation["completedAt"])
        if completed > now:
            raise ValueError("PUBLICATION_RETIREMENT_CLOCK")
        reason = (
            "PUBLICATION_ATTESTATION_STALE"
            if completed < now - timedelta(hours=24)
            else "PUBLICATION_MAIN_DRIFT"
            if payload.baseCommit != current_main
            else None
        )
        phases = publisher_root / "jobs" / digest / "phases"
        # Reconcile a proven terminal PR independently of private local phase payloads.
        pulls = publisher.api(
            "pulls?state=all&head=AegisFintech:research/" + digest + "&base=main&per_page=100"
        )
        if not isinstance(pulls, list) or len(pulls) > 1:
            raise ValueError("PUBLICATION_RETIREMENT_REMOTE_UNCERTAIN")
        if pulls:
            head = pulls[0].get("head", {}).get("sha")
            if head not in {
                publisher.expected_commit(payload, digest, git_directory=git_directory),
                publisher.expected_commit(
                    payload, digest, legacy=True, git_directory=git_directory
                ),
            }:
                raise ValueError("PUBLICATION_RETIREMENT_REMOTE_UNCERTAIN")
            publisher.confirm_pr(pulls[0], head)
            if pulls[0].get("state") == "closed":
                return {
                    "reason": "PUBLICATION_TERMINAL_CONFIRMED",
                    "terminalPublication": True,
                    "publicationSha256": digest,
                    "pullRequest": pulls[0]["number"],
                    "brokerAuthority": False,
                    "promotionAuthority": False,
                }
            if reason is None:
                return None
            raise ValueError("PUBLICATION_RETIREMENT_DISPATCH_UNCERTAIN")
        if reason is None:
            return None
        if any(p.is_symlink() for p in (phases, *phases.parents)) or (
            phases.exists() and any(p.name != "proposal.json" for p in phases.iterdir())
        ):
            raise ValueError("PUBLICATION_RETIREMENT_DISPATCH_UNCERTAIN")
        # A missing phase is not enough: independently verify both remote namespaces.
        branch = publisher.api("git/matching-refs/heads/research/" + digest)
        if not isinstance(branch, list) or branch:
            raise ValueError("PUBLICATION_RETIREMENT_REMOTE_UNCERTAIN")
        result = {
            "version": "research-publication-retirement-1.0",
            "publicationSha256": digest,
            "envelopeSha256": sha(raw),
            "baseCommit": payload.baseCommit,
            "observedMain": current_main,
            "retiredAt": now.isoformat(),
            "reason": reason,
            "noDispatchIntent": True,
            "remoteBranchAbsent": True,
            "remotePrAbsent": True,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
        if receipt.exists():
            prior = RetirementReceipt.model_validate_json(bounded(receipt, 8192)).model_dump()
            if any(
                prior.get(k) != result[k]
                for k in ("version", "publicationSha256", "envelopeSha256", "baseCommit")
            ):
                raise ValueError("PUBLICATION_RETIREMENT_CONFLICT")
            result = prior
        else:
            result = RetirementReceipt.model_validate(result).model_dump()
            immutable(receipt, result)
        # systemd mounts queue and private authority separately: cross-mount rename
        # is EXDEV even on one backing filesystem. Copy evidence first, then move
        # atomically inside the queue mount; retain both on interrupted completion.
        if archived.exists():
            if bounded(archived, publisher.MAX_REQUEST) != raw:
                raise ValueError("PUBLICATION_RETIREMENT_CONFLICT")
        else:
            atomic_bytes(archived, raw, replace=False)
        retired_directory.mkdir(mode=0o700, exist_ok=True)
        protected(retired_directory)
        if retired_envelope.exists():
            raise ValueError("PUBLICATION_RETIREMENT_CONFLICT")
        os.rename(queued, retired_envelope)
        for directory in (job, queue, retired_directory):
            descriptor = os.open(directory, os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return dict(result)
