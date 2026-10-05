"""Verify retained windows without recollection, source mutation or broker authority."""

from __future__ import annotations

import argparse
import re
from collections import Counter
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any, TypedDict

from python.backtest import forward as f
from python.backtest.paired import input_window
from python.evaluation.engine import timestamp


class ForwardSummary(TypedDict):
    reportVersion: str
    label: str
    studySha256: str
    sourceSha256: str
    asOf: str
    registeredWindows: int
    completedWindows: int
    dueUnreportedWindows: int
    windows: list[dict[str, Any]]
    actualClosedTradeTotals: dict[str, Any]
    counterfactualNetPnl: None
    providerCost: None
    decision: str
    brokerAuthority: bool
    productionChanged: bool
    qualification: str


def number(value: object) -> Decimal:
    if not isinstance(value, str) or len(value) > 100:
        raise ValueError("SUMMARY_MONEY_INVALID")
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise ValueError("SUMMARY_MONEY_INVALID") from None
    if not result.is_finite() or abs(result.adjusted()) > 100:
        raise ValueError("SUMMARY_MONEY_INVALID")
    return result


def count(value: object) -> int:
    if type(value) is not int or value < 0 or value > 1_000_000:
        raise ValueError("SUMMARY_COUNT_INVALID")
    return value


def candidate(group: dict[str, Any], key: str) -> dict[str, Any]:
    result: dict[str, Any] = group[key]
    cases = group["cases"]
    statuses = dict(Counter(case[key]["status"] for case in cases))
    if (
        count(result["experiments"]) != len(cases)
        or result["statuses"] != statuses
        or any(not re.fullmatch(r"[A-Z0-9_]{1,80}", k) for k in statuses)
        or count(result["observed_path_closes"]) != statuses.get("SL", 0) + statuses.get("TP", 0)
        or result["cohort_net_pnl"] is not None
        or result["cohort_win_rate"] is not None
    ):
        raise ValueError("SUMMARY_DENOMINATOR_INVALID")
    number(result["gross_price_over_sl_sum_closed_subset"])
    return result


def retained_summary(directory: Path, anchor: str, as_of: int) -> ForwardSummary:
    if (
        directory.is_symlink()
        or not directory.is_dir()
        or not re.fullmatch(r"[a-f0-9]{64}", anchor)
    ):
        raise ValueError("SUMMARY_DIRECTORY_OR_ANCHOR_INVALID")
    raw_study = f.read_json(directory / "study.json")
    # Bind to the separately retained trusted registration, not this checkout's new locks.
    if f.digest(raw_study) != anchor:
        raise ValueError("SUMMARY_REGISTRATION_MISMATCH")
    study = f.validate_study(raw_study, raw_study["source_sha256"])
    if as_of < timestamp(study["registered_at"]):
        raise ValueError("SUMMARY_TIME_INVALID")
    names = sorted(p.name for p in directory.glob("day-*.json"))
    expected = [f"day-{i + 1:02d}.json" for i in range(len(names))]
    if names != expected or len(names) > study["days"]:
        raise ValueError("SUMMARY_MISSING_OR_UNEXPECTED_WINDOW")
    windows: list[dict[str, Any]] = []
    totals: dict[str, Any] = {"trades": 0, "wins": 0, "matchedCloseEvidence": 0}
    with localcontext() as context:
        context.prec = 120
        net, gross, costs = Decimal(0), Decimal(0), Decimal(0)
        for i, name in enumerate(names):
            body = f.verified_report(directory / name, study, i)
            if not timestamp(body["until"]) + f.SETTLE <= timestamp(body["observed_at"]) <= as_of:
                raise ValueError("SUMMARY_PREMATURE_OR_FUTURE_REPORT")
            evidence = body["evidence"]
            payload, actual, replay = (
                evidence[k] for k in ("input", "actual_closed_trades", "conditional_replay")
            )
            if input_window(payload) != (timestamp(body["from"]), timestamp(body["until"])):
                raise ValueError("SUMMARY_WINDOW_MISMATCH")
            for report in (actual, replay):
                if (report["from"], report["until"]) != (body["from"], body["until"]):
                    raise ValueError("SUMMARY_WINDOW_MISMATCH")
            if (
                payload["release"] != study["release"]
                or actual["strategyVersion"] != study["release"]
                or actual["reportVersion"] != "demo-learning-1.0"
                or actual["label"] != "OBSERVED_DEMO_NOT_BACKTEST_OR_PROFITABILITY_EVIDENCE"
                or actual["providerCost"] is not None
                or actual["riskBasis"] != "APPROVED_LEG_BUDGET_NOT_ACTUAL_STOP_RISK"
                or replay["release"] != study["release"]
                or replay["label"] != "CONDITIONAL_PAIRED_REPLAY_V1"
                or replay["decision"] != "HOLD"
                or replay["candidate"] is not None
                or replay["net_pnl"] is not None
                or replay["broker_authority"] is not False
                or replay["production_changed"] is not False
                or count(replay["input_setups"]) != len(payload["setups"])
                or count(replay["valid_setups"])
                + sum(count(v) for v in replay["excluded"].values())
                != replay["input_setups"]
            ):
                raise ValueError("SUMMARY_EVIDENCE_INVALID")
            observed = actual["summary"]
            if count(observed["trades"]) != len(observed["observations"]):
                raise ValueError("SUMMARY_DENOMINATOR_INVALID")
            if (
                count(observed["wins"]) > observed["trades"]
                or count(observed["matchedCloseEvidence"]) > observed["trades"]
            ):
                raise ValueError("SUMMARY_DENOMINATOR_INVALID")
            n, g, c = (number(observed[k]) for k in ("netPnl", "grossPnl", "signedCosts"))
            if g + c != n:
                raise ValueError("SUMMARY_COST_MISMATCH")
            net += n
            gross += g
            costs += c
            for key in totals:
                totals[key] += observed[key]
            comparisons = replay["comparisons"]
            if [c["assumptions"]["name"] for c in comparisons] != ["base", "stress"]:
                raise ValueError("SUMMARY_ASSUMPTIONS_INVALID")
            summaries = []
            for comparison in comparisons:
                entry, tp = comparison["entry"], comparison["tp"]
                if (
                    len(entry["cases"]) != replay["valid_setups"]
                    or len(tp["cases"]) + count(tp["not_single_full_fill"])
                    != replay["valid_setups"]
                ):
                    raise ValueError("SUMMARY_DENOMINATOR_INVALID")
                for group, keys in (
                    (entry, ("baseline", "model_levels")),
                    (tp, ("baseline", "factor_0_75", "factor_1_25")),
                ):
                    for key in keys:
                        candidate(group, key)
                for pair_group, pair_keys in (
                    (entry, ("paired",)),
                    (tp, ("lower_paired", "higher_paired")),
                ):
                    for pair_key in pair_keys:
                        paired = pair_group[pair_key]
                        if (
                            count(paired["complete_pairs"]) + count(paired["unresolved_pairs"])
                            != len(pair_group["cases"])
                            or paired["selection_warning"]
                            != "COMPLETE_SUBSET_NOT_FULL_COHORT_EXPECTANCY"
                        ):
                            raise ValueError("SUMMARY_DENOMINATOR_INVALID")
                summaries.append(
                    {
                        "assumptions": comparison["assumptions"],
                        "entry": {k: v for k, v in entry.items() if k != "cases"},
                        "tp": {k: v for k, v in tp.items() if k != "cases"},
                    }
                )
            windows.append(
                {
                    "index": i,
                    "from": body["from"],
                    "until": body["until"],
                    "reportSha256": f.digest(body),
                    "inputSetups": replay["input_setups"],
                    "validSetups": replay["valid_setups"],
                    "excluded": replay["excluded"],
                    "actualClosedTrades": {
                        k: observed[k] for k in (*totals, "netPnl", "grossPnl", "signedCosts")
                    },
                    "comparisons": summaries,
                    "limitations": body["limitations"] + replay["limitations"],
                }
            )
        totals.update(netPnl=str(net), grossPnl=str(gross), signedCosts=str(costs))
    due = min(study["days"], max(0, (as_of - timestamp(study["start"]) - f.SETTLE) // f.DAY))
    return {
        "reportVersion": "forward-summary-1.0",
        "label": "RETAINED_CONDITIONAL_WINDOWS_NOT_PORTFOLIO_RETURN",
        "studySha256": anchor,
        "sourceSha256": study["source_sha256"],
        "asOf": f.iso(as_of),
        "registeredWindows": study["days"],
        "completedWindows": len(windows),
        "dueUnreportedWindows": max(0, due - len(windows)),
        "windows": windows,
        "actualClosedTradeTotals": totals,
        "counterfactualNetPnl": None,
        "providerCost": None,
        "decision": "HOLD",
        "brokerAuthority": False,
        "productionChanged": False,
        "qualification": "COLLECTION_ONLY_NOT_STRATEGY_QUALIFICATION",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--study-sha256", required=True)
    parser.add_argument("--as-of", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.resolve().is_relative_to(args.directory.resolve()):
            raise ValueError("SUMMARY_OUTPUT_INSIDE_STUDY")
        as_of = timestamp(args.as_of)
        if as_of > f.now_ms() or f.iso(as_of) != args.as_of:
            raise ValueError("SUMMARY_TIME_INVALID")
        body = retained_summary(args.directory, args.study_sha256, as_of)
        f.publish(args.output, {"body": body, "sha256": f.digest(body)})
        print("SUMMARY_WRITTEN_HOLD")
    except (OSError, ValueError, KeyError, TypeError, InvalidOperation):
        parser.exit(1, "SUMMARY_FAILED: retained evidence or exclusive output invalid\n")


if __name__ == "__main__":
    main()
