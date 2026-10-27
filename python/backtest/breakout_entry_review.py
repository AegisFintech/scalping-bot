"""Read-only trigger/path diagnostics. Not a fill simulator or strategy promotion authority."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, NotRequired, TypedDict

from python.operations.entry_context import number, plain, timestamp

CANDIDATES = {
    "TOUCH": "0",
    "BUFFER_005": "0.05",
    "BUFFER_010": "0.10",
    "BUFFER_020": "0.20",
    "M1_CLOSE": None,
}
PROTOCOL = "breakout-entry-observer-1.0"
MAX_INPUT = 32 * 1024**2
ROOT = Path(__file__).resolve().parents[2]


EntryReviewReport = TypedDict(
    "EntryReviewReport",
    {
        "schemaVersion": str,
        "cohort": str,
        "release": str,
        "from": str,
        "until": str,
        "sourceSha256": str,
        "setups": list[dict[str, Any]],
        "summary": dict[str, int],
        "brokerAuthority": bool,
        "promotion": str,
        "counterfactualNet": None,
        "economicPairedReplay": bool,
        "completeTickTape": bool,
        "registrationSha256": NotRequired[str | None],
        "prospective": NotRequired[bool],
        "bundleSha256": NotRequired[str],
    },
)


def canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        default=lambda v: v.isoformat() if isinstance(v, datetime) else str(v),
    ).encode()


def fingerprint() -> str:
    paths = [
        "python/backtest/breakout_entry_review.py",
        "python/operations/entry_context.py",
        "python/operations/setup_flight_recorder.py",
        "python/backtest/paired.py",
        "python/evaluation/engine.py",
        "python/operations/export_entry_evidence.py",
        "python/operations/run_entry_observer.py",
        "requirements.lock",
        "package-lock.json",
        "packages/config/src/policy.ts",
        "prompts/entry-quick-oco-v4.md",
        "schemas/breakout-entry-review-1.0.json",
    ]
    return hashlib.sha256(
        canonical([[p, hashlib.sha256((ROOT / p).read_bytes()).hexdigest()] for p in paths])
    ).hexdigest()


def write_new(path: Path, value: Any) -> None:
    data = canonical(value) + b"\n"
    if len(data) > 16 * 1024**2:
        raise ValueError("ENTRY_OUTPUT_BOUNDS_INVALID")
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(path, 0o400)


def register(path: Path, release: str, start: datetime, now: datetime) -> dict[str, Any]:
    if not now < start <= now + timedelta(hours=24) or not re.fullmatch(
        r"[0-9A-Za-z.-]{1,80}", release
    ):
        raise ValueError("ENTRY_REGISTRATION_INVALID")
    value = {
        "protocol": PROTOCOL,
        "registeredAt": now.isoformat(),
        "from": start.isoformat(),
        "until": (start + timedelta(days=30)).isoformat(),
        "release": release,
        "sourceSha256": fingerprint(),
        "candidates": CANDIDATES,
        "maxQuoteGapMs": 3000,
        "cancelAmbiguityMs": 500,
        "brokerAuthority": False,
        "promotion": "HOLD",
        "counterfactualNet": None,
    }
    write_new(path, value)
    return value


def verify_records(paths: list[Path]) -> list[dict[str, Any]]:
    """Verify chain across lossless segments; reject mutations, duplicates and gzip bombs."""
    if not paths or len(paths) > 128:
        raise ValueError("ENTRY_FLIGHT_SEGMENTS_INVALID")
    previous, sequence, used = "0" * 64, 0, 0
    records = []
    for path in paths:
        if path.is_symlink() or not path.is_file():
            raise ValueError("ENTRY_FLIGHT_PATH_INVALID")
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rb") as handle:
            while line := handle.readline(4 * 1024**2 + 1):
                used += len(line)
                if used > MAX_INPUT or len(line) > 4 * 1024**2 or not line.endswith(b"\n"):
                    raise ValueError("ENTRY_FLIGHT_BOUNDS_INVALID")
                record = json.loads(line)
                digest = record.pop("sha256")
                if (
                    record["sequence"] != sequence + 1
                    or record["previous"] != previous
                    or hashlib.sha256(canonical(record)).hexdigest() != digest
                ):
                    raise ValueError("ENTRY_FLIGHT_CHAIN_INVALID")
                previous, sequence = digest, sequence + 1
                records.append(record)
    if not records or records[0]["kind"] != "START":
        raise ValueError("ENTRY_FLIGHT_START_REQUIRED")
    return records


def audit_tp(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Prior recorded broker observations only; crossings are not executable-fill claims."""
    prior: dict[str, Any] = {}
    crossings: list[dict[str, Any]] = []
    observed = 0
    for record in records:
        if record["kind"] == "LIFECYCLE":
            prior = record["payload"]
        if record["kind"] != "BROKER_QUOTE":
            continue
        q = record["payload"]
        if q.get("kind") != "QUOTE" or not q.get("sourceTime"):
            continue
        at = timestamp(q["sourceTime"])
        received, saved = timestamp(q["receivedAt"]), timestamp(record["observedAt"])
        if not at <= received <= saved or received - at > timedelta(seconds=3):
            continue
        for p in prior.get("protection", []):
            side = p["side"]
            if (
                p["state"] != "OPEN"
                or p.get("protection_status") != "VERIFIED"
                or not p.get("broker_tp")
            ):
                continue
            protected = timestamp(p["observed_at"])
            if not protected <= at <= protected + timedelta(seconds=3):
                continue
            if not q.get("bidUpdated" if side == "BUY" else "askUpdated"):
                continue
            if at < timestamp(p["updated_at"]):
                continue
            if any(
                at >= timestamp(t["closed_at"])
                for t in prior.get("closedTrades", [])
                if t["direction"] == ("LONG" if side == "BUY" else "SHORT")
            ):
                continue
            observed += 1
            mark = number(q["bid"] if side == "BUY" else q["ask"])
            target = number(p["broker_tp"])
            if (mark >= target if side == "BUY" else mark <= target) and len(crossings) < 100:
                crossings.append(
                    {
                        "side": side,
                        "quoteAt": at.isoformat(),
                        "receivedAt": received.isoformat(),
                        "mark": plain(mark),
                        "brokerTp": plain(target),
                        "priorProtectionObservedAt": protected.isoformat(),
                    }
                )
    return {
        "status": "RECORDED_CROSSING_REQUIRES_BROKER_REVIEW" if crossings else "NO_CROSSING_PROVEN",
        "eligibleQuoteObservations": observed,
        "crossings": crossings,
        "crossingsBounded": len(crossings) == 100,
        "executionCause": None,
        "counterfactualNet": None,
    }


def trigger_review(
    context: dict[str, Any],
    orders: list[dict[str, Any]],
    records: list[dict[str, Any]],
    candles: list[dict[str, Any]],
    cutoff: datetime,
) -> list[dict[str, Any]]:
    """Paired conditional signal diagnostics; broker acceptance/availability bound every leg.

    No candidate order/fill/fees/swap/FX/margin model is invented. This does not
    replace ISSUE-253's economic paired replay or its immutable historical cohort.
    """
    if context.get("state") != "RECORDED":
        return [
            {
                "candidate": name,
                "state": "CONTEXT_UNAVAILABLE",
                "signals": [],
                "counterfactualNet": None,
            }
            for name in CANDIDATES
        ]
    available = timestamp(context["availableAt"])
    day_end = datetime.combine(available.date() + timedelta(days=1), datetime.min.time(), UTC)
    cutoff = min(cutoff, day_end)
    gaps = sum(r["kind"] == "GAP" for r in records)
    quotes: list[dict[str, Any]] = []
    prior_time = None
    sequence = None
    bad = False
    for r in records:
        if r["kind"] != "BROKER_QUOTE":
            continue
        q = r["payload"]
        if (
            q.get("kind") != "QUOTE"
            or not q.get("sourceTime")
            or not q.get("bidUpdated")
            or not q.get("askUpdated")
        ):
            continue
        t, recv, saved = (
            timestamp(q["sourceTime"]),
            timestamp(q["receivedAt"]),
            timestamp(r["observedAt"]),
        )
        bid, ask = number(q["bid"]), number(q["ask"])
        if not 0 < bid <= ask or not t <= recv <= saved or recv - t > timedelta(seconds=3):
            bad = True
            continue
        if prior_time is not None and (t <= prior_time or t - prior_time > timedelta(seconds=3)):
            bad = True
        if sequence is not None and q["sequence"] <= sequence:
            bad = True
        prior_time, sequence = t, q["sequence"]
        if available <= t < cutoff:
            quotes.append({**q, "time": t})
    output = []
    for name, delta in CANDIDATES.items():
        signals = []
        missing = False
        for side, field in (("BUY", "upperEntry"), ("SELL", "lowerEntry")):
            legs = [o for o in orders if o["side"] == side]
            if len(legs) != 1 or not legs[0].get("broker_accepted_at"):
                missing = True
                continue
            gate = max(available, timestamp(legs[0]["broker_accepted_at"]))
            base = number(context[field])
            level = base + number(delta or "0") * (1 if side == "BUY" else -1)
            if level <= 0 or level % number(context["tickSize"]):
                raise ValueError("ENTRY_CANDIDATE_PRECISION_INVALID")
            confirmation = None
            if name == "M1_CLOSE":
                seen: set[datetime] = set()
                for bar in sorted(candles, key=lambda b: timestamp(b["availableAt"])):
                    start, end, known = (
                        timestamp(bar["startTime"]),
                        timestamp(bar["endTime"]),
                        timestamp(bar["availableAt"]),
                    )
                    if end in seen:
                        raise ValueError("ENTRY_CANDLE_CONFLICT")
                    seen.add(end)
                    if (
                        bar.get("complete") is not True
                        or end - start != timedelta(minutes=1)
                        or known < end
                    ):
                        raise ValueError("ENTRY_CANDLE_PROVENANCE_INVALID")
                    if start < gate or known >= cutoff:
                        continue
                    close = number(bar["close"])
                    if close > base if side == "BUY" else close < base:
                        confirmation = known
                        break
                if confirmation is None:
                    continue
                gate = max(gate, confirmation)
            eligible = [q for q in quotes if q["time"] >= gate]
            first = next(
                (
                    q
                    for q in eligible
                    if (number(q["ask"]) >= level if side == "BUY" else number(q["bid"]) <= level)
                ),
                None,
            )
            if first is None:
                continue
            at = first["time"]
            # First observed already beyond threshold is explicitly not a proven crossing.
            prior_quotes = [q for q in eligible if q["time"] < at]
            entry_mark = number(first["ask"] if side == "BUY" else first["bid"])
            path = [q for q in eligible if q["time"] >= at]
            moves = [
                (number(q["bid"] if side == "BUY" else q["ask"]) - entry_mark)
                * (1 if side == "BUY" else -1)
                for q in path
            ]
            signals.append(
                {
                    "side": side,
                    "level": plain(level),
                    "firstObservedAt": at.isoformat(),
                    "confirmationAvailableAt": confirmation.isoformat() if confirmation else None,
                    "crossingProvenInObservedQuotes": bool(prior_quotes),
                    "executableQuoteReference": plain(entry_mark),
                    "hypotheticalFill": None,
                    "observedMaximumMove": plain(max(moves)),
                    "observedMinimumMove": plain(min(moves)),
                    "quoteSamples": len(path),
                    "counterfactualNet": None,
                }
            )
        ambiguity = len(signals) == 2 and abs(
            timestamp(signals[0]["firstObservedAt"]) - timestamp(signals[1]["firstObservedAt"])
        ) <= timedelta(milliseconds=500)
        output.append(
            {
                "candidate": name,
                "state": "PATH_UNAVAILABLE"
                if not records
                else "ACCEPTANCE_UNAVAILABLE"
                if missing
                else "OBSERVED_SIGNALS"
                if signals
                else "NO_SIGNAL_OBSERVED",
                "signals": signals,
                "ocoRaceAmbiguous": ambiguity,
                "pathCensored": gaps > 0
                or bad
                or not quotes
                or not records
                or records[-1]["kind"] != "END"
                or cutoff - quotes[-1]["time"] > timedelta(seconds=3),
                "m1EvidenceAvailable": bool(candles),
                "cutoff": cutoff.isoformat(),
                "gtcLifetime": "UNTIL_EVIDENCE_CUTOFF_NOT_ORIGINAL_FILL",
                "counterfactualNet": None,
            }
        )
    return output


def review(directory: Path, bundle: dict[str, Any], cutoff: datetime) -> EntryReviewReport:
    if directory.is_symlink() or len(bundle["setups"]) > 1000:
        raise ValueError("ENTRY_REVIEW_BOUNDS_INVALID")
    setups = []
    total_files = 0
    for item in bundle["setups"]:
        key = item["setup"]
        if not re.fullmatch(r"[a-f0-9]{24}", key):
            raise ValueError("ENTRY_SETUP_INVALID")
        summaries = sorted(directory.glob(f"flight-{key}-*.summary.json"))
        total_files += len(summaries)
        if total_files > 1000:
            raise ValueError("ENTRY_REVIEW_FILES_INVALID")
        records: list[dict[str, Any]] = []
        hashes: list[dict[str, str]] = []
        for summary in summaries:
            # Each recorder restart is a distinct chain. No bridging its missing paths.
            paths = sorted(directory.glob(summary.name.removesuffix(".summary.json") + "-*.jsonl*"))
            if not paths:
                continue
            chain = verify_records(paths)
            if chain[0]["payload"]["setup"]["setup"] != key:
                raise ValueError("ENTRY_FLIGHT_SCOPE_MISMATCH")
            if records:
                records.append({"kind": "GAP", "payload": {"reason": "RECORDER_RESTART"}})
            records.extend(chain)
            hashes.extend(
                {"file": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                for p in paths
            )
        # Lifecycle rows written/received after cutoff cannot establish prior protection.
        records = [r for r in records if r["kind"] == "GAP" or timestamp(r["observedAt"]) < cutoff]
        setups.append(
            {
                "setup": key,
                "sourceFiles": hashes,
                "entryContext": item.get("entryContext"),
                "actualEntries": [
                    {
                        "side": o["side"],
                        "firstFill": timestamp(o["first_fill"]).isoformat(),
                        "lastFill": timestamp(o["last_fill"]).isoformat(),
                        "volume": o["fill_volume"],
                        "price": o["fill_price"],
                    }
                    for o in item["orders"]
                    if o.get("first_fill")
                    and o.get("last_fill")
                    and timestamp(o["last_fill"]) < cutoff
                ],
                "actualClosedTrades": [
                    t for t in item.get("closedTrades", []) if timestamp(t["closed_at"]) < cutoff
                ],
                "tpAudit": audit_tp(records),
                "candidates": trigger_review(
                    item.get("entryContext") or {},
                    item["orders"],
                    records,
                    bundle.get("completedM1", []),
                    cutoff,
                ),
            }
        )
    return {
        "schemaVersion": PROTOCOL,
        "cohort": "ALL_SCOPED_INTENTS_NOT_SELECTED_CLOSED_TRADES",
        "release": bundle["release"],
        "from": bundle["from"],
        "until": cutoff.isoformat(),
        "sourceSha256": fingerprint(),
        "setups": setups,
        "summary": dict(Counter(c["state"] for s in setups for c in s["candidates"])),
        "brokerAuthority": False,
        "promotion": "HOLD",
        "counterfactualNet": None,
        "economicPairedReplay": False,
        "completeTickTape": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["register", "review"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release")
    parser.add_argument("--start")
    parser.add_argument("--registration", type=Path)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--recordings", type=Path)
    args = parser.parse_args()
    now = datetime.now(UTC)
    if args.command == "register":
        register(args.output, args.release, timestamp(args.start), now)
        return
    if (
        not args.bundle
        or not args.recordings
        or args.bundle.is_symlink()
        or args.bundle.stat().st_size > 16 * 1024**2
    ):
        raise ValueError("ENTRY_REVIEW_INPUT_REQUIRED")
    bundle = json.loads(args.bundle.read_text())
    cutoff = timestamp(bundle["until"])
    if not timestamp(bundle["from"]) < cutoff <= now or cutoff - timestamp(
        bundle["from"]
    ) > timedelta(days=31):
        raise ValueError("ENTRY_REVIEW_WINDOW_INVALID")
    registration_hash = None
    if args.registration:
        registration = json.loads(args.registration.read_text())
        if (
            registration["sourceSha256"] != fingerprint()
            or registration["candidates"] != CANDIDATES
            or registration["release"] != bundle["release"]
            or registration["protocol"] != PROTOCOL
            or registration["brokerAuthority"] is not False
            or registration["promotion"] != "HOLD"
            or registration["counterfactualNet"] is not None
            or registration["maxQuoteGapMs"] != 3000
            or registration["cancelAmbiguityMs"] != 500
            or timestamp(registration["until"])
            != timestamp(registration["from"]) + timedelta(days=30)
            or (timestamp(bundle["from"]) - timestamp(registration["from"])) % timedelta(days=1)
            != timedelta(0)
            or cutoff != timestamp(bundle["from"]) + timedelta(days=1)
            or cutoff + timedelta(minutes=10) > now
            or not timestamp(registration["registeredAt"])
            < timestamp(registration["from"])
            <= timestamp(bundle["from"])
            < cutoff
            <= timestamp(registration["until"])
        ):
            raise ValueError("ENTRY_REGISTRATION_DRIFT_OR_WINDOW_INVALID")
        registration_hash = hashlib.sha256(args.registration.read_bytes()).hexdigest()
    result = review(args.recordings, bundle, cutoff)
    result["registrationSha256"] = registration_hash
    result["prospective"] = registration_hash is not None
    result["bundleSha256"] = hashlib.sha256(args.bundle.read_bytes()).hexdigest()
    write_new(args.output, result)


if __name__ == "__main__":
    main()
