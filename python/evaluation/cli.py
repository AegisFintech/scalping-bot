from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path
from typing import Any

from python.evaluation.engine import (
    Plan,
    Scenario,
    candidates,
    evaluate,
    load_recordings,
    timestamp,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Research-only chronological sampled-quote evaluation"
    )
    parser.add_argument("recordings", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--legacy-plans", type=Path)
    parser.add_argument("--until-ms", type=int)
    args = parser.parse_args()
    quotes, evidence = load_recordings(args.recordings, args.until_ms)
    strategies = {
        "deterministic_oco_m1": candidates(quotes, 60_000, False),
        "directional_m1": candidates(quotes, 60_000, True),
        "directional_15s_rr1": candidates(quotes, 15_000, True, Decimal(1)),
    }
    if args.legacy_plans:
        rows = json.loads(args.legacy_plans.read_text())
        strategies["legacy_submitted_plans"] = [
            Plan(
                timestamp(row["created"]),
                timestamp(row["available"]),
                timestamp(row["expires"]),
                tuple(
                    (
                        int(leg["side"]),
                        Decimal(leg["entry"]),
                        Decimal(leg["tp"]),
                        Decimal(leg["sl"]),
                    )
                    for leg in row["legs"]
                ),
            )
            for row in rows
        ]
    scenarios = {
        "base": Scenario(),
        "worse_costs": Scenario(
            latency_ms=1500,
            entry_slippage=Decimal("0.04"),
            exit_slippage=Decimal("0.10"),
            spread_multiplier=Decimal("1.5"),
            commission_per_million=Decimal("45"),
            oco_cancel_latency_ms=1500,
        ),
        "partial_fill": Scenario(fill_fraction=Decimal("0.5")),
        "slow_model_ablation": Scenario(latency_ms=40_000, model_cost_per_request=Decimal("0.01")),
    }
    results: dict[str, Any] = {}
    # First chronological third is calibration only; two subsequent blocks are
    # untouched evaluation. Candidates are frozen, not selected on these blocks.
    for name, plans in strategies.items():
        results[name] = {}
        for label, scenario in scenarios.items():
            folds = []
            for fold in [1, 2]:
                segment = quotes[len(quotes) * fold // 3 : len(quotes) * (fold + 1) // 3]
                chosen = [
                    p
                    for p in plans
                    if segment[0].time <= p.created and p.expires <= segment[-1].time
                ]
                result = evaluate(segment, chosen, scenario)
                result.pop("closed_pnls")
                folds.append(
                    {"fold": fold, "start": segment[0].time, "end": segment[-1].time, **result}
                )
            results[name][label] = folds
    report = {
        "label": "SAMPLED_QUOTE_RESEARCH_NOT_LIVE_OR_PROFITABILITY_PROOF",
        "data": evidence,
        "assumptions": [
            "One base unit maximum per leg; research comparison does not choose production size.",
            (
                "Research price grid 0.01; entries round away from market; absolute spread ceiling "
                "0.10. Production percentile/history and broker session gates "
                "are not reconstructed."
            ),
            (
                "Sampled bid/ask, stop-limit unfilled observations and adverse entry/exit "
                "execution; fees counted once; delayed OCO cancellation can race."
            ),
            (
                "Legacy submitted opportunities are an observed selection, not an unbiased "
                "replay of every original analysis."
            ),
            (
                "120-second time exit is a common experiment, not a reconstruction of "
                "broker exit management."
            ),
            (
                "No entry near UTC rollover; financing or an unobserved path cannot be "
                "established from this tape."
            ),
            (
                "Slow-model ablation isolates delay and an illustrative USD 0.01/request; "
                "it is not evidence of model decision quality."
            ),
            (
                "Model value requires prospectively frozen model context and independent "
                "holdout data. No candidate is automatically promoted."
            ),
        ],
        "scenarios": {
            name: {key: str(value) for key, value in asdict(s).items()}
            for name, s in scenarios.items()
        },
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {"report": str(args.output), "quotes": len(quotes), "strategies": list(strategies)}
        )
    )


if __name__ == "__main__":
    main()
