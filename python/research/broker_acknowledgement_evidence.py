"""Independent read-only callback evidence; no order or promotion authority."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from python.operations.entry_context import timestamp
from python.research.codex_loop import StrictModel
from python.research.learning_evidence import (
    Digest,
    Identity,
    Instant,
    Number,
    clock_status,
)

FieldName = Literal[
    "stopPrice", "slippageInPoints", "timeInForce", "expirationTimestamp", "utcLastUpdateTimestamp"
]


def observed_clock(*values: str | None) -> Literal["ORDERED", "UNORDERED", "INCOMPLETE"]:
    result = clock_status(*values)
    return "ORDERED" if result == "CAUSAL" else result


class Acknowledgement(StrictModel):
    id: Identity
    eventId: Identity
    eventPayloadSha256: Digest
    orderType: Literal[3, 6]
    metadataAvailability: Literal["NOT_CAPTURED"]
    evidenceSha256: Digest
    stopPrice: Number | None
    slippageInPoints: Annotated[str, Field(pattern=r"^[1-9][0-9]{0,18}$")] | None
    timeInForce: Annotated[int, Field(ge=1, le=5)] | None
    expirationAt: Instant | None
    brokerUpdatedAt: Instant | None
    receivedAt: Instant
    persistedAt: Instant
    invalidFields: Annotated[list[FieldName], Field(max_length=5)]
    clockStatus: Literal["ORDERED", "UNORDERED", "INCOMPLETE"]

    @model_validator(mode="after")
    def clocks(self) -> Acknowledgement:
        if self.clockStatus != observed_clock(
            self.brokerUpdatedAt, self.receivedAt, self.persistedAt
        ):
            raise ValueError("ACKNOWLEDGEMENT_CLOCK_INVALID")
        if len(set(self.invalidFields)) != len(self.invalidFields):
            raise ValueError("ACKNOWLEDGEMENT_INVALID_FIELDS_DUPLICATE")
        fields = {
            "stopPrice": self.stopPrice,
            "slippageInPoints": self.slippageInPoints,
            "timeInForce": self.timeInForce,
            "expirationTimestamp": self.expirationAt,
            "utcLastUpdateTimestamp": self.brokerUpdatedAt,
        }
        if any(fields[field] is not None for field in self.invalidFields):
            raise ValueError("ACKNOWLEDGEMENT_INVALID_FIELD_PRESENT")
        if self.stopPrice is not None and Decimal(self.stopPrice) <= 0:
            raise ValueError("ACKNOWLEDGEMENT_STOP_PRICE_INVALID")
        if self.slippageInPoints is not None and int(self.slippageInPoints) > 9223372036854775807:
            raise ValueError("ACKNOWLEDGEMENT_SLIPPAGE_INVALID")
        return self


class AcknowledgementPacket(StrictModel):
    schemaVersion: Literal["broker-acknowledgement-evidence-1.0"]
    source: Annotated[str, Field(pattern=r"^[a-zA-Z0-9._-]{1,80}$")]
    start: Instant
    until: Instant
    snapshotAt: Instant
    observations: Annotated[list[Acknowledgement], Field(max_length=500)]
    coverage: Literal["PERSISTED_CALLBACKS_ONLY_ABSENCE_UNKNOWN"]
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="before")
    @classmethod
    def no_authority(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(
            value.get(key) is not False for key in ("brokerAuthority", "promotionAuthority")
        ):
            raise ValueError("ACK_AUTHORITY_INVALID")
        return value

    @model_validator(mode="after")
    def scope(self) -> AcknowledgementPacket:
        if not timestamp(self.start) < timestamp(self.until) <= timestamp(self.snapshotAt):
            raise ValueError("ACK_PACKET_CLOCK_INVALID")
        if len({record.id for record in self.observations}) != len(self.observations):
            raise ValueError("ACK_PACKET_DUPLICATE")
        if any(
            not timestamp(self.start) <= timestamp(record.persistedAt) < timestamp(self.until)
            or timestamp(record.persistedAt) > timestamp(self.snapshotAt)
            for record in self.observations
        ):
            raise ValueError("ACK_PACKET_OBSERVATION_SCOPE_INVALID")
        return self
