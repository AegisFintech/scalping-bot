import json
from dataclasses import replace
from pathlib import Path

import pytest

from python.research import generation_recovery as recovery
from python.research import holding_task as task
from python.research.learning_evidence import encoded
from tests.python import test_source_verifier as git
from tests.python.test_holding_preparation import CODE


def setup(tmp_path, monkeypatch, changed: str | None = None):
    directory, files, _, _, trust = git.fixture.__wrapped__(tmp_path / "git", monkeypatch)
    contracts = {name: Path(name).read_bytes() for name in recovery.CONTRACT_FILES}
    old_tree = git.tree(directory, {**files, **contracts})
    old = git.git(
        directory, "commit-tree", old_tree, "-p", trust.expected_main, raw=b"old contract"
    ).decode()
    newer = {**files, **contracts, "README.md": b"new operational documentation"}
    if changed:
        newer[changed] = b"changed protected contract"
    current_tree = git.tree(directory, newer)
    current = git.git(
        directory, "commit-tree", current_tree, "-p", old, raw=b"current main"
    ).decode()
    git.git(directory, "update-ref", "refs/heads/main", current)
    trust = replace(trust, expected_main=current)
    facts = {"trialId": "a" * 64, "resultSha256": "b" * 64, "findingSha256": "c" * 64}
    draft = task.Draft(
        task=task.TASK,
        baseCommit=old,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code=CODE,
        rationale="Test standalone generation recovery; no economic conclusion.",
    )
    job = tmp_path / "job"
    (job / "generation").mkdir(parents=True)
    (job / "generation" / "claim.json").write_bytes(encoded({"requestSha256": "d" * 64}))
    (job / "generation" / "response.json").write_bytes(encoded({"status": "GENERATED_UNVERIFIED"}))
    return job, draft, facts, trust


def test_rebase_keeps_original_provider_bytes_and_repeated_delivery_identity(tmp_path, monkeypatch):
    job, draft, facts, trust = setup(tmp_path, monkeypatch)
    original = {p.name: p.read_bytes() for p in (job / "generation").iterdir()}
    derived, current = recovery.prepare_rebase(
        job, draft, facts, trust, {"draft.json": encoded(draft.model_dump())}
    )
    assert current.code == draft.code and current.baseCommit == trust.expected_main
    assert draft.baseCommit != current.baseCommit
    receipt = json.loads((derived / "generation-rebase.json").read_bytes())
    assert receipt["requiresFreshScoringAndIndependentReview"]
    assert not receipt["brokerAuthority"]
    assert recovery.prepare_rebase(
        job, draft, facts, trust, {"draft.json": encoded(draft.model_dump())}
    ) == (derived, current)
    assert original == {p.name: p.read_bytes() for p in (job / "generation").iterdir()}


@pytest.mark.parametrize("changed", recovery.CONTRACT_FILES)
def test_changed_contract_cannot_be_rebased(tmp_path, monkeypatch, changed):
    job, draft, facts, trust = setup(tmp_path, monkeypatch, changed=changed)
    with pytest.raises(ValueError, match="GENERATION_REBASE_CONTRACT_CHANGED"):
        recovery.prepare_rebase(job, draft, facts, trust, {})


@pytest.mark.parametrize("state", ["OUTCOME_UNKNOWN", "REJECTED", "QUEUED_OR_UNKNOWN"])
def test_unknown_or_rejected_generation_never_rebases(tmp_path, monkeypatch, state):
    job, draft, facts, trust = setup(tmp_path, monkeypatch)
    (job / "generation" / "response.json").write_bytes(encoded({"status": state}))
    assert not recovery.resumable(job)
    with pytest.raises(ValueError, match="GENERATION_REBASE_NOT_UNSCORED"):
        recovery.prepare_rebase(job, draft, facts, trust, {})


def test_prior_scoring_claim_on_another_base_is_not_replayed(tmp_path, monkeypatch):
    job, draft, facts, trust = setup(tmp_path, monkeypatch)
    claimed = job / ("delivery-" + "e" * 40) / "scoring"
    claimed.mkdir(parents=True)
    (claimed / "claim.json").write_bytes(b"{}")
    with pytest.raises(ValueError, match="GENERATION_REBASE_PRIOR_SCORING_UNKNOWN_OR_REVIEWED"):
        recovery.prepare_rebase(job, draft, facts, trust, {})
