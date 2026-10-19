from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from python.research import codex_loop as r

NOW = datetime(2026, 10, 19, 8, tzinfo=UTC)


def evidence(tmp_path: Path, **changes: Any) -> Path:
    body = {
        "version": "research-evidence-1.0",
        "mode": "demo",
        "release": "fixture",
        "start": "2026-10-18T00:00:00Z",
        "end": "2026-10-19T00:00:00Z",
        "closed_trades": 2,
        "wins": 1,
        "matched_cost_records": 1,
        "net_pnl": "-1.00",
        "gross_pnl": "1.00",
        "signed_costs": "-2.00",
        "provider_cost": None,
    }
    body.update(changes)
    path = tmp_path / "input.json"
    path.write_text(json.dumps(body))
    return path


def proposal() -> bytes:
    return r.encoded(
        {"summary": "Fixture only", "evidence_limits": ["Costs incomplete"], "candidates": []}
    )


def test_daily_claim_is_durable_and_never_replayed(tmp_path: Path) -> None:
    source = evidence(tmp_path)
    directory = tmp_path / "jobs"
    calls = []

    def invoke(prompt: str, job: Path) -> bytes:
        assert (job / "claim.json").exists()
        assert "JOB: daily" in prompt
        calls.append(prompt)
        return proposal()

    assert r.run(directory, source, "daily", NOW, invoke) == "PROPOSAL_ONLY"
    assert r.run(directory, source, "daily", NOW, invoke) == "ALREADY_CLAIMED"
    report = json.loads((directory / "daily-2026-10-19/report.json").read_bytes())
    assert report["decision"] == "HOLD"
    assert not report["brokerAuthority"] and not report["promotionAuthority"]
    assert not report["evaluationPerformed"]
    assert len(calls) == 1
    assert (directory / "daily-2026-10-19/report.json").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("output", [b"invalid", b'{"summary":"bad","promotionAuthority":true}'])
def test_invalid_output_consumes_claim(tmp_path: Path, output: bytes) -> None:
    source = evidence(tmp_path)
    directory = tmp_path / "jobs"
    assert r.run(directory, source, "daily", NOW, lambda *_: output) == "FAILED_OR_UNKNOWN"
    assert r.run(directory, source, "daily", NOW, lambda *_: proposal()) == "ALREADY_CLAIMED"
    assert not (directory / "daily-2026-10-19/report.json").exists()


def test_timeout_is_recorded_without_raw_error_or_retry(tmp_path: Path) -> None:
    def fail(*_: Any) -> bytes:
        raise TimeoutError("private-provider-response")

    source = evidence(tmp_path)
    directory = tmp_path / "jobs"
    assert r.run(directory, source, "weekly", NOW, fail) == "FAILED_OR_UNKNOWN"
    failure = (directory / "weekly-2026-W43/failure.json").read_text()
    assert "private-provider-response" not in failure
    assert r.run(directory, source, "weekly", NOW + timedelta(hours=1), fail) == "ALREADY_CLAIMED"


@pytest.mark.parametrize(
    "changes",
    [
        {"end": "2026-10-17T00:00:00Z", "start": "2026-10-16T00:00:00Z"},
        {"end": "2026-10-20T00:00:00Z"},
        {"wins": 3},
        {"account_id": "forbidden"},
        {"net_pnl": 1.2},
        {"provider_cost": "0"},
        {"start": "2026-08-01T00:00:00Z"},
        {"end": "2026-10-19T00:00:00"},
    ],
)
def test_invalid_input_never_dispatches(tmp_path: Path, changes: dict[str, Any]) -> None:
    def forbidden(*_: Any) -> bytes:
        pytest.fail("provider must not be called")

    with pytest.raises(ValueError):
        r.run(tmp_path / "jobs", evidence(tmp_path, **changes), "daily", NOW, forbidden)


def test_all_attempts_count_toward_rolling_budget(tmp_path: Path) -> None:
    directory = tmp_path / "jobs"
    for n in range(8):
        job = directory / f"fixture-{n}"
        job.mkdir(parents=True)
        r.publish(job / "claim.json", {"at": (NOW - timedelta(hours=n)).isoformat()})
    assert r.run(directory, evidence(tmp_path), "daily", NOW) == "BUDGET_EXHAUSTED"


def test_corrupt_ledger_blocks_dispatch(tmp_path: Path) -> None:
    directory = tmp_path / "jobs/old"
    directory.mkdir(parents=True)
    (directory / "claim.json").write_text("partial")
    with pytest.raises(ValueError):
        r.run(directory.parent, evidence(tmp_path), "daily", NOW)


def test_schema_and_credential_url_rejection() -> None:
    with pytest.raises(ValidationError):
        r.Source(url="https://user:password@example.com", title="x", claim="x", limitation="x")
    assert r.Proposal.model_json_schema()["additionalProperties"] is False


def test_publication_never_overwrites(tmp_path: Path) -> None:
    path = tmp_path / "report.json"
    r.publish(path, {"original": True})
    with pytest.raises(FileExistsError):
        r.publish(path, {"original": False})
    assert json.loads(path.read_bytes()) == {"original": True}


def test_actual_runner_refuses_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(r.os, "geteuid", lambda: 0)
    with pytest.raises(ValueError, match="DEDICATED_USER"):
        r.codex_proposal("fixture", tmp_path)


def test_export_projection_drops_individual_rows_and_private_fields() -> None:
    from python.research.prepare_evidence import project

    payload = {
        "reportVersion": "demo-learning-1.0",
        "label": "OBSERVED_DEMO_NOT_BACKTEST_OR_PROFITABILITY_EVIDENCE",
        "strategyVersion": "fixture",
        "from": "2026-10-18T00:00:00Z",
        "until": "2026-10-19T00:00:00Z",
        "providerCost": None,
        "summary": {
            "trades": 1,
            "wins": 0,
            "matchedCloseEvidence": 0,
            "netPnl": "-2",
            "grossPnl": "1",
            "signedCosts": "-3",
            "observations": [{"private": "never-send"}],
        },
        "account_id": "never-send",
    }
    result = project(payload)
    assert "never-send" not in result.model_dump_json()
    assert result.matched_cost_records == 0
    payload["reportVersion"] = "unknown"
    with pytest.raises(ValueError):
        project(payload)


def test_weekly_candidate_requires_sources_and_stays_unevaluated(tmp_path: Path) -> None:
    body = json.loads(proposal())
    candidate = {
        "hypothesis": "Fixture",
        "single_change": "One completed-candle rule",
        "causal_entry_rule": "Use only confirmed past swing",
        "baseline": "Unchanged",
        "evaluation_plan": "Future predeclared window",
        "rejection_criteria": "Missing evidence",
        "sources": [
            {
                "url": "https://example.org/research",
                "title": "Fixture source",
                "claim": "Unverified hypothesis",
                "limitation": "Not validation",
            }
        ],
    }
    body["candidates"] = [candidate]
    directory = tmp_path / "jobs"
    source = evidence(tmp_path)
    assert r.run(directory, source, "weekly", NOW, lambda *_: r.encoded(body)) == "PROPOSAL_ONLY"
    assert r.run(directory, source, "daily", NOW, lambda *_: r.encoded(body)) == "FAILED_OR_UNKNOWN"
    candidate["sources"] = []
    with pytest.raises(ValidationError):
        r.Proposal.model_validate(body)


def test_committed_schemas_match_runtime_contracts() -> None:
    for name, model in (
        ("evidence", r.Evidence),
        ("proposal", r.Proposal),
        ("report", r.Report),
    ):
        schema = Path(f"schemas/codex-research-{name}-1.0.json")
        assert json.loads(schema.read_bytes()) == model.model_json_schema()


def test_cli_environment_is_allowlisted_and_failed_exit_rejected(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(r.os, "geteuid", lambda: 1001)
    monkeypatch.setattr(r.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("DATABASE_URL", "must-not-be-inherited")
    job = tmp_path / "job"
    job.mkdir()

    class Process:
        returncode = 1

        def communicate(self, data: bytes, timeout: int) -> None:
            assert data == b"JOB: weekly\n"
            assert timeout == 180

    def spawn(command: list[str], **kwargs: Any) -> Process:
        assert kwargs["env"] == {
            "HOME": str(tmp_path),
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "LANG": "C.UTF-8",
        }
        assert kwargs["start_new_session"] is True
        assert "--ignore-user-config" in command and "read-only" in command
        assert 'web_search="live"' in command
        return Process()

    monkeypatch.setattr(r.subprocess, "Popen", spawn)
    with pytest.raises(ValueError, match="CODEX_FAILED"):
        r.codex_proposal("JOB: weekly\n", job)


def test_cli_timeout_kills_process_group(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(r.os, "geteuid", lambda: 1001)
    monkeypatch.setattr(r.Path, "home", lambda: tmp_path)
    killed = []

    class Process:
        pid = 12345
        calls = 0

        def communicate(self, *_: Any, **__: Any) -> None:
            self.calls += 1
            if self.calls == 1:
                raise r.subprocess.TimeoutExpired("codex", 180)

    monkeypatch.setattr(r.subprocess, "Popen", lambda *_, **__: Process())
    monkeypatch.setattr(r.os, "killpg", lambda pid, sig: killed.append((pid, sig)))
    with pytest.raises(ValueError, match="CODEX_TIMEOUT"):
        r.codex_proposal("JOB: daily\n", tmp_path)
    assert killed == [(12345, r.signal.SIGKILL)]
