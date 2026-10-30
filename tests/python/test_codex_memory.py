from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any, ClassVar
from uuid import uuid4

import pytest

from python.codex_entry import memory as m
from python.codex_entry import service as s
from python.research.codex_loop import publish
from tests.python.test_codex_entry import NOW, PROMPT, smc_request


def current_request() -> s.RequestV13:
    body = smc_request().model_dump()
    body.update(version="codex-entry-request-1.3", promptVersion="entry-pair-v7")
    body["payload"]["execution_context"] = {
        "spread_price": "1",
        "modeled_round_trip_cost_price": "1.2",
        "cost_basis": "CONSERVATIVE_MIN_VOLUME_RESERVE_EXCLUDES_SPREAD",
        "shared_setup_risk_percent": "1",
        "recent_closed_outcomes": [],
    }
    return s.RequestV13.model_validate(body)


def test_current_schema_and_completed_wait_claim(tmp_path: Path) -> None:
    req = current_request()
    raw = b'{"decision":"WAIT","reason":"Conflicting structure","buy_stop":null,"sell_stop":null}'

    def call(prompt: str, job: Path) -> bytes:
        assert "Return OCO or WAIT only." in prompt
        assert "Propose prices only." not in prompt
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "thread1",
                "turnId": "turn1",
                "compacted": False,
            },
        )
        return raw

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.1"
    assert result["entries"]["decision"] == "WAIT"
    assert result["memory"]["threadId"] == "thread1"
    with pytest.raises(ValueError, match="ALREADY_CLAIMED"):
        s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert isinstance(s.parse_request(req.model_dump_json().encode()), s.RequestV13)
    for name, model in [
        ("request-1.3", s.RequestV13),
        ("response-1.1", s.ResponseV11),
        ("decision", s.Decision),
    ]:
        filename = f"codex-entry-{name}" if name != "decision" else "entry-decision-provider-1.0"
        schema = json.loads(Path(f"schemas/{filename}.json").read_text())
        schema.pop("$schema")
        schema.pop("$id")
        assert schema == model.model_json_schema()


@pytest.mark.parametrize("kind", ["future", "ordering", "old", "spread"])
def test_fresh_outcome_context_rejects_invalid_provenance(kind: str) -> None:
    body = current_request().model_dump()
    outcome = {
        "closed_at": NOW.isoformat(),
        "direction": "LONG",
        "realized_net": "-2",
        "strategy_version": "fixture",
    }
    if kind == "future":
        outcome["closed_at"] = (NOW + timedelta(seconds=1)).isoformat()
    if kind == "old":
        outcome["closed_at"] = (NOW - timedelta(days=2)).isoformat()
    body["payload"]["execution_context"]["recent_closed_outcomes"] = [outcome]
    if kind == "ordering":
        body["payload"]["execution_context"]["recent_closed_outcomes"] = [
            {**outcome, "closed_at": (NOW - timedelta(seconds=1)).isoformat()},
            outcome,
        ]
    if kind == "spread":
        body["payload"]["execution_context"]["spread_price"] = "0"
    with pytest.raises(ValueError):
        s.RequestV13.model_validate(body)


@pytest.mark.parametrize(
    "value",
    [
        {"decision": "WAIT", "reason": "wait", "buy_stop": "1", "sell_stop": None},
        {"decision": "OCO", "reason": "trade", "buy_stop": None, "sell_stop": "1"},
        {"decision": "OCO", "reason": "trade", "buy_stop": "0", "sell_stop": "1"},
    ],
)
def test_wait_cannot_carry_trade_authority(value: Any) -> None:
    with pytest.raises(ValueError):
        s.Decision.model_validate(value)


class FakeRpc:
    calls: ClassVar[list[tuple[str, dict[str, Any]]]] = []
    fail_turn = False
    busy = False
    thread_number = 0

    def __init__(self, *_: Any):
        pass

    def send(self, value: Any) -> None:
        pass

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((method, params))
        if method == "initialize":
            return {}
        if method in {"thread/start", "thread/resume"}:
            if method == "thread/start":
                type(self).thread_number += 1
            return {
                "thread": {
                    "id": params.get("threadId", f"thread{self.thread_number}"),
                    "status": {"type": "active" if self.busy else "idle"},
                }
            }
        if method == "turn/start":
            if self.fail_turn:
                raise ValueError("CODEX_TIMEOUT_UNKNOWN")
            return {"turn": {"id": "turn1"}}
        return {}

    def completed(self, *_: Any, compact: bool = False) -> tuple[str, str]:
        return (
            ("compact1", "")
            if compact
            else ("turn1", '{"decision":"WAIT","reason":"wait","buy_stop":null,"sell_stop":null}')
        )

    def close(self) -> None:
        pass


@pytest.fixture
def daily(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    FakeRpc.calls = []
    FakeRpc.fail_turn = False
    FakeRpc.busy = False
    FakeRpc.thread_number = 0
    monkeypatch.setattr(m.os, "geteuid", lambda: 1000)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(m, "Rpc", FakeRpc)

    def spawn(command: list[str], **options: Any) -> Any:
        assert command[:2] == ["codex", "app-server"]
        assert 'sandbox_mode="read-only"' in command
        assert "features.shell_tool=false" in command
        assert 'web_search="disabled"' in command
        assert set(options["env"]) == {"HOME", "PATH", "LANG"}
        assert options["start_new_session"] is True
        return object()

    monkeypatch.setattr(m.subprocess, "Popen", spawn)

    def run(day: str = "2026-10-19", purpose: str = "entries") -> Path:
        job = tmp_path / "jobs" / str(uuid4())
        job.mkdir(parents=True)
        req = current_request().model_dump()
        req["payload"]["captured_at"] = day + "T12:00:00Z"
        publish(job / "request.json", req)
        m.invoke_daily(
            "Fresh INPUT",
            job,
            schema=s.Decision.model_json_schema(),
            model=s.MODEL,
            purpose=purpose,
        )
        return job

    return run


def test_resume_exact_daily_thread_and_compact(daily: Any) -> None:
    jobs = [daily() for _ in range(m.COMPACT_EVERY + 1)]
    assert sum(method == "thread/start" for method, _ in FakeRpc.calls) == 1
    assert sum(method == "thread/resume" for method, _ in FakeRpc.calls) == m.COMPACT_EVERY
    assert sum(method == "thread/compact/start" for method, _ in FakeRpc.calls) == 1
    receipts = [json.loads((job / "memory-result.json").read_text()) for job in jobs]
    assert len({r["threadId"] for r in receipts}) == 1
    assert receipts[-1]["compacted"] is True
    next_job = daily("2026-10-20")
    assert json.loads((next_job / "memory-result.json").read_text())["threadId"] != "thread1"


def test_unknown_dispatch_is_not_replayed_and_busy_thread_blocks(
    daily: Any, tmp_path: Path
) -> None:
    FakeRpc.fail_turn = True
    with pytest.raises(ValueError, match="TIMEOUT_UNKNOWN"):
        daily()
    state = json.loads(next(tmp_path.rglob("state.json")).read_text())
    assert state["pending"] is True
    FakeRpc.fail_turn = False
    FakeRpc.busy = True
    with pytest.raises(ValueError, match="PREVIOUS_TURN_UNRESOLVED"):
        daily()
    assert sum(method == "turn/start" for method, _ in FakeRpc.calls) == 1
    FakeRpc.busy = False
    job = daily()
    assert (
        json.loads((job / "memory-dispatch.json").read_text())["priorOutcomeMayBeUnknown"] is True
    )
    assert sum(method == "turn/start" for method, _ in FakeRpc.calls) == 2


def test_corrupt_state_does_not_silently_create_new_thread(daily: Any, tmp_path: Path) -> None:
    daily()
    next(tmp_path.rglob("state.json")).write_text('{"day":"bad"}')
    with pytest.raises(ValueError):
        daily()
    assert sum(method == "thread/start" for method, _ in FakeRpc.calls) == 1


def test_stdio_protocol_success_and_failures() -> None:
    import subprocess
    import time

    # Real pipes exercise bounded IO and parser paths without Codex/provider access.
    cases = [
        ([{"id": 1, "result": {"ok": True}}], None),
        ([{"id": 1, "error": {"code": 1}}], "RPC_REJECTED"),
        ([{"id": 99, "result": {}}], "RPC_ID_MISMATCH"),
        ([{"id": 1, "method": "tool/request", "params": {}}], "SERVER_REQUEST"),
        (
            [{"method": "item/started", "params": {"item": {"type": "commandExecution"}}}],
            "TOOLS_FORBIDDEN",
        ),
    ]
    for messages, error in cases:
        script = "import sys,json;sys.stdin.readline();" + ";".join(
            f"print({json.dumps(message)!r},flush=True)" for message in messages
        )
        process = subprocess.Popen(
            ["/usr/bin/python3", "-u", "-c", script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        rpc = m.Rpc(process, time.monotonic() + 2)
        try:
            if error:
                with pytest.raises(ValueError, match=error):
                    rpc.request("initialize", {})
            else:
                assert rpc.request("initialize", {}) == {"ok": True}
        finally:
            rpc.close()


def test_stdio_deadline_kills_only_owned_process_group() -> None:
    import subprocess
    import time

    process = subprocess.Popen(
        ["/usr/bin/python3", "-u", "-c", "import time;time.sleep(5)"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    rpc = m.Rpc(process, time.monotonic() + 0.03)
    try:
        with pytest.raises(ValueError, match="TIMEOUT_UNKNOWN"):
            rpc.request("initialize", {})
    finally:
        rpc.close()
    assert process.poll() is not None


def test_resumed_history_cannot_satisfy_a_new_turn_or_compaction() -> None:
    # Exercise the notification matcher directly: only exact current turn output
    # can become a proposal. Old retained completions are context, not a result.
    rpc = object.__new__(m.Rpc)
    rpc.pending = [
        {
            "method": "item/completed",
            "params": {
                "threadId": "t",
                "turnId": "old",
                "item": {
                    "type": "agentMessage",
                    "id": "olditem",
                    "phase": "final_answer",
                    "text": "old prices",
                },
            },
        },
        {
            "method": "turn/completed",
            "params": {"threadId": "t", "turn": {"id": "old", "status": "completed"}},
        },
        {
            "method": "item/completed",
            "params": {
                "threadId": "t",
                "turnId": "new",
                "item": {
                    "type": "agentMessage",
                    "id": "newitem",
                    "phase": "final_answer",
                    "text": "fresh prices",
                },
            },
        },
        {
            "method": "turn/completed",
            "params": {"threadId": "t", "turn": {"id": "new", "status": "completed"}},
        },
    ]
    assert rpc.completed("t", "new") == ("new", "fresh prices")
    rpc.pending = [
        {
            "method": "item/completed",
            "params": {"threadId": "t", "turnId": "old", "item": {"type": "contextCompaction"}},
        },
        {
            "method": "turn/completed",
            "params": {"threadId": "t", "turn": {"id": "old", "status": "completed"}},
        },
        {
            "method": "turn/started",
            "params": {"threadId": "t", "turn": {"id": "compact", "status": "inProgress"}},
        },
        {
            "method": "item/completed",
            "params": {"threadId": "t", "turnId": "compact", "item": {"type": "contextCompaction"}},
        },
        {
            "method": "turn/completed",
            "params": {"threadId": "t", "turn": {"id": "compact", "status": "completed"}},
        },
    ]
    assert rpc.completed("t", None, compact=True) == ("compact", "")


def test_stdio_write_backpressure_has_the_same_deadline() -> None:
    import subprocess
    import time

    process = subprocess.Popen(
        ["/usr/bin/python3", "-u", "-c", "import time;time.sleep(5)"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    rpc = m.Rpc(process, time.monotonic() + 0.03)
    try:
        with pytest.raises(ValueError, match="TIMEOUT_UNKNOWN"):
            rpc.send({"text": "x" * 200_000})
    finally:
        rpc.close()
    assert process.poll() is not None


def test_v14_keeps_v13_immutable_and_pins_m1_prompt(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    from python.codex_entry.api import create_app

    legacy = current_request()
    body = legacy.model_dump()
    body.update(version="codex-entry-request-1.4", promptVersion="entry-pair-v8")
    req = s.parse_request(json.dumps(body).encode())
    assert isinstance(req, s.RequestV14)
    assert isinstance(s.parse_request(legacy.model_dump_json().encode()), s.RequestV13)
    schema = json.loads(Path("schemas/codex-entry-request-1.4.json").read_text())
    schema.pop("$schema")
    schema.pop("$id")
    assert schema == s.RequestV14.model_json_schema()
    bad = {**body, "promptVersion": "entry-pair-v7"}
    with pytest.raises(ValueError):
        s.parse_request(json.dumps(bad).encode())
    # Old worker refuses new contract before any provider claim; new worker also
    # refuses a legacy prompt. No old prompt can silently authorize v8 trading.
    for expected, payload in [("entry-pair-v7", body), ("entry-pair-v8", legacy.model_dump())]:
        client = TestClient(create_app(tmp_path, PROMPT, "x" * 32, prompt_version=expected))
        response = client.post(
            "/v1/entry-proposals", json=payload, headers={"authorization": "Bearer " + "x" * 32}
        )
        assert response.status_code == 422
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize("decision", ["WAIT", "OCO"])
def test_v14_persistent_decision_receipt(tmp_path: Path, decision: str) -> None:
    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.4", promptVersion="entry-pair-v8")
    req = s.RequestV14.model_validate(body)

    def call(prompt: str, job: Path) -> bytes:
        assert "Return OCO or WAIT only." in prompt
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "thread-v8",
                "turnId": "turn-v8",
                "compacted": False,
            },
        )
        return json.dumps(
            {
                "decision": decision,
                "reason": "Visible M1 range" if decision == "OCO" else "No usable M1 range",
                "buy_stop": "4002" if decision == "OCO" else None,
                "sell_stop": "3999" if decision == "OCO" else None,
            }
        ).encode()

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["entries"]["decision"] == decision
    assert result["version"] == "codex-entry-response-1.1"
    assert result["executionAuthority"] is False


@pytest.mark.parametrize("decision", ["BUY", "SELL", "WAIT"])
def test_directional_transport_is_strict_and_preserves_native_memory(
    tmp_path: Path, decision: str
) -> None:
    from fastapi.testclient import TestClient

    from python.codex_entry.api import create_app

    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.5", promptVersion="entry-direction-v1")
    req = s.parse_request(json.dumps(body).encode())
    assert isinstance(req, s.RequestV15)

    def call(prompt: str, job: Path) -> bytes:
        assert "Return BUY, SELL or WAIT only." in prompt
        assert "Return OCO or WAIT only." not in prompt
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "direction-thread",
                "turnId": "turn1",
                "compacted": False,
            },
        )
        return json.dumps(
            {
                "decision": decision,
                "reason": "Trend and M1 range",
                "upper_breakout": None if decision == "WAIT" else "4002",
                "lower_breakout": None if decision == "WAIT" else "3999",
            }
        ).encode()

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.2"
    assert result["entries"]["decision"] == decision
    assert result["executionAuthority"] is False
    for name, model in [
        ("codex-entry-request-1.5", s.RequestV15),
        ("codex-entry-response-1.2", s.ResponseV12),
        ("entry-direction-provider-1.0", s.DirectionalDecision),
    ]:
        schema = json.loads(Path("schemas", name + ".json").read_text())
        schema.pop("$id")
        schema.pop("$schema")
        assert schema == model.model_json_schema()
    legacy_worker = TestClient(
        create_app(tmp_path, PROMPT, "x" * 32, prompt_version="entry-pair-v8")
    )
    assert (
        legacy_worker.post(
            "/v1/entry-proposals", json=body, headers={"authorization": "Bearer " + "x" * 32}
        ).status_code
        == 422
    )


@pytest.mark.parametrize("decision", ["OCO", "REVERSE", "BOTH"])
def test_directional_transport_rejects_legacy_or_reversal_decisions(decision: str) -> None:
    with pytest.raises(ValueError):
        s.DirectionalDecision.model_validate(
            {
                "decision": decision,
                "reason": "invalid",
                "upper_breakout": "4002",
                "lower_breakout": "3999",
            }
        )


@pytest.mark.parametrize("decision", ["BUY", "SELL", "WAIT"])
def test_four_mode_worker_schema_and_native_receipt(tmp_path: Path, decision: str) -> None:
    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.6", promptVersion="entry-modes-v1")
    req = s.parse_request(json.dumps(body).encode())
    assert isinstance(req, s.RequestV16)

    def call(prompt: str, job: Path) -> bytes:
        assert "Return BUY, SELL or WAIT only." in prompt
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "mode-thread",
                "turnId": "mode-turn",
                "compacted": False,
            },
        )
        return json.dumps(
            {
                "decision": decision,
                "reason": "fixture",
                "upper_breakout": None if decision == "WAIT" else "4002",
                "lower_breakout": None if decision == "WAIT" else "3999",
            }
        ).encode()

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.2"
    assert result["entries"]["decision"] == decision
    assert result["executionAuthority"] is False
    schema = json.loads(Path("schemas/codex-entry-request-1.6.json").read_text())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == s.RequestV16.model_json_schema()
    with pytest.raises(ValueError):
        s.RequestV15.model_validate(body)


@pytest.mark.parametrize("decision", ["BUY", "SELL", "WAIT"])
def test_quick_oco_worker_contract_preserves_historical_risk_and_native_receipt(
    tmp_path: Path, decision: str
) -> None:
    import hashlib

    prompt = Path("prompts/entry-quick-oco-v1.md").read_text().strip()
    body = current_request().model_dump()
    body.update(
        version="codex-entry-request-1.7",
        promptVersion="entry-quick-oco-v1",
        promptSha256=hashlib.sha256(prompt.encode()).hexdigest(),
    )
    body["payload"]["execution_context"]["shared_setup_risk_percent"] = "5"
    req = s.parse_request(json.dumps(body).encode())
    assert isinstance(req, s.RequestV17)
    schema = json.loads(Path("schemas/codex-entry-request-1.7.json").read_text())
    schema.pop("$schema")
    schema.pop("$id")
    assert schema == s.RequestV17.model_json_schema()
    with pytest.raises(ValueError):
        s.RequestV16.model_validate(body)
    wrong = json.loads(json.dumps(body))
    wrong["payload"]["execution_context"]["shared_setup_risk_percent"] = "1"
    with pytest.raises(ValueError):
        s.RequestV17.model_validate(wrong)

    def call(text: str, job: Path) -> bytes:
        assert "Return BUY, SELL or WAIT only." in text
        assert "seven times gross TP" in text
        assert '"shared_setup_risk_percent":"5"' in text
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "quick-thread",
                "turnId": "quick-turn",
                "compacted": False,
            },
        )
        return json.dumps(
            {
                "decision": decision,
                "reason": "fixture",
                "upper_breakout": None if decision == "WAIT" else "4002",
                "lower_breakout": None if decision == "WAIT" else "3999",
            }
        ).encode()

    result = s.run(req, tmp_path, prompt, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.2"
    assert result["entries"]["decision"] == decision
    assert result["executionAuthority"] is False


def test_fixed_tp_worker_contract_preserves_earlier_request_versions() -> None:
    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.8", promptVersion="entry-quick-oco-v2")
    body["payload"]["execution_context"]["shared_setup_risk_percent"] = "5"
    assert isinstance(s.parse_request(json.dumps(body).encode()), s.RequestV18)
    schema = json.loads(Path("schemas/codex-entry-request-1.8.json").read_text())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == s.RequestV18.model_json_schema()
    with pytest.raises(ValueError):
        s.RequestV17.model_validate(body)


def test_quick_profit_request_is_versioned_and_preserves_v18() -> None:
    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.9", promptVersion="entry-quick-oco-v3")
    body["payload"]["execution_context"]["shared_setup_risk_percent"] = "5"
    assert isinstance(s.parse_request(json.dumps(body).encode()), s.RequestV19)
    schema = json.loads(Path("schemas/codex-entry-request-1.9.json").read_text())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == s.RequestV19.model_json_schema()
    with pytest.raises(ValueError):
        s.RequestV18.model_validate(body)


def test_native_profit_request_preserves_previous_versions_and_rejects_mixed_prompt() -> None:
    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.10", promptVersion="entry-quick-oco-v4")
    body["payload"]["execution_context"]["shared_setup_risk_percent"] = "5"
    assert isinstance(s.parse_request(json.dumps(body).encode()), s.RequestV110)
    schema = json.loads(Path("schemas/codex-entry-request-1.10.json").read_text())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == s.RequestV110.model_json_schema()
    with pytest.raises(ValueError):
        s.RequestV19.model_validate(body)
    body["promptVersion"] = "entry-quick-oco-v3"
    with pytest.raises(ValueError):
        s.parse_request(json.dumps(body).encode())


def level_request() -> s.RequestV111:
    """Current request carrying the causal-smc-1.1 fixture evidence."""
    body = current_request().model_dump()
    body.update(version="codex-entry-request-1.11", promptVersion="entry-quick-oco-v5")
    body["payload"]["execution_context"]["shared_setup_risk_percent"] = "5"
    evidence = json.loads(Path("tests/fixtures/technical-context/response-1.1.json").read_text())[
        "evidence"
    ]
    evidence["history_targets_met"] = True
    for frame in evidence["frames"]:
        frame["candle_count"] = {"M1": 720, "M5": 576, "M15": 480}[frame["timeframe"]]
        frame["latest_completed_at"] = NOW.isoformat()
    evidence["depth"]["source_at"] = NOW.isoformat()
    evidence["depth"]["received_at"] = NOW.isoformat()
    body["payload"]["technical_context"] = evidence
    return s.RequestV111.model_validate(body)


def level(available: str) -> dict[str, Any]:
    return {
        "id": "M5-L1",
        "lower": "4010",
        "upper": "4010.2",
        "touches": 2,
        "high_pivots": 2,
        "low_pivots": 0,
        "first_pivot_at": (NOW - timedelta(hours=2)).isoformat(),
        "last_pivot_at": (NOW - timedelta(hours=1)).isoformat(),
        "available_at": available,
        "role": "RESISTANCE",
        "distance_from_quote": "10",
        "traded_above_after": False,
        "traded_below_after": True,
        "tolerance": "0.4",
    }


def test_level_map_request_is_versioned_and_rejects_mixed_contracts(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    from python.codex_entry.api import create_app

    req = level_request()
    assert isinstance(s.parse_request(req.model_dump_json().encode()), s.RequestV111)
    schema = json.loads(Path("schemas/codex-entry-request-1.11.json").read_text())
    schema.pop("$id")
    schema.pop("$schema")
    assert schema == s.RequestV111.model_json_schema()
    body = req.model_dump()
    # 1.10 stays bound to causal-smc-1.0 and 1.11 to causal-smc-1.1; neither accepts the other.
    with pytest.raises(ValueError):
        s.RequestV110.model_validate(
            {**body, "version": "codex-entry-request-1.10", "promptVersion": "entry-quick-oco-v4"}
        )
    legacy = current_request().model_dump()
    legacy["payload"]["execution_context"]["shared_setup_risk_percent"] = "5"
    with pytest.raises(ValueError):
        s.RequestV111.model_validate(
            {**legacy, **{k: body[k] for k in ("version", "promptVersion")}}
        )
    with pytest.raises(ValueError):
        s.parse_request(json.dumps({**body, "promptVersion": "entry-quick-oco-v4"}).encode())
    # A v4 worker refuses the level-map request and a v5 worker refuses 1.10 before any claim.
    old = {**legacy, "version": "codex-entry-request-1.10", "promptVersion": "entry-quick-oco-v4"}
    for expected, payload in [("entry-quick-oco-v4", body), ("entry-quick-oco-v5", old)]:
        client = TestClient(create_app(tmp_path, PROMPT, "x" * 32, prompt_version=expected))
        response = client.post(
            "/v1/entry-proposals", json=payload, headers={"authorization": "Bearer " + "x" * 32}
        )
        assert response.status_code == 422
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize(
    "fault",
    [
        "level_future",
        "level_order",
        "level_bounds",
        "level_nan",
        "anatomy_future",
        "session",
        "session_end",
    ],
)
def test_level_map_lookahead_and_provenance_reject_before_provider(fault: str) -> None:
    body = level_request().model_dump()
    context = body["payload"]["technical_context"]
    frame = context["frames"][0]
    later = (NOW + timedelta(minutes=1)).isoformat()
    if fault == "level_future":
        frame["support_resistance"] = [level(later)]
    elif fault == "level_order":
        frame["support_resistance"] = [level((NOW - timedelta(hours=3)).isoformat())]
    elif fault in {"level_bounds", "level_nan"}:
        bad = level((NOW - timedelta(minutes=30)).isoformat())
        bad["lower"] = "0" if fault == "level_bounds" else "NaN"
        frame["support_resistance"] = [bad]
    elif fault == "session_end":
        complete = next(s for s in context["sessions"] if s["status"] == "COMPLETE")
        complete["utc_end"] = later
    elif fault == "anatomy_future":
        frame["candle_anatomy"][-1]["end_at"] = later
    else:
        context["sessions"][0]["utc_start"] = later
    with pytest.raises(ValueError):
        s.parse_request(json.dumps(body).encode())
    frame["support_resistance"] = [level((NOW - timedelta(minutes=30)).isoformat())]
    if fault in {"level_future", "level_order", "level_bounds", "level_nan"}:
        assert isinstance(s.parse_request(json.dumps(body).encode()), s.RequestV111)


def test_level_map_receipt_keeps_directional_response(tmp_path: Path) -> None:
    req = level_request()

    def call(prompt: str, job: Path) -> bytes:
        assert "Return BUY, SELL or WAIT only." in prompt
        assert '"definitions_version":"causal-smc-1.1"' in prompt
        assert '"support_resistance"' in prompt and '"m1_envelopes"' in prompt
        publish(
            job / "memory-result.json",
            {
                "day": NOW.date().isoformat(),
                "threadId": "thread-v5",
                "turnId": "turn-v5",
                "compacted": False,
            },
        )
        return (
            b'{"decision":"SELL","reason":"M5 bearish BOS; SELL = M1 env5 low - 9 ticks",'
            b'"upper_breakout":"4002","lower_breakout":"3999"}'
        )

    result = s.run(req, tmp_path, PROMPT, now=lambda: NOW, call=call)
    assert result["version"] == "codex-entry-response-1.2"
    assert result["entries"]["decision"] == "SELL" and result["executionAuthority"] is False


def test_research_purpose_has_separate_thread_and_no_price_instruction(daily: Any) -> None:
    daily()
    daily(purpose="research")
    starts = [params for method, params in FakeRpc.calls if method == "thread/start"]
    assert len(starts) == 2
    assert "propose prices" in starts[0]["baseInstructions"]
    assert "research diagnostics" in starts[1]["baseInstructions"]
    assert "Never use tools" in starts[1]["baseInstructions"]


def test_generated_research_uses_separate_tool_disabled_thread(daily: Any) -> None:
    daily(purpose="research")
    daily(purpose="research_code")
    starts = [params for method, params in FakeRpc.calls if method == "thread/start"]
    assert len(starts) == 2
    assert "research source text" in starts[1]["baseInstructions"]
    assert "Never use tools" in starts[1]["baseInstructions"]
