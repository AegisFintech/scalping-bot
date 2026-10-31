from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from python.research import holding_authority as authority
from python.research import holding_task as task
from tests.python import test_source_verifier as sources

CODE = """from __future__ import annotations

from typing import Any


Amount = tuple[int, int]


def report(rows: list[dict[str, str | None]]) -> dict[str, Any]:
    return {"rows": len(rows)}
"""


def context(tmp_path, monkeypatch):
    _, _, _, _, trust = sources.fixture.__wrapped__(tmp_path / "git", monkeypatch)
    monkeypatch.setattr(authority, "trusted_path", lambda _: None)
    facts = {"trialId": "a" * 64, "resultSha256": "b" * 64, "findingSha256": "c" * 64}
    draft = task.Draft(
        task=task.TASK,
        baseCommit=trust.expected_main,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code=CODE,
        rationale="Import/type-alias preparation regression; not an economic candidate.",
    )
    return trust, facts, draft


def test_prepared_type_alias_module_passes_actual_publisher_import_and_format_checks(
    tmp_path, monkeypatch
):
    trust, facts, draft = context(tmp_path, monkeypatch)
    destination = tmp_path / "prepared"
    tool = Path(".venv/bin/ruff").absolute()
    old = subprocess.run(
        [
            str(tool),
            "format",
            "--isolated",
            "--line-length",
            "100",
            "--stdin-filename",
            task.MODULE,
            "-",
        ],
        input=CODE.encode(),
        capture_output=True,
        check=True,
    ).stdout
    rejected = subprocess.run(
        [
            str(tool),
            "check",
            "--config",
            str(Path("pyproject.toml").absolute()),
            "--stdin-filename",
            task.MODULE,
            "-",
        ],
        input=old,
        capture_output=True,
    )
    assert rejected.returncode == 1 and b"I001" in rejected.stdout
    result = authority.prepare(draft, facts, trust, destination, tool)
    raw = result.files[task.MODULE]
    for args in [("check",), ("format", "--check")]:
        checked = subprocess.run(
            [
                str(tool),
                *args,
                "--config",
                str(Path("pyproject.toml").absolute()),
                "--stdin-filename",
                task.MODULE,
                "-",
            ],
            input=raw,
            capture_output=True,
        )
        assert checked.returncode == 0, checked.stdout.decode()
    assert json.loads((destination / "original-draft.json").read_bytes())["code"] == CODE
    assert (
        json.loads((destination / "preparation.json").read_bytes())["draft"]["code"].encode() == raw
    )


def test_failed_normalization_preserves_original_without_prepared_source(tmp_path, monkeypatch):
    trust, facts, draft = context(tmp_path, monkeypatch)
    destination = tmp_path / "prepared"
    with pytest.raises(subprocess.CalledProcessError):
        authority.prepare(draft, facts, trust, destination, Path("/usr/bin/false"))
    assert json.loads((destination / "original-draft.json").read_bytes())["code"] == CODE
    assert not (destination / "preparation.json").exists()
    assert not (destination / "source.json").exists()
