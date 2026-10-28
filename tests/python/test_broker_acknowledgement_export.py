from __future__ import annotations

import hashlib
import json
from contextlib import nullcontext
from copy import deepcopy
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from python.operations.export_broker_acknowledgements import export
from python.research.broker_acknowledgement_evidence import AcknowledgementPacket

START = datetime(2026, 1, 1, tzinfo=UTC)
END = datetime(2026, 1, 1, 1, tzinfo=UTC)


def row() -> dict:
    payload = {
        "schemaVersion": "broker-acknowledgement-1.0",
        "eventKey": "event:" + "b" * 64,
        "receivedAt": "2026-01-01T00:01:00.000Z",
        "brokerOrderType": 6,
        "stopPrice": "4000.5",
        "slippageInPoints": "30",
        "timeInForce": 1,
        "expirationTimestamp": "2026-01-01T00:05:00.000Z",
        "brokerUpdatedAt": "2026-01-01T00:00:59.000Z",
        "invalidFields": [],
    }
    digest = hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()
    return {
        "id": "private-row",
        "event_id": "private-event",
        "event_payload_hash": "a" * 64,
        "evidence_hash": digest,
        "evidence": {**payload, "evidenceHash": digest},
        "received_at": datetime(2026, 1, 1, 0, 1, tzinfo=UTC),
        "persisted_at": datetime(2026, 1, 1, 0, 1, 1, tzinfo=UTC),
        "broker_event_key": payload["eventKey"],
        "broker_order_type": 3,
    }


class Result:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def fetchone(self) -> dict | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[dict]:
        return self.rows


class Connection:
    def __init__(self, rows: list[dict], scope: int = 1) -> None:
        self.rows, self.scope = rows, scope

    def transaction(self):
        return nullcontext()

    def execute(self, sql: str, args: object = None) -> Result:
        if "clock_timestamp() at" in sql:
            return Result([{"at": END}])
        if "SELECT a.id account_id" in sql:
            return Result([{"account_id": "private", "symbol_id": "private"}] * self.scope)
        if "FROM broker_acknowledgement_evidence" in sql:
            return Result(self.rows)
        return Result([])


def run(rows: list[dict], scope: int = 1) -> AcknowledgementPacket:
    return export(Connection(rows, scope), "a" * 64, "XAUUSD", "tc01", START, END)  # type: ignore[arg-type]


def test_export_preserves_verified_terms_without_private_ids() -> None:
    packet = run([row()])
    value = packet.model_dump()
    assert value["observations"][0]["stopPrice"] == "4000.5"
    assert value["observations"][0]["orderType"] == 6
    assert value["observations"][0]["clockStatus"] == "ORDERED"
    assert "private-event" not in json.dumps(value)
    assert packet.coverage == "PERSISTED_CALLBACKS_ONLY_ABSENCE_UNKNOWN"


def test_invalid_optional_terms_export_as_explicitly_unavailable() -> None:
    value = row()
    evidence = value["evidence"]
    evidence["stopPrice"] = None
    evidence["expirationTimestamp"] = None
    evidence["invalidFields"] = ["stopPrice", "expirationTimestamp"]
    payload = {key: item for key, item in evidence.items() if key != "evidenceHash"}
    digest = hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()
    evidence["evidenceHash"] = value["evidence_hash"] = digest
    observation = run([value]).observations[0]
    assert observation.stopPrice is None
    assert observation.expirationAt is None
    assert observation.invalidFields == ["stopPrice", "expirationTimestamp"]


def test_export_rejects_tampered_evidence_and_scope_ambiguity() -> None:
    changed = deepcopy(row())
    changed["evidence"]["stopPrice"] = "4001"
    with pytest.raises(ValueError, match="ACK_EXPORT_EVIDENCE_MISMATCH"):
        run([changed])
    with pytest.raises(ValueError, match="ACK_EXPORT_SCOPE_UNAVAILABLE"):
        run([], 2)
    with pytest.raises(ValueError, match="ACK_EXPORT_ROW_LIMIT"):
        run([row()] * 501)


def test_packet_never_grants_authority_or_hides_bad_clocks() -> None:
    value = run([row()]).model_dump()
    value["brokerAuthority"] = 0
    with pytest.raises(ValidationError):
        AcknowledgementPacket.model_validate(value)
    value = run([row()]).model_dump()
    value["observations"][0]["clockStatus"] = "UNORDERED"
    with pytest.raises(ValidationError):
        AcknowledgementPacket.model_validate(value)


def test_schema_and_fixture_match_python_contract() -> None:
    from pathlib import Path

    schema = json.loads(Path("schemas/broker-acknowledgement-evidence-1.0.json").read_text())
    schema.pop("$schema")
    assert schema == AcknowledgementPacket.model_json_schema()
    fixture = json.loads(
        Path("tests/fixtures/broker-acknowledgement-evidence-1.0.json").read_text()
    )
    AcknowledgementPacket.model_validate(fixture)


def test_export_reads_scoped_postgres_rows() -> None:
    import os
    from uuid import uuid4

    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb

    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("requires isolated PostgreSQL")
    schema = "ack_export_" + uuid4().hex
    account_id, symbol_id, event_id, evidence_id = (uuid4() for _ in range(4))
    data = row()
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
        try:
            with psycopg.connect(
                dsn, autocommit=True, row_factory=dict_row, options=f"-c search_path={schema}"
            ) as conn:
                conn.execute(
                    "CREATE TABLE accounts (id uuid, provider text, "
                    "provider_account_key_hash text, environment text, account_type text)"
                )
                conn.execute("CREATE TABLE symbols (id uuid, account_id uuid, name text)")
                conn.execute(
                    "CREATE TABLE broker_execution_events (id uuid, account_id uuid, "
                    "symbol_id uuid, broker_event_key text, broker_order_type integer)"
                )
                conn.execute(
                    "CREATE TABLE broker_acknowledgement_evidence (id uuid, event_id uuid, "
                    "event_payload_hash text, evidence_hash text, evidence jsonb, "
                    "received_at timestamptz, persisted_at timestamptz)"
                )
                conn.execute(
                    "INSERT INTO accounts VALUES (%s,'ctrader',%s,'demo','demo')",
                    (account_id, "a" * 64),
                )
                conn.execute("INSERT INTO symbols VALUES (%s,%s,'XAUUSD')", (symbol_id, account_id))
                conn.execute(
                    "INSERT INTO broker_execution_events VALUES (%s,%s,%s,%s,3)",
                    (event_id, account_id, symbol_id, data["broker_event_key"]),
                )
                conn.execute(
                    "INSERT INTO broker_acknowledgement_evidence VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (
                        evidence_id,
                        event_id,
                        data["event_payload_hash"],
                        data["evidence_hash"],
                        Jsonb(data["evidence"]),
                        data["received_at"],
                        data["persisted_at"],
                    ),
                )
                packet = export(conn, "a" * 64, "XAUUSD", "tc01", START, END)
                assert len(packet.observations) == 1
                assert packet.observations[0].stopPrice == "4000.5"
                assert packet.observations[0].orderType == 6
        finally:
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
