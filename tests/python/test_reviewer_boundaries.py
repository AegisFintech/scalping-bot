from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from python.operations import holding_workers as cache
from python.operations import research_reviewer as reviewer
from python.operations import source_review_worker as worker
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha


def protection():
    return {
        "enforce_admins": {"enabled": True},
        "allow_force_pushes": {"enabled": False},
        "allow_deletions": {"enabled": False},
        "required_status_checks": {
            "strict": True,
            "checks": [{"context": "qualify-exact-head", "app_id": 15368}],
        },
        "required_pull_request_reviews": {
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": True,
            "require_code_owner_reviews": True,
            "require_last_push_approval": True,
        },
    }


def test_changed_branch_rules_and_protected_sources_block(monkeypatch):
    config = {
        "protectedFiles": {
            name: sha(b"frozen")
            for name in (".github/workflows/qualification.yml", ".github/CODEOWNERS")
        }
    }
    current = protection()
    monkeypatch.setattr(reviewer.publisher, "api", lambda _: current)
    monkeypatch.setattr(reviewer.publisher, "command", lambda *_: b"frozen")
    reviewer.rules(config)
    for scope, key, value in (
        ("enforce_admins", "enabled", False),
        ("required_status_checks", "strict", False),
        ("required_pull_request_reviews", "require_last_push_approval", False),
        ("required_pull_request_reviews", "required_approving_review_count", 0),
    ):
        current = copy.deepcopy(protection())
        current[scope][key] = value
        with pytest.raises(ValueError, match="BRANCH_RULES_CHANGED"):
            reviewer.rules(config)
    current = protection()
    current["required_status_checks"]["checks"][0]["app_id"] = 99
    with pytest.raises(ValueError, match="BRANCH_RULES_CHANGED"):
        reviewer.rules(config)
    current = protection()
    with pytest.raises(ValueError, match="PINS_MISSING"):
        reviewer.rules({"protectedFiles": {}})
    monkeypatch.setattr(reviewer.publisher, "command", lambda *_: b"changed")
    with pytest.raises(ValueError, match="PROTECTED_SOURCE_CHANGED"):
        reviewer.rules(config)


def test_signed_cache_relay_is_idempotent_and_rejects_tamper_or_paths(tmp_path):
    from tests.python import test_research_publisher as fixtures

    document, signers = fixtures.signed.__wrapped__(tmp_path)
    envelope = encoded(document)
    _, digest = cache.publisher.authenticate(envelope, signers)
    directory = tmp_path / "publications"
    result = cache.cache_publication(envelope, directory, signers)
    assert result == {"status": "PUBLICATION_CACHED", "publicationSha256": digest}
    assert cache.cache_publication(envelope, directory, signers) == result
    assert reviewer.fetch_envelope(digest, {"publications": str(directory)}) == envelope
    with pytest.raises(ValueError):
        cache.cache_publication(b"{}", directory, signers)
    with pytest.raises(ValueError):
        reviewer.fetch_envelope("../escape", {"publications": str(directory)})
    path = directory / (digest + ".json")
    path.unlink()
    path.symlink_to(tmp_path / "not-read")
    with pytest.raises(ValueError):
        reviewer.fetch_envelope(digest, {"publications": str(directory)})


def test_model_adapter_strips_root_credentials_and_uses_research_context(monkeypatch):
    from tests.python.test_source_review import value

    calls = []

    def command(args, *, data, timeout):
        calls.append(args)
        assert args[:6] == ["runuser", "-u", "scalper-learning", "--", "env", "-i"]
        assert "GH_TOKEN" not in " ".join(args)
        assert "-P" in args and "--chdir=" + str(reviewer.ARTIFACT) in args
        return b'{"status":"OUTCOME_UNKNOWN"}'

    monkeypatch.setattr(reviewer.publisher, "command", command)
    monkeypatch.setenv("GH_TOKEN", "root-credential-not-forwarded")
    assert reviewer.model_review(value())["status"] == "OUTCOME_UNKNOWN"

    def invoke(prompt, job, **kwargs):
        assert kwargs["purpose"] == "research" and kwargs["timeout"] == 180
        assert kwargs["schema"]["properties"]["version"]["const"] == "research-source-review-1.0"
        return b"review"

    monkeypatch.setattr(worker, "invoke_daily", invoke)
    assert worker.invoke("prompt", Path("unused")) == b"review"


def test_terminal_context_is_reconciled_after_pr_disappears_from_open_list(tmp_path, monkeypatch):
    monkeypatch.chdir(Path.cwd())
    mirror = tmp_path / "mirror"
    mirror.mkdir()
    root = tmp_path / "state"
    job = root / ("d" * 64)
    job.mkdir(parents=True)
    (job / "context.json").write_bytes(encoded({"number": 42, "digest": job.name}))
    config = {"mirror": str(mirror), "gitSha256": "a" * 64, "prlimitSha256": "b" * 64}

    def command(args, **kwargs):
        return b'{"login":"aloycwl"}' if args == ["gh", "api", "user"] else b""

    monkeypatch.setattr(reviewer.publisher, "command", command)
    monkeypatch.setattr(
        reviewer.publisher,
        "api",
        lambda p: [] if p.startswith("pulls?") else {"object": {"sha": "a" * 40}},
    )
    monkeypatch.setattr(reviewer.MirrorTrust, "verify", lambda _: None)
    monkeypatch.setattr(reviewer.GitObjects, "main", lambda _: "a" * 40)
    monkeypatch.setattr(reviewer, "fetch_envelope", lambda *_: b"signed")
    monkeypatch.setattr(reviewer, "process", lambda *_: {"pullRequest": 42, "status": "MERGED"})
    value = reviewer.cycle(config, root)
    assert value["recent"][0]["status"] == "MERGED"
    assert json.loads((job / "terminal.json").read_bytes())["status"] == "MERGED"
    assert reviewer.cycle(config, root)["lastTerminal"]["status"] == "MERGED"
