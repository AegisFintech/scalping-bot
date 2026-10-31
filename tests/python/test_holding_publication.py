from __future__ import annotations

import base64
import copy
import json
import subprocess
from pathlib import Path

import pytest

from python.operations import research_publisher as publisher
from python.research import holding_task as task
from python.research.learning_evidence import encoded
from tests.python import test_research_publisher as helpers
from tests.python.test_research_publisher import publication as legacy


def publication(base="a" * 40):
    value = legacy(base).model_dump()
    value["version"] = "signed-research-publication-1.1"
    receipt = value["attestation"]
    receipt["task"] = task.TASK
    receipt["rowsSha256"] = publisher.sha(encoded([]))
    receipt["actualReport"] = task.expected([])
    draft = task.Draft(
        task=task.TASK,
        baseCommit=value["baseCommit"],
        code=value["code"],
        resultSha256=value["resultSha256"],
        findingSha256=value["findingSha256"],
        rationale="Fixture",
    )
    receipt["source"]["bundleSha256"] = publisher.bundle_digest(
        task.candidate_files(draft, value, draft.baseCommit)
    )
    return value


def test_new_contract_binds_its_own_task_module_and_commit_metadata():
    result = publisher.HoldingPublication.model_validate(publication())
    assert result.module == task.MODULE and set(result.files()) == {task.MODULE, task.NOTE}
    assert "holding-duration" in result.message and "holding-duration" in result.title


@pytest.mark.parametrize(
    "field,value",
    [
        ("economicQualification", True),
        ("publishAuthority", True),
        ("rowsSha256", "not-a-digest"),
        ("task", "recorded-payoff-audit-1.0"),
    ],
)
def test_new_receipt_cannot_relabel_task_or_authority(field, value):
    raw = publication()
    raw["attestation"][field] = value
    with pytest.raises(ValueError):
        publisher.HoldingPublication.model_validate(raw)


def test_unknown_report_fields_buckets_and_denomination_conflicts_reject():
    for mode in ["field", "order", "rows", "counterfactual"]:
        value = copy.deepcopy(publication())
        report = value["attestation"]["actualReport"]
        if mode == "field":
            report["accountId"] = "forbidden"
        elif mode == "order":
            report["buckets"].reverse()
        elif mode == "rows":
            report["rows"] = 1
        else:
            report["buckets"][0]["payoff"]["counterfactualNet"] = "100"
        with pytest.raises(ValueError):
            publisher.HoldingPublication.model_validate(value)


def test_legacy_and_new_schema_are_separate_and_immutable():
    assert (
        json.loads(Path("schemas/signed-research-publication-1.0.json").read_bytes())
        == publisher.Publication.model_json_schema()
    )
    assert (
        json.loads(Path("schemas/signed-research-publication-1.1.json").read_bytes())
        == publisher.HoldingPublication.model_json_schema()
    )
    with pytest.raises(ValueError):
        publisher.Publication.model_validate(publication())


def test_signed_new_contract_and_unknown_version(tmp_path):
    from python.research.learning_evidence import encoded

    _, signers = helpers.signed.__wrapped__(tmp_path)
    for version in ["signed-research-publication-1.1", "unknown-contract"]:
        raw = publication()
        raw["version"] = version
        data = encoded(raw)
        path = tmp_path / (version + ".json")
        path.write_bytes(data)
        subprocess.run(
            [
                "ssh-keygen",
                "-Y",
                "sign",
                "-f",
                str(tmp_path / "key"),
                "-n",
                "scalper-candidate",
                str(path),
            ],
            capture_output=True,
            check=True,
        )
        envelope = encoded(
            {
                "payload": base64.b64encode(data).decode(),
                "signature": base64.b64encode(path.with_suffix(".json.sig").read_bytes()).decode(),
            }
        )
        if version == "unknown-contract":
            with pytest.raises(ValueError, match="CONTRACT_UNKNOWN"):
                publisher.authenticate(envelope, signers)
        else:
            result, _ = publisher.authenticate(envelope, signers)
            assert isinstance(result, publisher.HoldingPublication)


def test_real_git_publication_checks_the_new_module_and_reuses_pr(tmp_path, monkeypatch):
    old, remote = helpers.repo.__wrapped__(tmp_path, monkeypatch)
    payload = publisher.HoldingPublication.model_validate(publication(old.baseCommit))
    digest = publisher.sha(
        json.dumps(payload.model_dump(), sort_keys=True, separators=(",", ":")).encode()
    )
    prs = []
    checked = []

    def api(path, body=None):
        if path.startswith("pulls?"):
            return prs
        if path.startswith("git/ref/heads/"):
            branch = path.removeprefix("git/ref/heads/")
            return {
                "object": {
                    "sha": publisher.command(
                        ["git", "--git-dir=" + str(remote), "rev-parse", "refs/heads/" + branch]
                    )
                    .decode()
                    .strip()
                }
            }
        assert path == "pulls" and body["title"] == payload.title
        pr = {
            "number": 77,
            "draft": True,
            "state": "open",
            "user": {"login": publisher.PUBLISHER_LOGIN},
            "base": {"ref": "main", "repo": {"full_name": publisher.REPOSITORY}},
            "head": {
                "repo": {"full_name": publisher.REPOSITORY},
                "sha": publisher.command(["git", "rev-parse", "HEAD"]).decode().strip(),
            },
        }
        prs.append(pr)
        return pr

    monkeypatch.setattr(publisher, "api", api)
    monkeypatch.setattr(publisher, "check_style", lambda module: checked.append(module))
    result = publisher.publish(payload, digest, helpers.NOW, journal=tmp_path / "journal")
    assert checked == [task.MODULE] and result["pullRequest"] == 77
    assert (
        publisher.publish(payload, digest, helpers.NOW, journal=tmp_path / "journal")["status"]
        == "EXISTING_PR"
    )
    assert len(prs) == 1 and Path(task.MODULE).read_text() == payload.code
