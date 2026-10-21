from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from python.codex_entry import service as s
from python.codex_entry.api import create_app

NOW = datetime(2026, 10, 19, 12, tzinfo=UTC)
PROMPT = "Fixture prompt, no trading authority"


def request(**changes: Any) -> s.Request:
    at = NOW.isoformat()
    body = {
        "version": "codex-entry-request-1.0",
        "analysisId": str(uuid4()),
        "symbol": "XAUUSD",
        "promptVersion": "entry-pair-v4",
        "promptSha256": hashlib.sha256(PROMPT.encode()).hexdigest(),
        "payload": {
            "captured_at": at,
            "tick_size": "0.01",
            "quote": {"bid": "4000", "ask": "4001", "sourceTime": at, "receivedAt": at},
            "minimum_entry_distance": "0.01",
            "entry_boundaries": {key: "0.01" for key in s.Bounds.model_fields},
            "candles": [
                {
                    "timeframe": frame,
                    "columns": [
                        "startTime",
                        "endTime",
                        "open",
                        "high",
                        "low",
                        "close",
                        "volume",
                        "complete",
                        "qualityFlags",
                    ],
                    "rows": [
                        [
                            (NOW - timedelta(seconds=seconds)).isoformat(),
                            at,
                            "4000",
                            "4002",
                            "3999",
                            "4001",
                            None,
                            True,
                            [],
                        ]
                    ],
                }
                for frame, seconds in [("M1", 60), ("M5", 300), ("M15", 900)]
            ],
        },
    }
    body.update(changes)
    return s.Request.model_validate(body)


def output(*_: Any) -> bytes:
    return b'{"buy_stop":"4002","sell_stop":"3999"}'


def test_durable_claim_success_and_no_replay(tmp_path: Path) -> None:
    req = request()
    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=output)
    assert result["executionAuthority"] is False
    assert result["returnedModel"] is None
    assert result["costAmount"] is None
    assert result["requestedModel"] == s.MODEL
    assert result["entries"] == {"buy_stop": "4002", "sell_stop": "3999"}
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(
            req, tmp_path, PROMPT, now=lambda: NOW, call=lambda *_: pytest.fail("must not dispatch")
        )
    assert (tmp_path / req.analysisId / "claim.json").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "raw",
    [
        b"invalid",
        b'{"buy_stop":"4002","sell_stop":"3999","size":"100"}',
        b'{"buy_stop":"0","sell_stop":"1"}',
        b"x" * 8193,
    ],
)
def test_invalid_response_remains_claimed(tmp_path: Path, raw: bytes) -> None:
    req = request()
    with pytest.raises(ValueError, match="FAILED_OR_UNKNOWN"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=lambda *_: raw)
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=output)
    assert not (tmp_path / req.analysisId / "result.json").exists()


def test_unknown_failure_has_no_private_diagnostics(tmp_path: Path) -> None:
    req = request()

    def fail(*_: Any) -> bytes:
        raise TimeoutError("private callback/token")

    with pytest.raises(ValueError, match="FAILED_OR_UNKNOWN"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=fail)
    assert "private" not in (tmp_path / req.analysisId / "failure.json").read_text()


@pytest.mark.parametrize("kind", ["stale", "future", "prompt", "stale_quote"])
def test_preflight_never_calls_codex(tmp_path: Path, kind: str) -> None:
    req = request()
    clock = NOW
    prompt = PROMPT
    if kind == "stale":
        clock += timedelta(seconds=31)
    if kind == "future":
        clock -= timedelta(seconds=1)
    if kind == "prompt":
        prompt = "wrong"
    if kind == "stale_quote":
        req.payload.quote.sourceTime = (NOW - timedelta(seconds=31)).isoformat()
    with pytest.raises(ValueError):
        s.run(req, tmp_path, prompt, now=lambda: clock, call=lambda *_: pytest.fail("no dispatch"))
    assert not (tmp_path / req.analysisId).exists()


def test_late_output_cannot_be_used(tmp_path: Path) -> None:
    req = request()
    times = iter([NOW, NOW + timedelta(seconds=91)])
    with pytest.raises(ValueError, match="FAILED_OR_UNKNOWN"):
        s.run(req, tmp_path, PROMPT, now=lambda: next(times), call=output)
    assert (tmp_path / req.analysisId / "response-text.json").exists()
    assert not (tmp_path / req.analysisId / "result.json").exists()


@pytest.mark.parametrize(
    "kind", ["forming", "quality", "future", "stale", "gap", "range", "nan", "authority"]
)
def test_market_contract_rejects_bad_data(kind: str) -> None:
    body = request().model_dump()
    row = body["payload"]["candles"][0]["rows"][0]
    if kind == "forming":
        row[7] = False
    if kind == "quality":
        row[8] = ["gap"]
    if kind == "future":
        row[0] = (NOW + timedelta(seconds=60)).isoformat()
        row[1] = (NOW + timedelta(seconds=120)).isoformat()
    if kind == "stale":
        row[0] = (NOW - timedelta(days=1, seconds=60)).isoformat()
        row[1] = (NOW - timedelta(days=1)).isoformat()
    if kind == "gap":
        row[0] = (NOW - timedelta(seconds=61)).isoformat()
    if kind == "range":
        row[3] = "3998"
    if kind == "nan":
        row[2] = "NaN"
    if kind == "authority":
        body["position_size"] = "100"
    with pytest.raises(ValueError):
        s.Request.model_validate(body)


def test_http_boundary_auth_and_bounded_body(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, PROMPT, "x" * 32))
    assert client.post("/v1/entry-proposals", json={}).status_code == 401
    assert (
        client.post(
            "/v1/entry-proposals", headers={b"authorization": b"Bearer \xff"}, json={}
        ).status_code
        == 401
    )
    headers = {"authorization": "Bearer " + "x" * 32}
    response = client.post("/v1/entry-proposals", headers=headers, content="x" * (s.MAX_BYTES + 1))
    assert response.status_code == 413
    response = client.post("/v1/entry-proposals", headers=headers, json={"private": "do not echo"})
    assert response.status_code == 422
    assert "private" not in response.text


def test_worker_never_runs_as_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(s.os, "geteuid", lambda: 0)
    with pytest.raises(ValueError, match="DEDICATED_USER"):
        s.invoke("test", tmp_path)


def test_cli_isolation_and_timeout_kills_process_group(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(s.os, "geteuid", lambda: 1000)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("DATABASE_URL", "private-fixture")
    monkeypatch.setenv("CODEX_ENTRY_LOCAL_TOKEN", "private-fixture")
    killed = []
    monkeypatch.setattr(s.os, "killpg", lambda pid, sig: killed.append((pid, sig)))

    class Process:
        pid = 12345
        returncode = 0
        attempts = 0

        def communicate(self, *_: Any, **__: Any) -> None:
            self.attempts += 1
            if self.attempts == 1:
                raise s.subprocess.TimeoutExpired("codex", 90)

    def spawn(command: list[str], **options: Any) -> Process:
        assert command[command.index("--model") + 1] == s.MODEL
        assert command[command.index("--sandbox") + 1] == "read-only"
        assert "--ignore-user-config" in command and "--ignore-rules" in command
        assert 'web_search="disabled"' in command
        assert set(options["env"]) == {"HOME", "PATH", "LANG"}
        assert options["start_new_session"] is True
        return Process()

    monkeypatch.setattr(s.subprocess, "Popen", spawn)
    with pytest.raises(ValueError, match="TIMEOUT_UNKNOWN"):
        s.invoke("fixture", tmp_path)
    assert killed == [(12345, s.signal.SIGKILL)]


@pytest.mark.parametrize(
    "kind,version,model", [("request", "1.1", s.RequestV11), ("response", "1.0", s.Response)]
)
def test_published_schema_matches_typed_contract(kind: str, version: str, model: Any) -> None:
    schema = json.loads(Path(f"schemas/codex-entry-{kind}-{version}.json").read_text())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == model.model_json_schema()


@pytest.mark.parametrize(
    "fault",
    [None, "unmarked", "duplicate", "spurious", "overlap", "fractional", "too_long", "first"],
)
def test_verified_session_gap_contract(fault: str | None, tmp_path: Path) -> None:
    body = request().model_dump()
    series = body["payload"]["candles"][2]
    later = series["rows"][0]
    previous = list(later)
    gap = 2 * 86400
    if fault == "spurious":
        gap = 0
    elif fault == "overlap":
        gap = -900
    elif fault == "fractional":
        gap += 1
    elif fault == "too_long":
        gap = 15 * 86400
    previous[1] = (NOW - timedelta(seconds=900 + gap)).isoformat()
    previous[0] = (NOW - timedelta(seconds=1800 + gap)).isoformat()
    later[8] = ["BROKER_SESSION_GAP_BEFORE"]
    if fault == "unmarked":
        later[8] = []
    elif fault == "duplicate":
        later[8] *= 2
    series["rows"] = [later] if fault == "first" else [previous, later]
    if fault is not None:
        with pytest.raises(ValueError):
            s.Request.model_validate(body)
        assert not list(tmp_path.iterdir())
    else:
        req = s.Request.model_validate(body)
        result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=output)
        assert result["executionAuthority"] is False
        saved = json.loads((tmp_path / req.analysisId / "request.json").read_text())
        assert saved["payload"]["candles"][2]["rows"][1][8] == ["BROKER_SESSION_GAP_BEFORE"]


def test_new_breakout_request_identity_and_legacy_pair_rejection() -> None:
    body = request().model_dump()
    body.update(version="codex-entry-request-1.1", promptVersion="entry-pair-v5")
    assert s.Request.model_validate(body).promptVersion == "entry-pair-v5"
    body["version"] = "codex-entry-request-1.0"
    with pytest.raises(ValueError, match="PROMPT_VERSION_MISMATCH"):
        s.Request.model_validate(body)


def test_api_rejects_other_prompt_revision_before_claim(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, PROMPT, "x" * 32, prompt_version="entry-pair-v5"))
    response = client.post(
        "/v1/entry-proposals",
        headers={"authorization": "Bearer " + "x" * 32},
        json=request().model_dump(),
    )
    assert response.status_code == 422
    assert not list(tmp_path.iterdir())


def test_request_schemas_keep_legacy_and_v11_separate() -> None:
    from jsonschema import Draft202012Validator

    legacy = request().model_dump()
    current = request(version="codex-entry-request-1.1", promptVersion="entry-pair-v5").model_dump()
    old_schema = json.loads(Path("schemas/codex-entry-request-1.0.json").read_text())
    new_schema = json.loads(Path("schemas/codex-entry-request-1.1.json").read_text())
    Draft202012Validator(old_schema).validate(legacy)
    Draft202012Validator(new_schema).validate(current)
    assert list(Draft202012Validator(old_schema).iter_errors(current))
    assert list(Draft202012Validator(new_schema).iter_errors(legacy))


@pytest.mark.parametrize("frame,count", [("M5", 144), ("M15", 288)])
def test_expanded_context_is_v11_only(frame: str, count: int) -> None:
    body = request().model_dump()
    series = next(s for s in body["payload"]["candles"] if s["timeframe"] == frame)
    seconds = {"M5": 300, "M15": 900}[frame]
    template = series["rows"][0]
    series["rows"] = [
        [
            (NOW - timedelta(seconds=seconds * (i + 1))).isoformat(),
            (NOW - timedelta(seconds=seconds * i)).isoformat(),
            *template[2:],
        ]
        for i in reversed(range(count))
    ]
    with pytest.raises(ValueError, match="CODEX_LEGACY_CANDLE_LIMIT"):
        s.Request.model_validate(body)
    body.update(version="codex-entry-request-1.1", promptVersion="entry-pair-v5")
    assert s.RequestV11.model_validate(body).payload.candles
    series["rows"].insert(0, series["rows"][0])
    with pytest.raises(ValueError):
        s.RequestV11.model_validate(body)


def smc_request() -> s.RequestV12:
    body = request(version="codex-entry-request-1.1", promptVersion="entry-pair-v5").model_dump()
    evidence = json.loads(Path("tests/fixtures/technical-context/response.json").read_text())[
        "evidence"
    ]
    evidence["history_targets_met"] = True
    for frame in evidence["frames"]:
        frame["candle_count"] = {"M1": 720, "M5": 576, "M15": 480}[frame["timeframe"]]
        frame["latest_completed_at"] = NOW.isoformat()
    evidence["depth"]["source_at"] = NOW.isoformat()
    evidence["depth"]["received_at"] = NOW.isoformat()
    body.update(version="codex-entry-request-1.2", promptVersion="entry-pair-v6")
    body["payload"].update(
        technical_context=evidence,
        context_input_sha256="a" * 64,
        market_captured_at=NOW.isoformat(),
    )
    return s.RequestV12.model_validate(body)


def test_smc_transport_preserves_context_and_exact_claim(tmp_path: Path) -> None:
    req = smc_request()
    assert s.parse_request(req.model_dump_json().encode()) == req

    def call(prompt: str, _job: Path) -> bytes:
        assert (
            '"technical_context"' in prompt and '"definitions_version":"causal-smc-1.0"' in prompt
        )
        assert '"history_targets_met":true' in prompt and '"depth"' in prompt
        return output()

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["entries"] == {"buy_stop": "4002", "sell_stop": "3999"}
    assert (
        json.loads((tmp_path / req.analysisId / "request.json").read_text())["payload"][
            "technical_context"
        ]
        == req.payload.technical_context.model_dump()
    )
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=lambda *_: pytest.fail("no redispatch"))


@pytest.mark.parametrize(
    "fault", ["missing", "history", "future", "stale_dom", "mismatch", "old_version"]
)
def test_smc_corruption_rejects_before_provider(fault: str) -> None:
    body = smc_request().model_dump()
    if fault == "missing":
        del body["payload"]["technical_context"]
    elif fault == "history":
        body["payload"]["technical_context"]["history_targets_met"] = False
    elif fault == "future":
        body["payload"]["technical_context"]["frames"][0]["events"] = [
            {
                "kind": "MSS",
                "direction": "BULLISH",
                "level": "4000",
                "pivot_at": NOW.isoformat(),
                "available_at": (NOW + timedelta(minutes=1)).isoformat(),
                "displacement": True,
            }
        ]
    elif fault == "stale_dom":
        body["payload"]["technical_context"]["depth"]["source_at"] = (
            NOW - timedelta(seconds=4)
        ).isoformat()
    elif fault == "mismatch":
        body["payload"]["technical_context"]["frames"][0]["latest_completed_at"] = (
            NOW - timedelta(hours=1)
        ).isoformat()
    else:
        body["version"] = "codex-entry-request-1.1"
    with pytest.raises(ValueError):
        s.parse_request(json.dumps(body).encode())


def test_smc_http_version_gate_never_claims_legacy_input(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, PROMPT, "x" * 32, prompt_version="entry-pair-v6"))
    rejected = client.post(
        "/v1/entry-proposals",
        headers={"authorization": "Bearer " + "x" * 32},
        json=request().model_dump(),
    )
    assert rejected.status_code == 422 and not list(tmp_path.iterdir())
    assert (
        json.loads(Path("schemas/codex-entry-request-1.2.json").read_text())
        == s.RequestV12.model_json_schema()
    )


def test_worker_distinguishes_broker_clock_from_recorded_local_capture() -> None:
    body = smc_request().model_dump()
    body["payload"]["market_captured_at"] = (NOW + timedelta(milliseconds=800)).isoformat()
    body["payload"]["technical_context"]["depth"]["received_at"] = (
        NOW + timedelta(milliseconds=500)
    ).isoformat()
    assert (
        s.RequestV12.model_validate(body).payload.technical_context.depth.received_at
        == (NOW + timedelta(milliseconds=500)).isoformat()
    )
    body["payload"]["technical_context"]["depth"]["received_at"] = (
        NOW + timedelta(seconds=1)
    ).isoformat()
    with pytest.raises(ValueError, match="DEPTH_STALE"):
        s.RequestV12.model_validate(body)
    body["payload"]["market_captured_at"] = (NOW + timedelta(seconds=4)).isoformat()
    with pytest.raises(ValueError, match="CLOCK_SKEW"):
        s.RequestV12.model_validate(body)
