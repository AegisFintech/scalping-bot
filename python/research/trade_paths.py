"""Bounded read-only sampled paths. Never execution or promotion authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import time
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx


def at(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("PATH_TIME_INVALID")
    return result.astimezone(UTC)


def sample(
    client: httpx.Client,
    release: str,
    now: datetime,
    *,
    pnl: bool,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "version": "sampled-trade-path-1.0",
        "captured_at": now.isoformat(),
        "quote": None,
        "position": None,
        "pnl": None,
        "brokerAuthority": False,
        "completeTickTape": False,
        "future_closing_costs": None,
        "counterfactual_net": None,
    }
    try:
        status_response = client.get("http://127.0.0.1:8080/v1/status")
        status_response.raise_for_status()
        status = status_response.json()
        if status.get("mode") != "demo" or status.get("strategyVersion") != release:
            row["state"] = "SOURCE_HALT"
            return row
        row["runtime_release"] = release
        row["position_origin_release"] = None
        row["operational_ready"] = status.get("operationalReady") is True
        managed = status.get("managedSetup") or {}
        positions = managed.get("positions") or []
        active = [p for p in positions if p.get("state") in {"OPEN", "CLOSING"}]
        if len(active) == 1:
            row["position"] = {
                key: active[0].get(key) for key in ("side", "openedAt", "entryPrice", "volume")
            }
        response = client.post("http://127.0.0.1:8081/v1/quote", json={"symbol": "XAUUSD"})
        response.raise_for_status()
        quote = response.json()["quote"]
        source, received = at(quote["sourceTime"]), at(quote["receivedAt"])
        bid, ask = Decimal(quote["bid"]), Decimal(quote["ask"])
        observed = clock()
        row["quote_checked_at"] = observed.isoformat()
        if not (
            0 <= (observed - source).total_seconds() <= 3
            and source <= received <= observed
            and bid.is_finite()
            and ask.is_finite()
            and 0 < bid <= ask
        ):
            raise ValueError("PATH_QUOTE_INVALID")
        row["quote"] = {k: quote[k] for k in ("bid", "ask", "sourceTime", "receivedAt")}
        row["state"] = "SAMPLED"
        if pnl and row["position"] is not None:
            response = client.get("http://127.0.0.1:8080/v1/open-position-monitor")
            response.raise_for_status()
            monitor = response.json()
            observed = clock()
            verify_response = client.get("http://127.0.0.1:8080/v1/status")
            verify_response.raise_for_status()
            verify = verify_response.json()
            current = [
                p
                for p in (verify.get("managedSetup") or {}).get("positions", [])
                if p.get("state") in {"OPEN", "CLOSING"}
            ]
            identity = (
                {key: current[0].get(key) for key in ("side", "openedAt", "entryPrice", "volume")}
                if len(current) == 1
                else None
            )
            if verify.get("strategyVersion") != release or identity != row["position"]:
                row["pnl_reason"] = "POSITION_CHANGED"
                return row

            if (
                monitor.get("status") == "AVAILABLE"
                and monitor.get("side") == row["position"]["side"]
                and 0 <= (observed - at(monitor["pnlCapturedAt"])).total_seconds() <= 3
            ):
                for key in ("grossUnrealizedPnl", "netUnrealizedPnl", "recordedCommission"):
                    if (
                        not isinstance(monitor.get(key), str)
                        or not Decimal(monitor[key]).is_finite()
                    ):
                        raise ValueError("PATH_PNL_INVALID")
                # Broker net unrealized excludes unknown future closing costs.
                row["pnl"] = {
                    k: monitor.get(k)
                    for k in (
                        "side",
                        "accountCurrency",
                        "grossUnrealizedPnl",
                        "netUnrealizedPnl",
                        "recordedCommission",
                        "pnlCapturedAt",
                        "quoteSourceTime",
                        "quoteReceivedAt",
                    )
                }
    except (httpx.HTTPError, ValueError, KeyError, TypeError, ArithmeticError):
        row["state"] = "GAP"
    return row


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    registration = json.loads(args.registration.read_text())
    release = registration["strategyVersion"]
    start, end = at(registration["from"]), at(registration["pathUntil"])
    if (
        not 0 < (end - start).total_seconds() <= 7 * 86400
        or registration["promotionAuthority"] is not False
    ):
        raise ValueError("PATH_REGISTRATION_INVALID")
    if (
        hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        != registration["pathObserverSha256"]
    ):
        raise ValueError("PATH_SOURCE_DRIFT_RESEARCH_ONLY")
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    run = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
    index, sequence, previous = 0, 0, "0" * 64
    with httpx.Client(timeout=2, trust_env=False) as client:
        while datetime.now(UTC) < end:
            if datetime.now(UTC) < start:
                time.sleep(1)
                continue
            disk = shutil.disk_usage(args.output)
            if disk.free < max(2 * 1024**3, disk.total * 15 // 100):
                raise ValueError("PATH_DISK_RESERVE_RESEARCH_ONLY")
            with (args.output / f"{run}-{index:04d}.jsonl").open("x") as output:
                os.chmod(output.name, 0o600)
                segment_start = time.monotonic()
                while time.monotonic() - segment_start < 3600 and datetime.now(UTC) < end:
                    before = time.monotonic()
                    if sequence % 60 == 0:
                        disk = shutil.disk_usage(args.output)
                        size = sum(p.stat().st_size for p in args.output.glob("*.jsonl"))
                        if (
                            disk.free < max(2 * 1024**3, disk.total * 15 // 100)
                            or size >= 512 * 1024**2
                        ):
                            raise ValueError("PATH_STORAGE_BOUND_RESEARCH_ONLY")
                    row = sample(client, release, datetime.now(UTC), pnl=sequence % 5 == 0)
                    row.update(sequence=sequence, previous_sha256=previous)
                    previous = hashlib.sha256(
                        json.dumps(row, sort_keys=True, separators=(",", ":")).encode()
                    ).hexdigest()
                    row["sha256"] = previous
                    output.write(json.dumps(row, separators=(",", ":")) + "\n")
                    output.flush()
                    sequence += 1
                    if row["state"] == "SOURCE_HALT":
                        os.fsync(output.fileno())
                        return
                    if output.tell() > 32 * 1024**2:
                        raise ValueError("PATH_SEGMENT_BOUND_RESEARCH_ONLY")
                    time.sleep(max(0.01, 1 - (time.monotonic() - before)))
                os.fsync(output.fileno())
            index += 1


if __name__ == "__main__":
    main()
