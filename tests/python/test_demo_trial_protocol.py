"""Registered finite demo proposals retain source, memory and claim boundaries."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from python.codex_entry import service as s
from python.codex_entry.trial_protocol import TrialBinding, prompt
from python.research.codex_loop import encoded, publish
from python.research.demo_catalogue import load
from tests.python.test_codex_entry import NOW, PROMPT
from tests.python.test_cost_balanced_proposals import body

PROPOSAL = {
    "decision": "BUY",
    "reason": "Registered trend entry",
    "entry_price": "4002",
    "take_profit": "4003",
    "stop_loss": "3999",
    "pending_seconds": 180,
}


def trial_request(api: bool = False) -> s.RequestV116 | s.RequestV117:
    b = body()
    b["payload"]["execution_context"].update(
        modeled_stress_round_trip_cost_price="2",
        base_exit_reserve_ticks=5,
        stress_exit_reserve_ticks=65,
    )
    cat = load()
    profile = cat.profiles[0]
    binding = TrialBinding(
        trialId=str(uuid4()),
        profileId=profile.id,
        profileSha256=profile.digest(),
        catalogueSha256=hashlib.sha256(encoded(cat.model_dump())).hexdigest(),
        strategyVersion="0.10.0-demo-trials.1-codex.1",
        sourceSha256="b" * 64,
        registeredAt=(NOW - timedelta(seconds=2)).isoformat(),
        startsAt=(NOW - timedelta(seconds=1)).isoformat(),
    )
    b.update(
        version="codex-entry-request-1.17" if api else "codex-entry-request-1.16",
        promptVersion="entry-scalp-v3",
        experiment=binding.model_dump(),
        promptSha256=hashlib.sha256(prompt(PROMPT, binding).encode()).hexdigest(),
    )
    if api:
        b["provider"] = "openai-api"
    for f in b["payload"]["candles"]:
        seconds = {"M1": 60, "M5": 300, "M15": 900}[f["timeframe"]]
        f["rows"] = [
            [
                (NOW - timedelta(seconds=seconds * (5 - i))).isoformat(),
                (NOW - timedelta(seconds=seconds * (4 - i))).isoformat(),
                "4000",
                "4002",
                "3999",
                str(4000 + i / 10),
                None,
                True,
                [],
            ]
            for i in range(5)
        ]
    return s.RequestV117.model_validate(b) if api else s.RequestV116.model_validate(b)


def call(_prompt: str, job: Path) -> bytes:
    publish(
        job / "memory-result.json",
        {
            "day": NOW.date().isoformat(),
            "threadId": "registered-trial",
            "turnId": "one",
            "compacted": False,
        },
    )
    return json.dumps(PROPOSAL).encode()


def test_new_trial_success_source_guard_and_duplicate_claim(tmp_path: Path) -> None:
    req = trial_request()
    with pytest.raises(ValueError, match="SOURCE_MISMATCH"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert not (tmp_path / req.analysisId).exists()
    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call, trial_source_sha256="b" * 64)
    assert result["version"] == "codex-entry-response-1.9" and result["entries"] == PROPOSAL
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call, trial_source_sha256="b" * 64)


@pytest.mark.parametrize(
    "patch",
    [
        {"stop_loss": "3998"},
        {"take_profit": "4002.4"},
        {"pending_seconds": 60},
        {"decision": "SELL"},
    ],
)
def test_response_cannot_escape_registered_geometry(tmp_path: Path, patch: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        s.run(
            trial_request(),
            tmp_path,
            PROMPT,
            now=lambda: NOW,
            call=lambda *_: json.dumps(PROPOSAL | patch).encode(),
            trial_source_sha256="b" * 64,
        )


def test_explicit_credit_fallback_keeps_trial_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from python.codex_entry import openai_api

    monkeypatch.setattr(openai_api, "reserve", lambda *_: "API_CREDIT_EXHAUSTED")
    result = s.run(
        trial_request(True),
        tmp_path,
        PROMPT,
        now=lambda: NOW,
        call=call,
        trial_source_sha256="b" * 64,
    )
    assert (
        result["version"] == "codex-entry-response-1.11"
        and result["fallbackReason"] == "API_CREDIT_EXHAUSTED"
    )
    assert result["executionAuthority"] is False


@pytest.mark.parametrize(
    "name,model",
    [
        ("codex-entry-request-1.16", s.RequestV116),
        ("codex-entry-request-1.17", s.RequestV117),
        ("codex-entry-response-1.9", s.ResponseV19),
        ("codex-entry-response-1.10", s.ResponseV110),
        ("codex-entry-response-1.11", s.ResponseV111),
        ("entry-scalp-provider-1.2", s.ScalpDecisionV3),
    ],
)
def test_published_schemas(name: str, model: Any) -> None:
    schema = json.loads(Path("schemas", name + ".json").read_bytes())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == model.model_json_schema()


def test_trial_status_schema_matches_typed_read_only_boundary() -> None:
    from python.research.demo_trial_status import TrialStatus

    schema = json.loads(Path("schemas/demo-trial-status-1.0.json").read_bytes())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == TrialStatus.model_json_schema()


@pytest.mark.parametrize("branch", ["subscription", "api", "fallback"])
def test_actual_http_accepts_every_new_trial_receipt_without_legacy_union_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, branch: str
) -> None:
    from fastapi.testclient import TestClient

    from python.codex_entry import api, openai_api

    req = trial_request(branch != "subscription")
    if branch == "api":
        monkeypatch.setattr(openai_api, "reserve", lambda *_: None)
        monkeypatch.setattr(
            openai_api,
            "invoke",
            lambda *_: (
                json.dumps(PROPOSAL).encode(),
                {
                    "requestedModel": s.MODEL,
                    "returnedModel": s.MODEL,
                    "inputTokens": 10,
                    "outputTokens": 2,
                    "costAmount": None,
                    "providerRequestId": "fixture",
                },
            ),
        )
    elif branch == "fallback":
        monkeypatch.setattr(openai_api, "reserve", lambda *_: "API_CREDIT_EXHAUSTED")
    result = s.run(
        req, tmp_path / "worker", PROMPT, now=lambda: NOW, call=call, trial_source_sha256="b" * 64
    )
    invoked = []

    def transport(*args: Any, **kwargs: Any) -> dict[str, Any]:
        assert kwargs["trial_source_sha256"] == "b" * 64
        invoked.append(args[0].analysisId)
        return result

    monkeypatch.setattr(api, "run", transport)
    app = TestClient(
        api.create_app(
            tmp_path / "http",
            PROMPT,
            "x" * 64,
            prompt_version="entry-scalp-v3",
            trial_source_sha256="b" * 64,
        ),
        raise_server_exceptions=False,
    )
    response = app.post(
        "/v1/entry-proposals",
        json=req.model_dump(),
        headers={"authorization": "Bearer " + "x" * 64},
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["version"]
        == {
            "subscription": "codex-entry-response-1.9",
            "api": "codex-entry-response-1.10",
            "fallback": "codex-entry-response-1.11",
        }[branch]
    )
    assert response.json()["entries"] == PROPOSAL and response.json()["executionAuthority"] is False
    assert (
        app.post(
            "/v1/entry-proposals", json=req.model_dump(), headers={"authorization": "Bearer wrong"}
        ).status_code
        == 401
    )
    assert invoked == [req.analysisId]


@pytest.mark.parametrize("api", [False, True])
def test_executor_cost_context_reaches_worker(api: bool, tmp_path: Path) -> None:
    """The executor sends both cost scenarios, unlike the former worker fixture."""
    req = trial_request(api).model_dump()
    req["payload"]["execution_context"].update(
        modeled_stress_round_trip_cost_price="2",
        base_exit_reserve_ticks=5,
        stress_exit_reserve_ticks=65,
    )
    parsed = s.parse_request(json.dumps(req).encode())
    assert parsed.payload.execution_context.modeled_stress_round_trip_cost_price == "2"
    assert parsed.payload.execution_context.base_exit_reserve_ticks == 5
    for field, invalid in [("base_exit_reserve_ticks", 0), ("stress_exit_reserve_ticks", 5)]:
        broken = json.loads(json.dumps(req))
        broken["payload"]["execution_context"][field] = invalid
        with pytest.raises(ValueError):
            s.parse_request(json.dumps(broken).encode())


@pytest.mark.parametrize("use_api", [False, True])
@pytest.mark.parametrize(
    "field,value",
    [
        ("base_exit_reserve_ticks", 0),
        ("stress_exit_reserve_ticks", 5),
        ("modeled_stress_round_trip_cost_price", "0"),
    ],
)
def test_http_rejects_invalid_trial_costs_before_worker(
    tmp_path, monkeypatch, use_api, field, value
):
    from fastapi.testclient import TestClient

    from python.codex_entry import api

    req = trial_request(use_api).model_dump()
    req["payload"]["execution_context"][field] = value
    monkeypatch.setattr(api, "run", lambda *a, **k: pytest.fail("worker must not run"))
    client = TestClient(
        api.create_app(
            tmp_path,
            PROMPT,
            "t" * 32,
            prompt_version="entry-scalp-v3",
            trial_source_sha256="b" * 64,
        )
    )
    response = client.post(
        "/v1/entry-proposals", json=req, headers={"authorization": "Bearer " + "t" * 32}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "CODEX_REQUEST_INVALID"}
    assert not list(tmp_path.iterdir())
