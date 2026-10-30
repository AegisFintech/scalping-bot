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
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from python.research.candidate_attestation import TASK, Draft, candidate_files
from python.research.codex_loop import StrictModel, timestamp
from python.research.isolated_worker import bundle_digest
from python.research.learning_archive import unique
from python.research.learning_evidence import Digest, encoded
from python.research.observation_cycle import sha
from python.research.publisher_policy import GitId
from python.research.source_verifier import SourceReceipt

REPOSITORY = "AegisFintech/scalping-bot"
MAX_REQUEST = 32768


class Publication(StrictModel):
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
        receipt = self.attestation
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
        if set(receipt) != fields or receipt["independentReview"] is not None:
            raise ValueError("PUBLICATION_ATTESTATION_FIELDS")
        report = receipt["actualReport"]
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
        source = SourceReceipt.model_validate(receipt.get("source"))
        if (
            source.baseCommit != self.baseCommit
            or source.bundleSha256 != bundle_digest(self.files())
            or receipt.get("task") != TASK
            or receipt.get("resultSha256") != self.resultSha256
            or receipt.get("findingSha256") != self.findingSha256
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
        return self


def command(args: list[str], *, data: bytes | None = None, timeout: int = 120) -> bytes:
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise ValueError("PUBLICATION_COMMAND_FAILED")
    if len(result.stdout) > 1024 * 1024:
        raise ValueError("PUBLICATION_RESPONSE_OVERSIZED")
    return result.stdout


def authenticate(envelope: bytes, signers: Path) -> tuple[Publication, str]:
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
    payload = Publication.model_validate(json.loads(raw, object_pairs_hook=unique))
    if encoded(payload.model_dump()) != raw:
        raise ValueError("PUBLICATION_NONCANONICAL")
    return payload, sha(raw)


def api(path: str, payload: dict[str, Any] | None = None) -> Any:
    args = ["gh", "api", "repos/" + REPOSITORY + "/" + path]
    if payload is not None:
        args += ["--method", "POST", "--input", "-"]
    return json.loads(command(args, data=encoded(payload) if payload is not None else None))


def note(current: bytes, digest: str) -> bytes:
    """Fixed parent-owned metadata; candidate prose never edits protected instructions."""
    marker = "<!-- research-publication -->"
    text = current.decode()
    line = f"{marker}\nResearch-only delivery `{digest}`; no execution or promotion authority.\n"
    if marker in text:
        before, after = text.split(marker, 1)
        if after.count("\n") != 2:
            raise ValueError("PUBLICATION_DOCUMENTATION_TEMPLATE_DRIFT")
        return (before + line).encode()
    return (text.rstrip() + "\n\n" + line).encode()


def commit_identity(payload: Publication) -> None:
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


def expected_commit(payload: Publication, digest: str) -> str:
    """Construct Git objects with a separate index; never execute candidate code."""
    files = payload.files()
    for path in ["README.md", "AGENTS.md"]:
        files[path] = note(command(["git", "show", payload.baseCommit + ":" + path]), digest)
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
                    data=b"research: independently checked recorded payoff audit\n",
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
        or pr["user"]["login"] != "github-actions[bot]"
        or type(pr.get("draft")) is not bool
        or (created and (pr["draft"] is not True or pr.get("state") != "open"))
    ):
        raise ValueError("PUBLICATION_REMOTE_AMBIGUOUS")


def publish(payload: Publication, digest: str, now: datetime) -> dict[str, Any]:
    branch = "research/" + digest
    expected_head = expected_commit(payload, digest)
    # Reconcile existing proposals before freshness rejection; closed/merged PRs never re-open.
    pulls = api("pulls?state=all&head=AegisFintech:" + branch + "&base=main&per_page=100")
    if pulls:
        if len(pulls) != 1:
            raise ValueError("PUBLICATION_REMOTE_AMBIGUOUS")
        confirm_pr(pulls[0], expected_head)
        return {
            "status": "EXISTING_PR",
            "pullRequest": pulls[0]["number"],
            "headCommit": pulls[0]["head"]["sha"],
        }
    completed = timestamp(payload.attestation["completedAt"])
    if not now - timedelta(hours=24) <= completed <= now:
        raise ValueError("PUBLICATION_ATTESTATION_STALE")
    remote = api("git/ref/heads/main")["object"]["sha"]
    if (
        remote != payload.baseCommit
        or command(["git", "rev-parse", "HEAD"]).decode().strip() != remote
    ):
        raise ValueError("PUBLICATION_MAIN_DRIFT")
    if command(["git", "status", "--porcelain"]).strip():
        raise ValueError("PUBLICATION_DIRTY_SOURCE")
    files = payload.files()
    # This first bounded task only adds files. Existing research needs a new reviewed task.
    if any(Path(path).exists() for path in files):
        raise ValueError("PUBLICATION_TASK_ALREADY_PRESENT")
    for path, raw in files.items():
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    for path in ["README.md", "AGENTS.md"]:
        target = Path(path)
        target.write_bytes(note(target.read_bytes(), digest))
    check_style("python/research/experiments/recorded_payoff.py")
    command(["git", "checkout", "-b", branch])
    command(["git", "add", *sorted(files), "README.md", "AGENTS.md"])
    staged = set(command(["git", "diff", "--cached", "--name-only"]).decode().splitlines())
    if staged != set(files) | {"README.md", "AGENTS.md"}:
        raise ValueError("PUBLICATION_STAGED_SCOPE")
    command(["git", "diff", "--cached", "--check"])
    command(["bash", "scripts/secret-scan.sh"])
    # Stable author/time make interrupted push reconciliation compare the exact same commit.
    commit_identity(payload)
    command(["git", "commit", "-m", "research: independently checked recorded payoff audit"])
    head = command(["git", "rev-parse", "HEAD"]).decode().strip()
    if head != expected_head:
        raise ValueError("PUBLICATION_COMMIT_DRIFT")
    command(["git", "push", "origin", branch])  # Normal pre-push hook, never force or skip.
    if api("git/ref/heads/" + branch)["object"]["sha"] != head:
        raise ValueError("PUBLICATION_PUSH_UNCONFIRMED")
    if api("git/ref/heads/main")["object"]["sha"] != payload.baseCommit:
        raise ValueError("PUBLICATION_MAIN_DRIFT_AFTER_PUSH")
    pr = api(
        "pulls",
        {
            "title": "Research: independently checked recorded payoff audit",
            "head": branch,
            "base": "main",
            "draft": True,
            "body": (
                "Result-derived descriptive research for #451/#452.\n\n"
                f"Signed publication `{digest}`; exact base `{payload.baseCommit}`.\n"
                "Independent isolated checks: 28 cases. "
                "Software checks do not qualify a trading strategy.\n\n"
                "Awaiting exact-head CI and independent `aloycwl` review. "
                "No merge or deployment authority."
            ),
        },
    )
    confirm_pr(pr, head, created=True)
    return {"status": "DRAFT", "pullRequest": pr["number"], "headCommit": head}


def main() -> None:
    if (
        os.environ.get("GITHUB_REPOSITORY") != REPOSITORY
        or os.environ.get("GITHUB_REF") != "refs/heads/main"
        or os.environ.get("GITHUB_ACTOR") != "AegisWalletApp"
    ):
        raise ValueError("PUBLICATION_TRUSTED_DISPATCH_REQUIRED")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
    request = event["inputs"]["request"].encode()
    payload, digest = authenticate(request, Path("policy/research-publisher-signers"))
    result = publish(payload, digest, datetime.now(UTC))
    print(
        encoded(
            {"publication": digest, **result, "mergeAuthority": False, "brokerAuthority": False}
        ).decode()
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("PUBLICATION_FAILED_OR_REMOTE_OUTCOME_UNKNOWN")
        raise SystemExit(1) from None
