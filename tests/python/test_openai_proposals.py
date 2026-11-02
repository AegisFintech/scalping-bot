import json
from types import SimpleNamespace

import pytest

from python.codex_entry import openai_api as api
from python.learning.budget import Budget


def setup(tmp_path, monkeypatch):
    job = tmp_path / "job"
    job.mkdir()
    budget = Budget(tmp_path / "budget", default_limit=1_000_000)
    monkeypatch.setattr(api, "budget", lambda: budget)
    monkeypatch.setattr(api, "credential", lambda _: "fixture-private-secret")
    monkeypatch.setattr(api, "settings", lambda: {"dailyLimitMicroUsd": 1_000_000})
    api.reserve(job, "fresh input")
    raw = {
        "id": "resp_fixture",
        "model": api.MODEL,
        "status": "completed",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": '{"decision":"WAIT"}'}],
            }
        ],
        "usage": {
            "input_tokens": 100,
            "output_tokens": 20,
            "input_tokens_details": {"cached_tokens": 40},
        },
    }
    return job, budget, raw


def test_api_request_is_stateless_structured_and_private(tmp_path, monkeypatch):
    job, budget, raw = setup(tmp_path, monkeypatch)

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, _):
            return json.dumps(raw).encode()

    class Opener:
        def open(self, request, timeout):
            assert timeout == 85
            body = json.loads(request.data)
            assert body["model"] == api.MODEL and body["store"] is False
            assert body["reasoning"] == {"effort": "low"}
            assert body["text"]["format"]["strict"] is True
            assert "tools" not in body and "previous_response_id" not in body
            return Reply()

    monkeypatch.setattr(api.urllib.request, "build_opener", lambda *_: Opener())
    answer, metadata = api.invoke("fresh input", job, {"type": "object"})
    assert metadata["inputTokens"] == 100 and answer == b'{"decision":"WAIT"}'
    assert budget.snapshot()["recent"][0]["status"] == "COMPLETE"
    assert "fixture-private-secret" not in "".join(p.read_text() for p in job.glob("*.json"))
    with pytest.raises(ValueError):
        api.invoke("fresh input", job, {})


@pytest.mark.parametrize("fault", ["model", "status", "usage", "refusal", "request-id"])
def test_bad_api_response_retains_unknown_reservation_without_retry(tmp_path, monkeypatch, fault):
    job, budget, raw = setup(tmp_path, monkeypatch)
    if fault == "model":
        raw["model"] = "different-model"
    if fault == "status":
        raw["status"] = "incomplete"
    if fault == "usage":
        raw["usage"]["input_tokens"] = -1
    if fault == "refusal":
        raw["output"][0]["content"][0]["type"] = "refusal"
    if fault == "request-id":
        raw.pop("id")

    class Reply:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, _):
            return json.dumps(raw).encode()

    calls = []
    monkeypatch.setattr(
        api.urllib.request,
        "build_opener",
        lambda *_: SimpleNamespace(open=lambda *args, **kw: calls.append(1) or Reply()),
    )
    with pytest.raises(ValueError):
        api.invoke("fresh", job, {})
    assert calls == [1]
    assert budget.snapshot()["recent"][0]["status"] == "UNKNOWN"
    assert budget.snapshot()["charged"] > 0


def test_api_budget_denial_precedes_provider_dispatch(tmp_path, monkeypatch):
    job = tmp_path / "job"
    job.mkdir()
    budget = Budget(tmp_path / "budget", default_limit=1)
    monkeypatch.setattr(api, "budget", lambda: budget)
    monkeypatch.setattr(api, "settings", lambda: {"dailyLimitMicroUsd": 1})
    with pytest.raises(ValueError, match="BUDGET_WAIT"):
        api.reserve(job, "fresh")
    assert not (job / "provider-dispatch.json").exists()
    assert json.loads((job / "not-dispatched.json").read_text())["providerDispatched"] is False


def test_api_service_contract_and_schema_do_not_fabricate_subscription_memory(
    tmp_path, monkeypatch
):
    from pathlib import Path

    from python.codex_entry import service as s
    from tests.python.test_codex_entry import NOW, PROMPT
    from tests.python.test_codex_memory import level_request
    from tests.python.test_scalp_proposal import PROPOSAL

    body = level_request().model_dump()
    body["payload"].update(
        pip_size="0.01", maximum_stop_distance="7", minimum_protection_distance="0.01"
    )
    body.update(
        version="codex-entry-request-1.13", promptVersion="entry-scalp-v1", provider="openai-api"
    )
    req = s.parse_request(json.dumps(body).encode())
    assert isinstance(req, s.RequestV113)
    for name, model in [("request-1.13", s.RequestV113), ("response-1.4", s.ResponseV14)]:
        saved = json.loads(Path(f"schemas/codex-entry-{name}.json").read_text())
        saved.pop("$schema")
        saved.pop("$id")
        assert saved == model.model_json_schema()
    monkeypatch.setattr(api, "reserve", lambda *_: None)
    monkeypatch.setattr(
        api,
        "invoke",
        lambda *_: (
            json.dumps(PROPOSAL).encode(),
            {
                "returnedModel": api.MODEL,
                "inputTokens": 100,
                "outputTokens": 20,
                "providerRequestId": "resp_fixture",
            },
        ),
    )
    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW)
    assert result["version"] == "codex-entry-response-1.4"
    assert "memory" not in result and result["contextPolicy"] == "fresh-input-v1"
    assert result["entries"] == PROPOSAL and result["costAmount"] is None
    assert result["executionAuthority"] is False
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW)


def test_api_controls_use_separate_authority_and_cannot_raise_root_ceiling(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from python.codex_entry.api import create_app

    budget = Budget(tmp_path / "budget", default_limit=5_000_000)
    monkeypatch.setattr(api, "credential", lambda _: "control" + "x" * 32)
    monkeypatch.setattr(api, "settings", lambda: {"dailyLimitMicroUsd": 5_000_000})
    monkeypatch.setattr(api, "budget", lambda: budget)
    web = TestClient(create_app(tmp_path / "jobs", "fixture", "proposal" + "a" * 32))
    path = "/v1/provider-control"
    value = {"paused": True, "dailyLimitMicroUsd": 2_000_000}
    assert (
        web.post(
            path, json=value, headers={"Authorization": "Bearer proposal" + "a" * 32}
        ).status_code
        == 401
    )
    headers = {"Authorization": "Bearer control" + "x" * 32}
    assert web.post(path, json=value, headers=headers).status_code == 200
    assert budget.snapshot()["policy"]["paused"] is True
    assert (
        web.post(path, json={**value, "dailyLimitMicroUsd": 6_000_000}, headers=headers).status_code
        == 422
    )
    assert web.post(path, json={**value, "risk": 10}, headers=headers).status_code == 422
    assert budget.snapshot()["policy"]["dailyLimit"] == 2_000_000


@pytest.mark.parametrize("code", [401, 403, 429])
def test_api_auth_or_credit_failure_pauses_only_new_analysis(tmp_path, monkeypatch, code):
    import urllib.error

    job, budget, _ = setup(tmp_path, monkeypatch)
    calls = []

    class Opener:
        def open(self, *_args, **_kwargs):
            calls.append(1)
            raise urllib.error.HTTPError(
                "https://api.openai.com/v1/responses", code, "private", {}, None
            )

    monkeypatch.setattr(api.urllib.request, "build_opener", lambda *_: Opener())
    with pytest.raises(ValueError, match="UNAVAILABLE_OR_UNKNOWN"):
        api.invoke("fresh", job, {})
    assert calls == [1]
    status = budget.snapshot()
    assert status["policy"]["paused"] is True
    assert status["recent"][0]["status"] == "UNKNOWN"
    assert "private" not in json.dumps(status)


def test_api_credit_rejection_selects_only_a_future_request(tmp_path, monkeypatch):
    import io
    import urllib.error

    job, budget, _ = setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        api, "settings", lambda: {"dailyLimitMicroUsd": 1_000_000, "subscriptionFallback": True}
    )
    calls = []

    class Opener:
        def open(self, *_args, **_kwargs):
            calls.append(1)
            raise urllib.error.HTTPError(
                "https://api.openai.com/v1/responses",
                429,
                "credit",
                {},
                io.BytesIO(b'{"error":{"code":"insufficient_quota"}}'),
            )

    monkeypatch.setattr(api.urllib.request, "build_opener", lambda *_: Opener())
    with pytest.raises(ValueError, match="UNAVAILABLE_OR_UNKNOWN"):
        api.invoke("fresh", job, {})
    assert calls == [1] and (job / "api-financial-rejection.json").exists()
    assert api.reserve(tmp_path / "future", "fresh") == "API_CREDIT_EXHAUSTED"
    assert calls == [1]
    assert budget.snapshot()["recent"][0]["status"] == "UNKNOWN"


def test_fallback_receipt_has_real_subscription_provenance_and_no_api_call(tmp_path, monkeypatch):
    from pathlib import Path

    from python.codex_entry import service as s
    from python.research.codex_loop import publish
    from tests.python.test_codex_entry import NOW, PROMPT
    from tests.python.test_codex_memory import level_request
    from tests.python.test_scalp_proposal import PROPOSAL

    body = level_request().model_dump()
    body["payload"].update(
        pip_size="0.01", maximum_stop_distance="7", minimum_protection_distance="0.01"
    )
    body.update(
        version="codex-entry-request-1.13", promptVersion="entry-scalp-v1", provider="openai-api"
    )
    req = s.parse_request(json.dumps(body).encode())
    monkeypatch.setattr(api, "reserve", lambda *_: "API_DAILY_LIMIT")
    monkeypatch.setattr(api, "invoke", lambda *_: pytest.fail("API should not dispatch"))

    def subscription(_prompt, job):
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "thread",
                "turnId": "turn",
                "compacted": False,
            },
        )
        return json.dumps(PROPOSAL).encode()

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=subscription)
    assert result["version"] == "codex-entry-response-1.5"
    assert (
        result["provider"] == "codex-subscription" and result["fallbackReason"] == "API_DAILY_LIMIT"
    )
    assert result["memory"]["threadId"] == "thread"
    assert result["returnedModel"] is None and result["inputTokens"] is None
    schema = json.loads(Path("schemas/codex-entry-response-1.5.json").read_text())
    schema.pop("$schema")
    schema.pop("$id")
    assert schema == s.ResponseV15.model_json_schema()


def test_daily_api_limit_can_select_subscription_but_manual_pause_cannot(tmp_path, monkeypatch):
    from python.learning.budget import Policy

    budget = Budget(tmp_path / "budget", default_limit=1)
    monkeypatch.setattr(
        api, "settings", lambda: {"dailyLimitMicroUsd": 1, "subscriptionFallback": True}
    )
    monkeypatch.setattr(api, "budget", lambda: budget)
    job = tmp_path / "job"
    job.mkdir()
    assert api.reserve(job, "fresh") == "API_DAILY_LIMIT"
    budget.update(Policy(paused=True, dailyLimit=1))
    other = tmp_path / "other"
    other.mkdir()
    with pytest.raises(ValueError, match="BUDGET_WAIT"):
        api.reserve(other, "fresh")
