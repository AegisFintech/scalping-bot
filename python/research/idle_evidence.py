"""Verify bounded idle tape bytes; sampled crossings are never fills or terminal proof."""

from __future__ import annotations

import gzip
import io
import json
import re
from datetime import timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal

from pydantic import Field

from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_archive import bounded, unique
from python.research.learning_evidence import Instant, Number


class Update(StrictModel):
    schemaVersion: Literal["idle-quote-update-1.0"]
    streamId: str = Field(pattern=r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
    sequence: int = Field(ge=1)
    source: str
    kind: Literal["QUOTE", "RECONNECT"]
    symbolName: str | None
    bid: Number | None
    ask: Number | None
    sourceTime: Instant | None
    receivedAt: Instant
    bidUpdated: bool
    askUpdated: bool
    bidSourceTime: Instant | None
    askSourceTime: Instant | None
    bidReceivedAt: Instant | None
    askReceivedAt: Instant | None


def read_segment(
    root: Path, name: str, expected_source: str
) -> tuple[list[Update], dict[str, Any]]:
    if not re.fullmatch(r"idle-[a-f0-9-]+-\d{8}\.jsonl\.gz", name):
        raise ValueError("IDLE_EVIDENCE_NAME")
    manifest = json.loads(bounded(root / (name + ".manifest.json"), 8192), object_pairs_hook=unique)
    raw = bounded(root / name, 2 * 1024**2)
    if (
        manifest.get("file") != name
        or manifest.get("source") != expected_source
        or manifest.get("schemaVersion") != "idle-quote-manifest-1.0"
        or sha256(raw).hexdigest() != manifest.get("sha256")
        or len(raw) != manifest.get("compressedBytes")
    ):
        raise ValueError("IDLE_EVIDENCE_BINDING")
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as handle:
        body = handle.read(2 * 1024**2 + 1)
    if len(body) > 2 * 1024**2 or sha256(body).hexdigest() != manifest.get("uncompressedSha256"):
        raise ValueError("IDLE_EVIDENCE_DECOMPRESSION_OR_HASH")
    rows = [
        Update.model_validate(json.loads(line, object_pairs_hook=unique))
        for line in body.splitlines()
    ]
    if (
        not rows
        or len(rows) != manifest.get("updates")
        or rows[0].sequence != manifest.get("firstSequence")
        or rows[-1].sequence != manifest.get("lastSequence")
        or timestamp(rows[0].receivedAt) != timestamp(manifest.get("firstReceivedAt"))
        or timestamp(rows[-1].receivedAt) != timestamp(manifest.get("lastReceivedAt"))
    ):
        raise ValueError("IDLE_EVIDENCE_MANIFEST_COUNTS")
    previous = rows[0]
    for row in rows:
        if (
            row.source != expected_source
            or row.streamId != manifest.get("streamId")
            or timestamp(row.receivedAt) < timestamp(previous.receivedAt)
            or (row is not rows[0] and row.sequence <= previous.sequence)
        ):
            raise ValueError("IDLE_EVIDENCE_ORDER_OR_SOURCE")
        previous = row
    return rows, manifest


def eligibility(
    rows: list[Update],
    *,
    side: Literal["BUY", "SELL"],
    entry: str,
    tick: str,
    range_points: int,
    accepted_at: str,
    expires_at: str,
    cutoff: str,
) -> dict[str, Any]:
    """Best observed evidence only; no market-trigger/queue/expiry outcome is inferred."""
    if (
        not 0 < range_points <= 30
        or Decimal(tick) <= 0
        or Decimal(entry) <= 0
        or not timestamp(accepted_at) < timestamp(expires_at)
    ):
        raise ValueError("IDLE_ELIGIBILITY_INPUT")
    trigger: str | None = None
    eligible: str | None = None
    gaps = 0
    previous: Update | None = None
    last_side_source: str | None = None
    endpoint = timestamp(expires_at)
    for row in rows:
        received = timestamp(row.receivedAt)
        if received < timestamp(accepted_at) or received > timestamp(cutoff):
            continue
        if previous is not None and (
            row.streamId != previous.streamId
            or row.sequence != previous.sequence + 1
            or received < timestamp(previous.receivedAt)
        ):
            gaps += 1
        previous = row
        if row.kind == "RECONNECT":
            gaps += 1
            continue
        source = row.askSourceTime if side == "BUY" else row.bidSourceTime
        receive = row.askReceivedAt if side == "BUY" else row.bidReceivedAt
        price = row.ask if side == "BUY" else row.bid
        if (
            source is None
            or receive is None
            or price is None
            or not timestamp(source) <= timestamp(receive) <= received
            or received - timestamp(source) > timedelta(seconds=3)
            or timestamp(source) < timestamp(accepted_at)
            or timestamp(receive) < timestamp(accepted_at)
            or not (row.askUpdated if side == "BUY" else row.bidUpdated)
        ):
            gaps += 1
            continue
        if last_side_source is not None and timestamp(source) <= timestamp(last_side_source):
            gaps += 1
            continue
        last_side_source = source
        if received >= endpoint:
            continue
        p, e = Decimal(price), Decimal(entry)
        if p <= 0:
            gaps += 1
            continue
        if (side == "BUY" and p >= e) or (side == "SELL" and p <= e):
            trigger = trigger or row.receivedAt
        if trigger is not None and (
            (side == "BUY" and p <= e + Decimal(tick) * range_points)
            or (side == "SELL" and p >= e - Decimal(tick) * range_points)
        ):
            eligible = eligible or row.receivedAt
    return {
        "status": "OBSERVED_TRIGGER_AND_RANGE" if eligible else "NO_ELIGIBILITY_OBSERVED",
        "firstObservedTriggerAt": trigger,
        "firstObservedRangeEligibleAt": eligible,
        "gaps": gaps,
        "coverage": "BOUNDED_OBSERVATIONS_NOT_CONTINUOUS_MARKET_OR_QUEUE",
        "expiryReachedByCutoff": timestamp(cutoff) >= timestamp(expires_at),
        "brokerTerminalProven": False,
        "counterfactualFill": None,
        "counterfactualNet": None,
    }
