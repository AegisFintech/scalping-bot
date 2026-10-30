from __future__ import annotations

import json
import subprocess
import sys
from decimal import ROUND_UP, localcontext
from pathlib import Path

import pytest

from python.research import candidate_attestation as c
from python.research import experiment_execution as x
from python.research import isolated_worker as w
from python.research.learning_evidence import encoded
from python.research.source_verifier import SourceReceipt, VerifiedCandidate
from tests.python import test_experiment_execution as helpers


def oracle_pin():
    return c.sha(Path(c.__file__).read_bytes())


def test_generated_draft_schema_matches_boundary():
    assert (
        json.loads(Path("schemas/research-candidate-draft-1.0.json").read_bytes())
        == c.Draft.model_json_schema()
    )


@pytest.fixture(autouse=True)
def oracle_filesystem_fixture(monkeypatch):
    # Real protected-path checks are exercised by the tc02 namespace probe.
    monkeypatch.setattr(w, "trusted_path", lambda path: None)


@pytest.fixture
def setup(tmp_path):
    return helpers.setup.__wrapped__(tmp_path)


@pytest.fixture
def closed(setup):
    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)
    x.reconcile(registry, reg, approved, mailbox.execute_one(approved, helpers.execute))
    return registry.load(reg.questionId, reg.trialId)[0]


def draft(facts, base="a" * 40, code="def report(rows):\n    return {}\n"):
    return c.Draft(
        task=c.TASK,
        baseCommit=base,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code=code,
        rationale="Test measured payoff",
    )


def verified(facts):
    files = c.candidate_files(draft(facts), facts, "a" * 40)
    receipt = SourceReceipt(
        schemaVersion="research-source-verification-1.0",
        baseCommit="a" * 40,
        baseTree="b" * 40,
        candidateTree="c" * 40,
        proposalSha256="d" * 64,
        bundleSha256=w.bundle_digest(files),
        gitSha256="e" * 64,
        prlimitSha256="f" * 64,
        sourceBasis="INDEPENDENTLY_PROVISIONED_LOCAL_MIRROR",
        objectBytesVerified=True,
        remoteFreshnessAttested=False,
        dependencyClosureVerified=False,
        testsPassed=False,
        brokerAuthority=False,
        publishAuthority=False,
        mergeAuthority=False,
    )
    return VerifiedCandidate(receipt, files)


def oracle_worker(files, bundle, trust, *, data, expected_input):
    assert set(json.loads(data)) == {"module", "cases"}  # Expected values never mounted.
    return w.WorkerResult(
        bundle,
        trust.runtime_sha256,
        trust.verifier_sha256,
        0,
        encoded([c.expected(rows) for rows in json.loads(data)["cases"]]),
        input_sha256=expected_input,
    )


def test_oracle_counts_unknown_flat_and_fees_once():
    value = c.expected(
        [
            {"net": "100", "signedFees": "-7"},
            {"net": "50", "signedFees": "-7"},
            {"net": "-1500", "signedFees": "-14"},
            {"net": "0", "signedFees": None},
            {"net": None, "signedFees": "1"},
        ]
    )
    assert value == {
        "rows": 5,
        "knownNet": 4,
        "unknownNet": 1,
        "wins": 2,
        "losses": 1,
        "flat": 1,
        "knownFees": 4,
        "unknownFees": 1,
        "net": "-1350",
        "signedFees": "-27",
        "winningNet": "150",
        "losingNet": "-1500",
        "lossPerAverageWin": "20.000000",
        "counterfactualNet": None,
        "economicQualification": False,
    }
    assert c.expected([])["lossPerAverageWin"] is None


def test_decimal_encoding_preserves_value_and_ratio_scale():
    rows = [{"net": "1.00", "signedFees": "-0.000"}, {"net": "-10.000", "signedFees": None}]
    result = c.expected(rows)
    assert result["net"] == "-9" and result["signedFees"] == "0"
    assert result["lossPerAverageWin"] == "10.000000"
    with localcontext() as context:
        context.rounding = ROUND_UP
        assert (
            c.expected([{"net": "128", "signedFees": None}, {"net": "-1", "signedFees": None}])[
                "lossPerAverageWin"
            ]
            == "0.007812"
        )


def test_changed_independent_oracle_rejected_before_execution(closed, tmp_path, setup):
    facts, rows = c.evidence(closed)
    with pytest.raises(ValueError, match="ORACLE_CHANGED"):
        c.attest(
            verified(facts),
            facts,
            rows,
            setup[3].trust,
            tmp_path / "bad-oracle",
            "f" * 64,
            lambda *a, **k: pytest.fail("must not execute"),
        )


def test_closed_experiment_binding_rejects_tampered_measurement(closed):
    facts, rows = c.evidence(closed)
    assert rows == [] and facts["measurement"]["closedInWindow"] == 0
    path = closed / "experiment-finding.json"
    value = json.loads(path.read_bytes())
    value["measurement"]["net"] = "1"
    path.write_bytes(encoded(value))
    with pytest.raises(ValueError, match="EXPERIMENT_BINDING"):
        c.evidence(closed)


@pytest.mark.parametrize(
    "code",
    [
        "import os",
        "from pathlib import Path",
        "import requests",
        "from . import helper",
        "x = __import__('os')",
        "x = __builtins__['__import__']('os')",
        "from typing import sys",
        "import typing\nos = typing.sys.modules['os']",
        "x = vars()['__builtins__']['__import__']('os')",
        "x = __loader__.load_module('os')",
        "x = eval('2')",
        "x = object.__subclasses__()",
    ],
)
def test_dependency_bypasses_reject_with_valid_entrypoint(code):
    with pytest.raises(ValueError, match=r"CANDIDATE_(DEPENDENCY_FORBIDDEN|DYNAMIC_DEPENDENCY)"):
        c.dependencies((code + "\ndef report(rows): return {}\n").encode())


def test_missing_entrypoint_rejects():
    with pytest.raises(ValueError, match="CANDIDATE_ENTRYPOINT_MISSING"):
        c.dependencies(b"x = 1")


@pytest.mark.parametrize("field", ["baseCommit", "resultSha256", "findingSha256"])
def test_changed_base_or_evidence_rejects(closed, field):
    facts, _ = c.evidence(closed)
    candidate = draft(facts).model_copy(update={field: "f" * (40 if field == "baseCommit" else 64)})
    with pytest.raises(ValueError, match="BASE_OR_RESULT"):
        c.candidate_files(candidate, facts, "a" * 40)


def test_generated_tests_are_not_collected_or_imported_in_normal_suite(tmp_path):
    (tmp_path / "pyproject.toml").write_bytes(Path("pyproject.toml").read_bytes())
    directory = tmp_path / "tests/python/generated_research"
    directory.mkdir(parents=True)
    (directory / "test_host_execution.py").write_text("raise RuntimeError('UNTRUSTED_IMPORTED')")
    (directory.parent / "test_original.py").write_text("def test_original(): assert True")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/python", "-q"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1 passed" in result.stdout


def test_generation_recovers_response_without_provider_replay(closed, tmp_path):
    facts, _ = c.evidence(closed)
    calls = []

    def invoke(prompt, path):
        calls.append(path)
        assert "INPUT=" in prompt and facts["resultSha256"] in prompt
        return encoded(draft(facts).model_dump())

    root = tmp_path / "candidates"
    first = c.generate(root, closed, "a" * 40, invoke)
    (root / first["job"] / "draft.json").unlink()  # Crash between response and draft persistence.
    assert c.generate(root, closed, "a" * 40, invoke) == first
    assert len(calls) == 1


def test_unknown_provider_is_not_replayed(closed, tmp_path):
    def crashed(*args):
        raise TimeoutError

    root = tmp_path / "candidates"
    with pytest.raises(TimeoutError):
        c.generate(root, closed, "a" * 40, crashed)
    assert c.generate(root, closed, "a" * 40, crashed)["status"] == "OUTCOME_UNKNOWN"


def test_forbidden_candidate_retained_and_budget_bounded(closed, tmp_path):
    facts, _ = c.evidence(closed)

    def invoke(*args):
        return encoded(draft(facts, code="import os\ndef report(rows): return {}").model_dump())

    root = tmp_path / "candidates"
    (root / "memory").mkdir(parents=True)
    for letter in "abcd":
        assert c.generate(root, closed, letter * 40, invoke)["status"] == "REJECTED"
    assert c.generate(root, closed, "e" * 40, invoke)["status"] == "CANDIDATE_TASK_TRIAL_BUDGET"


def test_independent_cases_attest_but_never_publish(closed, tmp_path, setup):
    facts, rows = c.evidence(closed)
    trust = setup[3].trust
    path = tmp_path / "attestation"
    result = c.attest(verified(facts), facts, rows, trust, path, oracle_pin(), oracle_worker)
    assert result["caseCount"] == 28 and result["softwareTestsPassed"] is True
    assert result["status"] == "AWAITING_INDEPENDENT_REVIEW"
    assert result["publishAuthority"] is False and result["independentReview"] is None
    assert (
        c.attest(
            verified(facts), facts, rows, trust, path, oracle_pin(), lambda *a, **k: pytest.fail()
        )
        == result
    )


@pytest.mark.parametrize(
    "fault", ["claimed_pass", "wrong_math", "failed", "wrong_binding", "crash"]
)
def test_untrusted_worker_cannot_attest_itself(closed, tmp_path, setup, fault):
    facts, rows = c.evidence(closed)
    path = tmp_path / "attestation"

    def execute(*args, **kwargs):
        if fault == "crash":
            raise TimeoutError
        result = oracle_worker(*args, **kwargs)
        if fault == "claimed_pass":
            return w.WorkerResult(
                result.bundle_sha256,
                result.runtime_sha256,
                result.verifier_sha256,
                0,
                b'{"passed":true}',
                input_sha256=result.input_sha256,
            )
        if fault == "wrong_math":
            values = json.loads(result.output)
            values[0]["net"] = "999"
            return w.WorkerResult(
                result.bundle_sha256,
                result.runtime_sha256,
                result.verifier_sha256,
                0,
                encoded(values),
                input_sha256=result.input_sha256,
            )
        if fault == "wrong_binding":
            return w.WorkerResult(
                "f" * 64,
                result.runtime_sha256,
                result.verifier_sha256,
                0,
                result.output,
                input_sha256=result.input_sha256,
            )
        return w.WorkerResult(
            result.bundle_sha256,
            result.runtime_sha256,
            result.verifier_sha256,
            1,
            result.output,
            input_sha256=result.input_sha256,
        )

    if fault in {"crash", "wrong_binding"}:
        with pytest.raises((ValueError, TimeoutError)):
            c.attest(verified(facts), facts, rows, setup[3].trust, path, oracle_pin(), execute)
        assert (
            c.attest(verified(facts), facts, rows, setup[3].trust, path, oracle_pin(), execute)[
                "status"
            ]
            == "OUTCOME_UNKNOWN"
        )
    else:
        assert (
            c.attest(verified(facts), facts, rows, setup[3].trust, path, oracle_pin(), execute)[
                "status"
            ]
            == "REJECTED"
        )
