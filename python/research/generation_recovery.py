"""Recover only completed, never-scored standalone generation after main-only drift."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from python.research import holding_task as task
from python.research.experiment_registry import read
from python.research.learning_archive import immutable
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha
from python.research.source_verifier import GitObjects, MirrorTrust

CONTRACT_FILES = (
    "python/research/holding_task.py",
    "python/research/candidate_attestation.py",
    "python/research/holding_attestation.py",
    "python/research/publisher_policy.py",
    "python/research/learning_evidence.py",
    "python/research/learning_archive.py",
    "python/research/codex_loop.py",
    "python/research/research_pacing.py",
    "python/research/source_verifier.py",
    "python/research/isolated_worker.py",
    "python/research/holding_mailbox.py",
    "python/research/holding_authority.py",
    "requirements.lock",
)


def resumable(job: Path) -> bool:
    """Unknown/rejected/scored/published work never grants this recovery permission."""
    if (
        not (job / "generation" / "claim.json").exists()
        or not (job / "generation" / "response.json").exists()
        or any((job / name).exists() for name in ("scoring", "publication.json", "rejected.json"))
    ):
        return False
    return bool(
        read(job / "generation" / "response.json", 17 * 1024 * 1024).get("status")
        == "GENERATED_UNVERIFIED"
    )


def prepare_rebase(
    job: Path,
    draft: task.Draft,
    facts: dict[str, Any],
    trust: MirrorTrust,
    artifacts: dict[str, bytes],
) -> tuple[Path, task.Draft]:
    if not resumable(job):
        raise ValueError("GENERATION_REBASE_NOT_UNSCORED")
    deliveries = list(job.glob("delivery-*"))
    if len(deliveries) >= 16 and not (job / ("delivery-" + trust.expected_main)).exists():
        raise ValueError("GENERATION_REBASE_CAPACITY")
    if any(
        p.name != "delivery-" + trust.expected_main and (p / "scoring" / "claim.json").exists()
        for p in deliveries
    ):
        raise ValueError("GENERATION_REBASE_PRIOR_SCORING_UNKNOWN_OR_REVIEWED")
    trust.verify()
    objects = GitObjects(trust)
    objects.command("merge-base", "--is-ancestor", draft.baseCommit, trust.expected_main)
    old_contract = objects.command("ls-tree", "-rz", draft.baseCommit, "--", *CONTRACT_FILES)
    new_contract = objects.command("ls-tree", "-rz", trust.expected_main, "--", *CONTRACT_FILES)
    if old_contract != new_contract or len(old_contract.split(b"\0")) != len(CONTRACT_FILES) + 1:
        raise ValueError("GENERATION_REBASE_CONTRACT_CHANGED")
    if objects.command(
        "ls-tree", "-r", "--name-only", draft.baseCommit, "--", task.MODULE, task.NOTE
    ):
        raise ValueError("GENERATION_REBASE_OLD_PATH_CONFLICT")
    if task.admission(trust)["status"] != "ELIGIBLE":
        raise ValueError("GENERATION_REBASE_CURRENT_PATH_CONFLICT")
    task.candidate_files(draft, facts, draft.baseCommit)
    derived = job / ("delivery-" + trust.expected_main)
    derived.mkdir(mode=0o700, exist_ok=True)
    immutable(
        derived / "generation-rebase.json",
        {
            "version": "standalone-generation-rebase-1.0",
            "originalBase": draft.baseCommit,
            "deliveryBase": trust.expected_main,
            "originalDraftSha256": sha(encoded(draft.model_dump())),
            "originalArtifacts": {name: sha(raw) for name, raw in artifacts.items()},
            "unchangedContractSha256": sha(new_contract),
            "reason": "COMPLETED_UNSCORED_STANDALONE_CODE_NO_NEW_PROVIDER_CALL",
            "requiresFreshScoringAndIndependentReview": True,
            "brokerAuthority": False,
            "promotionAuthority": False,
        },
    )
    return derived, draft.model_copy(update={"baseCommit": trust.expected_main})
