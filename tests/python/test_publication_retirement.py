import base64
from datetime import timedelta

import pytest

from python.operations import publication_retirement as lifecycle
from python.operations import research_publisher as publisher
from python.research.learning_archive import immutable
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha
from tests.python.test_research_publisher import NOW, signed  # noqa: F401


@pytest.fixture
def layout(tmp_path, monkeypatch, signed):  # noqa: F811
    envelope, signers = signed
    raw = encoded(envelope)
    payload, digest = publisher.authenticate(raw, signers)
    queue = tmp_path / "queue"
    queue.mkdir()
    job = tmp_path / "job"
    job.mkdir()
    immutable(job / "publication.json", payload.model_dump())
    (job / "publication.json.sig").write_bytes(base64.b64decode(envelope["signature"]))
    immutable(job / "signed.json", {"publicationSha256": digest, "envelopeSha256": sha(raw)})
    (queue / (digest + ".json")).write_bytes(raw)
    state = tmp_path / "publisher"
    (state / "jobs" / digest / "phases").mkdir(parents=True)
    monkeypatch.setattr(lifecycle, "protected", lambda _: None)
    monkeypatch.setattr(lifecycle.os, "geteuid", lambda: 0)
    monkeypatch.setattr(lifecycle.publisher, "api", lambda _: [])
    return job, queue, state, signers, digest, raw


def test_expired_never_dispatched_publication_retires_once_without_rewriting(layout):
    job, queue, state, signers, digest, raw = layout
    first = lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))
    assert first["reason"] == "PUBLICATION_ATTESTATION_STALE"
    assert not (queue / (digest + ".json")).exists()
    assert (job / "retired-envelope.json").read_bytes() == raw
    assert (
        lifecycle.retire(job, queue, state, signers, digest, "b" * 40, NOW + timedelta(days=3))
        == first
    )


@pytest.mark.parametrize(
    "phase", ["push-intent", "push-confirmed", "pr-intent", "remote-pr", "unexpected"]
)
def test_unknown_or_existing_dispatch_is_never_retired(layout, phase):
    job, queue, state, signers, digest, raw = layout
    (state / "jobs" / digest / "phases" / (phase + ".json")).write_text("{}")
    with pytest.raises(ValueError, match="UNCERTAIN"):
        lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))
    assert (queue / (digest + ".json")).read_bytes() == raw


@pytest.mark.parametrize("remote", ["branch", "pr", "failure"])
def test_remote_presence_or_unknown_blocks_retirement(layout, monkeypatch, remote):
    job, queue, state, signers, digest, raw = layout

    def api(path):
        if remote == "failure":
            raise TimeoutError()
        return [{}] if (remote == "branch") == ("matching-refs" in path) else []

    monkeypatch.setattr(lifecycle.publisher, "api", api)
    with pytest.raises((ValueError, TimeoutError)):
        lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))
    assert (queue / (digest + ".json")).read_bytes() == raw


def test_tampered_envelope_and_missing_queue_cannot_clear_state(layout):
    job, queue, state, signers, digest, raw = layout
    target = queue / (digest + ".json")
    target.write_bytes(raw + b" ")
    with pytest.raises(ValueError):
        lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))
    target.unlink()
    with pytest.raises(ValueError):
        lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))


def test_queue_directory_lock_prevents_concurrent_publish_and_retire(layout):
    import fcntl
    import os

    job, queue, state, signers, digest, raw = layout
    fd = os.open(queue, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ValueError, match="QUEUE_BUSY"):
            lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))
        assert (queue / (digest + ".json")).read_bytes() == raw
    finally:
        os.close(fd)


def test_receipt_before_rename_recovers_after_reason_changes(layout, monkeypatch):
    job, queue, state, signers, digest, raw = layout
    original = lifecycle.os.rename
    monkeypatch.setattr(lifecycle.os, "rename", lambda *_: (_ for _ in ()).throw(OSError("crash")))
    with pytest.raises(OSError):
        lifecycle.retire(job, queue, state, signers, digest, "b" * 40, NOW + timedelta(hours=1))
    monkeypatch.setattr(lifecycle.os, "rename", original)
    result = lifecycle.retire(job, queue, state, signers, digest, "c" * 40, NOW + timedelta(days=2))
    assert result["reason"] == "PUBLICATION_MAIN_DRIFT"
    assert (job / "retired-envelope.json").read_bytes() == raw


def test_confirmed_terminal_publication_is_preserved_and_does_not_block_rollover(
    layout, monkeypatch
):
    job, queue, state, signers, digest, raw = layout
    payload, _ = publisher.authenticate(raw, signers)
    monkeypatch.setattr(publisher, "expected_commit", lambda *args, **kwargs: "c" * 40)
    remote = {
        "head": {"sha": publisher.expected_commit(payload, digest)},
        "state": "closed",
        "number": 7,
    }
    monkeypatch.setattr(lifecycle.publisher, "api", lambda _: [remote])
    confirmed = []
    monkeypatch.setattr(lifecycle.publisher, "confirm_pr", lambda *args: confirmed.append(args))
    (state / "jobs" / digest / "phases" / "push-intent.json").write_text("{}")
    assert (
        lifecycle.retire(job, queue, state, signers, digest, "b" * 40, NOW + timedelta(days=2))[
            "terminalPublication"
        ]
        is True
    )
    assert confirmed and (queue / (digest + ".json")).read_bytes() == raw


def test_hardened_separate_mounts_never_require_cross_mount_rename(layout, monkeypatch):
    import errno
    from pathlib import Path

    job, queue, state, signers, digest, raw = layout
    original = lifecycle.os.rename

    def namespace_rename(source, target):
        if not Path(target).is_relative_to(queue):
            raise OSError(errno.EXDEV, "separate systemd bind mounts")
        return original(source, target)

    monkeypatch.setattr(lifecycle.os, "rename", namespace_rename)
    result = lifecycle.retire(job, queue, state, signers, digest, "a" * 40, NOW + timedelta(days=2))
    assert result["noDispatchIntent"]
    assert (queue / "retired" / (digest + ".json")).read_bytes() == raw
    assert (job / "retired-envelope.json").read_bytes() == raw
    assert not (queue / (digest + ".json")).exists()
