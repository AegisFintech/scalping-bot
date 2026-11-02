"""Hourly immutable acknowledgement/metadata evidence review; SELECT-only, no inference."""

from __future__ import annotations

import argparse
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from pydantic import model_validator

from python.operations.export_broker_acknowledgements import export
from python.research.broker_acknowledgement_evidence import AcknowledgementPacket
from python.research.broker_metadata_evidence import MetadataObservation, filename
from python.research.codex_loop import StrictModel, timestamp
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import bounded, immutable
from python.research.learning_evidence import Digest, Instant, encoded
from python.research.observation_cycle import sha


class Association(StrictModel):
    acknowledgementId: str
    metadataSha256: Digest | None
    relationship: Literal["PRIOR_LOCAL_RESPONSE_WITHIN_30S", "UNAVAILABLE"]
    originalBrokerStateProven: Literal[False]


class EvidenceReview(StrictModel):
    schemaVersion: Literal["broker-evidence-review-1.0"]
    source: str
    start: Instant
    until: Instant
    databaseSnapshotAt: Instant
    acknowledgements: AcknowledgementPacket
    metadataObservations: list[MetadataObservation]
    associations: list[Association]
    missingMetadata: int
    coverage: Literal["BOUNDED_CALLBACKS_AND_LOCAL_METADATA_OBSERVATIONS_NO_INTERPOLATION"]
    accountScopeBasis: Literal["RECORDER_CONFIGURATION_NOT_INDEPENDENT_BROKER_IDENTITY"]
    actualCounterfactualCosts: None
    economicQualification: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]
    capturedAt: Instant | None = None
    collectorSourceSha256: Digest | None = None
    registrationSha256: Digest | None = None
    collectionStatus: Literal["DIAGNOSTIC", "REGISTERED_FUTURE_BASELINE"] = "DIAGNOSTIC"

    @model_validator(mode="after")
    def complete(self) -> EvidenceReview:
        packet = self.acknowledgements
        if (self.source, self.start, self.until, self.databaseSnapshotAt) != (
            packet.source,
            packet.start,
            packet.until,
            packet.snapshotAt,
        ) or [v.acknowledgementId for v in self.associations] != [
            v.id for v in packet.observations
        ]:
            raise ValueError("EVIDENCE_REVIEW_BINDING")
        if self.missingMetadata != sum(v.metadataSha256 is None for v in self.associations):
            raise ValueError("EVIDENCE_REVIEW_AVAILABILITY")
        metadata = {v.evidenceSha256: v for v in self.metadataObservations}
        if len(metadata) != len(self.metadataObservations):
            raise ValueError("EVIDENCE_REVIEW_DUPLICATE")
        selected = set()
        for ack, link in zip(packet.observations, self.associations, strict=True):
            if link.metadataSha256 is None:
                if link.relationship != "UNAVAILABLE":
                    raise ValueError("EVIDENCE_REVIEW_AVAILABILITY")
            else:
                value = metadata.get(link.metadataSha256)
                if (
                    value is None
                    or link.relationship != "PRIOR_LOCAL_RESPONSE_WITHIN_30S"
                    or not (
                        timedelta(0)
                        <= timestamp(ack.receivedAt) - timestamp(value.responseReceivedAt)
                        <= timedelta(seconds=30)
                    )
                ):
                    raise ValueError("EVIDENCE_REVIEW_CAUSALITY")
                selected.add(link.metadataSha256)
        if selected != set(metadata):
            raise ValueError("EVIDENCE_REVIEW_UNUSED_METADATA")
        return self


class EvidenceRegistration(StrictModel):
    schemaVersion: Literal["broker-evidence-registration-1.0"]
    registeredAt: Instant
    start: Instant
    until: Instant
    economicRelease: Literal["0.8.0-model-scalp.1-codex.1"]
    sourceFiles: dict[str, Digest]
    collectionOnly: Literal[True]
    economicQualification: Literal[False]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="after")
    def future(self) -> EvidenceRegistration:
        if not timestamp(self.registeredAt) < timestamp(self.start) < timestamp(self.until):
            raise ValueError("REGISTRATION_FUTURE_REQUIRED")
        expected = {
            "python/operations/broker_evidence_review.py",
            "python/operations/export_broker_acknowledgements.py",
            "python/operations/setup_flight_recorder.py",
            "python/research/broker_metadata_evidence.py",
            "python/research/broker_acknowledgement_evidence.py",
            "packages/config/src/policy.ts",
        }
        if set(self.sourceFiles) != expected:
            raise ValueError("REGISTRATION_SOURCE_SET")
        return self


def registration(path: Path, source: Path) -> tuple[EvidenceRegistration, str]:
    trusted_path(path)
    raw = bounded(path, 32768)
    value = EvidenceRegistration.model_validate_json(raw)
    if any(
        sha((source / name).read_bytes()) != digest for name, digest in value.sourceFiles.items()
    ):
        raise ValueError("EVIDENCE_REVIEW_SOURCE_DRIFT")
    return value, sha(raw)


def associate(
    packet: AcknowledgementPacket, directory: Path, symbol: str = "XAUUSD"
) -> dict[str, Any]:
    start = timestamp(packet.start) - timedelta(seconds=30)
    until = timestamp(packet.until)
    values = []
    for day in sorted({start.date(), until.date()}):
        paths = sorted(directory.glob("metadata-" + day.strftime("%Y%m%d") + "T*.json"))
        if len(paths) > 4000:
            raise ValueError("METADATA_EVIDENCE_CAPACITY")
        for p in paths:
            try:
                at = datetime.strptime(p.name[9:30], "%Y%m%dT%H%M%S%f").replace(tzinfo=UTC)
            except ValueError:
                raise ValueError("METADATA_EVIDENCE_NAME") from None
            if not start <= at < until:
                continue
            value = MetadataObservation.model_validate_json(bounded(p, 32768))
            if filename(value) != p.name:
                raise ValueError("METADATA_EVIDENCE_NAME")
            if value.symbol == symbol and value.reportedSymbol == symbol:
                values.append(value)
    values.sort(key=lambda v: (timestamp(v.responseReceivedAt), v.evidenceSha256))
    links = []
    selected = {}
    for ack in packet.observations:
        at = timestamp(ack.receivedAt)
        eligible = [
            v
            for v in values
            if timedelta(0) <= at - timestamp(v.responseReceivedAt) <= timedelta(seconds=30)
        ]
        meta = eligible[-1] if eligible else None
        if meta is not None:
            selected[meta.evidenceSha256] = meta.model_dump()
        links.append(
            {
                "acknowledgementId": ack.id,
                "metadataSha256": meta.evidenceSha256 if meta else None,
                "relationship": "PRIOR_LOCAL_RESPONSE_WITHIN_30S" if meta else "UNAVAILABLE",
                "originalBrokerStateProven": False,
            }
        )
    return EvidenceReview.model_validate(
        {
            "schemaVersion": "broker-evidence-review-1.0",
            "source": packet.source,
            "start": packet.start,
            "until": packet.until,
            "databaseSnapshotAt": packet.snapshotAt,
            "acknowledgements": packet.model_dump(),
            "metadataObservations": list(selected.values()),
            "associations": links,
            "missingMetadata": sum(v["metadataSha256"] is None for v in links),
            "coverage": "BOUNDED_CALLBACKS_AND_LOCAL_METADATA_OBSERVATIONS_NO_INTERPOLATION",
            "accountScopeBasis": "RECORDER_CONFIGURATION_NOT_INDEPENDENT_BROKER_IDENTITY",
            "actualCounterfactualCosts": None,
            "economicQualification": False,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
    ).model_dump()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--registration", type=Path, required=True)
    args = parser.parse_args()
    frozen, registration_sha = registration(args.registration, Path(__file__).resolve().parents[2])
    if os.geteuid() == 0:
        raise ValueError("EVIDENCE_DEDICATED_USER_REQUIRED")
    now = datetime.now(UTC)
    until = now.replace(minute=0, second=0, microsecond=0)
    start = until - timedelta(hours=1)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = args.output / ("hour-" + start.strftime("%Y%m%dT%H%M") + ".json")
    if path.exists():
        EvidenceReview.model_validate_json(bounded(path, 2 * 1024 * 1024))
        print("EVIDENCE_WINDOW_ALREADY_RETAINED")
        return
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=10000",
    ) as db:
        packet = export(
            db,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            "scalper-epoch314",
            start,
            until,
        )
    result = associate(packet, args.metadata)
    result["registrationSha256"] = registration_sha
    result["collectionStatus"] = (
        "REGISTERED_FUTURE_BASELINE"
        if (timestamp(frozen.start) <= start and until <= timestamp(frozen.until))
        else "DIAGNOSTIC"
    )
    result["capturedAt"] = now.isoformat()
    result["collectorSourceSha256"] = sha(Path(__file__).read_bytes())
    if len(encoded(result)) > 2 * 1024 * 1024:
        raise ValueError("METADATA_EVIDENCE_CAPACITY")
    immutable(path, EvidenceReview.model_validate(result).model_dump())
    print("BROKER_EVIDENCE_WINDOW_RETAINED")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("BROKER_EVIDENCE_REVIEW_FAILED") from None
