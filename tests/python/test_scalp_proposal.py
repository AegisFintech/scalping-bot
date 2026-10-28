from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.codex_entry import service as s
from python.research.codex_loop import publish
from tests.python.test_codex_entry import NOW, PROMPT
from tests.python.test_codex_memory import level_request

PROPOSAL = {
    "decision": "BUY",
    "reason": "M1 continuation",
    "entry_price": "4002",
    "take_profit": "4002.4",
    "stop_loss": "3995",
    "pending_seconds": 120,
}


def test_scalp_request_receipt_and_schema_are_additive(tmp_path: Path) -> None:
    body = level_request().model_dump()
    body["payload"]["pip_size"] = "0.01"
    body["payload"]["maximum_stop_distance"] = "7"
    body["payload"]["minimum_protection_distance"] = "0.01"
    body.update(version="codex-entry-request-1.12", promptVersion="entry-scalp-v1")
    req = s.parse_request(json.dumps(body).encode())
    assert isinstance(req, s.RequestV112)
    for name, model in (
        ("codex-entry-request-1.12", s.RequestV112),
        ("codex-entry-response-1.3", s.ResponseV13),
        ("entry-scalp-provider-1.0", s.ScalpDecision),
    ):
        schema = json.loads(Path(f"schemas/{name}.json").read_text())
        schema.pop("$schema")
        schema.pop("$id")
        assert schema == model.model_json_schema()

    def call(prompt: str, job: Path) -> bytes:
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "new-prompt-thread",
                "turnId": "turn",
                "compacted": False,
            },
        )
        return json.dumps(PROPOSAL).encode()

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.3"
    assert result["entries"] == PROPOSAL and result["executionAuthority"] is False
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)


@pytest.mark.parametrize(
    "patch",
    [
        {"pending_seconds": 59},
        {"pending_seconds": 301},
        {"take_profit": "4002.41"},
        {"stop_loss": "3994.99"},
        {"stop_loss": "4003"},
        {"volume": "999"},
        {"pending_seconds": "120"},
    ],
)
def test_scalp_geometry_and_authority_reject(patch: dict) -> None:
    with pytest.raises(ValueError):
        s.ScalpDecision.model_validate(PROPOSAL | patch)


def test_wait_has_no_exit_or_expiry_authority() -> None:
    wait = {
        "decision": "WAIT",
        "reason": "No continuation",
        "entry_price": None,
        "take_profit": None,
        "stop_loss": None,
        "pending_seconds": None,
    }
    assert s.ScalpDecision.model_validate(wait).decision == "WAIT"
    with pytest.raises(ValueError):
        s.ScalpDecision.model_validate(wait | {"entry_price": "4002"})
