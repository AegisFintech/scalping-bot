from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from python.operations import holding_pipeline as pipeline
from python.research import holding_authority as authority
from python.research import holding_mailbox as mailbox
from python.research.learning_evidence import encoded
from tests.python import test_holding_mailbox as helpers
from tests.python.test_holding_mailbox import invoke, request


@pytest.fixture
def closed(tmp_path):
    return helpers.closed.__wrapped__(tmp_path)


def test_lost_submission_only_queries_after_restart(tmp_path, monkeypatch, closed):
    box = mailbox.Mailbox(tmp_path / "generation", "generation")
    calls = []

    def transfer(role, value):
        calls.append(value["action"])
        if value["action"] == "submit":
            box.submit(encoded(value["request"]))
            raise TimeoutError
        return box.query(value["job"])

    monkeypatch.setattr(pipeline, "transfer", transfer)
    value = request(closed)
    job = tmp_path / "job"
    job.mkdir()
    with pytest.raises(TimeoutError):
        pipeline.remote(job, "generation", value)
    assert pipeline.remote(job, "generation", value)["status"] == "QUEUED_OR_UNKNOWN"
    box.work(invoke=invoke)
    assert pipeline.remote(job, "generation", value)["status"] == "GENERATED_UNVERIFIED"
    assert pipeline.remote(job, "generation", value)["status"] == "GENERATED_UNVERIFIED"
    assert calls == ["submit", "query", "query"]


def test_unreceived_unknown_never_resubmits(tmp_path, monkeypatch):
    calls = []

    def transfer(role, value):
        calls.append(value["action"])
        if value["action"] == "submit":
            raise TimeoutError
        return {"job": value["job"], "status": "NOT_RECEIVED"}

    monkeypatch.setattr(pipeline, "transfer", transfer)
    with pytest.raises(TimeoutError):
        pipeline.remote(tmp_path, "generation", {"probe": True})
    assert pipeline.remote(tmp_path, "generation", {"probe": True})["status"] == "NOT_RECEIVED"
    assert calls == ["submit", "query"]


def test_empty_or_delivered_task_waits_without_provider_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "refresh", lambda _: SimpleNamespace(expected_main="a" * 40))
    monkeypatch.setattr(pipeline.task, "admission", lambda _: {"status": "TASK_ALREADY_PRESENT"})
    monkeypatch.setattr(pipeline, "transfer", lambda *_: pytest.fail("delivered task redispatch"))
    assert pipeline.cycle(tmp_path, {})["status"] == "TASK_ALREADY_PRESENT"
    monkeypatch.setattr(pipeline.task, "admission", lambda _: {"status": "ELIGIBLE"})
    monkeypatch.setattr(pipeline, "transfer", lambda _, request: {"status": "NO_CLOSED_ROWS"})
    result = pipeline.cycle(tmp_path, {})
    assert result["status"] == "NO_CLOSED_ROWS"
    public = pipeline.delivery.generation(tmp_path, result)
    assert public.status == "NO_CLOSED_ROWS" and public.checkedAt == result["checkedAt"]
    assert public.job is public.origin is None


def test_signed_pending_publication_never_generates_redundant_candidate(tmp_path, monkeypatch):
    state = {
        "status": "SIGNED",
        "baseCommit": "a" * 40,
        "job": "b" * 64,
        "publicationSha256": "c" * 64,
    }
    (tmp_path / "state.json").write_bytes(encoded(state))
    monkeypatch.setattr(pipeline, "refresh", lambda _: SimpleNamespace(expected_main="a" * 40))
    monkeypatch.setattr(pipeline.task, "admission", lambda _: {"status": "ELIGIBLE"})
    monkeypatch.setattr(pipeline, "transfer", lambda *_: pytest.fail("pending task redispatch"))
    assert pipeline.cycle(tmp_path, {})["reason"] == "HOLDING_AWAITING_PUBLICATION"


@pytest.mark.parametrize("lose_relay", [False, True])
def test_real_source_and_signed_handoff_keeps_one_provider_call(
    tmp_path, monkeypatch, closed, lose_relay
):
    import subprocess

    from tests.python import test_holding_attestation as scoring
    from tests.python import test_source_verifier as sources

    _, _, _, _, trust = sources.fixture.__wrapped__(tmp_path / "git", monkeypatch)
    monkeypatch.setattr(authority, "trusted_path", lambda _: None)
    monkeypatch.setattr(pipeline, "refresh", lambda _: trust)
    monkeypatch.setattr(pipeline, "main_sha", lambda: trust.expected_main)
    generator = mailbox.Mailbox(tmp_path / "generation", "generation")
    scorer = mailbox.Mailbox(tmp_path / "scoring", "scoring")
    calls = []
    relays = []

    def transfer(role, value):
        if value["action"] == "discover":
            return {
                "status": "ELIGIBLE",
                "experiment": mailbox.archive(closed),
                "invalidArchives": 2,
            }
        if value["action"] == "publication":
            relays.append(value["envelope"])
            if lose_relay and len(relays) == 1:
                raise TimeoutError("lost readonly relay acknowledgement")
            import base64

            from python.operations import research_publisher as publisher

            data = json.loads(value["envelope"])
            return {
                "status": "PUBLICATION_CACHED",
                "publicationSha256": publisher.sha(base64.b64decode(data["payload"])),
            }
        box = generator if role == "generation" else scorer
        return (
            box.submit(encoded(value["request"]))
            if value["action"] == "submit"
            else box.query(value["job"])
        )

    monkeypatch.setattr(pipeline, "transfer", transfer)
    _, _, worker_trust = scoring.context.__wrapped__(tmp_path / "worker", monkeypatch)
    oracle = mailbox.scorer.oracle_pin()
    original_attest = mailbox.scorer.attest
    monkeypatch.setattr(
        mailbox.scorer, "attest", lambda *args: original_attest(*args, execute=scoring.execute)
    )
    key = tmp_path / "key"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    queue = tmp_path / "queue"
    queue.mkdir()
    config = {
        "formatter": str(Path(".venv/bin/ruff").absolute()),
        "signingKey": str(key),
        "queue": str(queue),
        "pins": {
            "runtimeSha256": worker_trust.runtime_sha256,
            "verifierSha256": worker_trust.verifier_sha256,
            "oracleSha256": oracle,
        },
    }
    root = tmp_path / "authority"
    assert pipeline.cycle(root, config)["status"] == "QUEUED_OR_UNKNOWN"

    def once(prompt, job):
        calls.append(1)
        return invoke(prompt, job)

    generator.work(invoke=once)
    assert pipeline.cycle(root, config)["status"] == "QUEUED_OR_UNKNOWN"
    scorer.work(trust=worker_trust, oracle=oracle)
    if lose_relay:
        with pytest.raises(TimeoutError):
            pipeline.cycle(root, config)
    value = pipeline.cycle(root, config)
    assert value["status"] == "SIGNED" and len(calls) == 1 and len(list(queue.iterdir())) == 1
    assert value["invalidArchives"] == 2
    assert pipeline.cycle(root, config)["status"] == "SIGNED" and len(calls) == 1
    assert json.loads((root / "state.json").read_bytes())["promotionAuthority"] is False


def test_protected_active_pointer_precedes_any_remote_dispatch(tmp_path, monkeypatch, closed):
    monkeypatch.setattr(pipeline, "refresh", lambda _: SimpleNamespace(expected_main="a" * 40))
    monkeypatch.setattr(pipeline.task, "admission", lambda _: {"status": "ELIGIBLE"})

    def transfer(role, value):
        if value["action"] == "discover":
            return {
                "status": "ELIGIBLE",
                "experiment": mailbox.archive(closed),
                "invalidArchives": 2,
            }
        state = json.loads((tmp_path / "authority" / "state.json").read_bytes())
        assert state["status"] == "CLAIMED" and state["job"]
        raise TimeoutError

    monkeypatch.setattr(pipeline, "transfer", transfer)
    with pytest.raises(TimeoutError):
        pipeline.cycle(tmp_path / "authority", {})
    assert json.loads((tmp_path / "authority" / "state.json").read_bytes())["status"] == "CLAIMED"


def test_source_drift_keeps_old_claims_query_only(tmp_path, monkeypatch):
    job = tmp_path / ("a" * 64)
    (job / "generation").mkdir(parents=True)
    (job / "generation" / "claim.json").write_bytes(encoded({"requestSha256": "b" * 64}))
    (tmp_path / "state.json").write_bytes(encoded({"job": job.name, "status": "OUTCOME_UNKNOWN"}))
    monkeypatch.setattr(pipeline, "refresh", lambda _: SimpleNamespace(expected_main="c" * 40))
    monkeypatch.setattr(pipeline.task, "admission", lambda _: {"status": "TASK_ALREADY_PRESENT"})
    calls = []

    def transfer(role, value):
        calls.append(value)
        return {"job": value["job"], "status": "OUTCOME_UNKNOWN"}

    monkeypatch.setattr(pipeline, "transfer", transfer)
    assert pipeline.cycle(tmp_path, {})["existingClaims"] == {"generation": "OUTCOME_UNKNOWN"}
    assert calls == [{"action": "query", "job": "b" * 64}]
