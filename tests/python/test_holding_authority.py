from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path

import pytest

from python.operations.research_publisher import HoldingPublication, authenticate
from python.research import holding_attestation as scorer
from python.research import holding_authority as authority
from python.research import holding_mailbox as mailbox
from python.research import holding_task as task
from python.research.learning_evidence import encoded
from tests.python import test_holding_attestation as scoring
from tests.python import test_holding_publication as publications
from tests.python import test_source_verifier as sources


def test_prepare_real_git_objects_preserves_original_and_reuses_exact_source(tmp_path, monkeypatch):
    _, _, _, _, trust = sources.fixture.__wrapped__(tmp_path, monkeypatch)
    monkeypatch.setattr(authority, "trusted_path", lambda _: None)
    facts = {"trialId": "a" * 64, "resultSha256": "b" * 64, "findingSha256": "c" * 64, "rows": []}
    draft = task.Draft(
        task=task.TASK,
        baseCommit=trust.expected_main,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code="def report(rows): return {}\n",
        rationale="Fixture",
    )
    path = tmp_path / "preparation"
    formatter = Path(".venv/bin/ruff").absolute()
    first = authority.prepare(draft, facts, trust, path, formatter)
    assert first.files[task.MODULE] == b"def report(rows):\n    return {}\n"
    assert json.loads((path / "original-draft.json").read_bytes())["code"] == draft.code
    assert authority.prepare(draft, facts, trust, path, formatter) == first
    assert first.receipt.objectBytesVerified and not first.receipt.testsPassed
    with pytest.raises(ValueError, match="BASE_OR_RESULT_CHANGED"):
        authority.prepare(
            draft.model_copy(update={"baseCommit": "f" * 40}), facts, trust, path, formatter
        )


@pytest.fixture
def context(tmp_path, monkeypatch):
    verified, facts, trust = scoring.context.__wrapped__(tmp_path, monkeypatch)
    path = tmp_path / "attestation"
    receipt = scorer.attest(
        verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), scoring.execute
    )
    pins = {k: receipt[k] for k in ("runtimeSha256", "verifierSha256", "oracleSha256")}
    response = {
        "job": "a" * 64,
        "requestSha256": "a" * 64,
        "status": receipt["status"],
        "outcome": receipt,
        "artifacts": {
            p.name: p.read_bytes().hex()
            for p in path.iterdir()
            if p.name
            in {"binding.json", "input.json", "claim.json", "output.json", "attestation.json"}
        },
    }
    return verified, facts, pins, response


def test_protected_parent_independently_recomputes_all_outputs_and_binds_source(context):
    verified, facts, pins, response = context
    value = authority.publication(
        response,
        "a" * 64,
        verified,
        facts,
        pins,
        bytes.fromhex(response["artifacts"]["input.json"]),
    )
    assert value.attestation["actualReport"] == task.expected(facts["rows"])
    assert not value.attestation["publishAuthority"]
    mailbox.Scoring(
        version="holding-scoring-request-1.0",
        task=task.TASK,
        source=verified.receipt,
        facts=facts,
        inputHex=response["artifacts"]["input.json"],
        files={p: v.hex() for p, v in verified.files.items()},
    )


@pytest.mark.parametrize(
    "name", ["request", "source", "rows", "runtime", "oracle", "output", "input"]
)
def test_untrusted_remote_self_reports_and_changed_inputs_never_sign(context, name):
    verified, facts, pins, original = context
    response = copy.deepcopy(original)
    if name == "request":
        response["requestSha256"] = "b" * 64
    elif name == "source":
        response["outcome"]["source"]["baseCommit"] = "f" * 40
    elif name == "rows":
        facts = {**facts, "rows": []}
    elif name in ("runtime", "oracle"):
        pins = {**pins, name + "Sha256": "f" * 64}
    else:
        path = name + ".json"
        value = json.loads(bytes.fromhex(response["artifacts"][path]))
        if name == "output":
            value["outputHex"] = b'[{"softwareTestsPassed":true}]'.hex()
        else:
            value["cases"][0] = []
        response["artifacts"][path] = encoded(value).hex()
    with pytest.raises(ValueError):
        authority.publication(
            response,
            "a" * 64,
            verified,
            facts,
            pins,
            bytes.fromhex(original["artifacts"]["input.json"]),
        )


def test_real_ssh_signature_queue_idempotence_and_late_source_cas(tmp_path, monkeypatch):
    monkeypatch.setattr(authority, "trusted_path", lambda _: None)
    payload = HoldingPublication.model_validate(publications.publication())
    key = tmp_path / "key"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    signers = tmp_path / "signers"
    signers.write_text("scalper-attestor " + key.with_suffix(".pub").read_text())
    job, outbox = tmp_path / "job", tmp_path / "queue"
    job.mkdir()
    outbox.mkdir()
    values = iter([payload.baseCommit, "f" * 40])
    with pytest.raises(ValueError, match="BEFORE_QUEUE"):
        authority.queue(payload, job, outbox, key, lambda: next(values))
    assert not list(outbox.iterdir())
    digest = authority.queue(payload, job, outbox, key, lambda: payload.baseCommit)
    path = outbox / (digest + ".json")
    assert authenticate(path.read_bytes(), signers)[0] == payload
    assert authority.queue(payload, job, outbox, key, lambda: payload.baseCommit) == digest
    assert len(list(outbox.iterdir())) == 1
    path.write_bytes(b"changed")
    with pytest.raises(ValueError, match="QUEUE_CONFLICT"):
        authority.queue(payload, job, outbox, key, lambda: payload.baseCommit)


def test_remote_cannot_replace_other_cases_and_rehash_a_self_declared_pass(context):
    verified, facts, pins, original = context
    value = copy.deepcopy(original)
    challenge = json.loads(bytes.fromhex(value["artifacts"]["input.json"]))
    challenge["cases"][1:] = [[]] * 27
    data = encoded(challenge)
    expected = encoded([task.expected(c) for c in challenge["cases"]])
    from python.research.observation_cycle import sha

    receipt = value["outcome"]
    receipt.update(inputSha256=sha(data), outputSha256=sha(expected), expectedSha256=sha(expected))
    claim = json.loads(bytes.fromhex(value["artifacts"]["claim.json"]))
    claim["inputSha256"] = sha(data)
    value["artifacts"].update(
        {
            "input.json": data.hex(),
            "output.json": encoded({"exitCode": 0, "outputHex": expected.hex()}).hex(),
            "claim.json": encoded(claim).hex(),
            "attestation.json": encoded(receipt).hex(),
        }
    )
    with pytest.raises(ValueError, match="INPUT_CHANGED"):
        authority.publication(
            value,
            "a" * 64,
            verified,
            facts,
            pins,
            bytes.fromhex(original["artifacts"]["input.json"]),
        )
