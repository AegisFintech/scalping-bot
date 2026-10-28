from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from python.backtest import scalp_replay as replay
from python.codex_entry.service import PayloadScalp
from python.research.learning_evidence import LearningEvidence, encoded, identity, revised
from tests.python.test_codex_entry import NOW
from tests.python.test_codex_memory import level_request
from tests.python.test_learning_bridge import packet, wait_record

KEY = "c" * 24


def at(seconds: int) -> str:
    return (NOW + timedelta(seconds=seconds)).isoformat()


def market() -> dict[str, Any]:
    body = level_request().payload.model_dump()
    body.update(pip_size="0.01", maximum_stop_distance="7", minimum_protection_distance="0.01")
    for frame in body["candles"]:
        period = {"M1": 60, "M5": 300, "M15": 900}[frame["timeframe"]]
        count = 5 if frame["timeframe"] == "M1" else 2
        frame["rows"] = [
            [
                at((i - count) * period),
                at((i - count + 1) * period),
                "4000",
                "4002",
                "3999",
                str(4000 + min(i, 1)),
                "100",
                True,
                [],
            ]
            for i in range(count)
        ]
    return PayloadScalp.model_validate(body).model_dump()


def fixture() -> dict[str, Any]:
    context = wait_record()
    context.pop("revisionSha256")
    context.update(
        capturedAt=at(0),
        requestedAt=at(1),
        completedAt=at(5),
        availableAt=at(5),
        validUntil=at(120),
        decision="BUY",
        planSchema="entry-scalp-1.0",
        entryPrice="4002",
        takeProfit="4002.4",
        stopLoss="3995",
        pendingSeconds=120,
        market=market(),
    )
    context = revised(context)
    order = identity("order")
    group = revised(
        {
            "id": KEY,
            "originRelease": replay.RELEASE,
            "recordedCodeHash": None,
            "recordedConfigHash": None,
            "cohortRole": "OBSERVED_WINDOW",
            "analysisId": identity("analysis-fixture"),
            "contextId": context["id"],
            "state": "PENDING",
            "executionMode": "SINGLE_STOP_LIMIT",
            "timeInForce": "GTD",
            "createdAt": at(6),
            "updatedAt": at(7),
            "expiresAt": at(120),
            "submissionValidUntil": at(120),
            "accountCurrency": "USD",
            "volumeScaleAsOfExport": "0.01",
            "metadataObservedAt": at(600),
            "orders": [
                {
                    "id": order,
                    "side": "BUY",
                    "state": "PENDING",
                    "orderType": "STOP_LIMIT",
                    "timeInForce": "GTD",
                    "entryPrice": "4002.0000000000",
                    "stopLoss": "3995",
                    "takeProfit": "4002.4",
                    "approvedVolume": "20",
                    "filledVolume": "0",
                    "expiresAt": at(120),
                    "submissionValidUntil": at(120),
                    "placementResultPersistedAt": at(8),
                    "updatedAt": at(8),
                }
            ],
            "fills": [],
            "brokerEvents": [
                {
                    "id": identity("event"),
                    "payloadSha256": "a" * 64,
                    "executionType": 2,
                    "mappingState": "MAPPED",
                    "closingOrder": False,
                    "orderType": 6,
                    "orderId": order,
                    "positionId": None,
                    "occurredAt": at(7),
                    "receivedAt": at(8),
                    "persistedAt": at(9),
                    "resolvedAt": None,
                    "reasonCodes": [],
                    "clockStatus": "CAUSAL",
                }
            ],
            "currentProtection": [],
            "protectionHistory": [],
            "protectionHistoryStart": at(-60),
            "protectionHistoryComplete": True,
            "brokerVariants": [],
            "variantCoverage": "RETAINED_ONLY_MISSING_LEGACY_VARIANTS_NOT_RECONSTRUCTED",
            "closeDeals": [],
            "closedTrades": [],
        }
    )
    return packet(
        contexts=[context],
        setups=[group],
        start=at(-60),
        until=at(600),
        journalSnapshotAt=at(601),
        exportedAt=at(660),
    )


def model(value: dict[str, Any]) -> LearningEvidence:
    value = deepcopy(value)
    for family in ("contexts", "setups"):
        for i, row in enumerate(value[family]):
            row.pop("revisionSha256", None)
            value[family][i] = revised(row)
    return LearningEvidence.model_validate(value)


def run(value: dict[str, Any]) -> replay.ReplayReport:
    return replay.replay(model(value), "f" * 64)


def fill(value: dict[str, Any], volume: str = "10") -> None:
    group = value["setups"][0]
    group["orders"][0]["filledVolume"] = volume
    group["fills"] = [
        {
            "id": identity("fill"),
            "orderId": group["orders"][0]["id"],
            "positionId": identity("position"),
            "price": "4002.1",
            "volume": volume,
            "commission": "-0.35",
            "occurredAt": at(10),
            "receivedAt": at(11),
            "clockStatus": "CAUSAL",
        }
    ]
    group["currentProtection"] = [
        {
            "positionId": identity("position"),
            "side": "BUY",
            "positionState": "OPEN",
            "volume": volume,
            "entryPrice": "4002.1",
            "brokerStopLoss": "3995.1",
            "brokerTakeProfit": "4002.5",
            "status": "VERIFIED",
            "observedAt": at(12),
            "basis": "CURRENT_OBSERVATION_NOT_HISTORICAL_FILL_ATTRIBUTION",
        }
    ]


def quote(seconds: int, ask: str) -> tuple[str, dict[str, Any]]:
    return "BROKER_QUOTE", {
        "kind": "QUOTE",
        "sourceTime": at(seconds),
        "receivedAt": at(seconds),
        "bid": str(Decimal(ask) - Decimal("0.1")),
        "ask": ask,
        "bidUpdated": True,
        "askUpdated": True,
    }


def chain(
    tmp_path: Path, value: dict[str, Any], quotes: list[tuple[str, dict[str, Any]]]
) -> replay.PathCompanion:
    group = value["setups"][0]
    rows = [
        (
            "START",
            {
                "setup": {"setup": KEY, "originRelease": replay.RELEASE},
                "coverageStart": at(6),
                "carryIn": False,
                "completeTickTape": False,
            },
        ),
        *quotes,
    ]
    previous, lines = "0" * 64, []
    observed = at(6)
    for i, (kind, payload) in enumerate(rows, 1):
        observed = max(observed, payload.get("receivedAt", observed))
        record = {
            "kind": kind,
            "payload": payload,
            "sequence": i,
            "previous": previous,
            "observedAt": observed,
        }
        previous = hashlib.sha256(encoded(record)).hexdigest()
        lines.append(encoded({**record, "sha256": previous}))
    path = tmp_path / f"flight-{group['id']}-20261019T120000000000-0000.jsonl"
    path.write_bytes(b"\n".join(lines) + b"\n")
    return replay.PathCompanion.model_validate(
        {
            "schemaVersion": "scalp-replay-paths-1.0",
            "packetSha256": "f" * 64,
            "sessions": [
                {
                    "setupId": KEY,
                    "files": [
                        {"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    ],
                }
            ],
            "declaredRangeTicks": 30,
            "rangeBasis": "DECLARED_HYPOTHESIS_NOT_BROKER_ACK",
            "brokerAuthority": False,
        }
    )


def test_decimal_equivalent_intent_is_not_a_false_mismatch() -> None:
    result = run(fixture())
    assert result.setups[0].state == "UNFILLED_PENDING"
    assert "APPROVED_INTENT_CONTEXT_MISMATCH" not in result.setups[0].reasons
    assert result.recommendation == "HOLD" and result.counterfactualNet is None


def test_wait_and_failure_remain_in_denominators() -> None:
    value = fixture()
    context = value["contexts"][0]
    context.update(
        decision="WAIT",
        planSchema="entry-wait-1.0",
        entryPrice=None,
        stopLoss=None,
        takeProfit=None,
        pendingSeconds=None,
    )
    value["setups"] = []
    result = run(value)
    assert result.counts["decision_WAIT"] == 1 and len(result.benchmark) == 1
    assert result.benchmark[0].decision == "BUY" and result.benchmark[0].counterfactualNet is None


def test_partial_fill_survives_pending_expiry_without_closing_exposure() -> None:
    value = fixture()
    fill(value)
    group = value["setups"][0]
    group["orders"][0]["state"] = "EXPIRED"
    group["brokerEvents"][0].update(
        executionType=6, occurredAt=at(120), receivedAt=at(121), persistedAt=at(122)
    )
    result = run(value).setups[0]
    assert result.state == "PARTIAL_OPEN" and result.filledVolume == "10"
    assert result.gtdAcknowledgement == "NOT_RETAINED"


def test_real_fill_without_pending_ack_is_not_discarded() -> None:
    value = fixture()
    fill(value, "20")
    value["setups"][0]["brokerEvents"] = []
    result = run(value).setups[0]
    assert result.state == "OPEN" and result.uniqueEntryFills == 1
    assert result.path.activationAt is None


def test_zero_fill_needs_exact_terminal_broker_evidence() -> None:
    value = fixture()
    value["setups"][0]["orders"][0]["state"] = "CANCELLED"
    assert run(value).setups[0].state == "UNKNOWN"
    value["setups"][0]["brokerEvents"][0]["executionType"] = 5
    value["setups"][0]["state"] = "CLOSED"
    assert run(value).setups[0].state == "ZERO_FILL_TERMINAL"


def test_fees_are_not_deducted_twice_from_recorded_net() -> None:
    value = fixture()
    fill(value, "20")
    group = value["setups"][0]
    group["state"] = "CLOSED"
    group["currentProtection"][0]["positionState"] = "CLOSED"
    group["closedTrades"] = [
        {
            "id": identity("trade"),
            "direction": "LONG",
            "realizedNet": "1.3",
            "signedFees": "-0.7",
            "openedAt": at(10),
            "closedAt": at(30),
        }
    ]
    result = run(value).setups[0]
    assert result.recordedClosedNet == "1.3"


def test_duplicate_and_conflicting_fill_do_not_inflate_volume() -> None:
    value = fixture()
    fill(value)
    group = value["setups"][0]
    group["fills"].append(deepcopy(group["fills"][0]))
    assert run(value).setups[0].filledVolume == "10"
    group["fills"][1]["price"] = "4002.2"
    assert run(value).setups[0].state == "UNKNOWN"


def test_benchmark_is_completed_trend_entry_not_reversal() -> None:
    value = fixture()
    result = run(value).benchmark[0]
    assert result.decision == "BUY" and result.entry == "4002.01"
    value["contexts"][0]["market"]["candles"][2]["rows"][-1][5] = "3999"
    assert run(value).benchmark[0].decision == "WAIT"


def test_summary_alone_never_establishes_execution_path() -> None:
    result = run(fixture()).setups[0].path
    assert result.status == "UNAVAILABLE" and result.counterfactualFill is None


def test_stop_activation_then_return_into_limit_is_only_sampled_eligibility(tmp_path: Path) -> None:
    value = fixture()
    comp = chain(tmp_path, value, [quote(8, "4002.5"), quote(9, "4002.2")])
    paths = replay.load_paths(comp, tmp_path, model(value))
    result = replay.replay(model(value), "f" * 64, sessions=paths, range_ticks=30).setups[0].path
    assert result.activationAt == at(8) and result.limitEligibleAt == at(9)
    assert result.counterfactualFill is None and result.counterfactualNet is None
    assert result.brokerRangeAcknowledgement == "NOT_RETAINED"


def test_gap_and_missing_side_update_remain_censored(tmp_path: Path) -> None:
    value = fixture()
    after = quote(10, "4002.2")
    after[1]["bidUpdated"] = False
    comp = chain(tmp_path, value, [quote(8, "4002.5"), ("GAP", {"reason": "FIXTURE"}), after])
    paths = replay.load_paths(comp, tmp_path, model(value))
    result = replay.replay(model(value), "f" * 64, sessions=paths, range_ticks=30).setups[0].path
    assert result.status == "CENSORED" and result.limitEligibleAt is None


def test_mutated_chain_is_rejected_before_quote_diagnostics(tmp_path: Path) -> None:
    value = fixture()
    comp = chain(tmp_path, value, [quote(8, "4002.5")])
    path = tmp_path / comp.sessions[0].files[0].name
    path.write_bytes(path.read_bytes().replace(b"4002.5", b"4002.6"))
    with pytest.raises(ValueError, match="HASH_OR_BOUNDS"):
        replay.load_paths(comp, tmp_path, model(value))


def test_historical_snapshots_cannot_be_backdated_to_an_earlier_cutoff() -> None:
    with pytest.raises(ValueError, match="CUTOFF"):
        replay.replay(model(fixture()), "f" * 64, cutoff=at(600))


def test_recorded_trade_without_complete_position_proof_is_not_closed() -> None:
    value = fixture()
    fill(value, "20")
    group = value["setups"][0]
    group["currentProtection"] = []
    group["closedTrades"] = [
        {
            "id": identity("trade"),
            "direction": "LONG",
            "realizedNet": "1.3",
            "signedFees": "-0.7",
            "openedAt": at(10),
            "closedAt": at(30),
        }
    ]
    assert run(value).setups[0].state == "UNKNOWN"
    assert "CLOSURE_PROOF_INCOMPLETE" in run(value).setups[0].reasons


def test_mapped_broker_reason_without_resolution_remains_unknown() -> None:
    value = fixture()
    value["setups"][0]["brokerEvents"][0]["reasonCodes"] = ["BROKER_STATE_UNCERTAIN"]
    assert run(value).setups[0].state == "UNKNOWN"


def test_admission_before_model_availability_is_not_repaired() -> None:
    value = fixture()
    value["setups"][0]["createdAt"] = at(3)
    assert "ADMISSION_CHRONOLOGY_INVALID" in run(value).setups[0].reasons
    assert run(value).setups[0].state == "UNKNOWN"


def test_exact_expiry_quote_is_ambiguous_not_a_favorable_fill(tmp_path: Path) -> None:
    value = fixture()
    comp = chain(tmp_path, value, [quote(120, "4002")])
    paths = replay.load_paths(comp, tmp_path, model(value))
    result = replay.replay(model(value), "f" * 64, sessions=paths, range_ticks=30).setups[0].path
    assert result.status == "CENSORED"
    assert "PATH_BOUNDARY_ORDER_AMBIGUOUS" in result.reasons
    assert result.activationAt is None and result.counterfactualFill is None


def test_m5_session_gap_cannot_define_a_trend() -> None:
    value = fixture()
    frame = value["contexts"][0]["market"]["candles"][1]
    frame["rows"][0][0] = at(-1200)
    frame["rows"][0][1] = at(-900)
    frame["rows"][1][8] = ["BROKER_SESSION_GAP_BEFORE"]
    result = run(value).benchmark[0]
    assert result.decision == "WAIT" and result.reasons == ["BASELINE_TREND_SESSION_GAP"]


def draft() -> replay.EvaluationDraft:
    return replay.EvaluationDraft.model_validate(
        {
            "schemaVersion": "scalp-evaluation-draft-1.0",
            "status": "DRAFT_NOT_REGISTERED",
            "sourceSha256": hashlib.sha256(Path(replay.__file__).read_bytes()).hexdigest(),
            "periods": [
                {"partition": label, "start": at(i * 1000), "until": at(i * 1000 + 100)}
                for i, label in enumerate(("DEVELOPMENT", "VALIDATION", "HOLDOUT"))
            ],
            "purgeSeconds": 60,
            "embargoSeconds": 60,
            "candidates": [
                {
                    "id": "trend-entry-1",
                    "codeSha256": "f" * 64,
                    "changedRule": "ENTRY_ONLY",
                    "hypothesis": "A fixed causal entry comparison; no financial qualification.",
                }
            ],
            "declaredAttemptIds": ["trend-entry-1"],
            "primaryMetric": "AFTER_COST_EXPECTANCY_WHEN_IDENTIFIABLE",
            "uncertainty": "CORRELATED_CONTEXT_BLOCKS_REQUIRES_REVIEW",
            "multipleTesting": "ALL_DECLARED_ATTEMPTS_REQUIRES_REVIEW",
            "numericalThresholds": None,
            "operatorThresholdReview": "PENDING",
            "registrationAuthority": False,
            "promotionAuthority": False,
            "brokerAuthority": False,
        }
    )


def test_draft_cannot_claim_registration_or_threshold_approval() -> None:
    value = draft().model_dump()
    value["status"] = "REGISTERED"
    with pytest.raises(ValueError):
        replay.EvaluationDraft.model_validate(value)
    value = draft().model_dump()
    value["operatorThresholdReview"] = "APPROVED"
    with pytest.raises(ValueError):
        replay.EvaluationDraft.model_validate(value)


def test_draft_rejects_overlapping_partitions_and_missing_attempts() -> None:
    value = draft().model_dump()
    value["periods"][1]["start"] = at(150)
    with pytest.raises(ValueError, match="CHRONOLOGY"):
        replay.EvaluationDraft.model_validate(value)
    value = draft().model_dump()
    value["declaredAttemptIds"] = ["another-attempt"]
    with pytest.raises(ValueError, match="ATTEMPT_INVENTORY"):
        replay.EvaluationDraft.model_validate(value)


def test_source_drift_halts_benchmark_but_keeps_factual_denominators() -> None:
    changed = draft().model_dump()
    changed["sourceSha256"] = "0" * 64
    result = replay.replay(
        model(fixture()), "f" * 64, draft=replay.EvaluationDraft.model_validate(changed)
    )
    assert result.benchmark == [] and result.counts["contexts"] == 1
    assert (
        "DRAFT_SOURCE_DRIFT_RESEARCH_HALTED" in result.reasons and result.recommendation == "HOLD"
    )


def test_recorded_closed_statistics_include_fees_once_and_keep_the_official_cohort() -> None:
    value = fixture()
    fill(value, "20")
    value["setups"][0]["closedTrades"] = [
        {
            "id": identity("trade" + str(i)),
            "direction": "LONG",
            "realizedNet": net,
            "signedFees": "-0.7",
            "openedAt": at(10),
            "closedAt": at(30 + i),
        }
        for i, net in enumerate(("1.3", "-2", "0"))
    ]
    result = run(value)
    summary = result.recordedClosedStatistics[0]
    assert summary.records == 3 and summary.recordedNet == "-0.7"
    assert summary.wins == summary.losses == summary.breakeven == 1
    assert summary.meanWin == "1.3" and summary.meanLoss == "-2"
    assert summary.withoutLargestWinnerDiagnostic == "-2.0"
    assert result.counts["setups"] == 1 and result.portfolioDrawdown is None


def test_sampled_exit_uses_prior_protection_not_future_or_current_values(tmp_path: Path) -> None:
    value = fixture()
    fill(value, "20")
    group = value["setups"][0]
    group["protectionHistory"] = [
        {
            "id": identity("protection"),
            "positionId": identity("position"),
            "kind": "OBSERVATION",
            "status": "VERIFIED",
            "stopLoss": "3995.1",
            "takeProfit": "4002.5",
            "observedAt": at(11),
            "persistedAt": at(11),
            "detailsSha256": "a" * 64,
        }
    ]
    comp = chain(tmp_path, value, [quote(12, "4002.7")])
    paths = replay.load_paths(comp, tmp_path, model(value))
    result = replay.replay(model(value), "f" * 64, sessions=paths, range_ticks=30).setups[0]
    assert result.exposure[0].firstObservedTpCrossingAt == at(12)
    assert result.exposure[0].observedMfePrice == "0.5"
    assert result.exposure[0].afterCostTimeToProfit is None
    group["protectionHistory"][0].update(observedAt=at(13), persistedAt=at(13))
    result = replay.replay(model(value), "f" * 64, sessions=paths, range_ticks=30).setups[0]
    assert result.exposure[0].firstObservedTpCrossingAt is None
    assert result.exposure[0].exitCause is None


def test_conflicting_prior_protection_cannot_prove_tp_crossing(tmp_path: Path) -> None:
    value = fixture()
    fill(value, "20")
    group = value["setups"][0]
    row = {
        "id": identity("protectA"),
        "positionId": identity("position"),
        "kind": "OBSERVATION",
        "status": "VERIFIED",
        "stopLoss": "3995.1",
        "takeProfit": "4002.5",
        "observedAt": at(11),
        "persistedAt": at(11),
        "detailsSha256": "a" * 64,
    }
    group["protectionHistory"] = [row, {**row, "id": identity("protectB"), "takeProfit": "4003"}]
    comp = chain(tmp_path, value, [quote(12, "4002.7")])
    paths = replay.load_paths(comp, tmp_path, model(value))
    result = (
        replay.replay(model(value), "f" * 64, sessions=paths, range_ticks=30).setups[0].exposure[0]
    )
    assert result.firstObservedTpCrossingAt is None
    assert "HISTORICAL_PROTECTION_CONFLICT" in result.reasons


def test_offline_cli_validates_hash_and_never_overwrites(tmp_path: Path) -> None:
    import subprocess
    import sys

    raw = encoded(model(fixture()).model_dump())
    source, result = tmp_path / "input.json", tmp_path / "result.json"
    source.write_bytes(raw)
    command = [
        sys.executable,
        "-m",
        "python.backtest.scalp_replay",
        "--input",
        str(source),
        "--sha256",
        hashlib.sha256(raw).hexdigest(),
        "--output",
        str(result),
    ]
    assert subprocess.run(command, capture_output=True, check=False).returncode == 0
    assert json.loads(result.read_bytes())["recommendation"] == "HOLD"
    assert subprocess.run(command, capture_output=True, check=False).returncode != 0
    result.unlink()
    command[command.index("--sha256") + 1] = "0" * 64
    assert subprocess.run(command, capture_output=True, check=False).returncode != 0
    assert not result.exists()


@pytest.mark.parametrize(
    "field,value",
    [("executionMode", "OCO"), ("expiresAt", at(119)), ("submissionValidUntil", at(119))],
)
def test_group_intent_mismatch_blocks_reconstruction(field: str, value: str) -> None:
    data = fixture()
    data["setups"][0][field] = value
    result = run(data).setups[0]
    assert result.state == "UNKNOWN" and "GROUP_INTENT_MISMATCH" in result.reasons


def test_position_remaining_volume_mismatch_stays_unknown() -> None:
    data = fixture()
    fill(data)
    data["setups"][0]["currentProtection"][0]["volume"] = "9"
    result = run(data).setups[0]
    assert result.state == "UNKNOWN" and "POSITION_EVIDENCE_INCOMPLETE" in result.reasons


def test_matching_group_and_order_deadlines_must_match_expiry() -> None:
    data = fixture()
    data["setups"][0]["submissionValidUntil"] = at(119)
    data["setups"][0]["orders"][0]["submissionValidUntil"] = at(119)
    result = run(data).setups[0]
    assert result.state == "UNKNOWN" and "GROUP_INTENT_MISMATCH" in result.reasons


def test_overlapping_sessions_keep_earliest_exposure_and_deduplicate(tmp_path: Path) -> None:
    data = fixture()
    fill(data, "20")
    later, earlier = tmp_path / "later", tmp_path / "earlier"
    later.mkdir()
    earlier.mkdir()
    first = chain(later, data, [quote(18, "4002.7")])
    second = chain(earlier, data, [quote(12, "4002.7"), quote(18, "4002.7")])
    packet = model(data)
    sessions = (
        replay.load_paths(first, later, packet)[KEY]
        + replay.load_paths(second, earlier, packet)[KEY]
    )
    result = replay.replay(packet, "f" * 64, sessions={KEY: sessions}, range_ticks=30)
    exposure = result.setups[0].exposure[0]
    assert exposure.firstObservedGrossPositiveAt == at(12)
    assert exposure.samples == 2


@pytest.mark.parametrize(
    "name,cls",
    [
        ("scalp-replay-report-1.0", replay.ReplayReport),
        ("scalp-evaluation-draft-1.0", replay.EvaluationDraft),
        ("scalp-replay-paths-1.0", replay.PathCompanion),
    ],
)
def test_published_schema_matches_model(name: str, cls: type) -> None:
    assert json.loads(Path("schemas", name + ".json").read_text()) == cls.model_json_schema()


def test_chain_is_verified_from_exact_hashed_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    value = fixture()
    companion = chain(tmp_path, value, [quote(8, "4002.5")])
    original_path = tmp_path / companion.sessions[0].files[0].name
    verify = replay.verify_records

    def replace_original(paths: list[Path]) -> list[dict[str, Any]]:
        original_path.write_bytes(b"changed after hashing")
        return verify(paths)

    monkeypatch.setattr(replay, "verify_records", replace_original)
    assert len(replay.load_paths(companion, tmp_path, model(value))[KEY][0]) == 2


def test_newer_uncertain_protection_censors_older_verified_crossing(tmp_path: Path) -> None:
    data = fixture()
    fill(data, "20")
    group = data["setups"][0]
    prior = {
        "id": identity("prior"),
        "positionId": identity("position"),
        "kind": "OBSERVATION",
        "status": "VERIFIED",
        "stopLoss": "3995.1",
        "takeProfit": "4002.5",
        "observedAt": at(11),
        "persistedAt": at(11),
        "detailsSha256": "a" * 64,
    }
    uncertain = {
        **prior,
        "id": identity("uncertain"),
        "status": "UNCERTAIN",
        "observedAt": None,
        "persistedAt": at(12),
    }
    group["protectionHistory"] = [prior, uncertain]
    comp = chain(tmp_path, data, [quote(13, "4002.7")])
    packet = model(data)
    sessions = replay.load_paths(comp, tmp_path, packet)
    exposure = (
        replay.replay(packet, "f" * 64, sessions=sessions, range_ticks=30).setups[0].exposure[0]
    )
    assert exposure.firstObservedTpCrossingAt is None
    assert "HISTORICAL_PROTECTION_STALE_OR_UNVERIFIED" in exposure.reasons


def test_terminal_event_conflicting_with_pending_order_is_unknown() -> None:
    data = fixture()
    data["setups"][0]["brokerEvents"][0]["executionType"] = 6
    result = run(data).setups[0]
    assert result.state == "UNKNOWN" and "TERMINAL_STATE_CONFLICT" in result.reasons


def test_sell_stop_limit_uses_bid_and_continuation_trend(tmp_path: Path) -> None:
    data = fixture()
    context = data["contexts"][0]
    context.update(decision="SELL", entryPrice="3998.99", stopLoss="4005.99", takeProfit="3998.59")
    context["market"]["entry_boundaries"]["sell_stop_maximum"] = "3999"
    for frame in context["market"]["candles"]:
        if frame["timeframe"] in {"M5", "M15"}:
            frame["rows"][-1][5] = "3999"
    order = data["setups"][0]["orders"][0]
    order.update(side="SELL", entryPrice="3998.99", stopLoss="4005.99", takeProfit="3998.59")
    packet = model(data)
    assert replay.replay(packet, "f" * 64).benchmark[0].decision == "SELL"
    companion = chain(tmp_path, data, [quote(8, "3998.7"), quote(9, "3998.9")])
    sessions = replay.load_paths(companion, tmp_path, packet)
    path = replay.replay(packet, "f" * 64, sessions=sessions, range_ticks=30).setups[0].path
    assert path.activationAt == at(8) and path.limitEligibleAt == at(9)
    assert (
        path.counterfactualFill is None
        and path.declaredRangeBasis == "DECLARED_HYPOTHESIS_NOT_BROKER_ACK"
    )


@pytest.mark.parametrize("field,value", [("stopLoss", "3994"), ("takeProfit", "4002.3")])
def test_changed_intent_protection_is_not_original_context(field: str, value: str) -> None:
    data = fixture()
    data["setups"][0]["orders"][0][field] = value
    result = run(data).setups[0]
    assert result.state == "UNKNOWN" and "APPROVED_INTENT_CONTEXT_MISMATCH" in result.reasons


def test_protection_observed_after_its_persistence_cannot_prove_crossing(tmp_path: Path) -> None:
    data = fixture()
    fill(data, "20")
    data["setups"][0]["protectionHistory"] = [
        {
            "id": identity("future-protection"),
            "positionId": identity("position"),
            "kind": "OBSERVATION",
            "status": "VERIFIED",
            "stopLoss": "3995.1",
            "takeProfit": "4002.5",
            "observedAt": at(12),
            "persistedAt": at(11),
            "detailsSha256": "a" * 64,
        }
    ]
    companion = chain(tmp_path, data, [quote(13, "4002.7")])
    packet = model(data)
    result = replay.replay(
        packet, "f" * 64, sessions=replay.load_paths(companion, tmp_path, packet), range_ticks=30
    )
    exposure = result.setups[0].exposure[0]
    assert exposure.firstObservedTpCrossingAt is None
    assert "HISTORICAL_PROTECTION_STALE_OR_UNVERIFIED" in exposure.reasons


def test_previous_release_context_never_authorizes_current_release_geometry() -> None:
    data = fixture()
    data["contexts"][0]["originRelease"] = "0.7.3-quick-oco.1-codex.2"
    result = run(data)
    assert result.setups[0].state == "UNKNOWN"
    assert "CONTEXT_RELEASE_MISMATCH" in result.setups[0].reasons
    assert result.benchmark[0].decision == "WAIT"
    assert result.benchmark[0].reasons == ["CONTEXT_RELEASE_UNSUPPORTED"]


def test_numeric_false_cannot_impersonate_authority_flag() -> None:
    value = draft().model_dump()
    value["brokerAuthority"] = 0
    with pytest.raises(ValueError, match="AUTHORITY_INVALID"):
        replay.EvaluationDraft.model_validate(value)
    report = run(fixture()).model_dump()
    report["promotionAuthority"] = 0
    with pytest.raises(ValueError, match="AUTHORITY_INVALID"):
        replay.ReplayReport.model_validate(report)


def test_trade_identity_reused_by_another_setup_is_rejected() -> None:
    data = fixture()
    group = data["setups"][0]
    group["closedTrades"] = [
        {
            "id": identity("trade"),
            "direction": "LONG",
            "realizedNet": "1.3",
            "signedFees": "-0.7",
            "openedAt": at(10),
            "closedAt": at(30),
        }
    ]
    other = deepcopy(group)
    other["id"] = identity("other-group")
    other["accountCurrency"] = "EUR"
    data["setups"].append(other)
    with pytest.raises(ValueError, match="CLOSED_TRADE_IDENTITY_CONFLICT"):
        run(data)


def test_high_precision_price_does_not_flip_a_loss_to_positive(tmp_path: Path) -> None:
    data = fixture()
    fill(data, "1")
    data["setups"][0]["fills"][0]["price"] = "12345678901234567890.0000000049"
    q = (
        "BROKER_QUOTE",
        {
            "kind": "QUOTE",
            "sourceTime": at(12),
            "receivedAt": at(12),
            "bid": "12345678901234567890.0000000010",
            "ask": "12345678901234567890.0000000020",
            "bidUpdated": True,
            "askUpdated": True,
        },
    )
    companion = chain(tmp_path, data, [q])
    packet = model(data)
    sessions = replay.load_paths(companion, tmp_path, packet)[KEY]
    result = replay.exposure_paths(packet.setups[0], sessions, packet.journalSnapshotAt)[0]
    assert result.firstObservedGrossPositiveAt is None
    assert Decimal(result.observedMaePrice or "0") == Decimal("0.0000000039")


def test_repeating_weighted_price_is_bounded_and_report_revalidates() -> None:
    data = fixture()
    fill(data, "3")
    group = data["setups"][0]
    first = group["fills"][0]
    first.update(volume="1", price="4002.01")
    group["fills"] = [
        first,
        {**first, "id": identity("fill-2"), "price": "4002.02"},
        {**first, "id": identity("fill-3"), "price": "4002.02"},
    ]
    report = run(data)
    assert report.setups[0].weightedEntry == "4002.0166666666666666666666666666666666666667"
    assert replay.ReplayReport.model_validate(report.model_dump()).recommendation == "HOLD"


def test_replay_does_not_change_the_callers_decimal_context() -> None:
    from decimal import getcontext

    original = getcontext().prec
    run(fixture())
    assert getcontext().prec == original


def test_duplicate_close_deal_cannot_complete_position_volume() -> None:
    data = fixture()
    fill(data, "20")
    group = data["setups"][0]
    group["state"] = "CLOSED"
    group["currentProtection"][0]["positionState"] = "CLOSED"
    group["closedTrades"] = [
        {
            "id": identity("trade"),
            "direction": "LONG",
            "realizedNet": "1",
            "signedFees": "-0.7",
            "openedAt": at(10),
            "closedAt": at(30),
        }
    ]
    deal = {
        "id": identity("deal"),
        "positionId": identity("position"),
        "closedVolume": "10",
        "entryPrice": "4002.1",
        "gross": "1.7",
        "commission": "-0.7",
        "swap": "0",
        "conversionFee": "0",
        "occurredAt": at(30),
        "recordedAt": at(31),
        "externalIntervention": False,
        "evidenceSha256": "a" * 64,
        "exitCause": None,
    }
    group["closeDeals"] = [deal, deepcopy(deal)]
    result = run(data).setups[0]
    assert result.state == "UNKNOWN"
    assert result.partialCloseVolume == "10"
    assert "CLOSE_DEAL_IDENTITY_DUPLICATE" in result.reasons


def test_conflicting_close_deal_identity_never_selects_a_version() -> None:
    data = fixture()
    fill(data, "20")
    deal = {
        "id": identity("deal-conflict"),
        "positionId": identity("position"),
        "closedVolume": "10",
        "entryPrice": "4002.1",
        "gross": "1.7",
        "commission": "-0.7",
        "swap": "0",
        "conversionFee": "0",
        "occurredAt": at(30),
        "recordedAt": at(31),
        "externalIntervention": False,
        "evidenceSha256": "a" * 64,
        "exitCause": None,
    }
    data["setups"][0]["closeDeals"] = [deal, {**deal, "closedVolume": "11"}]
    with pytest.raises(ValueError, match="CLOSE_DEAL_IDENTITY_CONFLICT"):
        run(data)
