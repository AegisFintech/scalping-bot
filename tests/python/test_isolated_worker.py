from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from python.research import isolated_worker as worker

SOURCE = "python/research/experiments/probe.py"
FILES = {SOURCE: b"answer = 42\n"}


def trust(tmp_path: Path) -> worker.WorkerTrust:
    return worker.WorkerTrust(tmp_path, "r" * 64, tmp_path / "verify.py", "v" * 64, "b", "p")


@pytest.mark.parametrize(
    "files",
    [
        {},
        {"../secret": b"x"},
        {"/tmp/p.py": b"x"},
        {"python/research/experiments/__init__.py": b"x"},
        {SOURCE: b"x" * (worker.MAX_FILE_BYTES + 1)},
        {SOURCE: "text"},
        {i: b"x" for i in range(13)},
    ],
)
def test_bundle_rejects_unsafe_or_unbounded_inputs(files: dict) -> None:
    with pytest.raises(ValueError, match="WORKER_BUNDLE"):
        worker.bundle_digest(files)


def test_bundle_identity_includes_paths_and_bytes() -> None:
    assert worker.bundle_digest(FILES) == worker.bundle_digest(dict(FILES))
    assert worker.bundle_digest(FILES) != worker.bundle_digest({SOURCE: b"answer = 43\n"})


def test_trust_path_rejects_writable_ancestors_and_links(tmp_path: Path) -> None:
    # Temporary paths have an untrusted owner or a writable /tmp ancestor.
    with pytest.raises(ValueError, match="TRUST_PATH_UNSAFE"):
        worker.trusted_path(tmp_path)
    link = tmp_path / "link"
    link.symlink_to("/usr")
    with pytest.raises(ValueError, match="TRUST_PATH_NOT_CANONICAL"):
        worker.trusted_path(link)


@pytest.mark.parametrize("path", [".", "..", "runtime", "/usr/../usr"])
def test_relative_or_noncanonical_runtime_never_starts(
    monkeypatch, tmp_path: Path, path: str
) -> None:
    monkeypatch.setattr(os, "geteuid", lambda: 1001)
    monkeypatch.setattr(worker, "verify_cgroup", lambda: None)

    def forbidden(*args, **kwargs):
        pytest.fail("a process started before checking the runtime path")

    monkeypatch.setattr(subprocess, "Popen", forbidden)
    with pytest.raises(ValueError, match="TRUST_PATH_NOT_CANONICAL"):
        worker.run(FILES, worker.bundle_digest(FILES), replace(trust(tmp_path), runtime=Path(path)))


def test_root_and_changed_bundle_never_start_a_process(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(os, "geteuid", lambda: 0)
    with pytest.raises(ValueError, match="UNPRIVILEGED"):
        worker.run(FILES, worker.bundle_digest(FILES), trust(tmp_path))
    monkeypatch.setattr(os, "geteuid", lambda: 1001)
    with pytest.raises(ValueError, match="BUNDLE_CHANGED"):
        worker.run(FILES, "different", trust(tmp_path))


def test_trust_changes_are_rejected_before_execution(monkeypatch, tmp_path: Path) -> None:
    expected = trust(tmp_path)
    monkeypatch.setattr(worker, "runtime_digest", lambda _: "changed")
    with pytest.raises(ValueError, match="RUNTIME_CHANGED"):
        expected.verify()
    monkeypatch.setattr(worker, "runtime_digest", lambda _: expected.runtime_sha256)
    monkeypatch.setattr(worker, "trusted_path", lambda _: None)
    expected.verifier.write_bytes(b"trusted")
    with pytest.raises(ValueError, match="TRUST_FILE_CHANGED"):
        expected.verify()


def test_runtime_manifest_rejects_links_and_writable_files(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(worker, "trusted_path", lambda _: None)
    # Root-owned fixture semantics without depending on the CI runner's uid.
    original = Path.lstat

    def owned(path: Path):
        values = list(original(path))
        values[4] = 0
        return os.stat_result(values)

    monkeypatch.setattr(Path, "lstat", owned)
    p = tmp_path / "module.py"
    p.write_bytes(b"a")
    p.chmod(0o644)
    before = worker.runtime_digest(tmp_path)
    p.write_bytes(b"b")
    assert worker.runtime_digest(tmp_path) != before
    p.chmod(0o666)
    with pytest.raises(ValueError, match="RUNTIME_WRITABLE"):
        worker.runtime_digest(tmp_path)
    p.chmod(0o644)
    (tmp_path / "link").symlink_to(p)
    with pytest.raises(ValueError, match=r"RUNTIME_SPECIAL_FILE|RUNTIME_WRITABLE"):
        worker.runtime_digest(tmp_path)


def test_runtime_walk_cannot_silently_skip_unreadable_subtrees(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(worker, "trusted_path", lambda _: None)

    def unreadable(root, *, followlinks, onerror):
        onerror(PermissionError("unreadable runtime subtree"))

    monkeypatch.setattr(os, "walk", unreadable)
    with pytest.raises(ValueError, match="RUNTIME_UNREADABLE"):
        worker.runtime_digest(tmp_path)


def test_runtime_must_be_a_directory(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(worker, "trusted_path", lambda _: None)
    file = tmp_path / "runtime"
    file.write_bytes(b"not a directory")
    with pytest.raises(ValueError, match="RUNTIME_NOT_DIRECTORY"):
        worker.runtime_digest(file)


def launch_fixture(monkeypatch, tmp_path: Path, code: str) -> worker.WorkerTrust:
    """Exercise bounded collection with known test code; real isolation is a separate probe."""
    real_popen = subprocess.Popen
    monkeypatch.setattr(os, "geteuid", lambda: 1001)
    monkeypatch.setattr(worker, "verify_cgroup", lambda: None)
    monkeypatch.setattr(worker.WorkerTrust, "verify", lambda _: b"trusted verifier")

    def launch(command, **kwargs):
        assert command[:2] == ["/usr/bin/prlimit", "--as=536870912"]
        for option in (
            "--unshare-user",
            "--unshare-pid",
            "--unshare-net",
            "--unshare-ipc",
            "--unshare-uts",
            "--unshare-cgroup",
            "--die-with-parent",
            "--cap-drop",
            "--clearenv",
        ):
            assert option in command
        assert not any(option.endswith("-try") for option in command)
        assert command[-5:] == ["/usr/bin/python3", "-I", "-S", "-B", "/verify.py"]
        assert kwargs["env"] == {"PATH": "/usr/bin:/bin", "LANG": "C"}
        assert kwargs["close_fds"] and kwargs["start_new_session"]
        assert kwargs["stdin"] == subprocess.DEVNULL
        return real_popen([sys.executable, "-I", "-c", code], **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    return trust(tmp_path)


def test_process_result_is_not_qualification(monkeypatch, tmp_path: Path) -> None:
    t = launch_fixture(monkeypatch, tmp_path, "import os; print(os.getenv('SECRET')); exit(7)")
    monkeypatch.setenv("SECRET", "must-not-inherit")
    result = worker.run(FILES, worker.bundle_digest(FILES), t)
    assert result.exit_code == 7 and result.output == b"None\n"
    assert not any(
        (result.broker_authority, result.publish_authority, result.qualification_authority)
    )


@pytest.mark.parametrize(
    ("code", "error"),
    [
        ("print('x'*70000)", "OUTPUT_LIMIT"),
        ("import time; time.sleep(10)", "TIMEOUT"),
        ("import os,time; os.close(1); os.close(2); time.sleep(10)", "TIMEOUT"),
    ],
)
def test_output_and_timeout_kill_process(
    monkeypatch, tmp_path: Path, code: str, error: str
) -> None:
    t = launch_fixture(monkeypatch, tmp_path, code)
    monkeypatch.setattr(worker, "TIMEOUT_SECONDS", 0.2)
    with pytest.raises(ValueError, match=error):
        worker.run(FILES, worker.bundle_digest(FILES), t)


def test_missing_sandbox_never_falls_back(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(os, "geteuid", lambda: 1001)
    monkeypatch.setattr(worker, "verify_cgroup", lambda: None)
    monkeypatch.setattr(worker.WorkerTrust, "verify", lambda _: b"trusted verifier")

    def missing(*args, **kwargs):
        raise FileNotFoundError("sandbox missing")

    monkeypatch.setattr(subprocess, "Popen", missing)
    with pytest.raises(FileNotFoundError):
        worker.run(FILES, worker.bundle_digest(FILES), replace(trust(tmp_path)))


def test_interrupted_collection_kills_the_child(monkeypatch, tmp_path: Path) -> None:
    t = launch_fixture(monkeypatch, tmp_path, "import time; time.sleep(10)")
    launch = subprocess.Popen
    children = []

    def tracked(*args, **kwargs):
        child = launch(*args, **kwargs)
        children.append(child)
        return child

    def interrupt(*args, **kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(subprocess, "Popen", tracked)
    monkeypatch.setattr(worker.selectors.DefaultSelector, "select", interrupt)
    with pytest.raises(KeyboardInterrupt):
        worker.run(FILES, worker.bundle_digest(FILES), t)
    assert len(children) == 1 and children[0].poll() is not None


@pytest.mark.parametrize(
    ("memory", "swap", "tasks", "cpu", "valid"),
    [
        ("536870912", "0", "32", "50000 100000", True),
        ("max", "0", "32", "50000 100000", False),
        ("536870913", "0", "32", "50000 100000", False),
        ("536870912", "1", "32", "50000 100000", False),
        ("536870912", "0", "33", "50000 100000", False),
        ("536870912", "0", "32", "50001 100000", False),
    ],
)
def test_cgroup_requires_aggregate_limits(monkeypatch, memory, swap, tasks, cpu, valid) -> None:
    files = {
        "cgroup": "0::/system.slice/test.service",
        "memory.max": memory,
        "memory.swap.max": swap,
        "pids.max": tasks,
        "cpu.max": cpu,
    }
    monkeypatch.setattr(Path, "read_text", lambda path: files[path.name])
    if valid:
        worker.verify_cgroup()
    else:
        with pytest.raises(ValueError, match="WORKER_CGROUP"):
            worker.verify_cgroup()


@pytest.mark.parametrize("value", ["1:memory:/legacy", "0::/../escape", "0::/test\n1:cpu:/x"])
def test_invalid_cgroup_identity_is_rejected(monkeypatch, value) -> None:
    monkeypatch.setattr(Path, "read_text", lambda _: value)
    with pytest.raises(ValueError, match="WORKER_CGROUP"):
        worker.verify_cgroup()
