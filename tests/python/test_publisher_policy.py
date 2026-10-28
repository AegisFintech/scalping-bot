from __future__ import annotations

import hashlib
from copy import deepcopy

import pytest
from pydantic import ValidationError

from python.research import publisher_policy as policy

SRC = "python/research/experiments/strategy_probe.py"
TEST = "tests/python/generated_research/test_strategy_probe.py"


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def entry(content: bytes, mode: str = "100644") -> dict:
    return {"sha256": digest(content), "mode": mode, "size": len(content)}


def proposal() -> dict:
    return {
        "schemaVersion": "engineering-proposal-1.0",
        "repository": "AegisFintech/scalping-bot",
        "issue": 410,
        "classification": "RESEARCH_ONLY",
        "policyId": "research-additions-1.0",
        "baseCommit": "a" * 40,
        "baseTree": "b" * 40,
        "changes": [
            {
                "path": SRC,
                "beforeSha256": None,
                "afterSha256": digest(b"research"),
                "size": 8,
                "mode": "100644",
            },
            {
                "path": TEST,
                "beforeSha256": None,
                "afterSha256": digest(b"tests"),
                "size": 5,
                "mode": "100644",
            },
        ],
        "brokerAuthority": False,
        "publishAuthority": False,
        "mergeAuthority": False,
    }


def snapshots() -> tuple[dict, dict]:
    original = {
        "README.md": entry(b"original"),
        "python/research/codex_loop.py": entry(b"existing"),
    }
    return (
        {"headCommit": "a" * 40, "treeId": "b" * 40, "entries": deepcopy(original)},
        {
            "headCommit": "a" * 40,
            "treeId": "c" * 40,
            "entries": {**original, SRC: entry(b"research"), TEST: entry(b"tests")},
        },
    )


def evaluate(value: dict, base: dict, candidate: dict) -> policy.PolicyDecision:
    return policy.evaluate(
        policy.EngineeringProposal.model_validate(value),
        base=policy.TrustedTreeSnapshot.model_validate(base),
        candidate=policy.TrustedTreeSnapshot.model_validate(candidate),
    )


def test_valid_scope_has_no_publication_or_verification_authority() -> None:
    base, candidate = snapshots()
    result = evaluate(proposal(), base, candidate)
    assert result.result == "SCOPE_MATCH_ONLY"
    assert result.changedPaths == [SRC, TEST]
    assert not any(
        (
            result.brokerAuthority,
            result.publishAuthority,
            result.mergeAuthority,
            result.sandboxVerified,
            result.sourceEvidenceIndependentlyVerified,
        )
    )
    assert evaluate(proposal(), base, candidate).proposalSha256 == result.proposalSha256


@pytest.mark.parametrize(
    "path",
    [
        "../secret",
        "/tmp/file.py",
        ".github/workflows/test.yml",
        "packages/risk-engine/src/index.ts",
        "AGENTS.md",
        "python/research/experiments/../codex_loop.py",
        "python/research/experiments/__init__.py",
        "python/research/experiments/x\\y.py",
        "python/research/experiments/\uff45\uff56\uff49\uff4c.py",
        "tests/python/conftest.py",
    ],
)
def test_untrusted_protected_or_ambiguous_paths_are_rejected(path: str) -> None:
    value = proposal()
    value["changes"] = [{**value["changes"][0], "path": path}]
    with pytest.raises(ValidationError, match="PATH_FORBIDDEN"):
        policy.EngineeringProposal.model_validate(value)


def test_trusted_head_and_tree_must_match_pinned_base() -> None:
    base, candidate = snapshots()
    base["headCommit"] = "f" * 40
    with pytest.raises(ValueError, match="BASE_COMMIT_DRIFT"):
        evaluate(proposal(), base, candidate)
    base, candidate = snapshots()
    base["treeId"] = "f" * 40
    with pytest.raises(ValueError, match="BASE_TREE_DRIFT"):
        evaluate(proposal(), base, candidate)
    base, candidate = snapshots()
    candidate["headCommit"] = "f" * 40
    with pytest.raises(ValueError, match="BASE_COMMIT_DRIFT"):
        evaluate(proposal(), base, candidate)


def test_extra_or_missing_file_in_trusted_diff_is_never_ignored() -> None:
    base, candidate = snapshots()
    candidate["entries"]["README.md"] = entry(b"unauthorized")
    with pytest.raises(ValueError, match="DIFF_SCOPE_MISMATCH"):
        evaluate(proposal(), base, candidate)
    base, candidate = snapshots()
    del candidate["entries"][TEST]
    with pytest.raises(ValueError, match="DIFF_SCOPE_MISMATCH"):
        evaluate(proposal(), base, candidate)


def test_changed_bytes_size_or_symlink_mode_cannot_impersonate_proposal() -> None:
    for bad in (
        entry(b"different"),
        {**entry(b"research"), "size": 9},
        entry(b"research", "120000"),
    ):
        base, candidate = snapshots()
        candidate["entries"][SRC] = bad
        with pytest.raises(ValueError, match="AFTER_EVIDENCE_MISMATCH"):
            evaluate(proposal(), base, candidate)


def test_untrusted_before_hash_never_replaces_trusted_base() -> None:
    base, candidate = snapshots()
    base["entries"][SRC] = entry(b"prior")
    value = proposal()
    value["changes"][0]["beforeSha256"] = digest(b"invented")
    with pytest.raises(ValueError, match="BEFORE_EVIDENCE_MISMATCH"):
        evaluate(value, base, candidate)


def test_identical_tree_identifier_cannot_claim_a_changed_diff() -> None:
    base, candidate = snapshots()
    candidate["treeId"] = base["treeId"]
    with pytest.raises(ValueError, match="TREE_EVIDENCE_CONTRADICTION"):
        evaluate(proposal(), base, candidate)


def test_duplicate_unsorted_and_excessive_proposals_are_rejected() -> None:
    value = proposal()
    value["changes"].append(deepcopy(value["changes"][0]))
    with pytest.raises(ValidationError, match="PATHS_DUPLICATE_OR_UNORDERED"):
        policy.EngineeringProposal.model_validate(value)
    value = proposal()
    value["changes"].reverse()
    with pytest.raises(ValidationError, match="PATHS_DUPLICATE_OR_UNORDERED"):
        policy.EngineeringProposal.model_validate(value)
    value = proposal()
    value["changes"][0]["size"] = policy.MAX_FILE_BYTES + 1
    with pytest.raises(ValidationError):
        policy.EngineeringProposal.model_validate(value)


def test_existing_unicode_or_case_collision_is_rejected() -> None:
    base, candidate = snapshots()
    path = "Python/Research/Experiments/strategy_probe.py"
    base["entries"][path] = entry(b"old")
    candidate["entries"][path] = entry(b"old")
    with pytest.raises(ValueError, match="PATH_COLLISION"):
        evaluate(proposal(), base, candidate)


def test_shadowing_standard_or_existing_modules_is_rejected() -> None:
    for module in ("json", "codex_loop"):
        value = proposal()
        value["changes"] = [
            {**value["changes"][0], "path": f"python/research/experiments/{module}.py"}
        ]
        base, candidate = snapshots()
        del candidate["entries"][SRC]
        del candidate["entries"][TEST]
        candidate["entries"][value["changes"][0]["path"]] = entry(b"research")
        with pytest.raises(ValueError, match="MODULE_SHADOW"):
            evaluate(value, base, candidate)


def test_existing_test_and_research_record_are_immutable() -> None:
    base, candidate = snapshots()
    base["entries"][TEST] = entry(b"old")
    value = proposal()
    value["changes"][1]["beforeSha256"] = digest(b"old")
    with pytest.raises(ValueError, match="ORIGINAL_TEST_PROTECTED"):
        evaluate(value, base, candidate)
    doc = "docs/research/proposals/previous.md"
    value = proposal()
    value["changes"] = [
        {
            "path": doc,
            "beforeSha256": digest(b"old"),
            "afterSha256": digest(b"new"),
            "size": 3,
            "mode": "100644",
        }
    ]
    base, candidate = snapshots()
    base["entries"][doc] = entry(b"old")
    candidate["entries"].pop(SRC)
    candidate["entries"].pop(TEST)
    candidate["entries"][doc] = entry(b"new")
    with pytest.raises(ValueError, match="RESEARCH_RECORD_IMMUTABLE"):
        evaluate(value, base, candidate)


def test_blob_at_parent_path_cannot_become_implicit_directory() -> None:
    parent = "python/research/experiments"
    base, candidate = snapshots()
    base["entries"][parent] = entry(b"target", "120000")
    candidate["entries"][parent] = entry(b"target", "120000")
    with pytest.raises(ValueError, match="ANCESTOR_NOT_DIRECTORY"):
        evaluate(proposal(), base, candidate)


@pytest.mark.parametrize(
    "field,value", [("brokerAuthority", True), ("publishAuthority", 0), ("mergeAuthority", None)]
)
def test_authority_flags_are_literal_false(field: str, value: object) -> None:
    data = proposal()
    data[field] = value
    with pytest.raises(ValidationError, match="AUTHORITY_INVALID"):
        policy.EngineeringProposal.model_validate(data)


def test_trusted_tree_rejects_unsafe_names_and_wrong_repository() -> None:
    base, candidate = snapshots()
    base["entries"]["foo/../secret"] = entry(b"bad")
    with pytest.raises(ValidationError, match="TREE_PATH_INVALID"):
        evaluate(proposal(), base, candidate)
    value = proposal()
    value["repository"] = "somewhere/else"
    with pytest.raises(ValidationError):
        policy.EngineeringProposal.model_validate(value)


def test_decision_rejects_numeric_false_authority() -> None:
    base, candidate = snapshots()
    value = evaluate(proposal(), base, candidate).model_dump()
    value["publishAuthority"] = 0
    with pytest.raises(ValidationError):
        policy.PolicyDecision.model_validate(value)


def test_schema_fixtures_match_python_models() -> None:
    import json
    from pathlib import Path

    for name, model in (
        ("engineering-proposal-1.0", policy.EngineeringProposal),
        ("publisher-tree-snapshot-1.0", policy.TrustedTreeSnapshot),
        ("publisher-policy-decision-1.0", policy.PolicyDecision),
    ):
        model.model_validate(json.loads(Path("tests/fixtures", f"{name}.json").read_text()))


def test_tree_rejects_same_digest_with_conflicting_size() -> None:
    value = proposal()
    base, candidate = snapshots()
    old = entry(b"research")
    base["entries"][SRC] = old
    value["changes"][0]["beforeSha256"] = old["sha256"]
    value["changes"][0]["size"] = 7
    candidate["entries"][SRC]["size"] = 7
    with pytest.raises(ValueError, match="PUBLISHER_TREE_EVIDENCE_CONTRADICTION"):
        evaluate(value, base, candidate)
