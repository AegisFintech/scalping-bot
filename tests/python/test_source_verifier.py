from __future__ import annotations

import json
import os
import subprocess
import zlib
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from python.research import source_verifier as s
from python.research.publisher_policy import EngineeringProposal

SOURCE = "python/research/experiments/verified_probe.py"


def git(directory: Path, *args: str, raw: bytes = b"") -> bytes:
    return subprocess.check_output(
        ["git", "--git-dir=" + str(directory), *args],
        input=raw,
        env={
            **os.environ,
            "GIT_AUTHOR_NAME": "fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.test",
            "GIT_COMMITTER_NAME": "fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.test",
        },
        stderr=subprocess.DEVNULL,
    ).strip()


def tree(directory: Path, files: dict[str, bytes]) -> str:
    rows = []
    folders: dict[str, dict[str, bytes]] = {}
    for path, value in sorted(files.items()):
        if "/" in path:
            folder, rest = path.split("/", 1)
            folders.setdefault(folder, {})[rest] = value
        else:
            oid = git(directory, "hash-object", "-w", "--stdin", raw=value).decode()
            rows.append(f"100644 blob {oid}\t{path}\0")
    for folder, contents in folders.items():
        rows.append(f"040000 tree {tree(directory, contents)}\t{folder}\0")
    return git(directory, "mktree", "-z", raw="".join(rows).encode()).decode()


@pytest.fixture
def fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    directory = tmp_path / "mirror"
    subprocess.run(
        ["git", "init", "--bare", "-b", "main", str(directory)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base_files = {"README.md": b"original", "python/research/original.py": b"original = True"}
    base_tree = tree(directory, base_files)
    base = git(directory, "commit-tree", base_tree, raw=b"fixture\n").decode()
    git(directory, "update-ref", "refs/heads/main", base)
    content = b"raise RuntimeError('must never execute during verification')\n"
    candidate = tree(directory, {**base_files, SOURCE: content})
    proposal = EngineeringProposal.model_validate(
        {
            "schemaVersion": "engineering-proposal-1.0",
            "repository": "AegisFintech/scalping-bot",
            "issue": 448,
            "classification": "RESEARCH_ONLY",
            "policyId": "research-additions-1.0",
            "baseCommit": base,
            "baseTree": base_tree,
            "changes": [
                {
                    "path": SOURCE,
                    "beforeSha256": None,
                    "afterSha256": s.sha(content),
                    "size": len(content),
                    "mode": "100644",
                }
            ],
            "brokerAuthority": False,
            "publishAuthority": False,
            "mergeAuthority": False,
        }
    )
    trust = s.MirrorTrust(
        directory,
        base,
        s.sha(Path("/usr/bin/git").read_bytes()),
        s.sha(Path("/usr/bin/prlimit").read_bytes()),
    )
    # CI owns its temporary mirror. The separate real-host probe exercises root-owned trust.
    monkeypatch.setattr(s.MirrorTrust, "verify", lambda self: None)
    return directory, base_files, candidate, proposal, trust


def test_actual_git_objects_produce_exact_worker_bundle_without_execution(fixture: Any) -> None:
    _, _, candidate, proposal, trust = fixture
    result = s.verify(proposal, candidate, trust)
    assert s.sha(result.files[SOURCE]) == proposal.changes[0].afterSha256
    assert result.receipt.bundleSha256 == s.bundle_digest(result.files)
    assert result.receipt.objectBytesVerified
    assert not any(
        (
            result.receipt.testsPassed,
            result.receipt.dependencyClosureVerified,
            result.receipt.remoteFreshnessAttested,
            result.receipt.publishAuthority,
            result.receipt.mergeAuthority,
            result.receipt.brokerAuthority,
        )
    )


def test_undeclared_protected_edit_is_detected_in_complete_tree(fixture: Any) -> None:
    directory, base_files, _, proposal, trust = fixture
    candidate = tree(directory, {**base_files, SOURCE: b"new", "README.md": b"altered"})
    with pytest.raises(ValueError, match="DIFF_SCOPE_MISMATCH"):
        s.verify(proposal, candidate, trust)


@pytest.mark.parametrize("kind", ["hash", "size", "base", "tree"])
def test_model_metadata_cannot_override_real_objects(fixture: Any, kind: str) -> None:
    _, _, candidate, proposal, trust = fixture
    value = proposal.model_dump()
    if kind == "hash":
        value["changes"][0]["afterSha256"] = "f" * 64
    elif kind == "size":
        value["changes"][0]["size"] += 1
    elif kind == "base":
        value["baseCommit"] = "f" * 40
    else:
        value["baseTree"] = "f" * 40
    with pytest.raises(ValueError):
        s.verify(EngineeringProposal.model_validate(value), candidate, trust)


@pytest.mark.parametrize("oid", ["HEAD", "--help", "f" * 40])
def test_symbolic_flags_or_missing_candidate_reject(fixture: Any, oid: str) -> None:
    _, _, _, proposal, trust = fixture
    with pytest.raises(ValueError):
        s.verify(proposal, oid, trust)


def test_commit_cannot_masquerade_as_candidate_tree(fixture: Any) -> None:
    _, _, _, proposal, trust = fixture
    with pytest.raises(ValueError, match="TYPE_MISMATCH"):
        s.verify(proposal, trust.expected_main, trust)


def test_replace_refs_cannot_substitute_read_objects(fixture: Any) -> None:
    directory, _, candidate, proposal, trust = fixture
    other = git(directory, "commit-tree", candidate, raw=b"other\n").decode()
    git(directory, "replace", trust.expected_main, other)
    assert s.verify(proposal, candidate, trust).receipt.baseTree == proposal.baseTree


def test_reference_drift_during_reads_rejects(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory, _, candidate, proposal, trust = fixture
    other = git(directory, "commit-tree", candidate, raw=b"other\n").decode()
    original = s.evaluate

    def drift(*args: Any, **kwargs: Any) -> Any:
        result = original(*args, **kwargs)
        git(directory, "update-ref", "refs/heads/main", other)
        return result

    monkeypatch.setattr(s, "evaluate", drift)
    with pytest.raises(ValueError, match="MAIN_DRIFT"):
        s.verify(proposal, candidate, trust)


def test_corrupt_loose_blob_cannot_be_attested(fixture: Any) -> None:
    directory, _, candidate, proposal, trust = fixture
    oid = git(directory, "hash-object", "-w", "--stdin", raw=b"original").decode()
    path = directory / "objects" / oid[:2] / oid[2:]
    path.chmod(0o600)
    path.write_bytes(zlib.compress(b"blob 8\0modified"))
    with pytest.raises(ValueError, match=r"SOURCE_(OBJECT_HASH_MISMATCH|GIT_READ_FAILED)"):
        s.verify(proposal, candidate, trust)


@pytest.mark.parametrize("mode", ["120000", "160000"])
def test_symlinks_and_submodules_are_not_followed(fixture: Any, mode: str) -> None:
    directory, _, _, proposal, trust = fixture
    oid = git(directory, "hash-object", "-w", "--stdin", raw=b"/etc/passwd").decode()
    kind = "blob"
    if mode == "160000":
        oid, kind = trust.expected_main, "commit"
    candidate = git(directory, "mktree", raw=f"{mode} {kind} {oid}\tlink\n".encode()).decode()
    with pytest.raises(ValueError, match="MODE_FORBIDDEN"):
        s.verify(proposal, candidate, trust)


def test_hostile_git_environment_is_not_inherited(
    fixture: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, _, candidate, proposal, trust = fixture
    monkeypatch.setenv("GIT_OBJECT_DIRECTORY", "/does-not-exist")
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", "core.fsmonitor")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", "hostile")
    assert s.verify(proposal, candidate, trust).receipt.objectBytesVerified


def test_deadline_and_output_bounds(fixture: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    directory, _, _, _, trust = fixture
    store = s.GitObjects(trust)
    store.deadline = 0
    with pytest.raises(ValueError, match="DEADLINE"):
        store.read(trust.expected_main, "commit")
    oid = git(directory, "hash-object", "-w", "--stdin", raw=b"x" * 1000).decode()
    monkeypatch.setattr(s, "MAX_OBJECT", 128)
    with pytest.raises(ValueError):
        s.GitObjects(trust).read(oid, "blob")


def test_root_protection_and_executable_pin_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    trust = s.MirrorTrust(tmp_path, "a" * 40, "f" * 64, "f" * 64)
    with pytest.raises(ValueError):
        trust.verify()
    monkeypatch.setattr(s, "trusted_path", lambda _: None)
    with pytest.raises(ValueError, match="EXECUTABLE_CHANGED"):
        trust.verify()
    with pytest.raises(ValueError, match="BASE_ID_INVALID"):
        replace(trust, expected_main="HEAD").verify()


def test_alternates_are_rejected_before_git(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(s, "trusted_path", lambda _: None)
    monkeypatch.setattr(s.os, "walk", lambda *_, **__: iter([]))
    path = tmp_path / "objects/info"
    path.mkdir(parents=True)
    (path / "alternates").write_text("/other/object/store")
    with pytest.raises(ValueError, match="EXTERNAL_OBJECTS_FORBIDDEN"):
        s.MirrorTrust(tmp_path, "a" * 40, "f" * 64, "f" * 64).verify()


def test_published_receipt_schema_matches() -> None:
    schema = json.loads(Path("schemas/research-source-verification-1.0.json").read_text())
    schema.pop("$schema")
    schema.pop("$id")
    assert schema == s.SourceReceipt.model_json_schema()


@pytest.mark.parametrize("name", ["undeclared", "\x01unsafe"])
def test_undeclared_empty_subtree_cannot_escape_scope(fixture: Any, name: str) -> None:
    directory, _, candidate, proposal, trust = fixture
    empty = git(directory, "mktree", raw=b"").decode()
    rows = git(directory, "ls-tree", "-z", candidate)
    modified = git(
        directory, "mktree", "-z", raw=rows + f"040000 tree {empty}\t{name}\0".encode()
    ).decode()
    with pytest.raises(ValueError, match=r"SOURCE_(EMPTY_SUBTREE_FORBIDDEN|TREE_PATH_INVALID)"):
        s.verify(proposal, modified, trust)


@pytest.mark.parametrize("name", ["commondir", "config.worktree", "worktrees", "refs/replace"])
def test_repository_indirection_is_rejected_before_reads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    monkeypatch.setattr(s, "trusted_path", lambda _: None)
    monkeypatch.setattr(s.os, "walk", lambda *_, **__: iter([]))
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("/outside")
    with pytest.raises(
        ValueError, match=r"SOURCE_(REPOSITORY_INDIRECTION_FORBIDDEN|EXTERNAL_OBJECTS_FORBIDDEN)"
    ):
        s.MirrorTrust(tmp_path, "a" * 40, "f" * 64, "f" * 64).verify()


def test_packed_replacement_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(s, "trusted_path", lambda _: None)
    monkeypatch.setattr(s.os, "walk", lambda *_, **__: iter([]))
    (tmp_path / "packed-refs").write_text("a" * 40 + " refs/replace/" + "b" * 40 + "\n")
    with pytest.raises(ValueError, match="PACKED_REPLACEMENTS"):
        s.MirrorTrust(tmp_path, "a" * 40, "f" * 64, "f" * 64).verify()


@pytest.mark.parametrize(
    "configuration",
    [
        "[include]\n path = /outside\n",
        '[includeIf "gitdir:*"]\n path = /outside\n',
        "[extensions]\n worktreeConfig = true\n",
        '[remote "origin"]\n promisor = true\n',
    ],
)
def test_configuration_cannot_escape_verified_mirror(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, configuration: str
) -> None:
    monkeypatch.setattr(s, "trusted_path", lambda _: None)
    monkeypatch.setattr(s.os, "walk", lambda *_, **__: iter([]))
    (tmp_path / "config").write_text("[core]\n bare = true\n" + configuration)
    trust = s.MirrorTrust(
        tmp_path,
        "a" * 40,
        s.sha(Path("/usr/bin/git").read_bytes()),
        s.sha(Path("/usr/bin/prlimit").read_bytes()),
    )
    with pytest.raises(ValueError, match="CONFIGURATION_INDIRECTION"):
        trust.verify()
