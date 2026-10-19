from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from python.research.candidate_lab import Lab, sha

NOW = datetime(2026, 10, 19, 12, tzinfo=UTC)
HASH = "1" * 64


def proposal(path: Path) -> Path:
    candidate = {
        key: "Explicit fixture hypothesis and rule"
        for key in [
            "hypothesis",
            "single_change",
            "causal_entry_rule",
            "baseline",
            "evaluation_plan",
            "rejection_criteria",
        ]
    }
    candidate["sources"] = [
        {
            "url": "https://example.org/fixture",
            "title": "Fixture source",
            "claim": "Fixture claim only",
            "limitation": "Not real economic evidence",
        }
    ]  # type: ignore[assignment]
    body = {
        "version": "codex-research-report-1.0",
        "status": "PROPOSAL_ONLY",
        "decision": "HOLD",
        "brokerAuthority": False,
        "promotionAuthority": False,
        "evaluationPerformed": False,
        "sourceVerification": "MODEL_REPORTED_NOT_INDEPENDENT",
        "proposal": {
            "summary": "Fixture",
            "evidence_limits": ["Synthetic"],
            "candidates": [candidate],
        },
    }
    path.write_text(json.dumps(body))
    return path


def prepare(tmp_path: Path) -> tuple[Lab, list[datetime], dict[str, Any]]:
    times = [NOW]
    lab = Lab(tmp_path / "lab", clock=lambda: times[0], fingerprint=lambda: HASH)
    result = lab.ingest(proposal(tmp_path / "report.json"))
    hypothesis = result["body"]["candidates"][0]["hypothesis_sha256"]
    source = tmp_path / "source.txt"
    source.write_text("Independently inspected synthetic fixture source, not evidence.")
    reviewed = lab.review_source(
        hypothesis,
        "https://example.org/fixture",
        source,
        reviewer="fixture-reviewer",
        rationale="Synthetic review explicitly performed for this test only.",
        retrieved_at=NOW.isoformat(),
    )
    assert reviewed["kind"] == "SOURCE_REVIEWED"
    registration = lab.register(
        hypothesis,
        "model_levels",
        (NOW + timedelta(hours=1)).isoformat(),
        reviewer="fixture-reviewer",
        rejection_rule="Reject incomplete economics; no promotion from complete subsets.",
    )
    assert registration["kind"] == "REGISTERED"
    return lab, times, registration


def export(path: Path, registration: dict[str, Any]) -> Path:
    start = datetime.fromisoformat(registration["body"]["start"])
    body = {
        "label": "PAIRED_REPLAY_INPUT_V1",
        "release": "0.3.0-fade-limit.3",
        "from": start.isoformat(),
        "until": (start + timedelta(days=1)).isoformat(),
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
        "economics": None,
        "setups": [],
    }
    path.write_text(json.dumps(body))
    return path


def replay(*_: Any) -> dict[str, Any]:
    return {"decision": "HOLD", "broker_authority": False, "net_pnl": None, "input_setups": 0}


def test_ingestion_keeps_duplicates_and_failed_inputs(tmp_path: Path) -> None:
    lab = Lab(tmp_path / "lab", clock=lambda: NOW, fingerprint=lambda: HASH)
    path = proposal(tmp_path / "report.json")
    first = lab.ingest(path)
    second = lab.ingest(path)
    assert not first["body"]["candidates"][0]["duplicate"]
    assert second["body"]["candidates"][0]["duplicate"]
    path.write_text("broken")
    failed = lab.ingest(path)
    assert failed["kind"] == "INGEST_FAILED" and failed["body"]["input_sha256"] is not None
    assert sum(e["kind"] == "INGEST_ATTEMPT" for e in lab.events()) == 3
    lab.close()
    resumed = Lab(tmp_path / "lab", clock=lambda: NOW, fingerprint=lambda: HASH)
    assert len(resumed.events()) == 6
    resumed.close()


def test_ledger_rejects_mutation(tmp_path: Path) -> None:
    lab, _, _ = prepare(tmp_path)
    with pytest.raises(sqlite3.DatabaseError, match="APPEND_ONLY"):
        lab.db.execute("UPDATE events SET kind='WINNER'")
    with pytest.raises(sqlite3.DatabaseError, match="APPEND_ONLY"):
        lab.db.execute("DELETE FROM events")
    lab.close()


def test_registration_requires_all_source_reviews_and_future_window(tmp_path: Path) -> None:
    lab = Lab(tmp_path / "lab", clock=lambda: NOW, fingerprint=lambda: HASH)
    proposed = lab.ingest(proposal(tmp_path / "report.json"))
    h = proposed["body"]["candidates"][0]["hypothesis_sha256"]
    result = lab.register(
        h,
        "model_levels",
        (NOW + timedelta(hours=1)).isoformat(),
        reviewer="fixture",
        rejection_rule="Explicit reviewed rejection conditions.",
    )
    assert result["kind"] == "REGISTRATION_FAILED"
    assert not list((tmp_path / "lab").glob("registration-*"))
    lab.close()


def test_no_backdating_or_duplicate_protocol(tmp_path: Path) -> None:
    lab, _, reg = prepare(tmp_path)
    for start in [NOW - timedelta(hours=1), NOW + timedelta(hours=2)]:
        result = lab.register(
            reg["body"]["hypothesis"],
            "model_levels",
            start.isoformat(),
            reviewer="fixture",
            rejection_rule="Explicit reviewed rejection conditions.",
        )
        assert result["kind"] == "REGISTRATION_FAILED"
    assert sum(e["kind"] == "REGISTERED" for e in lab.events()) == 1
    lab.close()


def test_future_wait_then_frozen_daily_report_without_replay(tmp_path: Path) -> None:
    lab, times, reg = prepare(tmp_path)
    source = export(tmp_path / "input.json", reg)
    assert (
        lab.evaluate(reg["seq"], 0, source, (tmp_path,), runner=replay)["kind"] == "EVALUATION_WAIT"
    )
    assert not any(e["kind"] == "EVALUATION_ATTEMPT" for e in lab.events())
    times[0] = NOW + timedelta(days=1, hours=1, minutes=10)
    assert lab.evaluate(reg["seq"], 0, source, (tmp_path,), runner=replay)["kind"] == "EVALUATED"
    report = tmp_path / "lab" / f"evaluation-{reg['seq']}-0.json"
    raw = report.read_bytes()
    result = lab.evaluate(
        reg["seq"], 0, source, (tmp_path,), runner=lambda *_: pytest.fail("no replay")
    )
    assert result["kind"] == "EVALUATION_FAILED" and report.read_bytes() == raw
    lab.review_packet(tmp_path / "packet.json")
    packet = json.loads((tmp_path / "packet.json").read_bytes())
    assert packet["decision"] == "HOLD" and packet["counterfactual_net_pnl"] is None
    assert packet["event_counts"]["EVALUATION_FAILED"] == 1
    assert reg["body"]["family_variants"] == 3
    lab.close()


@pytest.mark.parametrize("fault", ["code", "source", "registration", "window", "authority"])
def test_evidence_failures_stay_visible(tmp_path: Path, fault: str) -> None:
    lab, times, reg = prepare(tmp_path)
    source = export(tmp_path / "input.json", reg)
    times[0] = NOW + timedelta(days=1, hours=1, minutes=10)
    if fault == "code":
        lab.fingerprint = lambda: "2" * 64
    if fault == "source":
        next((tmp_path / "lab").glob("source-*.json")).write_text("{}")
    if fault == "registration":
        (tmp_path / "lab" / f"registration-{reg['seq']}.json").write_text("{}")
    if fault == "window":
        body = json.loads(source.read_text())
        body["until"] = (times[0] + timedelta(days=1)).isoformat()
        source.write_text(json.dumps(body))
    runner = (lambda *_: {**replay(), "broker_authority": True}) if fault == "authority" else replay
    assert (
        lab.evaluate(reg["seq"], 0, source, (tmp_path,), runner=runner)["kind"]
        == "EVALUATION_FAILED"
    )
    assert not list((tmp_path / "lab").glob(f"evaluation-{reg['seq']}-*.json"))
    if fault in ("window", "authority"):
        assert list((tmp_path / "lab").glob("evaluation-input-*.json"))
        assert any(e["kind"] == "EVALUATION_INPUT" for e in lab.events())
    lab.close()


def test_actual_paired_engine_retains_full_empty_denominator(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from python.research import candidate_lab as module

    lab, times, reg = prepare(tmp_path)
    source = export(tmp_path / "input.json", reg)
    times[0] = NOW + timedelta(days=1, hours=1, minutes=10)
    monkeypatch.setattr(module.paired, "load_tape", lambda *_: module.paired.Tape([], [], [], {}))
    assert lab.evaluate(reg["seq"], 0, source, (tmp_path,))["kind"] == "EVALUATED"
    report = json.loads((tmp_path / "lab" / f"evaluation-{reg['seq']}-0.json").read_text())
    assert report["result"]["input_setups"] == 0
    assert report["result"]["valid_setups"] == 0
    assert len(report["result"]["comparisons"]) == 2
    assert report["result"]["net_pnl"] is None
    assert report["result"]["decision"] == "HOLD"
    lab.close()


def test_unknown_ledger_version_is_not_migrated(tmp_path: Path) -> None:
    directory = tmp_path / "lab"
    directory.mkdir()
    db = sqlite3.connect(directory / "trials.sqlite3")
    db.execute("PRAGMA user_version=2")
    db.close()
    with pytest.raises(ValueError, match="VERSION_UNSUPPORTED"):
        Lab(directory)


def test_scanner_retains_generation_failure_and_is_idempotent(tmp_path: Path) -> None:
    lab = Lab(tmp_path / "lab", clock=lambda: NOW, fingerprint=lambda: HASH)
    root = tmp_path / "jobs"
    root.mkdir()
    for name, kind in [("daily-2026-10-19", "daily"), ("weekly-2026-W43", "weekly")]:
        job = root / name
        job.mkdir()
        claim = {
            "at": NOW.isoformat(),
            "kind": kind,
            "input_sha256": HASH,
            "source_input_sha256": HASH,
            "prompt_sha256": HASH,
            "worker_sha256": HASH,
        }
        evidence = {
            "version": "research-evidence-1.0",
            "mode": "demo",
            "release": "fixture",
            "start": (NOW - timedelta(days=1)).isoformat(),
            "end": NOW.isoformat(),
            "closed_trades": 0,
            "wins": 0,
            "matched_cost_records": 0,
            "net_pnl": None,
            "gross_pnl": None,
            "signed_costs": None,
            "provider_cost": None,
        }
        evidence_raw = json.dumps(evidence).encode()
        (job / "evidence.json").write_bytes(evidence_raw)
        claim["input_sha256"] = sha(evidence_raw)
        (job / "claim.json").write_text(json.dumps(claim))
        if kind == "daily":
            file = proposal(job / "report.json")
            report = json.loads(file.read_text())
            report["proposal"]["candidates"] = []
            file.write_text(json.dumps(report))
        else:
            (job / "failure.json").write_text(
                json.dumps(
                    {
                        "status": "FAILED_OR_UNKNOWN",
                        "decision": "HOLD",
                        "retry": False,
                        "reason": "RESEARCH_PROVIDER_OR_OUTPUT_FAILURE",
                    }
                )
            )
    assert lab.scan(root)["imported"] == 2
    assert lab.scan(root)["imported"] == 0
    assert sum(e["kind"] == "PROPOSAL_GENERATION_FAILED" for e in lab.events()) == 1
    assert sum(e["kind"] == "PROPOSALS" for e in lab.events()) == 1
    lab.close()


def test_packet_marks_crashed_claim_unknown_and_rejects_promotion_schema(tmp_path: Path) -> None:
    from jsonschema import Draft202012Validator, ValidationError

    lab = Lab(tmp_path / "lab", clock=lambda: NOW, fingerprint=lambda: HASH)
    lab.append("EVALUATION_ATTEMPT", {"registration": 1, "day": 0})
    output = tmp_path / "packet.json"
    lab.review_packet(output)
    packet = json.loads(output.read_text())
    schema = json.loads(Path("schemas/candidate-review-packet-1.0.json").read_text())
    validator = Draft202012Validator(schema)
    validator.validate(packet)
    assert packet["unfinished_attempts"]["EVALUATION_ATTEMPT"] == 1
    packet["promotion_authority"] = True
    with pytest.raises(ValidationError):
        validator.validate(packet)
    lab.close()
