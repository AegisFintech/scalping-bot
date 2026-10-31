from __future__ import annotations

import json

import pytest

from python.research import holding_attestation as scorer
from python.research import holding_task as task
from python.research import isolated_worker as worker
from python.research.learning_evidence import encoded
from python.research.source_verifier import VerifiedCandidate
from tests.python.test_candidate_attestation import verified as legacy_verified


@pytest.fixture
def context(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "trusted_path", lambda _: None)
    facts = {
        "trialId": "a" * 64,
        "resultSha256": "b" * 64,
        "findingSha256": "c" * 64,
        "rows": [{"holdingMicros": "5000000", "net": "-2", "signedFees": "-0.1"}],
    }
    draft = task.Draft(
        task=task.TASK,
        baseCommit="d" * 40,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code="def report(rows):\n    return {}\n",
        rationale="Fixture",
    )
    files = task.candidate_files(draft, facts, draft.baseCommit)
    receipt = legacy_verified(facts).receipt.model_copy(
        update={"baseCommit": draft.baseCommit, "bundleSha256": worker.bundle_digest(files)}
    )
    verified = VerifiedCandidate(receipt, files)
    trust = worker.WorkerTrust(
        tmp_path, "a" * 64, tmp_path / "verify.py", "b" * 64, "c" * 64, "d" * 64
    )
    return verified, facts, trust


def execute(files, bundle, trust, *, data, expected_input):
    value = json.loads(data)
    assert value["module"] == task.MODULE and "expected" not in value
    return worker.WorkerResult(
        bundle,
        trust.runtime_sha256,
        trust.verifier_sha256,
        0,
        encoded([task.expected(c) for c in value["cases"]]),
        input_sha256=expected_input,
    )


def test_independent_output_attests_and_restart_reuses_receipt(context, tmp_path):
    verified, facts, trust = context
    path = tmp_path / "attestation"
    value = scorer.attest(verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), execute)
    assert value["softwareTestsPassed"] is True and value["caseCount"] == 28
    assert value["publishAuthority"] is False and value["economicQualification"] is False
    assert value["actualReport"]["buckets"][1]["payoff"]["net"] == "-2"

    def forbidden(*_, **kw):
        pytest.fail("receipt reuse cannot execute")

    assert (
        scorer.attest(verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), forbidden)
        == value
    )


def test_unknown_execution_is_not_replayed(context, tmp_path):
    verified, facts, trust = context
    path = tmp_path / "unknown"

    def lost(*_, **kw):
        raise TimeoutError("unknown execution")

    with pytest.raises(TimeoutError):
        scorer.attest(verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), lost)
    assert (
        scorer.attest(verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), lost)[
            "status"
        ]
        == "OUTCOME_UNKNOWN"
    )


def test_self_declared_pass_is_rejected(context, tmp_path):
    verified, facts, trust = context

    def forged(files, bundle, trust, *, data, expected_input):
        return worker.WorkerResult(
            bundle,
            trust.runtime_sha256,
            trust.verifier_sha256,
            0,
            b'{"softwareTestsPassed":true}',
            input_sha256=expected_input,
        )

    value = scorer.attest(
        verified, facts, facts["rows"], trust, tmp_path / "false-pass", scorer.oracle_pin(), forged
    )
    assert value["status"] == "REJECTED" and value["actualReport"] is None


def test_changed_oracle_and_challenge_reject_before_execution(context, tmp_path):
    verified, facts, trust = context
    with pytest.raises(ValueError, match="ORACLE_CHANGED"):
        scorer.attest(
            verified, facts, facts["rows"], trust, tmp_path / "wrong-pin", "f" * 64, execute
        )
    path = tmp_path / "wrong-challenge"
    path.mkdir()
    (path / "input.json").write_bytes(encoded({"module": task.MODULE, "cases": [[]] * 28}))
    with pytest.raises(ValueError, match="CHALLENGE_CHANGED"):
        scorer.attest(verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), execute)


def test_unsupported_frozen_input_rejects_before_claim_or_execution(context, tmp_path, monkeypatch):
    verified, facts, trust = context
    cases = task.challenges(facts["rows"])
    cases[1] = [{"holdingMicros": "0", "net": "1" * 4301, "signedFees": None}]
    monkeypatch.setattr(task, "challenges", lambda _: cases)
    path = tmp_path / "unsupported"

    def forbidden(*args, **kwargs):
        pytest.fail("unsupported numeric domain reached candidate execution")

    with pytest.raises(ValueError, match="HOLDING_INPUT_INVALID"):
        scorer.attest(verified, facts, facts["rows"], trust, path, scorer.oracle_pin(), forbidden)
    assert (path / "input.json").exists() and not (path / "claim.json").exists()


def test_oracle_pin_binds_the_imported_input_domain_source(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "trusted_path", lambda _: None)
    domain = tmp_path / "domain.py"
    domain.write_text("first frozen domain")
    monkeypatch.setattr(scorer.input_domain, "__file__", str(domain))
    before = scorer.oracle_pin()
    domain.write_text("changed input bounds")
    assert scorer.oracle_pin() != before
