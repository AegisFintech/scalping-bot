from __future__ import annotations

import base64
import copy
import json
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from python.operations import research_publisher as p
from python.research import candidate_attestation as c
from python.research.learning_evidence import encoded
from tests.python.test_candidate_attestation import verified

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)


def publication(base="a" * 40):
    facts = {"trialId": "b" * 64, "resultSha256": "c" * 64, "findingSha256": "d" * 64}
    files = c.candidate_files(
        c.Draft(
            task=c.TASK,
            baseCommit=base,
            resultSha256=facts["resultSha256"],
            findingSha256=facts["findingSha256"],
            code="def report(rows):\n    return {}\n",
            rationale="Fixture",
        ),
        facts,
        base,
    )
    source = verified(facts).receipt.model_copy(
        update={"baseCommit": base, "bundleSha256": p.bundle_digest(files)}
    )
    attestation = {
        "task": c.TASK,
        "source": source.model_dump(),
        "resultSha256": facts["resultSha256"],
        "findingSha256": facts["findingSha256"],
        **{
            k: "e" * 64
            for k in [
                "runtimeSha256",
                "verifierSha256",
                "oracleSha256",
                "inputSha256",
                "outputSha256",
                "expectedSha256",
            ]
        },
        "caseCount": 28,
        "completedAt": NOW.isoformat(),
        "status": "AWAITING_INDEPENDENT_REVIEW",
        "softwareTestsPassed": True,
        "independentReview": None,
        "actualReport": c.expected([]),
        "economicQualification": False,
        "publishAuthority": False,
        "brokerAuthority": False,
    }
    return p.Publication(
        version="signed-research-publication-1.0",
        authority="DRAFT_ONLY",
        baseCommit=base,
        **facts,
        code=files[c.MODULE].decode(),
        attestation=attestation,
    )


@pytest.fixture
def signed(tmp_path):
    key = tmp_path / "key"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    signers = tmp_path / "signers"
    signers.write_text("scalper-attestor " + key.with_suffix(".pub").read_text())
    raw = encoded(publication().model_dump())
    payload = tmp_path / "payload"
    payload.write_bytes(raw)
    subprocess.run(
        ["ssh-keygen", "-Y", "sign", "-f", str(key), "-n", "scalper-candidate", str(payload)],
        capture_output=True,
        check=True,
    )
    return {
        "payload": base64.b64encode(raw).decode(),
        "signature": base64.b64encode(payload.with_suffix(".sig").read_bytes()).decode(),
    }, signers


def test_signature_accepts_only_parent_signed_exact_bytes(signed):
    envelope, signers = signed
    result, digest = p.authenticate(encoded(envelope), signers)
    assert result.authority == "DRAFT_ONLY" and len(digest) == 64
    changed = copy.deepcopy(envelope)
    changed["payload"] = base64.b64encode(base64.b64decode(envelope["payload"]) + b" ").decode()
    with pytest.raises(ValueError, match="SIGNATURE_REJECTED"):
        p.authenticate(encoded(changed), signers)


@pytest.mark.parametrize(
    "field,value",
    [
        ("softwareTestsPassed", False),
        ("publishAuthority", True),
        ("brokerAuthority", True),
        ("caseCount", 1),
        ("independentReview", "self-approved"),
        ("status", "REJECTED"),
    ],
)
def test_attestation_cannot_promote_or_self_approve(field, value):
    raw = publication().model_dump()
    raw["attestation"][field] = value
    with pytest.raises(ValueError):
        p.Publication.model_validate(raw)


def test_changed_source_and_extra_report_fields_reject():
    raw = publication().model_dump()
    raw["code"] += "\nimport os\n"
    with pytest.raises(ValueError):
        p.Publication.model_validate(raw)
    raw = publication().model_dump()
    raw["attestation"]["actualReport"]["accountId"] = "never publish"
    with pytest.raises(ValueError, match="REPORT_FIELDS"):
        p.Publication.model_validate(raw)


def test_trusted_documentation_template_is_bounded():
    original = b"# Instructions\n\nKeep safeguards.\n"
    first = p.note(original, "a" * 64)
    second = p.note(first, "b" * 64)
    assert second.startswith(original) and b"a" * 64 not in second
    assert second.count(b"<!-- research-publication -->") == 1
    with pytest.raises(ValueError, match="TEMPLATE_DRIFT"):
        p.note(first + b"Hidden instructions\n", "c" * 64)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    repository = tmp_path / "repo"
    repository.mkdir()
    monkeypatch.chdir(repository)
    for key in [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_DATE",
    ]:
        monkeypatch.setenv(key, "")
        monkeypatch.delenv(key)
    p.command(["git", "init", "-b", "main"])
    p.command(["git", "config", "user.name", "Fixture"])
    p.command(["git", "config", "user.email", "fixture@example.invalid"])
    for name in ["README.md", "AGENTS.md"]:
        Path(name).write_text("# Trusted\n")
    Path("scripts").mkdir()
    Path("scripts/secret-scan.sh").write_text("#!/bin/sh\nexit 0\n")
    p.command(["git", "add", "."])
    p.command(["git", "commit", "-m", "Trusted base"])
    base = p.command(["git", "rev-parse", "HEAD"]).decode().strip()
    remote = tmp_path / "remote.git"
    p.command(["git", "init", "--bare", str(remote)])
    p.command(["git", "remote", "add", "origin", str(remote)])
    p.command(["git", "push", "origin", "main"])
    return publication(base), remote


@pytest.mark.parametrize("lost_reply", [False, True])
def test_real_git_commit_and_duplicate_pr_reconciliation(repo, monkeypatch, lost_reply):
    payload, remote = repo
    digest = p.sha(encoded(payload.model_dump()))
    prs = []

    def api(path, body=None):
        if path.startswith("pulls?"):
            return prs
        if path.startswith("git/ref/heads/"):
            branch = path.removeprefix("git/ref/heads/")
            return {
                "object": {
                    "sha": p.command(
                        ["git", "--git-dir=" + str(remote), "rev-parse", "refs/heads/" + branch]
                    )
                    .decode()
                    .strip()
                }
            }
        assert path == "pulls" and body["draft"] is True
        head = p.command(["git", "rev-parse", "HEAD"]).decode().strip()
        pr = {
            "number": 12,
            "head": {"repo": {"full_name": p.REPOSITORY}, "sha": head},
            "base": {"ref": "main", "repo": {"full_name": p.REPOSITORY}},
            "draft": True,
            "state": "open",
            "user": {"login": "github-actions[bot]"},
        }
        prs.append(pr)
        if lost_reply:
            raise OSError("Simulated lost PR creation reply")
        return pr

    monkeypatch.setattr(p, "api", api)
    monkeypatch.setattr(p, "check_style", lambda module: None)
    expected = p.expected_commit(payload, digest)
    if lost_reply:
        with pytest.raises(OSError):
            p.publish(payload, digest, NOW)
    else:
        result = p.publish(payload, digest, NOW)
        assert result == {"status": "DRAFT", "pullRequest": 12, "headCommit": expected}
    duplicate = p.publish(payload, digest, NOW + timedelta(days=2))
    assert duplicate["status"] == "EXISTING_PR" and len(prs) == 1
    prs[0]["head"]["sha"] = "f" * 40
    with pytest.raises(ValueError, match="REMOTE_AMBIGUOUS"):
        p.publish(payload, digest, NOW)


def test_remote_main_drift_blocks_writes(repo, monkeypatch):
    payload, _ = repo
    monkeypatch.setattr(
        p,
        "api",
        lambda path, body=None: [] if path.startswith("pulls?") else {"object": {"sha": "f" * 40}},
    )
    with pytest.raises(ValueError, match="MAIN_DRIFT"):
        p.publish(payload, p.sha(encoded(payload.model_dump())), NOW)
    assert not Path(c.MODULE).exists()


def test_expired_attestation_cannot_start_new_publication(repo, monkeypatch):
    payload, _ = repo
    monkeypatch.setattr(p, "api", lambda *args: [])
    with pytest.raises(ValueError, match="ATTESTATION_STALE"):
        p.publish(payload, p.sha(encoded(payload.model_dump())), NOW + timedelta(days=2))


def test_schema_matches():
    assert (
        json.loads(Path("schemas/signed-research-publication-1.0.json").read_bytes())
        == p.Publication.model_json_schema()
    )


def test_lost_push_reply_recovers_from_a_fresh_runner(repo, monkeypatch, tmp_path):
    payload, remote = repo
    digest = p.sha(encoded(payload.model_dump()))
    original = p.command
    lost = [False]
    prs = []

    def command(args, **kwargs):
        result = original(args, **kwargs)
        if args[:2] == ["git", "push"] and not lost[0]:
            lost[0] = True
            raise OSError("Simulated lost push reply")
        return result

    def api(path, body=None):
        if path.startswith("pulls?"):
            return prs
        if path.startswith("git/ref/heads/"):
            branch = path.removeprefix("git/ref/heads/")
            return {
                "object": {
                    "sha": original(
                        ["git", "--git-dir=" + str(remote), "rev-parse", "refs/heads/" + branch]
                    )
                    .decode()
                    .strip()
                }
            }
        assert body["draft"] is True
        head = original(["git", "rev-parse", "HEAD"]).decode().strip()
        return {
            "number": 15,
            "head": {"repo": {"full_name": p.REPOSITORY}, "sha": head},
            "base": {"ref": "main", "repo": {"full_name": p.REPOSITORY}},
            "draft": True,
            "state": "open",
            "user": {"login": "github-actions[bot]"},
        }

    monkeypatch.setattr(p, "api", api)
    monkeypatch.setattr(p, "check_style", lambda module: None)
    monkeypatch.setattr(p, "command", command)
    with pytest.raises(OSError):
        p.publish(payload, digest, NOW)
    recovered = tmp_path / "fresh-runner"
    original(["git", "clone", "--branch", "main", str(remote), str(recovered)])
    monkeypatch.chdir(recovered)
    result = p.publish(payload, digest, NOW)
    assert result["pullRequest"] == 15 and result["headCommit"] == p.expected_commit(
        payload, digest
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"draft": False},
        {"state": "closed"},
        {"number": True},
        {"head": {"repo": {"full_name": p.REPOSITORY}, "sha": "f" * 40}},
    ],
)
def test_create_response_must_confirm_exact_draft_head(patch):
    pr = {
        "number": 15,
        "head": {"repo": {"full_name": p.REPOSITORY}, "sha": "a" * 40},
        "base": {"ref": "main", "repo": {"full_name": p.REPOSITORY}},
        "draft": True,
        "state": "open",
        "user": {"login": "github-actions[bot]"},
        **patch,
    }
    with pytest.raises(ValueError, match="REMOTE_AMBIGUOUS"):
        p.confirm_pr(pr, "a" * 40, created=True)
