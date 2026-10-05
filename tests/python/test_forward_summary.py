from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from python.backtest import forward as f
from python.backtest import forward_summary as s
from python.backtest.paired import Tape, compare
from tests.python.test_forward import registered


def evidence(start: str, end: str, unresolved: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "label": "PAIRED_REPLAY_INPUT_V1",
        "release": f.RELEASE,
        "from": start,
        "until": end,
        "cohort": "OBSERVED_DEMO_INTENTS_CONDITIONAL_NOT_STRATEGY_BACKTEST",
        "economics": None,
        "setups": [],
    }
    replay = compare(payload, Tape([], [], [], {}))
    if unresolved:
        # Retained structural fixture, not invented market or broker evidence.
        payload["setups"] = [{"fixture": True}]
        replay["input_setups"] = replay["valid_setups"] = 1
        for comparison in replay["comparisons"]:
            for group, keys in (
                (comparison["entry"], ("baseline", "model_levels")),
                (comparison["tp"], ("baseline", "factor_0_75", "factor_1_25")),
            ):
                case = {
                    key: {"status": "OPEN_AT_CUTOFF" if key == "baseline" else "CENSORED_GAP"}
                    for key in keys
                }
                group["cases"] = [case]
                for key in keys:
                    group[key].update(experiments=1, statuses={case[key]["status"]: 1})
                for key in ("paired", "lower_paired", "higher_paired"):
                    if key in group:
                        group[key]["unresolved_pairs"] = 1
    actual = {
        "reportVersion": "demo-learning-1.0",
        "strategyVersion": f.RELEASE,
        "label": "OBSERVED_DEMO_NOT_BACKTEST_OR_PROFITABILITY_EVIDENCE",
        "from": start,
        "until": end,
        "providerCost": None,
        "riskBasis": "APPROVED_LEG_BUDGET_NOT_ACTUAL_STOP_RISK",
        "summary": {
            "trades": 0,
            "wins": 0,
            "matchedCloseEvidence": 0,
            "netPnl": "0",
            "grossPnl": "0",
            "signedCosts": "0",
            "observations": [],
        },
    }
    return {"input": payload, "actual_closed_trades": actual, "conditional_replay": replay}


def complete(tmp_path: Path, unresolved: bool = False) -> tuple[Path, str, int]:
    folder, study, due = registered(tmp_path)
    f.run_once(folder, due, study["source_sha256"], lambda a, b: evidence(a, b, unresolved))
    rewrite(folder, lambda body: body.update(observed_at=f.iso(due)))
    return folder, f.digest(study), due


def rewrite(folder: Path, change: Any) -> None:
    path = folder / "day-01.json"
    envelope = json.loads(path.read_bytes())
    change(envelope["body"])
    envelope["sha256"] = f.digest(envelope["body"])
    path.write_bytes(f.encoded(envelope))


def test_empty_windows_are_kept_and_aggregate_is_exclusive(tmp_path: Path) -> None:
    folder, anchor, due = complete(tmp_path)
    before = (folder / "day-01.json").read_bytes()
    report = s.retained_summary(folder, anchor, due + f.DAY)
    assert report["completedWindows"] == 1 and report["dueUnreportedWindows"] == 1
    assert report["windows"][0]["inputSetups"] == 0
    assert report["actualClosedTradeTotals"]["trades"] == 0
    assert report["decision"] == "HOLD" and report["counterfactualNetPnl"] is None
    assert report["brokerAuthority"] is False and report["productionChanged"] is False
    output = tmp_path / "summary.json"
    f.publish(output, {"body": report, "sha256": f.digest(report)})
    with pytest.raises(FileExistsError):
        f.publish(output, report)
    assert (folder / "day-01.json").read_bytes() == before
    assert output.stat().st_mode & 0o777 == 0o600


def test_open_and_gap_outcomes_are_retained_in_separate_experiments(tmp_path: Path) -> None:
    folder, anchor, due = complete(tmp_path, True)
    report = s.retained_summary(folder, anchor, due)
    for comparison in report["windows"][0]["comparisons"]:
        assert comparison["entry"]["baseline"]["statuses"] == {"OPEN_AT_CUTOFF": 1}
        assert comparison["entry"]["model_levels"]["statuses"] == {"CENSORED_GAP": 1}
        assert comparison["tp"]["factor_0_75"]["statuses"] == {"CENSORED_GAP": 1}
        assert comparison["entry"]["paired"]["unresolved_pairs"] == 1
        assert comparison["tp"]["factor_1_25"]["cohort_net_pnl"] is None
        assert "cases" not in comparison["entry"]


def test_trusted_registration_and_contiguous_windows_are_required(tmp_path: Path) -> None:
    folder, anchor, due = complete(tmp_path)
    with pytest.raises(ValueError, match="REGISTRATION_MISMATCH"):
        s.retained_summary(folder, "b" * 64, due)
    (folder / "day-01.json").rename(folder / "day-02.json")
    with pytest.raises(ValueError, match="MISSING_OR_UNEXPECTED_WINDOW"):
        s.retained_summary(folder, anchor, due)


def test_checksum_and_observation_cutoff_are_verified(tmp_path: Path) -> None:
    folder, anchor, due = complete(tmp_path)
    with pytest.raises(ValueError, match="PREMATURE_OR_FUTURE_REPORT"):
        s.retained_summary(folder, anchor, due - 1)
    path = folder / "day-01.json"
    envelope = json.loads(path.read_bytes())
    envelope["sha256"] = "0" * 64
    path.write_bytes(f.encoded(envelope))
    with pytest.raises(ValueError, match="REPORT_INVALID"):
        s.retained_summary(folder, anchor, due)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda b: b["evidence"]["conditional_replay"].update(net_pnl="1"),
        lambda b: b["evidence"]["actual_closed_trades"]["summary"].update(netPnl="1"),
        lambda b: b["evidence"]["conditional_replay"]["comparisons"][0]["entry"]["baseline"].update(
            experiments=1
        ),
    ],
)
def test_counterfactual_costs_denominators_and_actual_costs_fail_closed(
    tmp_path: Path, mutation: Any
) -> None:
    folder, anchor, due = complete(tmp_path)
    rewrite(folder, mutation)
    with pytest.raises(ValueError):
        s.retained_summary(folder, anchor, due)


def test_symlinked_report_and_nonfinite_money_are_rejected(tmp_path: Path) -> None:
    folder, anchor, due = complete(tmp_path)
    path = folder / "day-01.json"
    path.rename(tmp_path / "external.json")
    path.symlink_to(tmp_path / "external.json")
    with pytest.raises(ValueError, match="FILE_INVALID"):
        s.retained_summary(folder, anchor, due)
    for value in ("NaN", "Infinity", "1e1000", 0):
        with pytest.raises(ValueError, match="MONEY_INVALID"):
            s.number(value)


def test_cli_refuses_future_cutoff_without_publishing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import sys

    folder, anchor, due = complete(tmp_path)
    output = tmp_path / "summary.json"
    monkeypatch.setattr(f, "now_ms", lambda: due)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "summary",
            "--directory",
            str(folder),
            "--study-sha256",
            anchor,
            "--as-of",
            f.iso(due + 1),
            "--output",
            str(output),
        ],
    )
    with pytest.raises(SystemExit) as error:
        s.main()
    assert error.value.code == 1 and not output.exists()
    assert (
        capsys.readouterr().err == "SUMMARY_FAILED: retained evidence or exclusive output invalid\n"
    )


def test_cli_publishes_valid_envelope_and_never_overwrites(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    folder, anchor, due = complete(tmp_path)
    output = tmp_path / "summary.json"
    monkeypatch.setattr(f, "now_ms", lambda: due)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "summary",
            "--directory",
            str(folder),
            "--study-sha256",
            anchor,
            "--as-of",
            f.iso(due),
            "--output",
            str(output),
        ],
    )
    s.main()
    envelope = f.read_json(output)
    assert envelope["sha256"] == f.digest(envelope["body"])
    before = output.read_bytes()
    with pytest.raises(SystemExit):
        s.main()
    assert output.read_bytes() == before
