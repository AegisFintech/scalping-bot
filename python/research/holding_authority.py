"""Protected-parent source/scoring/signature checks; candidate bytes are never executed."""

from __future__ import annotations

import base64
import json
import re
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

from python.operations.research_publisher import MAX_REQUEST, HoldingPublication
from python.research import holding_task as task
from python.research.isolated_worker import MAX_OUTPUT, trusted_path
from python.research.learning_archive import atomic_bytes, bounded, immutable, unique
from python.research.learning_evidence import MAX_BYTES, encoded
from python.research.observation_cycle import sha
from python.research.publisher_policy import EngineeringProposal
from python.research.source_verifier import GitObjects, MirrorTrust, VerifiedCandidate, verify


def prepare(
    draft: task.Draft, facts: dict[str, Any], trust: MirrorTrust, destination: Path, formatter: Path
) -> VerifiedCandidate:
    task.candidate_files(draft, facts, trust.expected_main)
    trusted_path(formatter.resolve(strict=True))
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    immutable(destination / "original-draft.json", draft.model_dump())
    formatted = draft.code.encode()
    # Import spacing is a separate Ruff check; freeze only its formatted result.
    for action in (
        ["check", "--isolated", "--select", "I", "--fix-only"],
        ["format", "--isolated", "--line-length", "100"],
    ):
        formatted = subprocess.run(
            [str(formatter), *action, "--stdin-filename", task.MODULE, "-"],
            input=formatted,
            capture_output=True,
            timeout=20,
            check=True,
            cwd="/",
            env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent"},
        ).stdout
    if len(formatted) > 6000:
        raise ValueError("HOLDING_PREPARATION_SIZE")
    prepared = draft.model_copy(update={"code": formatted.decode()})
    files = task.candidate_files(prepared, facts, trust.expected_main)
    immutable(
        destination / "preparation.json",
        {
            "draft": prepared.model_dump(),
            "formatterSha256": sha(formatter.resolve(strict=True).read_bytes()),
            "normalization": "RUFF_IMPORTS_THEN_FORMAT_V1",
            "originalSha256": sha(encoded(draft.model_dump())),
        },
    )
    trust.verify()
    objects = GitObjects(trust)
    base = objects.main()
    base_tree = objects.read(base, "commit").split(b"\n", 1)[0][5:].decode()
    objects.snapshot(base_tree)
    # Construct objects without a checkout, attributes, hooks or candidate execution.
    entries: dict[str, tuple[str, str]] = {}
    for row in objects.command("ls-tree", "-rz", base_tree).split(b"\0"):
        if row:
            header, path = row.split(b"\t", 1)
            mode, kind, oid = header.decode().split()
            if kind != "blob":
                raise ValueError("HOLDING_BASE_OBJECT_TYPE")
            entries[path.decode()] = (mode, oid)
    if any(name in entries for name in files):
        raise ValueError("HOLDING_TASK_ALREADY_PRESENT")
    for name, raw in files.items():
        oid = objects.command("hash-object", "-w", "--stdin", request=raw).decode().strip()
        entries[name] = ("100644", oid)

    def tree(items: dict[str, tuple[str, str]]) -> str:
        rows = []
        folders: dict[str, dict[str, tuple[str, str]]] = {}
        for name, (mode, oid) in sorted(items.items()):
            if "/" in name:
                folder, rest = name.split("/", 1)
                folders.setdefault(folder, {})[rest] = (mode, oid)
            else:
                rows.append(f"{mode} blob {oid}\t{name}\0")
        for name, children in folders.items():
            rows.append(f"040000 tree {tree(children)}\t{name}\0")
        return objects.command("mktree", "-z", request="".join(rows).encode()).decode().strip()

    candidate = tree(entries)
    proposal = EngineeringProposal.model_validate(
        {
            "schemaVersion": "engineering-proposal-1.0",
            "repository": "AegisFintech/scalping-bot",
            "issue": 464,
            "classification": "RESEARCH_ONLY",
            "policyId": "research-additions-1.0",
            "baseCommit": base,
            "baseTree": base_tree,
            "changes": [
                {
                    "path": name,
                    "beforeSha256": None,
                    "afterSha256": sha(raw),
                    "size": len(raw),
                    "mode": "100644",
                }
                for name, raw in sorted(files.items())
            ],
            "brokerAuthority": False,
            "publishAuthority": False,
            "mergeAuthority": False,
        }
    )
    verified = verify(proposal, candidate, trust)
    immutable(
        destination / "source.json",
        {
            "receipt": verified.receipt.model_dump(),
            "files": {name: raw.hex() for name, raw in verified.files.items()},
        },
    )
    return verified


def artifacts(value: dict[str, Any], names: set[str]) -> dict[str, bytes]:
    source = value["artifacts"]
    if not isinstance(source, dict) or set(source) != names:
        raise ValueError("HOLDING_ATTESTATION_ARTIFACTS")
    result = {}
    for name, raw in source.items():
        if (
            not isinstance(raw, str)
            or len(raw) > 2 * MAX_BYTES
            or not re.fullmatch(r"(?:[a-f0-9]{2})*", raw)
        ):
            raise ValueError("HOLDING_ATTESTATION_ENCODING")
        result[name] = bytes.fromhex(raw)
    return result


def publication(
    response: dict[str, Any],
    request_sha: str,
    verified: VerifiedCandidate,
    facts: dict[str, Any],
    pins: dict[str, str],
    expected_input: bytes,
) -> HoldingPublication:
    if (
        response["job"] != request_sha
        or response["requestSha256"] != request_sha
        or response["status"] != "AWAITING_INDEPENDENT_REVIEW"
    ):
        raise ValueError("HOLDING_ATTESTATION_IDENTITY")
    files = artifacts(
        response, {"binding.json", "input.json", "claim.json", "output.json", "attestation.json"}
    )
    if files["input.json"] != expected_input:
        raise ValueError("HOLDING_ATTESTATION_INPUT_CHANGED")
    values = {name: json.loads(raw, object_pairs_hook=unique) for name, raw in files.items()}
    receipt = values["attestation.json"]
    if receipt != response["outcome"]:
        raise ValueError("HOLDING_ATTESTATION_RECEIPT")
    claim, binding = values["claim.json"], values["binding.json"]
    challenge, output = values["input.json"], values["output.json"]
    rows = facts["rows"]
    if (
        challenge["module"] != task.MODULE
        or len(challenge["cases"]) != 28
        or challenge["cases"][0] != rows
    ):
        raise ValueError("HOLDING_ATTESTATION_CHALLENGES")
    expected = [task.expected(case) for case in challenge["cases"]]
    actual = bytes.fromhex(output["outputHex"])
    if len(actual) > MAX_OUTPUT or output["exitCode"] != 0:
        raise ValueError("HOLDING_ATTESTATION_OUTPUT")
    if encoded(json.loads(actual, object_pairs_hook=unique)) != encoded(expected):
        raise ValueError("HOLDING_ATTESTATION_MISMATCH")
    wanted = {
        "task": task.TASK,
        "source": verified.receipt.model_dump(),
        "resultSha256": facts["resultSha256"],
        "findingSha256": facts["findingSha256"],
        "runtimeSha256": pins["runtimeSha256"],
        "verifierSha256": pins["verifierSha256"],
        "oracleSha256": pins["oracleSha256"],
        "rowsSha256": sha(encoded(rows)),
    }
    if (
        binding != wanted
        or claim["bindingSha256"] != sha(encoded(wanted))
        or claim["inputSha256"] != sha(files["input.json"])
    ):
        raise ValueError("HOLDING_ATTESTATION_BINDING")
    digests = {
        "inputSha256": sha(files["input.json"]),
        "outputSha256": sha(actual),
        "expectedSha256": sha(encoded(expected)),
    }
    if (
        any(receipt.get(k) != v for k, v in {**wanted, **digests}.items())
        or receipt["actualReport"] != expected[0]
    ):
        raise ValueError("HOLDING_ATTESTATION_DIGEST")
    return HoldingPublication(
        version="signed-research-publication-1.1",
        authority="DRAFT_ONLY",
        baseCommit=verified.receipt.baseCommit,
        trialId=facts["trialId"],
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code=verified.files[task.MODULE].decode(),
        attestation=receipt,
    )


def queue(
    payload: HoldingPublication,
    destination: Path,
    outbox: Path,
    key: Path,
    current_main: Callable[[], str],
) -> str:
    trusted_path(key)
    if key.stat().st_mode & 0o077:
        raise ValueError("HOLDING_SIGNING_KEY_PERMISSIONS")
    raw = encoded(payload.model_dump())
    digest = sha(raw)
    immutable(destination / "publication.json", payload.model_dump())
    if current_main() != payload.baseCommit:
        raise ValueError("HOLDING_MAIN_DRIFT_BEFORE_SIGNING")
    sig = destination / "publication.json.sig"
    if not sig.exists():
        subprocess.run(
            [
                "ssh-keygen",
                "-Y",
                "sign",
                "-f",
                str(key),
                "-n",
                "scalper-candidate",
                str(destination / "publication.json"),
            ],
            capture_output=True,
            timeout=15,
            check=True,
            env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent"},
        )
    envelope = encoded(
        {
            "payload": base64.b64encode(raw).decode(),
            "signature": base64.b64encode(bounded(sig, 8192)).decode(),
        }
    )
    if len(envelope) > MAX_REQUEST:
        raise ValueError("HOLDING_PUBLICATION_SIZE")
    if current_main() != payload.baseCommit:
        raise ValueError("HOLDING_MAIN_DRIFT_BEFORE_QUEUE")
    path = outbox / (digest + ".json")
    if path.exists():
        if bounded(path, MAX_REQUEST) != envelope:
            raise ValueError("HOLDING_QUEUE_CONFLICT")
    else:
        atomic_bytes(path, envelope, replace=False)
        path.chmod(0o644)
    immutable(
        destination / "signed.json", {"publicationSha256": digest, "envelopeSha256": sha(envelope)}
    )
    return digest
