"""Bounded read-only projection of operational flight summaries, no raw paths/credentials."""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


def load_flight_view(directory: Path, now: datetime) -> dict[str, Any]:
    unavailable: dict[str, Any] = {"available": False, "state": "UNAVAILABLE"}
    try:
        status_path = directory / "status.json"
        if directory.is_symlink() or status_path.is_symlink() or status_path.stat().st_size > 4096:
            return unavailable
        status = json.loads(status_path.read_text())
        checked = datetime.fromisoformat(status["checkedAt"].replace("Z", "+00:00"))
        if checked.tzinfo is None or not 0 <= (now - checked).total_seconds() <= 10:
            return {**unavailable, "state": "STALE"}
        name = status.get("summary")
        if not isinstance(name, str) or not re.fullmatch(
            r"flight-[a-f0-9]{24}-\d{8}T\d{12}\.summary\.json", name
        ):
            return {**unavailable, "state": str(status.get("state", "UNAVAILABLE"))[:32]}
        path = directory / name
        if path.is_symlink() or path.stat().st_size > 256 * 1024:
            return unavailable
        summary = json.loads(path.read_text())
        if summary.get("schemaVersion") != "1.0" or len(summary.get("chart", [])) > 240:
            return unavailable
        # Explicit presentation whitelist; never return arbitrary JSON/raw journal fields.
        result: dict[str, Any] = {
            "available": True,
            "state": str(summary["state"]),
            "checkedAt": checked.isoformat(),
            "final": summary.get("final") is True,
            "originRelease": str(summary.get("originRelease", "Unknown")),
            "accountCurrency": str(summary.get("accountCurrency") or "Unknown currency"),
            "coverageStart": summary.get("coverageStart"),
            "gaps": int(summary.get("gaps", 0)),
            "records": int(summary.get("records", 0)),
            "quoteAt": summary.get("quoteAt"),
            "costBasis": "Modeled commission; unknown swap/slippage excluded",
            "completeTickTape": False,
        }
        result["chart"] = [
            {k: p.get(k) for k in ["at", "bid", "ask", "gap"]} for p in summary["chart"]
        ]
        result["legs"] = [
            {
                k: p.get(k)
                for k in [
                    "side",
                    "entry",
                    "target",
                    "stop",
                    "mark",
                    "quoteAt",
                    "samples",
                    "mfePips",
                    "maePips",
                    "modeledNetPips",
                    "bestModeledNetPips",
                    "closestTpPips",
                    "closestSlPips",
                    "timeProfitableSeconds",
                    "entrySlippagePips",
                    "localIntentToBrokerFillSeconds",
                ]
            }
            for p in summary.get("legs", [])[:2]
        ]
        result["orders"] = [
            {
                k: p.get(k)
                for k in [
                    "side",
                    "state",
                    "entry_price",
                    "stop_loss",
                    "take_profit",
                    "fill_price",
                    "first_fill",
                ]
            }
            for p in summary.get("orders", [])[:2]
        ]
        result["closedTrades"] = [
            {k: p.get(k) for k in ["direction", "net", "signed_fees", "opened_at", "closed_at"]}
            for p in summary.get("closedTrades", [])[:2]
        ]
        result["boundaries"] = [
            {k: p.get(k) for k in ["side", "closestEntryPips", "observedBoundaryCross"]}
            for p in summary.get("boundaries", [])[:2]
        ]
        return result
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return unavailable
