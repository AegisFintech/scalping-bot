import gzip
import json
from hashlib import sha256
from pathlib import Path
from typing import Any

import pytest

from python.research.idle_evidence import Update, eligibility, read_segment
from tests.python.test_scalp_replay import at


def update(seconds: int, price: str, sequence: int = 1, **changes: Any) -> Update:
    return Update.model_validate(
        dict(
            schemaVersion="idle-quote-update-1.0",
            streamId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            sequence=sequence,
            source="fixture",
            kind="QUOTE",
            symbolName="XAUUSD",
            bid=price,
            ask=price,
            sourceTime=at(seconds),
            receivedAt=at(seconds),
            bidUpdated=True,
            askUpdated=True,
            bidSourceTime=at(seconds),
            askSourceTime=at(seconds),
            bidReceivedAt=at(seconds),
            askReceivedAt=at(seconds),
        )
        | changes
    )


def run(rows: list[Update]) -> dict[str, Any]:
    return eligibility(
        rows,
        side="BUY",
        entry="4000",
        tick="0.01",
        range_points=10,
        accepted_at=at(5),
        expires_at=at(60),
        cutoff=at(100),
    )


def test_trigger_range_and_expiry_are_observations_never_fills():
    result = run([update(4, "4000"), update(6, "4000.3", 2), update(7, "4000.05", 3)])
    assert result["firstObservedTriggerAt"] == at(6)
    assert result["firstObservedRangeEligibleAt"] == at(7)
    assert result["counterfactualFill"] is None and result["brokerTerminalProven"] is False
    expired = run([update(61, "4000.05")])
    assert expired["firstObservedRangeEligibleAt"] is None
    assert expired["expiryReachedByCutoff"] is True


def test_missing_side_clock_and_stream_gap_cannot_be_complete_execution():
    result = run([update(6, "4000", askSourceTime=None), update(7, "4000", 3)])
    assert result["gaps"] == 2
    assert result["coverage"] == "BOUNDED_OBSERVATIONS_NOT_CONTINUOUS_MARKET_OR_QUEUE"
    assert result["counterfactualNet"] is None


def test_verified_original_bytes_and_wrong_source_or_tamper(tmp_path: Path):
    name = "idle-aaaaaaaa-00000001.jsonl.gz"
    body = json.dumps(update(6, "4000").model_dump()).encode() + b"\n"
    raw = gzip.compress(body)
    (tmp_path / name).write_bytes(raw)
    manifest = dict(
        file=name,
        source="fixture",
        schemaVersion="idle-quote-manifest-1.0",
        sha256=sha256(raw).hexdigest(),
        uncompressedSha256=sha256(body).hexdigest(),
        compressedBytes=len(raw),
        updates=1,
        firstSequence=1,
        lastSequence=1,
        firstReceivedAt=at(6),
        lastReceivedAt=at(6),
        streamId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )
    (tmp_path / (name + ".manifest.json")).write_text(json.dumps(manifest))
    rows, _ = read_segment(tmp_path, name, "fixture")
    assert len(rows) == 1
    with pytest.raises(ValueError, match="BINDING"):
        read_segment(tmp_path, name, "other-source")
    (tmp_path / name).write_bytes(raw + b"tamper")
    with pytest.raises(ValueError, match="BINDING"):
        read_segment(tmp_path, name, "fixture")
