from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from python.research import experiment_registry as r
from python.research.learning_evidence import encoded
from tests.python.test_learning_bridge import packet
from tests.python.test_observation_cycle import job, run

CODE = {"python/research/experiments/registered_audit.py": b"raise RuntimeError('never execute')\n"}


def method(**changes: Any) -> r.Method:
    return r.Method.model_validate(
        {
            "methodId": "acceptance-audit-1.0",
            "hypothesis": "Recorded acceptances cover all submitted entries.",
            "baseline": "All submitted entries in the bounded observation cohort.",
            "measurement": "Count exact acknowledgements and unresolved submissions separately.",
            "falsification": "Any unresolved submission contradicts complete acceptance coverage.",
            "runtimeSha256": "a" * 64,
            "costPolicy": "RECORDED_SIGNED_COSTS_ONLY_UNKNOWN_COUNTERFACTUALS_NULL",
            "cohortPolicy": "ALL_ROWS_RETAIN_OPEN_GAP_PARTIAL_NONFILL_AND_CARRY_IN",
            "dataUse": "RETROSPECTIVE_EXPLORATORY_NOT_PROSPECTIVE",
            **changes,
        }
    )


@pytest.fixture
def fixture(tmp_path: Path) -> tuple[r.Registry, Path, datetime]:
    source = tmp_path / "observations"
    run(source, packet())
    return r.Registry(tmp_path / "registry"), job(source), datetime.now(UTC)


def register(fixture: tuple[r.Registry, Path, datetime]) -> r.Registration:
    registry, review, now = fixture
    return registry.register(review, method(), CODE, now)


def outcome(value: r.Registration, claim: dict[str, Any], kind: str = "NEGATIVE") -> r.Outcome:
    return r.Outcome.model_validate(
        {
            "trialId": value.trialId,
            "claimSha256": r.sha(encoded(claim)),
            "resultSha256": r.sha(b"result"),
            "kind": kind,
            "recordedAt": datetime.now(UTC).isoformat(),
            "independentValidation": False,
            "counterfactualNet": None,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
    )


def test_closed_finding_freezes_whole_job_without_execution(fixture: Any) -> None:
    registry, review, _ = fixture
    value = register(fixture)
    folder, loaded = registry.load(value.questionId, value.trialId)
    assert loaded == value
    assert (folder / "input.json").read_bytes() == (review / "input.json").read_bytes()
    assert bytes.fromhex(json.loads((folder / "code.json").read_text())[next(iter(CODE))]) == next(
        iter(CODE.values())
    )
    assert registry.status(value.questionId, value.trialId)["status"] == "REGISTERED_UNQUALIFIED"
    assert not value.executionAuthority and value.counterfactualCosts is None


def test_repeat_registration_and_claim_are_idempotent(fixture: Any) -> None:
    registry, _, now = fixture
    value = register(fixture)
    assert register(fixture) == value
    assert registry.claim(value.questionId, value.trialId, now) is not None
    assert registry.claim(value.questionId, value.trialId, now + timedelta(days=1)) is None
    assert registry.status(value.questionId, value.trialId)["status"] == "CLAIMED_OUTCOME_UNKNOWN"
    assert registry.status(value.questionId, value.trialId)["questionOccurrences"] == 1


@pytest.mark.parametrize(
    "kind", ["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "REJECTED", "FAILED", "OPEN", "GAP"]
)
def test_every_outcome_is_retained_without_independent_or_economic_claim(
    fixture: Any, kind: str
) -> None:
    registry, _, now = fixture
    value = register(fixture)
    claim = registry.claim(value.questionId, value.trialId, now)
    result = outcome(value, claim, kind)
    registry.retain(value.questionId, result, b"result")
    registry.retain(value.questionId, result, b"result")
    state = registry.status(value.questionId, value.trialId)
    assert state["status"] == "RECORDED_UNVERIFIED_" + kind
    assert not state["promotionAuthority"]
    assert registry.claim(value.questionId, value.trialId, now) is None


@pytest.mark.parametrize(
    "target",
    [
        "closed.json",
        "response.json",
        "finding.json",
        "input.json",
        "diagnostic.json",
        "claim.json",
        "plan.json",
    ],
)
def test_altered_source_review_rejects_without_registering(fixture: Any, target: str) -> None:
    registry, review, _ = fixture
    (review / target).write_text("{}")
    with pytest.raises((ValueError, KeyError)):
        register(fixture)
    assert not list(registry.root.rglob("registration.json"))


@pytest.mark.parametrize("target", ["finding.json", "input.json", "code.json", "registration.json"])
def test_frozen_job_tampering_blocks_claim(fixture: Any, target: str) -> None:
    registry, _, now = fixture
    value = register(fixture)
    folder = registry.directory(value.questionId, value.trialId)
    (folder / target).write_text("{}")
    with pytest.raises((ValueError, KeyError)):
        registry.claim(value.questionId, value.trialId, now)
    assert not (folder / "claim.json").exists()


def test_interrupted_registration_recovers_without_duplicate_trial(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, _, _ = fixture
    original = r.immutable

    def fail(path: Path, value: Any) -> None:
        if path.name == "registration.json":
            raise OSError("power loss")
        original(path, value)

    monkeypatch.setattr(r, "immutable", fail)
    with pytest.raises(OSError):
        register(fixture)
    monkeypatch.setattr(r, "immutable", original)
    value = register(fixture)
    assert registry.status(value.questionId, value.trialId)["reservedTrials"] == 1


def test_crash_after_claim_cannot_grant_redispatch(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, _, now = fixture
    value = register(fixture)
    original = r.immutable

    def fail(path: Path, data: Any) -> None:
        original(path, data)
        if path.name == "claim.json":
            raise OSError("lost acknowledgement")

    monkeypatch.setattr(r, "immutable", fail)
    with pytest.raises(OSError):
        registry.claim(value.questionId, value.trialId, now)
    monkeypatch.setattr(r, "immutable", original)
    assert registry.claim(value.questionId, value.trialId, now) is None


def test_result_before_outcome_interruption_recovers(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, _, now = fixture
    value = register(fixture)
    result = outcome(value, registry.claim(value.questionId, value.trialId, now))
    original = r.immutable

    def fail(path: Path, data: Any) -> None:
        if path.name == "outcome.json":
            raise OSError("power loss")
        original(path, data)

    monkeypatch.setattr(r, "immutable", fail)
    with pytest.raises(OSError):
        registry.retain(value.questionId, result, b"result")
    assert registry.status(value.questionId, value.trialId)["status"] == "CLAIMED_OUTCOME_UNKNOWN"
    monkeypatch.setattr(r, "immutable", original)
    registry.retain(value.questionId, result, b"result")
    assert (
        registry.status(value.questionId, value.trialId)["status"] == "RECORDED_UNVERIFIED_NEGATIVE"
    )


def test_budget_counts_failed_unknown_and_changed_code_without_reset(fixture: Any) -> None:
    registry, review, now = fixture
    for index in range(r.MAX_TRIALS):
        code = {next(iter(CODE)): str(index).encode()}
        value = registry.register(review, method(), code, now)
        assert registry.claim(value.questionId, value.trialId, now)
    with pytest.raises(ValueError, match="TRIAL_BUDGET"):
        registry.register(review, method(), {next(iter(CODE)): b"another"}, now)
    assert registry.status(value.questionId, value.trialId)["reservedTrials"] == r.MAX_TRIALS


@pytest.mark.parametrize(
    "change",
    [
        {"dataUse": "PROSPECTIVE"},
        {"costPolicy": "ASSUME_ZERO_FEES"},
        {"cohortPolicy": "COMPLETE_WINNERS"},
        {"execute": True},
    ],
)
def test_method_cannot_claim_prospective_cost_or_execution_authority(change: Any) -> None:
    with pytest.raises(ValueError):
        method(**change)


def test_symlink_and_path_escape_rejected(fixture: Any, tmp_path: Path) -> None:
    registry, _, now = fixture
    value = register(fixture)
    with pytest.raises(ValueError):
        registry.claim("../elsewhere", value.trialId, now)
    (registry.root / ".lock").unlink()
    (registry.root / ".lock").symlink_to(tmp_path / "elsewhere")
    with pytest.raises(ValueError):
        registry.claim(value.questionId, value.trialId, now)


def test_foreign_or_conflicting_result_does_not_replace_evidence(fixture: Any) -> None:
    registry, _, now = fixture
    value = register(fixture)
    result = outcome(value, registry.claim(value.questionId, value.trialId, now))
    with pytest.raises(ValueError):
        registry.retain(
            value.questionId, result.model_copy(update={"claimSha256": "f" * 64}), b"result"
        )
    registry.retain(value.questionId, result, b"result")
    with pytest.raises(ValueError):
        registry.retain(value.questionId, result.model_copy(update={"kind": "POSITIVE"}), b"result")
    assert (
        registry.status(value.questionId, value.trialId)["status"] == "RECORDED_UNVERIFIED_NEGATIVE"
    )


def test_schemas_match_runtime_models() -> None:
    for cls, name in [
        (r.Registration, "research-experiment-registration-1.0"),
        (r.Outcome, "research-experiment-outcome-1.0"),
    ]:
        assert json.loads(Path("schemas", name + ".json").read_text()) == cls.model_json_schema()


def test_concurrent_coordinator_cannot_claim_while_lock_held(fixture: Any) -> None:
    registry, _, now = fixture
    value = register(fixture)
    with registry.locked(), pytest.raises(BlockingIOError):
        r.Registry(registry.root).claim(value.questionId, value.trialId, now)
    assert registry.claim(value.questionId, value.trialId, now)


def test_future_review_or_early_claim_rejects(fixture: Any) -> None:
    registry, review, now = fixture
    with pytest.raises(ValueError):
        registry.register(review, method(), CODE, now - timedelta(days=1))
    value = register(fixture)
    with pytest.raises(ValueError, match="CLAIM_CLOCK"):
        registry.claim(value.questionId, value.trialId, now - timedelta(seconds=1))


def test_code_path_size_and_question_capacity_fail_before_claim(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, review, now = fixture
    with pytest.raises(ValueError):
        registry.register(review, method(), {"../../execution.py": b"bad"}, now)
    with pytest.raises(ValueError):
        registry.register(review, method(), {next(iter(CODE)): b"x" * 300000}, now)
    monkeypatch.setattr(r, "MAX_QUESTIONS", 0)
    with pytest.raises(ValueError, match="QUESTION_CAPACITY"):
        register(fixture)
    assert not list(registry.root.rglob("claim.json"))


def test_status_rejects_corrupted_claim_after_result(fixture: Any) -> None:
    registry, _, now = fixture
    value = register(fixture)
    claim = registry.claim(value.questionId, value.trialId, now)
    registry.retain(value.questionId, outcome(value, claim), b"result")
    path = registry.directory(value.questionId, value.trialId) / "claim.json"
    path.write_text("{}")
    with pytest.raises((KeyError, ValueError)):
        registry.status(value.questionId, value.trialId)


@pytest.mark.parametrize("interrupt", [False, True])
def test_new_closed_finding_for_same_trial_preserves_original_provenance(
    fixture: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, interrupt: bool
) -> None:
    from tests.python.test_observation_cycle import answer

    registry, review, _ = fixture
    original = r.immutable

    def fail(path: Path, data: Any) -> None:
        if path.name == "registration.json":
            raise OSError("power loss")
        original(path, data)

    if interrupt:
        monkeypatch.setattr(r, "immutable", fail)
        with pytest.raises(OSError):
            register(fixture)
        monkeypatch.setattr(r, "immutable", original)
    else:
        register(fixture)

    def another(prompt: str, directory: Path) -> bytes:
        data = json.loads(answer(prompt, directory))
        data["summary"] = "Another valid interpretation of the same observations."
        return encoded(data)

    second_root = tmp_path / "second-review"
    run(second_root, packet(), invoke=another)
    value = registry.register(job(second_root), method(), CODE, datetime.now(UTC))
    assert value.findingSha256 == r.sha((review / "finding.json").read_bytes())
    state = registry.status(value.questionId, value.trialId)
    assert state["reservedTrials"] == 1 and state["questionOccurrences"] == 2


def test_source_interpretation_upper_bound_is_admitted(fixture: Any, tmp_path: Path) -> None:
    from tests.python.test_observation_cycle import answer

    registry, _, _ = fixture
    maximum = r.Interpretation.model_json_schema()["properties"]["requiredEvidence"]["maxLength"]

    def long_answer(prompt: str, directory: Path) -> bytes:
        data = json.loads(answer(prompt, directory))
        data["requiredEvidence"] = "x" * maximum
        return encoded(data)

    root = tmp_path / "long-review"
    run(root, packet(), invoke=long_answer)
    value = registry.register(job(root), method(), CODE, datetime.now(UTC))
    assert len(value.requiredEvidence) == maximum


def test_interrupted_registration_cannot_seal_corrupted_original_finding(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, _, _ = fixture
    original = r.immutable

    def fail(path: Path, data: Any) -> None:
        if path.name == "registration.json":
            raise OSError("power loss")
        original(path, data)

    monkeypatch.setattr(r, "immutable", fail)
    with pytest.raises(OSError):
        register(fixture)
    monkeypatch.setattr(r, "immutable", original)
    finding = next(registry.root.rglob("finding.json"))
    data = json.loads(finding.read_text())
    data["interpretation"]["summary"] = "This text was never in the original review."
    finding.write_bytes(encoded(data))
    with pytest.raises((OSError, ValueError)):
        register(fixture)
    assert not list(registry.root.rglob("registration.json"))


def test_interrupted_registration_rejects_other_packet_finding_even_in_same_window(
    fixture: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry, review, _ = fixture
    original = r.immutable

    def fail(path: Path, data: Any) -> None:
        if path.name == "registration.json":
            raise OSError("power loss")
        original(path, data)

    monkeypatch.setattr(r, "immutable", fail)
    with pytest.raises(OSError):
        register(fixture)
    monkeypatch.setattr(r, "immutable", original)
    interrupted = next(registry.root.rglob("finding.json"))
    # Same source/window/question, but a different exact packet export.
    other = packet()
    other["exportedAt"] = "2026-10-28T00:32:00+00:00"
    root = tmp_path / "other-packet"
    run(root, other)
    other_value = registry.register(job(root), method(), CODE, datetime.now(UTC))
    assert other_value.packetSha256 != r.sha((review / "input.json").read_bytes())
    interrupted.write_bytes((job(root) / "finding.json").read_bytes())
    with pytest.raises(ValueError, match="ORIGIN_BINDING"):
        registry.register(review, method(), CODE, datetime.now(UTC))
    assert not (interrupted.parent / "registration.json").exists()
