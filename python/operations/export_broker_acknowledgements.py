"""Export bounded, SELECT-only broker acknowledgement evidence for research."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from python.operations.entry_context import timestamp
from python.research.broker_acknowledgement_evidence import AcknowledgementPacket, observed_clock
from python.research.learning_evidence import identity

if TYPE_CHECKING:
    import psycopg


def export(
    connection: psycopg.Connection[dict[str, Any]],
    account: str,
    symbol: str,
    source: str,
    start: datetime,
    until: datetime,
) -> AcknowledgementPacket:
    if (
        not re.fullmatch(r"[a-f0-9]{64}", account)
        or not re.fullmatch(r"[A-Z0-9._-]{1,32}", symbol)
        or not re.fullmatch(r"[a-zA-Z0-9._-]{1,80}", source)
        or start.tzinfo is None
        or until.tzinfo is None
        or not start < until <= datetime.now(UTC)
        or until - start > timedelta(hours=1)
    ):
        raise ValueError("ACK_EXPORT_SCOPE_INVALID")
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        connection.execute("SET LOCAL statement_timeout='10s'")
        snapshot_row = connection.execute("SELECT clock_timestamp() at").fetchone()
        if snapshot_row is None:
            raise ValueError("ACK_EXPORT_SNAPSHOT_UNAVAILABLE")
        snapshot = snapshot_row["at"]
        scopes = connection.execute(
            """SELECT a.id account_id,s.id symbol_id FROM accounts a
            JOIN symbols s ON s.account_id=a.id WHERE a.provider='ctrader'
            AND a.provider_account_key_hash=%s AND a.environment='demo'
            AND a.account_type='demo' AND s.name=%s LIMIT 2""",
            (account, symbol),
        ).fetchall()
        if len(scopes) != 1:
            raise ValueError("ACK_EXPORT_SCOPE_UNAVAILABLE")
        rows = connection.execute(
            """SELECT a.id,a.event_id,a.event_payload_hash,a.evidence_hash,
            CASE WHEN pg_column_size(a.evidence)<=16384 THEN a.evidence ELSE NULL END evidence,
            a.received_at,a.persisted_at,e.broker_event_key
            FROM broker_acknowledgement_evidence a
            JOIN broker_execution_events e ON e.id=a.event_id
            WHERE e.account_id=%s AND e.symbol_id=%s
              AND a.persisted_at >= %s AND a.persisted_at < %s
            ORDER BY a.persisted_at,a.id LIMIT 501""",
            (scopes[0]["account_id"], scopes[0]["symbol_id"], start, until),
        ).fetchall()
        if len(rows) > 500:
            raise ValueError("ACK_EXPORT_ROW_LIMIT")
        observations = []
        for row in rows:
            value = row["evidence"]
            keys = (
                "schemaVersion",
                "eventKey",
                "receivedAt",
                "brokerOrderType",
                "stopPrice",
                "slippageInPoints",
                "timeInForce",
                "expirationTimestamp",
                "brokerUpdatedAt",
                "invalidFields",
            )
            if not isinstance(value, dict) or set(value) != {*keys, "evidenceHash"}:
                raise ValueError("ACK_EXPORT_EVIDENCE_INVALID")
            payload = {key: value[key] for key in keys}
            digest = hashlib.sha256(
                json.dumps(
                    payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False
                ).encode()
            ).hexdigest()
            if (
                value["schemaVersion"] != "broker-acknowledgement-1.0"
                or value["eventKey"] != row["broker_event_key"]
                or digest != value["evidenceHash"]
                or digest != row["evidence_hash"]
                or timestamp(value["receivedAt"]) != timestamp(row["received_at"])
                or timestamp(row["persisted_at"]) > timestamp(snapshot)
            ):
                raise ValueError("ACK_EXPORT_EVIDENCE_MISMATCH")
            observed = {
                "id": identity(row["id"]),
                "eventId": identity(row["event_id"]),
                "eventPayloadSha256": row["event_payload_hash"],
                "orderType": value["brokerOrderType"],
                "metadataAvailability": "NOT_CAPTURED",
                "evidenceSha256": digest,
                "stopPrice": value["stopPrice"],
                "slippageInPoints": value["slippageInPoints"],
                "timeInForce": value["timeInForce"],
                "expirationAt": value["expirationTimestamp"],
                "brokerUpdatedAt": value["brokerUpdatedAt"],
                "receivedAt": value["receivedAt"],
                "persistedAt": timestamp(row["persisted_at"]).isoformat(),
                "invalidFields": value["invalidFields"],
            }
            observed["clockStatus"] = observed_clock(
                observed["brokerUpdatedAt"], observed["receivedAt"], observed["persistedAt"]
            )
            observations.append(observed)
    return AcknowledgementPacket.model_validate(
        {
            "schemaVersion": "broker-acknowledgement-evidence-1.0",
            "source": source,
            "start": start.isoformat(),
            "until": until.isoformat(),
            "snapshotAt": timestamp(snapshot).isoformat(),
            "observations": observations,
            "coverage": "PERSISTED_CALLBACKS_ONLY_ABSENCE_UNKNOWN",
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
    )


def main() -> None:
    import psycopg
    from psycopg.rows import dict_row

    from python.backtest.breakout_entry_review import write_new

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=10000",
    ) as connection:
        result = export(
            connection,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            args.source,
            timestamp(args.start),
            timestamp(args.until),
        )
    write_new(args.output, result.model_dump())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("ACK_EXPORT_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
