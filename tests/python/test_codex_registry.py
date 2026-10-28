"""Routing characterization; full request validation stays in the existing version suites."""

from __future__ import annotations

import json
from typing import Any

import pytest

from python.codex_entry import service as s


@pytest.mark.parametrize("version", [f"codex-entry-request-1.{i}" for i in range(12)])
def test_registered_version_reaches_its_exact_validator(
    version: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = s.REQUEST_BY_VERSION[version]
    sentinel = object()
    seen: list[bytes] = []

    def validate(raw: bytes, **kwargs: Any) -> object:
        seen.append(raw)
        return sentinel

    monkeypatch.setattr(model, "model_validate_json", validate)
    raw = json.dumps({"version": version}).encode()
    assert s.parse_request(raw) is sentinel
    assert seen == [raw]


@pytest.mark.parametrize("raw", [b"{}", b"[]", b'{"version":[]}', b'{"version":"unknown"}'])
def test_unknown_versions_reject_before_dispatch(raw: bytes) -> None:
    with pytest.raises(ValueError, match="CODEX_REQUEST_VERSION_INVALID"):
        s.parse_request(raw)


def test_prompt_whitelist_is_derived_from_all_existing_contracts() -> None:
    assert {
        "entry-pair-v4",
        "entry-pair-v5",
        "entry-pair-v6",
        "entry-pair-v7",
        "entry-pair-v8",
        "entry-direction-v1",
        "entry-modes-v1",
        "entry-quick-oco-v1",
        "entry-quick-oco-v2",
        "entry-quick-oco-v3",
        "entry-quick-oco-v4",
        "entry-quick-oco-v5",
    } == s.SUPPORTED_PROMPTS
