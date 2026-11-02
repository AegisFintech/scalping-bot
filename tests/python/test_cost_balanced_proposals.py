"""New economic proposal versions never reinterpret historical receipts or authorize orders."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from python.codex_entry import api
from python.codex_entry import service as s
from python.research.codex_loop import publish
from tests.python.test_codex_entry import NOW, PROMPT
from tests.python.test_codex_memory import level_request

PROPOSAL = {
    "decision": "BUY",
    "reason": "Nearby continuation and structural stop",
    "entry_price": "4002",
    "take_profit": "4005",
    "stop_loss": "4001",
    "pending_seconds": 120,
}


def body(version: str = "codex-entry-request-1.14") -> dict[str, Any]:
    value = level_request().model_dump()
    value["payload"].update(
        pip_size="0.01", maximum_stop_distance="7", minimum_protection_distance="0.01"
    )
    value.update(version=version, promptVersion="entry-scalp-v2")
    if version.endswith(".15"):
        value["provider"] = "openai-api"
    return value


def call(_prompt: str, job: Path) -> bytes:
    publish(
        job / "memory-result.json",
        {
            "day": NOW.date().isoformat(),
            "threadId": "new-policy",
            "turnId": "turn",
            "compacted": False,
        },
    )
    return json.dumps(PROPOSAL).encode()


def test_new_versions_keep_old_contracts_and_no_replay(tmp_path: Path) -> None:
    req = s.parse_request(json.dumps(body()).encode())
    assert isinstance(req, s.RequestV114)
    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.6" and result["entries"] == PROPOSAL
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    with pytest.raises(ValueError):
        s.ScalpDecision.model_validate(PROPOSAL)
    for name, model in [
        ("codex-entry-request-1.14", s.RequestV114),
        ("codex-entry-request-1.15", s.RequestV115),
        ("codex-entry-response-1.6", s.ResponseV16),
        ("codex-entry-response-1.7", s.ResponseV17),
        ("codex-entry-response-1.8", s.ResponseV18),
        ("entry-scalp-provider-1.1", s.ScalpDecisionV2),
    ]:
        schema = json.loads(Path(f"schemas/{name}.json").read_bytes())
        schema.pop("$id")
        schema.pop("$schema")
        assert schema == model.model_json_schema()


@pytest.mark.parametrize(
    "patch",
    [
        {"take_profit": "4002.4", "stop_loss": "3995"},
        {"take_profit": "4010"},
        {"stop_loss": "4003"},
        {"pending_seconds": 59},
        {"volume": "100"},
    ],
)
def test_new_geometry_cannot_inject_or_relax_authority(patch: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        s.ScalpDecisionV2.model_validate({**PROPOSAL, **patch})


def test_explicit_credit_fallback_retains_new_economic_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from python.codex_entry import openai_api

    monkeypatch.setattr(openai_api, "reserve", lambda *_: "API_CREDIT_EXHAUSTED")
    req = s.parse_request(json.dumps(body("codex-entry-request-1.15")).encode())
    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert (
        result["version"] == "codex-entry-response-1.8"
        and result["fallbackReason"] == "API_CREDIT_EXHAUSTED"
    )
    assert result["entries"] == PROPOSAL and result["executionAuthority"] is False


def test_actual_http_boundary_accepts_new_api_receipt_and_rejects_old_prompt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    req = body("codex-entry-request-1.15")
    result = {
        "version": "codex-entry-response-1.7",
        "provider": "openai-api",
        "analysisId": req["analysisId"],
        "requestedModel": s.MODEL,
        "returnedModel": s.MODEL,
        "promptSha256": req["promptSha256"],
        "capturedAt": req["payload"]["captured_at"],
        "receivedAt": NOW.isoformat(),
        "entries": PROPOSAL,
        "rawResponse": json.dumps(PROPOSAL),
        "inputTokens": 10,
        "outputTokens": 5,
        "costAmount": None,
        "providerRequestId": "fixture",
        "contextPolicy": "fresh-input-v1",
        "executionAuthority": False,
    }
    monkeypatch.setattr(api, "run", lambda *_: result)
    client = TestClient(api.create_app(tmp_path, PROMPT, "x" * 64, prompt_version="entry-scalp-v2"))
    response = client.post(
        "/v1/entry-proposals", json=req, headers={"authorization": "Bearer " + "x" * 64}
    )
    assert response.status_code == 200 and response.json()["entries"] == PROPOSAL
    req["promptVersion"] = "entry-scalp-v1"
    assert (
        client.post(
            "/v1/entry-proposals", json=req, headers={"authorization": "Bearer " + "x" * 64}
        ).status_code
        != 200
    )
