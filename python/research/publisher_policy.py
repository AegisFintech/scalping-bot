"""Offline proposal scope checks. Caller-supplied snapshots must come from a trusted verifier.

This module neither reads Git nor runs code and grants no publication authority.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import PurePosixPath
from typing import Annotated, Any, Final, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel

Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
GitId = Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
MODE = Literal["100644", "100755", "120000", "160000"]
PathName = Annotated[str, Field(min_length=1, max_length=1024)]
POLICY: Final = "research-additions-1.0"
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 1024 * 1024
ALLOWED = (
    re.compile(r"^python/research/experiments/[a-z][a-z0-9_]{0,79}\.py$"),
    re.compile(r"^tests/python/generated_research/test_[a-z][a-z0-9_]{0,79}\.py$"),
    re.compile(r"^docs/research/proposals/[a-z][a-z0-9_]{0,79}\.md$"),
)


def folded(path: str) -> str:
    return unicodedata.normalize("NFKC", path).casefold()


class FileChange(StrictModel):
    path: Annotated[str, Field(min_length=1, max_length=256)]
    beforeSha256: Digest | None
    afterSha256: Digest
    size: Annotated[int, Field(ge=0, le=MAX_FILE_BYTES)]
    mode: Literal["100644"]

    @model_validator(mode="after")
    def permitted_path(self) -> FileChange:
        if not any(rule.fullmatch(self.path) for rule in ALLOWED):
            raise ValueError("PUBLISHER_PATH_FORBIDDEN")
        return self


class EngineeringProposal(StrictModel):
    schemaVersion: Literal["engineering-proposal-1.0"]
    repository: Literal["AegisFintech/scalping-bot"]
    issue: Annotated[int, Field(ge=1, le=999_999_999)]
    classification: Literal["RESEARCH_ONLY"]
    policyId: Literal["research-additions-1.0"]
    baseCommit: GitId
    baseTree: GitId
    changes: Annotated[list[FileChange], Field(min_length=1, max_length=12)]
    brokerAuthority: Literal[False]
    publishAuthority: Literal[False]
    mergeAuthority: Literal[False]

    @model_validator(mode="before")
    @classmethod
    def authority(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(
            value.get(k) is not False
            for k in ("brokerAuthority", "publishAuthority", "mergeAuthority")
        ):
            raise ValueError("PUBLISHER_AUTHORITY_INVALID")
        return value

    @model_validator(mode="after")
    def deterministic_paths(self) -> EngineeringProposal:
        paths = [change.path for change in self.changes]
        if paths != sorted(paths) or len({folded(p) for p in paths}) != len(paths):
            raise ValueError("PUBLISHER_PATHS_DUPLICATE_OR_UNORDERED")
        if sum(change.size for change in self.changes) > MAX_TOTAL_BYTES:
            raise ValueError("PUBLISHER_TOTAL_BYTES_EXCEEDED")
        return self


class TreeEntry(StrictModel):
    sha256: Digest
    mode: MODE
    size: Annotated[int, Field(ge=0, le=2**31)]


class TrustedTreeSnapshot(StrictModel):
    """Evidence supplied by a separately trusted Git/tree verifier, not by the model."""

    headCommit: GitId
    treeId: GitId
    entries: Annotated[dict[PathName, TreeEntry], Field(max_length=20_000)]

    @model_validator(mode="after")
    def paths(self) -> TrustedTreeSnapshot:
        if any(
            path.startswith("/")
            or "\\" in path
            or any(ord(c) < 32 or ord(c) == 127 for c in path)
            or any(part in {"", ".", ".."} for part in path.split("/"))
            for path in self.entries
        ):
            raise ValueError("PUBLISHER_TREE_PATH_INVALID")
        return self


class PolicyDecision(StrictModel):
    policyId: Literal["research-additions-1.0"]
    proposalSha256: Digest
    candidateTree: GitId
    changedPaths: list[str]
    result: Literal["SCOPE_MATCH_ONLY"]
    sourceEvidenceIndependentlyVerified: Literal[False]
    sandboxVerified: Literal[False]
    brokerAuthority: Literal[False]
    publishAuthority: Literal[False]
    mergeAuthority: Literal[False]

    @model_validator(mode="before")
    @classmethod
    def authority(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(
            value.get(k) is not False
            for k in (
                "sourceEvidenceIndependentlyVerified",
                "sandboxVerified",
                "brokerAuthority",
                "publishAuthority",
                "mergeAuthority",
            )
        ):
            raise ValueError("PUBLISHER_AUTHORITY_INVALID")
        return value


def evaluate(
    proposal: EngineeringProposal, *, base: TrustedTreeSnapshot, candidate: TrustedTreeSnapshot
) -> PolicyDecision:
    """Compare complete trusted trees; scope match is not a test or release receipt."""
    if base.headCommit != proposal.baseCommit or candidate.headCommit != proposal.baseCommit:
        raise ValueError("PUBLISHER_BASE_COMMIT_DRIFT")
    if base.treeId != proposal.baseTree:
        raise ValueError("PUBLISHER_BASE_TREE_DRIFT")
    changed = sorted(
        path
        for path in base.entries.keys() | candidate.entries.keys()
        if base.entries.get(path) != candidate.entries.get(path)
    )
    declared = [change.path for change in proposal.changes]
    if changed != declared:
        raise ValueError("PUBLISHER_DIFF_SCOPE_MISMATCH")
    if (base.treeId == candidate.treeId) != (not changed):
        raise ValueError("PUBLISHER_TREE_EVIDENCE_CONTRADICTION")
    declared_set = set(declared)
    base_stems = {
        folded(PurePosixPath(path).stem)
        for path in base.entries
        if path.endswith(".py") and path not in declared_set
    }
    candidate_stems: set[str] = set()
    for change in proposal.changes:
        if any(
            folded(path) == folded(change.path) and path != change.path for path in base.entries
        ):
            raise ValueError("PUBLISHER_PATH_COLLISION")
        parents = list(PurePosixPath(change.path).parents)[:-1]
        if any(
            str(parent) in base.entries or str(parent) in candidate.entries for parent in parents
        ):
            raise ValueError("PUBLISHER_PATH_ANCESTOR_NOT_DIRECTORY")
        before, after = base.entries.get(change.path), candidate.entries.get(change.path)
        if before is not None and (before.mode != "100644" or change.beforeSha256 != before.sha256):
            raise ValueError("PUBLISHER_BEFORE_EVIDENCE_MISMATCH")
        if before is None and change.beforeSha256 is not None:
            raise ValueError("PUBLISHER_BEFORE_EVIDENCE_MISMATCH")
        if (
            before is not None
            and after is not None
            and before.sha256 == after.sha256
            and before.size != after.size
        ):
            raise ValueError("PUBLISHER_TREE_EVIDENCE_CONTRADICTION")
        if (
            after is None
            or after.mode != change.mode
            or after.sha256 != change.afterSha256
            or after.size != change.size
        ):
            raise ValueError("PUBLISHER_AFTER_EVIDENCE_MISMATCH")
        if change.path.startswith("tests/python/generated_research/") and before is not None:
            raise ValueError("PUBLISHER_ORIGINAL_TEST_PROTECTED")
        if change.path.startswith("docs/research/proposals/") and before is not None:
            raise ValueError("PUBLISHER_RESEARCH_RECORD_IMMUTABLE")
        if change.path.endswith(".py"):
            stem = folded(PurePosixPath(change.path).stem)
            if stem in sys.stdlib_module_names or stem in base_stems or stem in candidate_stems:
                raise ValueError("PUBLISHER_MODULE_SHADOW")
            candidate_stems.add(stem)
    payload = json.dumps(
        proposal.model_dump(), sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()
    return PolicyDecision(
        policyId=POLICY,
        proposalSha256=hashlib.sha256(payload).hexdigest(),
        candidateTree=candidate.treeId,
        changedPaths=changed,
        result="SCOPE_MATCH_ONLY",
        sourceEvidenceIndependentlyVerified=False,
        sandboxVerified=False,
        brokerAuthority=False,
        publishAuthority=False,
        mergeAuthority=False,
    )
