"""Trend worker contracts preserve claims and API/subscription boundaries."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from python.codex_entry import service as s
from python.codex_entry.trend_protocol import TrendBinding, TrendProfile, catalogue
from python.codex_entry.trial_protocol import prompt
from python.research.codex_loop import encoded
from tests.python.test_codex_entry import NOW, PROMPT
from tests.python.test_demo_trial_protocol import call as legacy_call
from tests.python.test_demo_trial_protocol import trial_request

PROPOSAL = {
    "decision": "BUY",
    "reason": "Registered trend entry",
    "entry_price": "4002",
    "take_profit": "4006",
    "stop_loss": "4000",
    "pending_seconds": 60,
}


def trend_request(api: bool = False) -> s.RequestV118 | s.RequestV119:
    b = trial_request(api).model_dump()
    cat = catalogue()
    profile = TrendProfile.model_validate(cat["profiles"][0])
    binding = TrendBinding.model_validate(
        b["experiment"]
        | {
            "strategyVersion": "0.11.0-trend-retest.1-codex.1",
            "profileId": profile.id,
            "profileSha256": profile.digest(),
            "catalogueSha256": hashlib.sha256(encoded(cat)).hexdigest(),
        }
    )
    b.update(
        version="codex-entry-request-1.19" if api else "codex-entry-request-1.18",
        promptVersion="entry-scalp-v4",
        experiment=binding.model_dump(),
        promptSha256=hashlib.sha256(prompt(PROMPT, binding).encode()).hexdigest(),
    )
    b["payload"]["execution_context"]["base_exit_reserve_ticks"] = 65
    return s.RequestV119.model_validate(b) if api else s.RequestV118.model_validate(b)


def call(text: str, job: Path) -> bytes:
    legacy_call(text, job)
    return json.dumps(PROPOSAL).encode()


def test_trend_source_and_unknown_claim_are_not_retried(tmp_path: Path) -> None:
    req = trend_request()
    with pytest.raises(ValueError, match="SOURCE_MISMATCH"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert not (tmp_path / req.analysisId).exists()

    def fail(*_: Any) -> bytes:
        raise TimeoutError("unknown")

    with pytest.raises(ValueError, match="FAILED_OR_UNKNOWN"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=fail, trial_source_sha256="b" * 64)
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call, trial_source_sha256="b" * 64)


@pytest.mark.parametrize(
    "field,value",
    [
        ("catalogueSha256", "a" * 64),
        ("profileSha256", "a" * 64),
        ("profileId", "unknown"),
        ("strategyVersion", "0.10.0-demo-trials.1-codex.1"),
    ],
)
def test_wrong_registration_rejected(field: str, value: str) -> None:
    raw = trend_request().model_dump()
    raw["experiment"][field] = value
    with pytest.raises(ValueError):
        s.parse_request(encoded(raw))


@pytest.mark.parametrize("branch", ["subscription", "api", "fallback"])
def test_actual_http_accepts_every_new_trial_receipt_without_legacy_union_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, branch: str
) -> None:
    from fastapi.testclient import TestClient

    from python.codex_entry import api, openai_api

    req = trend_request(branch != "subscription")
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
            prompt_version="entry-scalp-v4",
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
            "subscription": "codex-entry-response-1.12",
            "api": "codex-entry-response-1.13",
            "fallback": "codex-entry-response-1.14",
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
    req = trend_request(api).model_dump()
    req["payload"]["execution_context"].update(
        modeled_stress_round_trip_cost_price="2",
        base_exit_reserve_ticks=65,
        stress_exit_reserve_ticks=65,
    )
    parsed = s.parse_request(json.dumps(req).encode())
    assert parsed.payload.execution_context.modeled_stress_round_trip_cost_price == "2"
    assert parsed.payload.execution_context.base_exit_reserve_ticks == 65
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

    req = trend_request(use_api).model_dump()
    req["payload"]["execution_context"][field] = value
    monkeypatch.setattr(api, "run", lambda *a, **k: pytest.fail("worker must not run"))
    client = TestClient(
        api.create_app(
            tmp_path,
            PROMPT,
            "t" * 32,
            prompt_version="entry-scalp-v4",
            trial_source_sha256="b" * 64,
        )
    )
    response = client.post(
        "/v1/entry-proposals", json=req, headers={"authorization": "Bearer " + "t" * 32}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "CODEX_REQUEST_INVALID"}
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize(
    "name,model",
    [
        ("codex-entry-request-1.18", s.RequestV118),
        ("codex-entry-request-1.19", s.RequestV119),
        ("codex-entry-response-1.12", s.ResponseV112),
        ("codex-entry-response-1.13", s.ResponseV113),
        ("codex-entry-response-1.14", s.ResponseV114),
    ],
)
def test_published_trend_schemas(name: str, model: Any) -> None:
    schema = json.loads(Path("schemas", name + ".json").read_bytes())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == model.model_json_schema()


def test_wait_is_preserved_without_local_fallback(tmp_path: Path) -> None:
    wait = {
        "decision": "WAIT",
        "reason": "No opportunity",
        "entry_price": None,
        "take_profit": None,
        "stop_loss": None,
        "pending_seconds": None,
    }

    def provider(text: str, job: Path) -> bytes:
        legacy_call(text, job)
        return json.dumps(wait).encode()

    result = s.run(
        trend_request(),
        tmp_path,
        PROMPT,
        now=lambda: NOW,
        call=provider,
        trial_source_sha256="b" * 64,
    )
    assert result["entries"] == wait and result["executionAuthority"] is False
