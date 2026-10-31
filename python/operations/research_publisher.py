"""Publish signed research bytes as a draft PR; never execute them or merge/deploy."""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, ClassVar, Literal

from pydantic import Field, model_validator

from python.research import holding_task as holding
from python.research.candidate_attestation import TASK, Draft, candidate_files
from python.research.codex_loop import StrictModel, timestamp
from python.research.experiment_registry import read
from python.research.isolated_worker import bundle_digest
from python.research.learning_archive import immutable, unique
from python.research.learning_evidence import Digest, encoded
from python.research.observation_cycle import sha
from python.research.publisher_policy import GitId
from python.research.source_verifier import SourceReceipt

REPOSITORY = "AegisFintech/scalping-bot"
PUBLISHER_LOGIN = "AegisWalletApp"
MAX_REQUEST = 32768


class Publication(StrictModel):
    module: ClassVar[str] = "python/research/experiments/recorded_payoff.py"
    message: ClassVar[str] = "research: independently checked recorded payoff audit"
    title: ClassVar[str] = "Research: independently checked recorded payoff audit"
    issue: ClassVar[str] = "#451/#452"
    version: Literal["signed-research-publication-1.0"]
    authority: Literal["DRAFT_ONLY"]
    baseCommit: GitId
    trialId: Digest
    resultSha256: Digest
    findingSha256: Digest
    code: Annotated[str, Field(min_length=1, max_length=6000)]
    attestation: dict[str, Any]

    def files(self) -> dict[str, bytes]:
        draft = Draft(
            task=TASK,
            baseCommit=self.baseCommit,
            resultSha256=self.resultSha256,
            findingSha256=self.findingSha256,
            code=self.code,
            rationale="Trusted publication binding; original rationale remains archived.",
        )
        return candidate_files(draft, self.model_dump(), self.baseCommit)

    @model_validator(mode="after")
    def binding(self) -> Publication:
        validate_receipt(self, TASK)
        validate_payoff_report(self.attestation["actualReport"])
        return self


class HoldingPublication(StrictModel):
    version: Literal["signed-research-publication-1.1"]
    authority: Literal["DRAFT_ONLY"]
    baseCommit: GitId
    trialId: Digest
    resultSha256: Digest
    findingSha256: Digest
    code: Annotated[str, Field(min_length=1, max_length=6000)]
    attestation: dict[str, Any]
    module: ClassVar[str] = holding.MODULE
    message: ClassVar[str] = "research: independently checked holding-duration payoff audit"
    title: ClassVar[str] = "Research: recorded holding-duration payoff audit"
    issue: ClassVar[str] = "#464"

    def files(self) -> dict[str, bytes]:
        draft = holding.Draft(
            task=holding.TASK,
            baseCommit=self.baseCommit,
            resultSha256=self.resultSha256,
            findingSha256=self.findingSha256,
            code=self.code,
            rationale="Trusted binding; original rationale remains archived.",
        )
        return holding.candidate_files(draft, self.model_dump(), self.baseCommit)

    @model_validator(mode="after")
    def binding(self) -> HoldingPublication:
        validate_receipt(self, holding.TASK)
        report = self.attestation["actualReport"]
        if (
            not isinstance(report, dict)
            or set(report) != {"rows", "buckets", "counterfactualNet", "economicQualification"}
            or type(report["rows"]) is not int
            or not 0 <= report["rows"] <= 100000
            or not isinstance(report["buckets"], list)
            or len(report["buckets"]) != 6
            or report["counterfactualNet"] is not None
            or report["economicQualification"] is not False
        ):
            raise ValueError("PUBLICATION_HOLDING_REPORT")
        for name, item in zip(holding.BUCKETS, report["buckets"], strict=True):
            if (
                not isinstance(item, dict)
                or set(item) != {"bucket", "payoff"}
                or item["bucket"] != name
            ):
                raise ValueError("PUBLICATION_HOLDING_BUCKET")
            validate_payoff_report(item["payoff"])
        if sum(item["payoff"]["rows"] for item in report["buckets"]) != report["rows"]:
            raise ValueError("PUBLICATION_HOLDING_ROWS")
        return self


type SignedPublication = Publication | HoldingPublication


def validate_payoff_report(report: Any) -> None:
    counts = {
        "rows",
        "knownNet",
        "unknownNet",
        "wins",
        "losses",
        "flat",
        "knownFees",
        "unknownFees",
    }
    amounts = {"net", "signedFees", "winningNet", "losingNet", "lossPerAverageWin"}
    if not isinstance(report, dict) or set(report) != counts | amounts | {
        "counterfactualNet",
        "economicQualification",
    }:
        raise ValueError("PUBLICATION_REPORT_FIELDS")
    if any(type(report[k]) is not int or not 0 <= report[k] <= 100000 for k in counts):
        raise ValueError("PUBLICATION_REPORT_COUNT")
    for key in amounts:
        value = report[key]
        if key == "lossPerAverageWin" and value is None:
            continue
        if not isinstance(value, str) or not re.fullmatch(
            r"-?[0-9]{1,100}(?:\.[0-9]{1,100})?", value
        ):
            raise ValueError("PUBLICATION_REPORT_AMOUNT")
    if report["counterfactualNet"] is not None or report["economicQualification"] is not False:
        raise ValueError("PUBLICATION_REPORT_AUTHORITY")


def validate_receipt(payload: SignedPublication, task_name: str) -> None:
    receipt = payload.attestation
    fields = {
        "task",
        "source",
        "resultSha256",
        "findingSha256",
        "runtimeSha256",
        "verifierSha256",
        "oracleSha256",
        "inputSha256",
        "outputSha256",
        "expectedSha256",
        "caseCount",
        "completedAt",
        "status",
        "softwareTestsPassed",
        "independentReview",
        "actualReport",
        "economicQualification",
        "publishAuthority",
        "brokerAuthority",
    }
    if task_name == holding.TASK:
        fields.add("rowsSha256")
        if not re.fullmatch(r"[a-f0-9]{64}", str(receipt.get("rowsSha256"))):
            raise ValueError("PUBLICATION_ATTESTATION_DIGEST")
    if set(receipt) != fields or receipt["independentReview"] is not None:
        raise ValueError("PUBLICATION_ATTESTATION_FIELDS")
    source = SourceReceipt.model_validate(receipt.get("source"))
    if (
        source.baseCommit != payload.baseCommit
        or source.bundleSha256 != bundle_digest(payload.files())
        or receipt.get("task") != task_name
        or receipt.get("resultSha256") != payload.resultSha256
        or receipt.get("findingSha256") != payload.findingSha256
        or receipt.get("softwareTestsPassed") is not True
        or receipt.get("status") != "AWAITING_INDEPENDENT_REVIEW"
        or receipt.get("caseCount") != 28
        or receipt.get("publishAuthority") is not False
        or receipt.get("brokerAuthority") is not False
        or receipt.get("economicQualification") is not False
    ):
        raise ValueError("PUBLICATION_ATTESTATION_BINDING")
    for key in [
        "runtimeSha256",
        "verifierSha256",
        "oracleSha256",
        "inputSha256",
        "outputSha256",
        "expectedSha256",
    ]:
        if not re.fullmatch(r"[a-f0-9]{64}", str(receipt.get(key))):
            raise ValueError("PUBLICATION_ATTESTATION_DIGEST")
    timestamp(receipt["completedAt"])


def command(args: list[str], *, data: bytes | None = None, timeout: int = 120) -> bytes:
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise ValueError("PUBLICATION_COMMAND_FAILED")
    if len(result.stdout) > 1024 * 1024:
        raise ValueError("PUBLICATION_RESPONSE_OVERSIZED")
    return result.stdout


def authenticate(envelope: bytes, signers: Path) -> tuple[SignedPublication, str]:
    """A protected parent signs only after independent attestation; workers lack its key."""
    if len(envelope) > MAX_REQUEST:
        raise ValueError("PUBLICATION_REQUEST_OVERSIZED")
    value = json.loads(envelope, object_pairs_hook=unique)
    if set(value) != {"payload", "signature"}:
        raise ValueError("PUBLICATION_ENVELOPE_FIELDS")
    raw = base64.b64decode(value["payload"], validate=True)
    signature = base64.b64decode(value["signature"], validate=True)
    with tempfile.TemporaryDirectory() as directory:
        sig = Path(directory) / "request.sig"
        sig.write_bytes(signature)
        result = subprocess.run(
            [
                "ssh-keygen",
                "-Y",
                "verify",
                "-f",
                str(signers),
                "-I",
                "scalper-attestor",
                "-n",
                "scalper-candidate",
                "-s",
                str(sig),
            ],
            input=raw,
            capture_output=True,
            timeout=10,
            check=False,
            env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent"},
        )
        if result.returncode:
            raise ValueError("PUBLICATION_SIGNATURE_REJECTED")
    document = json.loads(raw, object_pairs_hook=unique)
    if document.get("version") == "signed-research-publication-1.0":
        payload: SignedPublication = Publication.model_validate(document)
    elif document.get("version") == "signed-research-publication-1.1":
        payload = HoldingPublication.model_validate(document)
    else:
        raise ValueError("PUBLICATION_CONTRACT_UNKNOWN")
    if encoded(payload.model_dump()) != raw:
        raise ValueError("PUBLICATION_NONCANONICAL")
    return payload, sha(raw)


def api(path: str, payload: dict[str, Any] | None = None) -> Any:
    args = ["gh", "api", "repos/" + REPOSITORY + "/" + path]
    if payload is not None:
        args += ["--method", "POST", "--input", "-"]
    return json.loads(command(args, data=encoded(payload) if payload is not None else None))


def note(current: bytes, digest: str, *, legacy: bool = False) -> bytes:
    """Fixed parent-owned metadata; candidate prose never edits protected instructions."""
    marker = "<!-- research-publication -->"
    text = current.decode()
    separator = "\n" if legacy else "\n\n"
    line = (
        f"{marker}{separator}Research-only delivery `{digest}`; "
        "no execution or promotion authority.\n"
    )
    if marker in text:
        before, after = text.split(marker, 1)
        if not re.fullmatch(
            r"\n\n?Research-only delivery `[a-f0-9]{64}`; no execution or promotion authority\.\n",
            after,
        ):
            raise ValueError("PUBLICATION_DOCUMENTATION_TEMPLATE_DRIFT")
        return (before + line).encode()
    return (text.rstrip() + "\n\n" + line).encode()


def commit_identity(payload: SignedPublication) -> None:
    stamp = "@" + str(int(timestamp(payload.attestation["completedAt"]).timestamp())) + " +0000"
    os.environ.update(
        {
            "GIT_AUTHOR_NAME": "Scalper research publisher",
            "GIT_AUTHOR_EMAIL": "research-publisher@users.noreply.github.com",
            "GIT_COMMITTER_NAME": "Scalper research publisher",
            "GIT_COMMITTER_EMAIL": "research-publisher@users.noreply.github.com",
            "GIT_AUTHOR_DATE": stamp,
            "GIT_COMMITTER_DATE": stamp,
        }
    )


def expected_commit(payload: SignedPublication, digest: str, *, legacy: bool = False) -> str:
    """Construct Git objects with a separate index; never execute candidate code."""
    files = payload.files()
    for path in ["README.md", "AGENTS.md"]:
        files[path] = note(
            command(["git", "show", payload.baseCommit + ":" + path]), digest, legacy=legacy
        )
    commit_identity(payload)
    with tempfile.TemporaryDirectory() as directory:
        old = os.environ.get("GIT_INDEX_FILE")
        os.environ["GIT_INDEX_FILE"] = str(Path(directory) / "index")
        try:
            command(["git", "read-tree", payload.baseCommit])
            for path, raw in files.items():
                blob = command(["git", "hash-object", "-w", "--stdin"], data=raw).decode().strip()
                command(
                    ["git", "update-index", "--add", "--cacheinfo", "100644," + blob + "," + path]
                )
            tree = command(["git", "write-tree"]).decode().strip()
            return (
                command(
                    ["git", "commit-tree", tree, "-p", payload.baseCommit],
                    data=(payload.message + "\n").encode(),
                )
                .decode()
                .strip()
            )
        finally:
            if old is None:
                os.environ.pop("GIT_INDEX_FILE", None)
            else:
                os.environ["GIT_INDEX_FILE"] = old


def check_style(module: str) -> None:
    """Static checks only. Never change the source that the independent worker attested."""
    command([".venv/bin/ruff", "check", module])
    command([".venv/bin/ruff", "format", "--check", module])
    command([".venv/bin/mypy", "--strict", module])


def confirm_pr(pr: dict[str, Any], expected_head: str, *, created: bool = False) -> None:
    if (
        type(pr.get("number")) is not int
        or not 1 <= pr["number"] <= 999999999
        or pr["head"]["repo"]["full_name"] != REPOSITORY
        or pr["head"]["sha"] != expected_head
        or pr["base"]["repo"]["full_name"] != REPOSITORY
        or pr["base"]["ref"] != "main"
        or pr["user"]["login"] != PUBLISHER_LOGIN
        or type(pr.get("draft")) is not bool
        or (created and (pr["draft"] is not True or pr.get("state") != "open"))
    ):
        raise ValueError("PUBLICATION_REMOTE_AMBIGUOUS")


def record_phase(journal: Path, phase: str, facts: dict[str, Any]) -> None:
    journal.mkdir(parents=True, mode=0o700, exist_ok=True)
    path = journal / (phase + ".json")
    value = {"phase": phase, **facts}
    if path.exists():
        prior = read(path)
        prior.pop("observedAt")
        if prior != value:
            raise ValueError("PUBLICATION_JOURNAL_CONFLICT")
        return
    immutable(path, {**value, "observedAt": datetime.now(UTC).isoformat()})


def publish(
    payload: SignedPublication, digest: str, now: datetime, *, journal: Path
) -> dict[str, Any]:
    branch = "research/" + digest
    expected_head = expected_commit(payload, digest)
    pulls = api("pulls?state=all&head=AegisFintech:" + branch + "&base=main&per_page=100")
    if len(pulls) > 1:
        raise ValueError("PUBLICATION_REMOTE_AMBIGUOUS")
    prior = journal / "proposal.json"
    recorded_head = read(prior).get("expectedCommit") if prior.exists() else None
    observed_head = recorded_head or (pulls[0]["head"]["sha"] if pulls else None)
    legacy = observed_head is not None and observed_head != expected_head
    if legacy:
        # Preserve already committed/published bytes after fixing Markdown whitespace.
        # Only these two exact trusted templates are recoverable, never arbitrary heads.
        old_head = expected_commit(payload, digest, legacy=True)
        if observed_head != old_head:
            raise ValueError("PUBLICATION_REMOTE_AMBIGUOUS")
        expected_head = old_head
    record_phase(
        journal,
        "proposal",
        {
            "publicationSha256": digest,
            "baseCommit": payload.baseCommit,
            "attestationSha256": sha(encoded(payload.attestation)),
            "expectedCommit": expected_head,
        },
    )
    # Reconcile existing proposals before freshness rejection; closed/merged PRs never re-open.
    if pulls:
        confirm_pr(pulls[0], expected_head)
        record_phase(
            journal, "remote-pr", {"number": pulls[0]["number"], "headCommit": expected_head}
        )
        return {
            "status": "EXISTING_PR",
            "pullRequest": pulls[0]["number"],
            "headCommit": pulls[0]["head"]["sha"],
            "remoteState": "MERGED"
            if pulls[0].get("merged_at")
            else "CLOSED"
            if pulls[0]["state"] == "closed"
            else "OPEN",
        }
    completed = timestamp(payload.attestation["completedAt"])
    if not now - timedelta(hours=24) <= completed <= now:
        raise ValueError("PUBLICATION_ATTESTATION_STALE")
    remote = api("git/ref/heads/main")["object"]["sha"]
    head = command(["git", "rev-parse", "HEAD"]).decode().strip()
    if remote != payload.baseCommit or head not in {payload.baseCommit, expected_head}:
        raise ValueError("PUBLICATION_MAIN_DRIFT")
    if command(["git", "status", "--porcelain"]).strip():
        raise ValueError("PUBLICATION_DIRTY_SOURCE")
    if head != expected_head:
        files = payload.files()
        # Each bounded task only adds files; existing research needs a new reviewed task.
        if any(Path(path).exists() for path in files):
            raise ValueError("PUBLICATION_TASK_ALREADY_PRESENT")
        for path, raw in files.items():
            target = Path(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        for path in ["README.md", "AGENTS.md"]:
            target = Path(path)
            target.write_bytes(note(target.read_bytes(), digest, legacy=legacy))
        check_style(payload.module)
        command(["git", "checkout", "-b", branch])
        command(["git", "add", *sorted(files), "README.md", "AGENTS.md"])
        staged = set(command(["git", "diff", "--cached", "--name-only"]).decode().splitlines())
        if staged != set(files) | {"README.md", "AGENTS.md"}:
            raise ValueError("PUBLICATION_STAGED_SCOPE")
        command(["git", "diff", "--cached", "--check"])
        command(["bash", "scripts/secret-scan.sh"])
        # Stable author/time make interrupted push reconciliation compare the exact same commit.
        commit_identity(payload)
        command(["git", "commit", "-m", payload.message])
    head = command(["git", "rev-parse", "HEAD"]).decode().strip()
    if head != expected_head:
        raise ValueError("PUBLICATION_COMMIT_DRIFT")
    record_phase(journal, "commit", {"headCommit": head})
    record_phase(journal, "push-intent", {"headCommit": head, "branch": branch})
    command(["git", "push", "origin", branch])  # Normal pre-push hook, never force or skip.
    if api("git/ref/heads/" + branch)["object"]["sha"] != head:
        raise ValueError("PUBLICATION_PUSH_UNCONFIRMED")
    record_phase(journal, "push-confirmed", {"headCommit": head, "branch": branch})
    if api("git/ref/heads/main")["object"]["sha"] != payload.baseCommit:
        raise ValueError("PUBLICATION_MAIN_DRIFT_AFTER_PUSH")
    record_phase(journal, "pr-intent", {"headCommit": head, "branch": branch})
    pr = api(
        "pulls",
        {
            "title": payload.title,
            "head": branch,
            "base": "main",
            "draft": True,
            "body": (
                f"Result-derived descriptive research for {payload.issue}.\n\n"
                f"Signed publication `{digest}`; exact base `{payload.baseCommit}`.\n"
                "Independent isolated checks: 28 cases. "
                "Software checks do not qualify a trading strategy.\n\n"
                "Awaiting exact-head CI and independent `aloycwl` review. "
                "No merge or deployment authority."
            ),
        },
    )
    confirm_pr(pr, head, created=True)
    record_phase(journal, "remote-pr", {"number": pr["number"], "headCommit": head})
    return {
        "status": "DRAFT",
        "pullRequest": pr["number"],
        "headCommit": head,
        "remoteState": "OPEN",
    }
