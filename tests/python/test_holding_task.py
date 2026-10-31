from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from python.research import holding_task as task


def row(micros, net="1", fees="-0.25"):
    return {"holdingMicros": micros, "net": net, "signedFees": fees}


@pytest.mark.parametrize(
    "value,expected",
    [
        ("0", "under_5s"),
        ("4999999", "under_5s"),
        ("5000000", "5_to_15s"),
        ("14999999", "5_to_15s"),
        ("15000000", "15_to_60s"),
        ("60000000", "60_to_300s"),
        ("300000000", "300s_plus"),
        (None, "unknown"),
    ],
)
def test_duration_boundaries(value, expected):
    assert task.bucket(row(value)) == expected


@pytest.mark.parametrize("value", ["-1", "1.1", "Infinity", "\uff11", "1" * 21])
def test_invalid_durations_reject(value):
    with pytest.raises(ValueError, match="DURATION_INVALID"):
        task.bucket(row(value))


def test_net_costs_unknown_clocks_and_empty_buckets_remain_distinct():
    result = task.expected([row("0", "2", "-0.5"), row("0", "-3", None), row(None, None, "-0.1")])
    assert result["rows"] == 3
    assert [b["bucket"] for b in result["buckets"]] == list(task.BUCKETS)
    fast = result["buckets"][0]["payoff"]
    assert fast["net"] == "-1" and fast["signedFees"] == "-0.5"
    assert fast["wins"] == fast["losses"] == 1 and fast["unknownFees"] == 1
    assert result["buckets"][-1]["payoff"]["unknownNet"] == 1
    assert result["buckets"][1]["payoff"]["rows"] == 0
    assert result["counterfactualNet"] is None and result["economicQualification"] is False


def test_independent_cases_cover_real_rows_boundaries_and_unknowns():
    actual = [row("42000000")]
    cases = task.challenges(actual)
    assert len(cases) == 28 and cases[0] == actual and cases[1] == []
    assert task.expected(cases[2])["buckets"][-1]["payoff"]["rows"] == 1
    assert {task.bucket(r) for r in cases[3]} == set(task.BUCKETS[:-1])


def test_clock_derivation_keeps_microseconds_unknowns_and_window_cutoff(tmp_path, monkeypatch):
    def trade(opened, closed):
        return SimpleNamespace(openedAt=opened, closedAt=closed, realizedNet="1", signedFees="-0.1")

    packet = SimpleNamespace(
        start="2000-01-01T00:00:00Z",
        until="2000-01-01T00:30:00Z",
        setups=[
            SimpleNamespace(
                closedTrades=[
                    trade("1999-12-31T23:59:59.999999Z", "2000-01-01T00:00:05.000001Z"),
                    trade("2000-01-01T00:01:01Z", "2000-01-01T00:01:00Z"),
                    trade("2000-01-01T00:00:00Z", "2000-01-01T00:30:00Z"),
                ]
            )
        ],
    )
    facts = {"packetSha256": "a" * 64}
    monkeypatch.setattr(
        task.payoff,
        "evidence",
        lambda path: (
            facts,
            [{"net": "1", "signedFees": "-0.1"}, {"net": "1", "signedFees": "-0.1"}],
        ),
    )
    monkeypatch.setattr(task, "bounded", lambda *_: b"independently-checked-in-parent")
    monkeypatch.setattr(task, "parse", lambda *_: packet)
    result, rows = task.evidence(tmp_path)
    assert [r["holdingMicros"] for r in rows] == ["5000002", None]
    assert result["rows"] == rows and len(rows) == 2
    packet.setups[0].closedTrades.pop(0)
    with pytest.raises(ValueError, match="ROWS_CHANGED"):
        task.evidence(tmp_path)


def test_generated_scope_binds_base_and_result_without_model_metadata():
    facts = {"trialId": "a" * 64, "resultSha256": "b" * 64, "findingSha256": "c" * 64}
    draft = task.Draft(
        task=task.TASK,
        baseCommit="d" * 40,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code="def report(rows):\n    return {}\n",
        rationale="Never trusted as metadata",
    )
    files = task.candidate_files(draft, facts, draft.baseCommit)
    assert set(files) == {task.MODULE, task.NOTE}
    assert b"Never trusted as metadata" not in files[task.NOTE]
    with pytest.raises(ValueError, match="BASE_OR_RESULT_CHANGED"):
        task.candidate_files(draft, facts, "e" * 40)
    with pytest.raises(ValueError, match="DEPENDENCY_FORBIDDEN"):
        task.candidate_files(
            draft.model_copy(update={"code": "import os\ndef report(rows): return {}"}),
            facts,
            draft.baseCommit,
        )


def test_draft_schema_matches():
    from pathlib import Path

    assert (
        json.loads(Path("schemas/holding-research-candidate-draft-1.0.json").read_bytes())
        == task.Draft.model_json_schema()
    )


def test_generation_binds_new_task_and_recovers_without_repeating_provider(tmp_path, monkeypatch):
    from python.research.learning_evidence import encoded

    facts = {"trialId": "a" * 64, "resultSha256": "b" * 64, "findingSha256": "c" * 64, "rows": []}
    monkeypatch.setattr(task, "evidence", lambda _: (facts, []))
    calls = []

    def invoke(prompt, job):
        calls.append(prompt)
        assert task.TASK in prompt
        return encoded(
            task.Draft(
                task=task.TASK,
                baseCommit="d" * 40,
                resultSha256=facts["resultSha256"],
                findingSha256=facts["findingSha256"],
                code="def report(rows):\n    return {}\n",
                rationale="software candidate",
            ).model_dump()
        )

    first = task.generate(tmp_path / "generation", tmp_path / "experiment", "d" * 40, invoke)
    assert first["status"] == "GENERATED_UNVERIFIED"
    assert (
        task.generate(tmp_path / "generation", tmp_path / "experiment", "d" * 40, invoke) == first
    )
    assert len(calls) == 1


def test_unknown_generation_is_not_replayed(tmp_path, monkeypatch):
    facts = {"trialId": "a" * 64, "resultSha256": "b" * 64, "findingSha256": "c" * 64, "rows": []}
    monkeypatch.setattr(task, "evidence", lambda _: (facts, []))

    def lost(*_):
        raise TimeoutError("unknown provider outcome")

    with pytest.raises(TimeoutError):
        task.generate(tmp_path / "generation", tmp_path / "experiment", "d" * 40, lost)
    assert (
        task.generate(tmp_path / "generation", tmp_path / "experiment", "d" * 40, lost)["status"]
        == "OUTCOME_UNKNOWN"
    )


def test_challenge_output_fits_existing_worker_cap():
    from python.research.isolated_worker import MAX_OUTPUT

    actual = [
        row(str(n), "99999999999999999999.9999999999", "-0.0000000001") for n in [0, *task.LIMITS]
    ]
    output = json.dumps(
        [task.expected(c) for c in task.challenges(actual)], sort_keys=True
    ).encode()
    assert len(output) < MAX_OUTPUT


def test_protected_git_admission_blocks_existing_paths_and_source_drift(tmp_path, monkeypatch):
    from dataclasses import replace

    from tests.python import test_source_verifier as helpers

    directory, files, _, _, trust = helpers.fixture.__wrapped__(tmp_path, monkeypatch)
    assert task.admission(trust)["status"] == "ELIGIBLE"
    for present, expected in [
        ({task.MODULE: b"raise RuntimeError('never run')"}, "TASK_PATH_CONFLICT"),
        ({task.MODULE: b"not executed", task.NOTE: b"provenance"}, "TASK_ALREADY_PRESENT"),
    ]:
        tree = helpers.tree(directory, {**files, **present})
        head = helpers.git(
            directory, "commit-tree", tree, "-p", trust.expected_main, raw=b"fixture\n"
        ).decode()
        helpers.git(directory, "update-ref", "refs/heads/main", head)
        with pytest.raises(ValueError, match="SOURCE_MAIN_DRIFT"):
            task.admission(trust)
        trust = replace(trust, expected_main=head)
        assert task.admission(trust)["status"] == expected


@pytest.mark.parametrize(
    "path",
    [
        task.MODULE.upper(),
        task.NOTE.upper(),
        "python/research/experiments",
        "docs/research/proposals",
        task.MODULE + "/child",
        task.NOTE + "/child",
        "python/elsewhere/recorded_holding_payoff.py",
    ],
)
def test_admission_blocks_namespace_conflicts_before_paid_dispatch(tmp_path, monkeypatch, path):
    from dataclasses import replace

    from tests.python import test_source_verifier as helpers

    directory, _, _, _, trust = helpers.fixture.__wrapped__(tmp_path, monkeypatch)
    tree = helpers.tree(directory, {path: b"never execute"})
    head = helpers.git(
        directory, "commit-tree", tree, "-p", trust.expected_main, raw=b"conflict\n"
    ).decode()
    helpers.git(directory, "update-ref", "refs/heads/main", head)
    assert task.admission(replace(trust, expected_main=head))["status"] == "TASK_PATH_CONFLICT"


def test_generation_prompt_includes_real_static_delivery_requirements():
    assert "mypy --strict" in task.PROMPT and "Ruff check/format" in task.PROMPT


def test_prompt_names_exact_import_symbols_and_preserves_dependency_gate():
    for module, names in {
        "decimal": ["Decimal", "localcontext", "ROUND_HALF_EVEN"],
        "typing": ["Any", "Dict", "List", "Optional", "Tuple"],
        "__future__": ["annotations"],
    }.items():
        for name in names:
            assert name in task.PROMPT
            task.payoff.dependencies(
                f"from {module} import {name}\ndef report(rows): return {{}}\n".encode()
            )
    assert "TypedDict is not" in task.PROMPT
    with pytest.raises(ValueError, match="DEPENDENCY_FORBIDDEN"):
        task.payoff.dependencies(b"from typing import TypedDict\ndef report(rows): return {}\n")
