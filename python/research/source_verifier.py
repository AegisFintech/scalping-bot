"""Verify research bytes from a protected Git mirror; never checkout or execute them."""

from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from python.research.codex_loop import StrictModel
from python.research.isolated_worker import bundle_digest, trusted_path
from python.research.publisher_policy import (
    Digest,
    EngineeringProposal,
    GitId,
    TreeEntry,
    TrustedTreeSnapshot,
    evaluate,
    folded,
)

MAX_OBJECT = 8 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_ENTRIES = 20_000
TIMEOUT = 60


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


@dataclass(frozen=True)
class MirrorTrust:
    """Provisioned independently; the model cannot choose its mirror, pins or base."""

    directory: Path
    expected_main: str
    git_sha256: str
    prlimit_sha256: str

    def verify(self) -> None:
        if not re.fullmatch(r"[0-9a-f]{40}", self.expected_main):
            raise ValueError("SOURCE_BASE_ID_INVALID")
        trusted_path(self.directory)
        if not self.directory.is_dir():
            raise ValueError("SOURCE_MIRROR_NOT_DIRECTORY")
        count = 0

        def unreadable(_: OSError) -> None:
            raise ValueError("SOURCE_MIRROR_UNREADABLE")

        for directory, folders, files in os.walk(self.directory, onerror=unreadable):
            for name in folders + files:
                info = (Path(directory) / name).lstat()
                count += 1
                if count > 100_000 or info.st_uid != 0 or info.st_mode & 0o022:
                    raise ValueError("SOURCE_MIRROR_WRITABLE_OR_OVERSIZED")
                if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                    raise ValueError("SOURCE_MIRROR_SPECIAL_FILE")
        for name in (
            "objects/info/alternates",
            "objects/info/http-alternates",
            "info/grafts",
            "refs/replace",
        ):
            if (self.directory / name).exists():
                raise ValueError("SOURCE_EXTERNAL_OBJECTS_FORBIDDEN")
        for name in ("commondir", "config.worktree", "worktrees", "refs/replace"):
            if (self.directory / name).exists():
                raise ValueError("SOURCE_REPOSITORY_INDIRECTION_FORBIDDEN")
        packed = self.directory / "packed-refs"
        if packed.exists() and (
            packed.stat().st_size > MAX_OBJECT or b"refs/replace/" in packed.read_bytes()
        ):
            raise ValueError("SOURCE_PACKED_REPLACEMENTS_OR_CAPACITY")
        for path, expected in (
            (Path("/usr/bin/git"), self.git_sha256),
            (Path("/usr/bin/prlimit"), self.prlimit_sha256),
        ):
            trusted_path(path)
            if (
                not path.is_file()
                or path.stat().st_size > 16 * 1024 * 1024
                or sha(path.read_bytes()) != expected
            ):
                raise ValueError("SOURCE_EXECUTABLE_CHANGED")

        keys = (
            GitObjects(self)
            .command(
                "config",
                "--file",
                str(self.directory / "config"),
                "--no-includes",
                "--name-only",
                "--list",
                "-z",
                configuration_only=True,
            )
            .decode()
            .lower()
            .split("\0")
        )
        if any(
            k.startswith(("include.", "includeif."))
            or k in {"extensions.worktreeconfig", "core.worktree", "extensions.partialclone"}
            or k.endswith(".promisor")
            for k in keys
        ):
            raise ValueError("SOURCE_CONFIGURATION_INDIRECTION_FORBIDDEN")


class SourceReceipt(StrictModel):
    schemaVersion: Literal["research-source-verification-1.0"]
    baseCommit: GitId
    baseTree: GitId
    candidateTree: GitId
    proposalSha256: Digest
    bundleSha256: Digest
    gitSha256: Digest
    prlimitSha256: Digest
    sourceBasis: Literal["INDEPENDENTLY_PROVISIONED_LOCAL_MIRROR"]
    objectBytesVerified: Literal[True]
    remoteFreshnessAttested: Literal[False]
    dependencyClosureVerified: Literal[False]
    testsPassed: Literal[False]
    brokerAuthority: Literal[False]
    publishAuthority: Literal[False]
    mergeAuthority: Literal[False]


@dataclass(frozen=True)
class VerifiedCandidate:
    receipt: SourceReceipt
    files: dict[str, bytes]


class GitObjects:
    def __init__(self, trust: MirrorTrust):
        self.trust = trust
        self.deadline = time.monotonic() + TIMEOUT
        self.cache: dict[str, tuple[str, bytes]] = {}
        self.total = 0

    def command(self, *args: str, request: bytes = b"", configuration_only: bool = False) -> bytes:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("SOURCE_DEADLINE_EXCEEDED")
        command = [
            "/usr/bin/prlimit",
            f"--fsize={MAX_OBJECT + 256}",
            "--as=536870912",
            "--cpu=10",
            "--",
            "/usr/bin/git",
            "--no-replace-objects",
            *([] if configuration_only else ["--git-dir=" + str(self.trust.directory)]),
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "protocol.allow=never",
            "-c",
            "credential.helper=",
            *args,
        ]
        with tempfile.TemporaryFile() as output:
            try:
                subprocess.run(
                    command,
                    input=request,
                    stdout=output,
                    stderr=subprocess.DEVNULL,
                    timeout=min(10, remaining),
                    check=True,
                    cwd="/",
                    close_fds=True,
                    env={
                        "PATH": "/usr/bin:/bin",
                        "HOME": "/nonexistent",
                        "LANG": "C",
                        "GIT_CONFIG_NOSYSTEM": "1",
                        "GIT_CONFIG_GLOBAL": "/dev/null",
                        "GIT_NO_LAZY_FETCH": "1",
                        "GIT_TERMINAL_PROMPT": "0",
                    },
                )
            except subprocess.SubprocessError:
                raise ValueError("SOURCE_GIT_READ_FAILED") from None
            output.seek(0)
            raw = output.read(MAX_OBJECT + 257)
        if len(raw) > MAX_OBJECT + 256:
            raise ValueError("SOURCE_OBJECT_TOO_LARGE")
        return raw

    def main(self) -> str:
        if self.command("rev-parse", "--is-bare-repository") != b"true\n":
            raise ValueError("SOURCE_BARE_MIRROR_REQUIRED")
        value = self.command("rev-parse", "--verify", "refs/heads/main").decode().strip()
        if value != self.trust.expected_main:
            raise ValueError("SOURCE_MAIN_DRIFT")
        return value

    def read(self, oid: str, expected: str) -> bytes:
        if not re.fullmatch(r"[0-9a-f]{40}", oid):
            raise ValueError("SOURCE_OBJECT_ID_INVALID")
        if oid not in self.cache:
            raw = self.command("cat-file", "--batch", request=(oid + "\n").encode())
            header, _, tail = raw.partition(b"\n")
            fields = header.split()
            if len(fields) != 3 or fields[0] != oid.encode() or not fields[2].isdigit():
                raise ValueError("SOURCE_OBJECT_MISSING_OR_INVALID")
            kind, size = fields[1].decode(), int(fields[2])
            if size > MAX_OBJECT or len(tail) != size + 1 or tail[-1:] != b"\n":
                raise ValueError("SOURCE_OBJECT_FRAMING_INVALID")
            body = tail[:-1]
            object_id = hashlib.sha1(
                fields[1] + b" " + str(size).encode() + b"\0" + body
            ).hexdigest()
            if object_id != oid:
                raise ValueError("SOURCE_OBJECT_HASH_MISMATCH")
            self.total += size
            if self.total > MAX_TOTAL or len(self.cache) >= MAX_ENTRIES:
                raise ValueError("SOURCE_OBJECT_CAPACITY")
            self.cache[oid] = (kind, body)
        kind, body = self.cache[oid]
        if kind != expected:
            raise ValueError("SOURCE_OBJECT_TYPE_MISMATCH")
        return body

    def snapshot(self, tree: str) -> tuple[TrustedTreeSnapshot, dict[str, bytes]]:
        entries: dict[str, TreeEntry] = {}
        contents: dict[str, bytes] = {}
        names: set[str] = set()
        pending = [("", tree, 0)]
        visited = 0
        while pending:
            prefix, oid, depth = pending.pop()
            visited += 1
            if depth > 32 or visited + len(entries) > MAX_ENTRIES:
                raise ValueError("SOURCE_TREE_CAPACITY")
            raw = self.read(oid, "tree")
            if prefix and not raw:
                raise ValueError("SOURCE_EMPTY_SUBTREE_FORBIDDEN")
            previous: bytes | None = None
            position = 0
            siblings: set[str] = set()
            while position < len(raw):
                end = raw.find(b"\0", position)
                if end < 0 or end + 21 > len(raw):
                    raise ValueError("SOURCE_TREE_INVALID")
                fields = raw[position:end].split(b" ", 1)
                if len(fields) != 2:
                    raise ValueError("SOURCE_TREE_INVALID")
                mode, name = fields[0].decode(), fields[1].decode("utf-8")
                if name in {"", ".", ".."} or "/" in name or "\\" in name or name in siblings:
                    raise ValueError("SOURCE_TREE_PATH_INVALID")
                if any(ord(c) < 32 or ord(c) == 127 for c in name):
                    raise ValueError("SOURCE_TREE_PATH_INVALID")
                sort_key = fields[1] + (b"/" if mode == "40000" else b"")
                if previous is not None and sort_key <= previous:
                    raise ValueError("SOURCE_TREE_ORDER_INVALID")
                previous = sort_key
                siblings.add(name)
                child = raw[end + 1 : end + 21].hex()
                position = end + 21
                path = prefix + name
                if len(path) > 1024 or folded(path) in names:
                    raise ValueError("SOURCE_TREE_PATH_COLLISION")
                names.add(folded(path))
                if len(names) > MAX_ENTRIES:
                    raise ValueError("SOURCE_TREE_CAPACITY")
                if mode == "40000":
                    pending.append((path + "/", child, depth + 1))
                    continue
                if mode not in {"100644", "100755"}:
                    raise ValueError("SOURCE_TREE_MODE_FORBIDDEN")
                body = self.read(child, "blob")
                entries[path] = TreeEntry.model_validate(
                    {"sha256": sha(body), "mode": mode, "size": len(body)}
                )
                contents[path] = body
                if len(names) > MAX_ENTRIES:
                    raise ValueError("SOURCE_TREE_CAPACITY")
        return TrustedTreeSnapshot(
            headCommit=self.trust.expected_main, treeId=tree, entries=entries
        ), contents


def verify(
    proposal: EngineeringProposal, candidate_tree: str, trust: MirrorTrust
) -> VerifiedCandidate:
    """Source/scope receipt only; origin, tests, dependency and release gates are separate."""
    trust.verify()
    objects = GitObjects(trust)
    base = objects.main()
    if proposal.baseCommit != base:
        raise ValueError("SOURCE_PROPOSAL_BASE_MISMATCH")
    commit = objects.read(base, "commit")
    first = commit.split(b"\n", 1)[0]
    if not re.fullmatch(rb"tree [0-9a-f]{40}", first):
        raise ValueError("SOURCE_COMMIT_INVALID")
    base_tree = first[5:].decode()
    before, _ = objects.snapshot(base_tree)
    after, contents = objects.snapshot(candidate_tree)
    decision = evaluate(proposal, base=before, candidate=after)
    files = {path: contents[path] for path in decision.changedPaths}
    # Recheck the protected ref after all object reads. This does not attest remote HEAD.
    objects.main()
    return VerifiedCandidate(
        SourceReceipt(
            schemaVersion="research-source-verification-1.0",
            baseCommit=base,
            baseTree=base_tree,
            candidateTree=candidate_tree,
            proposalSha256=decision.proposalSha256,
            bundleSha256=bundle_digest(files),
            gitSha256=trust.git_sha256,
            prlimitSha256=trust.prlimit_sha256,
            sourceBasis="INDEPENDENTLY_PROVISIONED_LOCAL_MIRROR",
            objectBytesVerified=True,
            remoteFreshnessAttested=False,
            dependencyClosureVerified=False,
            testsPassed=False,
            brokerAuthority=False,
            publishAuthority=False,
            mergeAuthority=False,
        ),
        files,
    )
