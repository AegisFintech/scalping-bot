from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.research import holding_mailbox as mailbox
from python.research import holding_task as task
from python.research.learning_evidence import encoded
from tests.python import test_candidate_attestation as helpers
from tests.python import test_experiment_execution as execution


@pytest.fixture
def closed(tmp_path):
    setup = execution.setup.__wrapped__(tmp_path)
    return helpers.closed.__wrapped__(setup)


def request(closed):
    return mailbox.Generation(
        version="holding-generation-request-1.0",
        task=task.TASK,
        baseCommit="a" * 40,
        experiment=mailbox.archive(closed),
    ).model_dump()


def invoke(prompt, job):
    binding = json.loads((job / "binding.json").read_bytes())
    return encoded(
        task.Draft(
            task=task.TASK,
            baseCommit=binding["baseCommit"],
            resultSha256=binding["resultSha256"],
            findingSha256=binding["findingSha256"],
            code="def report(rows):\n    return {}\n",
            rationale="software probe",
        ).model_dump()
    )


def test_generation_mailbox_duplicate_intake_and_completed_restart(closed, tmp_path):
    box = mailbox.Mailbox(tmp_path / "holding-mailbox", "generation")
    value = request(closed)
    first = box.submit(encoded(value))
    assert first["status"] == "QUEUED_OR_UNKNOWN"
    assert box.submit(encoded(value)) == first
    result = box.work(invoke=invoke)
    assert result["status"] == "GENERATED_UNVERIFIED"
    assert "response.json" in result["artifacts"]
    reopened = mailbox.Mailbox(box.root, "generation")
    assert reopened.query(first["job"]) == result
    assert reopened.work(invoke=lambda *_: pytest.fail("duplicate call"))["status"] == "IDLE"


def test_provider_unknown_is_never_replayed_after_worker_restart(closed, tmp_path):
    box = mailbox.Mailbox(tmp_path / "holding-mailbox", "generation")
    first = box.submit(encoded(request(closed)))
    calls = []

    def lost(*_):
        calls.append(1)
        raise TimeoutError

    with pytest.raises(TimeoutError):
        box.work(invoke=lost)
    reopened = mailbox.Mailbox(box.root, "generation")
    value = reopened.work(invoke=lambda *_: pytest.fail("unknown replay"))
    assert value["status"] == "OUTCOME_UNKNOWN" and len(calls) == 1
    assert reopened.query(first["job"]) == value


def test_worker_can_finish_saved_response_without_new_provider_call(closed, tmp_path, monkeypatch):
    from python.research import candidate_generation as generation

    box = mailbox.Mailbox(tmp_path / "holding-mailbox", "generation")
    box.submit(encoded(request(closed)))
    original = generation.immutable

    def crash(path, value):
        if path.name == "draft.json":
            raise KeyboardInterrupt
        return original(path, value)

    monkeypatch.setattr(generation, "immutable", crash)
    with pytest.raises(KeyboardInterrupt):
        box.work(invoke=invoke)
    monkeypatch.setattr(generation, "immutable", original)
    assert (
        box.work(invoke=lambda *_: pytest.fail("saved response replay"))["status"]
        == "GENERATED_UNVERIFIED"
    )


def test_archive_tamper_paths_and_wrong_role_reject(closed, tmp_path):
    value = request(closed)
    value["experiment"]["../escape"] = "00"
    with pytest.raises(ValueError):
        mailbox.Generation.model_validate(value)
    value = request(closed)
    value["experiment"]["result.bin"] = b"{}".hex()
    with pytest.raises(ValueError):
        mailbox.Generation.model_validate(value)
    box = mailbox.Mailbox(tmp_path / "holding-mailbox", "scoring")
    with pytest.raises(ValueError):
        box.submit(encoded(request(closed)))
    assert box.query("f" * 64)["status"] == "NOT_RECEIVED"
    with pytest.raises(ValueError):
        box.query("../escape")


def test_mailbox_preserves_rejections_and_task_budget(closed, tmp_path):
    box = mailbox.Mailbox(tmp_path / "holding-mailbox", "generation")
    for n in range(4):
        value = request(closed)
        value["baseCommit"] = str(n) * 40
        box.submit(encoded(value))
        assert box.work(invoke=lambda *_: b"{}")["status"] == "REJECTED"
    value["baseCommit"] = "4" * 40
    with pytest.raises(ValueError, match="TASK_BUDGET"):
        box.submit(encoded(value))


def test_discovery_empty_or_invalid_archives_never_invoke_provider(closed, tmp_path):
    root = closed.parent.parent
    assert mailbox.discover(root)["status"] == "NO_CLOSED_ROWS"
    (closed / "result.bin").write_bytes(b"invalid")
    value = mailbox.discover(root)
    assert value["status"] == "NO_CLOSED_ROWS" and value["invalidArchives"] == 1


def test_request_schemas_match_versioned_models():
    for cls in (mailbox.Generation, mailbox.Scoring):
        version = cls.model_fields["version"].annotation.__args__[0]
        assert (
            json.loads(Path("schemas", version + ".json").read_bytes()) == cls.model_json_schema()
        )
