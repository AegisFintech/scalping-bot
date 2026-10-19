"""Project an existing read-only learning export into the Codex aggregate allowlist."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python.research.codex_loop import Evidence, publish


def project(payload: dict[str, Any]) -> Evidence:
    if (
        payload.get("reportVersion") != "demo-learning-1.0"
        or payload.get("label") != "OBSERVED_DEMO_NOT_BACKTEST_OR_PROFITABILITY_EVIDENCE"
        or payload.get("providerCost") is not None
    ):
        raise ValueError("RESEARCH_EXPORT_INVALID")
    summary = payload["summary"]
    return Evidence.model_validate(
        {
            "version": "research-evidence-1.0",
            "mode": "demo",
            "release": payload["strategyVersion"],
            "start": payload["from"],
            "end": payload["until"],
            "closed_trades": summary["trades"],
            "wins": summary["wins"],
            "matched_cost_records": summary["matchedCloseEvidence"],
            "net_pnl": summary["netPnl"],
            "gross_pnl": summary["grossPnl"],
            "signed_costs": summary["signedCosts"],
            "provider_cost": None,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        with args.input.open("rb") as handle:
            raw = handle.read(8_000_001)
        if len(raw) > 8_000_000:
            raise ValueError("RESEARCH_EXPORT_TOO_LARGE")
        publish(args.output, project(json.loads(raw)).model_dump())
    except (ValueError, KeyError, TypeError, OSError):
        raise SystemExit("RESEARCH_EXPORT_REJECTED") from None


if __name__ == "__main__":
    main()
