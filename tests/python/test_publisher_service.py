from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.operations import publisher_service as service
from tests.python.test_research_publisher import NOW, signed  # noqa: F401


@pytest.fixture
def layout(tmp_path, monkeypatch):
    queue = tmp_path / "queue"
    queue.mkdir()
    root = tmp_path / "state"
    root.mkdir()
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    monkeypatch.setattr(service, "protected", lambda path: None)
    monkeypatch.setattr(service, "credentials", lambda root: None)
    return root, queue, artifact


def test_idle_requires_available_queue_and_credentials(layout, monkeypatch):
    root, queue, artifact = layout
    assert service.cycle(root, queue, artifact, NOW).status == "IDLE"

    def denied(root):
        raise ValueError("PUBLICATION_IDENTITY_MISMATCH")

    monkeypatch.setattr(service, "credentials", denied)
    with pytest.raises(ValueError, match="IDENTITY_MISMATCH"):
        service.cycle(root, queue, artifact, NOW)


def test_failed_request_cannot_be_hidden_by_another_success(layout, monkeypatch):
    root, queue, artifact = layout
    for char in "ab":
        (queue / (char * 64 + ".json")).write_text("{}")

    def process(request, *_):
        if request.name.startswith("a"):
            raise RuntimeError("private response must not escape")
        return {"status": "AWAITING_REVIEW", "reason": "PUBLICATION_OPEN"}

    monkeypatch.setattr(service, "process", process)
    result = service.cycle(root, queue, artifact, NOW)
    assert result.status == "BLOCKED" and result.reason == "PUBLICATION_OPERATION_FAILED"
    assert result.pullRequest is None


@pytest.mark.parametrize("count", [1, 5])
def test_unknown_and_excess_queue_entries_reject(layout, count):
    root, queue, artifact = layout
    for i in range(count):
        (queue / str(i)).write_text("{}")
    with pytest.raises(ValueError, match="QUEUE_"):
        service.cycle(root, queue, artifact, NOW)


def test_signed_request_name_binds_payload_before_checkout(layout, signed, monkeypatch):  # noqa: F811
    root, queue, artifact = layout
    envelope, signers = signed
    (artifact / "policy").mkdir()
    (artifact / "policy/research-publisher-signers").write_bytes(signers.read_bytes())
    request = queue / ("f" * 64 + ".json")
    request.write_text(json.dumps(envelope))

    def forbidden(*_):
        pytest.fail("must reject before checkout")

    monkeypatch.setattr(service, "checkout", forbidden)
    with pytest.raises(ValueError, match="QUEUE_DIGEST_MISMATCH"):
        service.process(request, root, artifact, NOW)


def test_protected_authority_rejects_symlink_or_worker_writable(tmp_path):
    target = tmp_path / "target"
    target.write_text("public")
    link = tmp_path / "link"
    link.symlink_to(target)
    with pytest.raises(ValueError, match="UNPROTECTED_PATH"):
        service.protected(link)
    target.chmod(0o666)
    with pytest.raises(ValueError, match="UNPROTECTED_PATH"):
        service.protected(target)


def test_credential_never_loaded_as_root(tmp_path, monkeypatch):
    monkeypatch.setattr(service.os, "geteuid", lambda: 0)
    with pytest.raises(ValueError, match="ROOT_FORBIDDEN"):
        service.credentials(tmp_path)


def test_separate_publisher_identity_is_checked_before_git_setup(tmp_path, monkeypatch):
    (tmp_path / "github-token").write_text("fixture-not-a-real-token")
    monkeypatch.setattr(service.os, "geteuid", lambda: 999)
    monkeypatch.setenv("CREDENTIALS_DIRECTORY", str(tmp_path))
    for key in ["GH_TOKEN", "GH_HOST", "GH_CONFIG_DIR", "GIT_TERMINAL_PROMPT"]:
        monkeypatch.setenv(key, "")
    calls = []

    def command(args):
        calls.append(args)
        return b'{"login":"aloycwl"}'

    monkeypatch.setattr(service.publisher, "command", command)
    with pytest.raises(ValueError, match="IDENTITY_MISMATCH"):
        service.credentials(tmp_path)
    assert calls == [["gh", "api", "user"]]


def test_service_has_no_signer_broker_or_reviewer_access():
    unit = Path("systemd/scalper-research-publisher.service").read_text()
    for required in [
        "User=scalper-publisher",
        "LoadCredential=github-token:",
        "ProtectSystem=strict",
        "ProtectHome=true",
        "NoNewPrivileges=true",
        "-/etc/scalper-publisher/authority",
        "-/etc/scalping-bot",
        "TimeoutStartSec=480",
    ]:
        assert required in unit
    assert "research-publisher.yml" not in [
        path.name for path in Path(".github/workflows").iterdir()
    ]
