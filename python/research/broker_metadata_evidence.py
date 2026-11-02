"""Independent metadata response receipts, never original acknowledgement facts."""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_archive import atomic_bytes, bounded
from python.research.learning_evidence import Digest, Instant, Number, encoded
from python.research.observation_cycle import sha

NUMERIC = (
    "pipSize",
    "tickSize",
    "tickValue",
    "volumeScale",
    "minVolume",
    "maxVolume",
    "volumeStep",
    "quoteToAccountConversionRate",
    "commissionRate",
    "commissionMinimum",
    "pnlConversionFeeRate",
)
CATEGORICAL = (
    "baseAsset",
    "quoteAsset",
    "accountAsset",
    "commissionType",
    "minimumType",
    "minimumAsset",
)


class MetadataObservation(StrictModel):
    schemaVersion: Literal["broker-metadata-observation-1.0"]
    symbol: str = Field(pattern=r"^[A-Z0-9._-]{1,32}$")
    requestStartedAt: Instant
    responseReceivedAt: Instant
    brokerSourceTime: None
    adapterMetadataAt: Instant | None
    reportedSymbol: str | None = Field(pattern=r"^[A-Z0-9._-]{1,32}$")
    provenance: Literal["BROKER_METADATA_ENDPOINT_RESPONSE_NOT_ORIGINAL_ACK"]
    actualClosingCosts: None
    terms: dict[str, Number | None]
    categories: dict[str, str | None]
    unavailableFields: list[str]
    evidenceSha256: Digest

    @model_validator(mode="after")
    def binding(self) -> MetadataObservation:
        if (
            set(self.terms) != set(NUMERIC)
            or set(self.categories) != set(CATEGORICAL)
            or timestamp(self.requestStartedAt) > timestamp(self.responseReceivedAt)
        ):
            raise ValueError("METADATA_EVIDENCE_INVALID")
        if any(
            v is not None and not re.fullmatch("[A-Z][A-Z0-9_]{0,39}", v)
            for v in self.categories.values()
        ):
            raise ValueError("METADATA_EVIDENCE_INVALID")
        absent = sorted(
            k
            for k, v in {
                **self.terms,
                **self.categories,
                "adapterMetadataAt": self.adapterMetadataAt,
                "reportedSymbol": self.reportedSymbol,
            }.items()
            if v is None
        )
        if self.unavailableFields != absent:
            raise ValueError("METADATA_EVIDENCE_AVAILABILITY")
        if sha(encoded(self.model_dump(exclude={"evidenceSha256"}))) != self.evidenceSha256:
            raise ValueError("METADATA_EVIDENCE_HASH")
        return self


def observation(
    metadata: dict[str, Any], symbol: str, started: datetime, received: datetime
) -> MetadataObservation:
    commission = (
        dict(metadata["commission"]) if isinstance(metadata.get("commission"), dict) else {}
    )
    raw = {
        **metadata,
        "commissionRate": commission.get("rate"),
        "commissionMinimum": commission.get("minimum"),
        "pnlConversionFeeRate": commission.get("pnlConversionFeeRate"),
        "commissionType": commission.get("type"),
        "minimumType": commission.get("minimumType"),
        "minimumAsset": commission.get("minimumAsset"),
    }
    terms = {
        k: v
        if isinstance(v := raw.get(k), str)
        and len(v) <= 80
        and re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", v)
        else None
        for k in NUMERIC
    }
    categories = {
        k: v
        if isinstance(v := raw.get(k), str) and re.fullmatch("[A-Z][A-Z0-9_]{0,39}", v)
        else None
        for k in CATEGORICAL
    }
    for key, term in terms.items():
        if term is not None and (
            Decimal(term) < 0
            or (
                key not in {"commissionRate", "commissionMinimum", "pnlConversionFeeRate"}
                and Decimal(term) == 0
            )
        ):
            terms[key] = None
    adapter_time = metadata.get("metadataTime")
    try:
        if not isinstance(adapter_time, str) or timestamp(adapter_time) > received:
            adapter_time = None
    except ValueError:
        adapter_time = None
    reported = metadata.get("symbolName")
    reported = (
        reported
        if isinstance(reported, str) and re.fullmatch("[A-Z0-9._-]{1,32}", reported)
        else None
    )
    value = {
        "schemaVersion": "broker-metadata-observation-1.0",
        "symbol": symbol,
        "requestStartedAt": started.isoformat(),
        "responseReceivedAt": received.isoformat(),
        "brokerSourceTime": None,
        "adapterMetadataAt": adapter_time,
        "reportedSymbol": reported,
        "provenance": "BROKER_METADATA_ENDPOINT_RESPONSE_NOT_ORIGINAL_ACK",
        "actualClosingCosts": None,
        "terms": terms,
        "categories": categories,
        "unavailableFields": sorted(
            k
            for k, v in {
                **terms,
                **categories,
                "adapterMetadataAt": adapter_time,
                "reportedSymbol": reported,
            }.items()
            if v is None
        ),
    }
    return MetadataObservation.model_validate({**value, "evidenceSha256": sha(encoded(value))})


def filename(value: MetadataObservation) -> str:
    return (
        "metadata-"
        + timestamp(value.responseReceivedAt).strftime("%Y%m%dT%H%M%S%f")
        + "-"
        + value.evidenceSha256[:16]
        + ".json"
    )


def persist(directory: Path, value: MetadataObservation) -> int:
    raw = encoded(value.model_dump())
    p = directory / filename(value)
    if p.exists():
        if bounded(p, 32768) != raw:
            raise ValueError("METADATA_EVIDENCE_CONFLICT")
        return 0
    atomic_bytes(p, raw, replace=False)
    p.chmod(0o400)
    return len(raw)
