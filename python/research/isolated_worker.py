"""Run bounded research code in a credential-free Linux namespace; never publish it.

Trust inputs belong to an independent coordinator, never the candidate. The
coordinator must freeze a root-owned, standalone Python runtime before invocation.
An exit code is process evidence, not a test verdict or economic qualification.
"""

from __future__ import annotations

import hashlib
import json
import os
import selectors
import signal
import stat
import subprocess
import tempfile
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn

from python.research.publisher_policy import ALLOWED, MAX_FILE_BYTES, MAX_TOTAL_BYTES

MAX_OUTPUT = 64 * 1024
MAX_RUNTIME_BYTES = 256 * 1024 * 1024
TIMEOUT_SECONDS = 30


def verify_cgroup() -> None:
    """Per-process rlimits cannot bound descendants or tmpfs; require an outer cgroup."""
    rows = Path("/proc/self/cgroup").read_text().splitlines()
    if len(rows) != 1 or not rows[0].startswith("0::/"):
        raise ValueError("WORKER_CGROUP_V2_REQUIRED")
    name = rows[0][3:]
    if ".." in name.split("/"):
        raise ValueError("WORKER_CGROUP_PATH_INVALID")
    root = Path("/sys/fs/cgroup") / name.lstrip("/")
    try:
        memory = int((root / "memory.max").read_text())
        swap = int((root / "memory.swap.max").read_text())
        tasks = int((root / "pids.max").read_text())
        quota, period = map(int, (root / "cpu.max").read_text().split())
        valid = (
            0 < memory <= 536870912 and swap == 0 and 0 < tasks <= 32 and 0 < quota <= period // 2
        )
    except (OSError, ValueError):
        raise ValueError("WORKER_CGROUP_LIMITS_UNAVAILABLE") from None
    if not valid:
        raise ValueError("WORKER_CGROUP_LIMITS_UNSAFE")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def bundle_digest(files: dict[str, bytes]) -> str:
    if any(type(name) is not str or type(raw) is not bytes for name, raw in files.items()):
        raise ValueError("WORKER_BUNDLE_TYPE")
    if not 1 <= len(files) <= 12 or sum(map(len, files.values())) > MAX_TOTAL_BYTES:
        raise ValueError("WORKER_BUNDLE_LIMIT")
    if any(
        not any(pattern.fullmatch(name) for pattern in ALLOWED) or len(raw) > MAX_FILE_BYTES
        for name, raw in files.items()
    ):
        raise ValueError("WORKER_BUNDLE_PATH_OR_SIZE")
    return digest(json.dumps([(name, digest(raw)) for name, raw in sorted(files.items())]).encode())


def trusted_path(path: Path) -> None:
    if not path.is_absolute() or path != path.resolve(strict=True):
        raise ValueError("WORKER_TRUST_PATH_NOT_CANONICAL")
    for part in (path, *path.parents):
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("WORKER_TRUST_PATH_UNSAFE")


def runtime_digest(root: Path) -> str:
    trusted_path(root)
    if not root.is_dir():
        raise ValueError("WORKER_RUNTIME_NOT_DIRECTORY")

    def unreadable(error: OSError) -> NoReturn:
        raise ValueError("WORKER_RUNTIME_UNREADABLE") from error

    entries: list[tuple[str, int, str]] = []
    total = 0
    for directory, folders, names in os.walk(root, followlinks=False, onerror=unreadable):
        for name in sorted(folders + names):
            path = Path(directory) / name
            info = path.lstat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError("WORKER_RUNTIME_WRITABLE")
            if stat.S_ISDIR(info.st_mode):
                value = "directory"
            elif stat.S_ISREG(info.st_mode):
                total += info.st_size
                if total > MAX_RUNTIME_BYTES:
                    raise ValueError("WORKER_RUNTIME_LIMIT")
                value = digest(path.read_bytes())
            else:
                raise ValueError("WORKER_RUNTIME_SPECIAL_FILE")
            entries.append((str(path.relative_to(root)), stat.S_IMODE(info.st_mode), value))
            if len(entries) > 20_000:
                raise ValueError("WORKER_RUNTIME_LIMIT")
    return digest(json.dumps(sorted(entries)).encode())


@dataclass(frozen=True)
class WorkerTrust:
    runtime: Path
    runtime_sha256: str
    verifier: Path
    verifier_sha256: str
    bubblewrap_sha256: str
    prlimit_sha256: str

    def verify(self) -> bytes:
        if runtime_digest(self.runtime) != self.runtime_sha256:
            raise ValueError("WORKER_RUNTIME_CHANGED")
        for path, expected in (
            (self.verifier, self.verifier_sha256),
            (Path("/usr/bin/bwrap"), self.bubblewrap_sha256),
            (Path("/usr/bin/prlimit"), self.prlimit_sha256),
        ):
            trusted_path(path)
            if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("WORKER_TRUST_FILE_INVALID")
            if digest(path.read_bytes()) != expected:
                raise ValueError("WORKER_TRUST_FILE_CHANGED")
        return self.verifier.read_bytes()


@dataclass(frozen=True)
class WorkerResult:
    bundle_sha256: str
    runtime_sha256: str
    verifier_sha256: str
    exit_code: int
    output: bytes
    # Output is untrusted; callers must not interpret a claimed PASS as authority.
    broker_authority: bool = False
    publish_authority: bool = False
    qualification_authority: bool = False


def run(files: dict[str, bytes], expected_bundle: str, trust: WorkerTrust) -> WorkerResult:
    if os.geteuid() == 0:
        raise ValueError("WORKER_REQUIRES_UNPRIVILEGED_USER")
    files = dict(files)
    actual = bundle_digest(files)
    if actual != expected_bundle:
        raise ValueError("WORKER_BUNDLE_CHANGED")
    verify_cgroup()
    verifier = trust.verify()
    with tempfile.TemporaryDirectory(prefix="scalper-research-") as temporary:
        root = Path(temporary)
        workspace = root / "work"
        workspace.mkdir()
        for name, raw in files.items():
            target = workspace / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        check = root / "verify.py"
        check.write_bytes(verifier)
        command = [
            "/usr/bin/prlimit",
            "--as=536870912",
            "--cpu=15",
            "--nproc=32",
            "--nofile=64",
            "--fsize=1048576",
            "--core=0",
            "--",
            "/usr/bin/bwrap",
            "--unshare-user",
            "--unshare-pid",
            "--unshare-net",
            "--unshare-ipc",
            "--unshare-uts",
            "--unshare-cgroup",
            "--die-with-parent",
            "--new-session",
            "--cap-drop",
            "ALL",
            "--clearenv",
            "--ro-bind",
            str(trust.runtime),
            "/",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
            "--ro-bind",
            str(workspace),
            "/work",
            "--ro-bind",
            str(check),
            "/verify.py",
            "--chdir",
            "/work",
            "--",
            "/usr/bin/python3",
            "-I",
            "-S",
            "-B",
            "/verify.py",
        ]
        with subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env={"PATH": "/usr/bin:/bin", "LANG": "C"},
            cwd="/",
            close_fds=True,
            start_new_session=True,
        ) as process:
            assert process.stdout is not None
            output = bytearray()
            deadline = time.monotonic() + TIMEOUT_SECONDS
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    while selector.get_map():
                        if time.monotonic() >= deadline:
                            raise ValueError("WORKER_TIMEOUT")
                        for key, _ in selector.select(
                            min(0.1, max(0, deadline - time.monotonic()))
                        ):
                            chunk = os.read(key.fd, 8192)
                            if not chunk:
                                selector.unregister(key.fileobj)
                            output.extend(chunk)
                            if len(output) > MAX_OUTPUT:
                                raise ValueError("WORKER_OUTPUT_LIMIT")
                code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise ValueError("WORKER_TIMEOUT") from None
            finally:
                if process.poll() is None:
                    with suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        return WorkerResult(
            actual, trust.runtime_sha256, trust.verifier_sha256, code, bytes(output)
        )
