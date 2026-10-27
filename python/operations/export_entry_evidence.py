"""SELECT-only bounded setup/context export, using existing immutable provider evidence."""

from __future__ import annotations

import argparse
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from python.backtest.breakout_entry_review import write_new
from python.operations.entry_context import timestamp
from python.operations.setup_flight_recorder import load_setup


def export(
    connection: psycopg.Connection[dict[str, Any]],
    account: str,
    symbol: str,
    release: str,
    start: datetime,
    until: datetime,
) -> dict[str, Any]:
    if (
        not re.fullmatch(r"[a-f0-9]{64}", account)
        or not re.fullmatch(r"[A-Z0-9._-]{1,32}", symbol)
        or not re.fullmatch(r"[0-9A-Za-z.-]{1,80}", release)
        or not start < until <= datetime.now(UTC)
        or until - start > timedelta(days=31)
    ):
        raise ValueError("ENTRY_EXPORT_SCOPE_INVALID")
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        ids = connection.execute(
            """SELECT substr(encode(sha256(convert_to(g.id::text,'UTF8')),'hex'),1,24) setup
            FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id
            JOIN accounts ac ON ac.id=a.account_id JOIN symbols sy ON sy.id=a.symbol_id
            JOIN strategy_versions sv ON sv.id=a.strategy_version_id
            WHERE ac.provider_account_key_hash=%s AND ac.environment='demo' AND sy.name=%s
              AND sv.version=%s AND g.mode='demo' AND a.mode='demo'
              AND g.created_at >= %s AND g.created_at < %s ORDER BY g.created_at,g.id LIMIT 1001""",
            (account, symbol, release, start, until),
        ).fetchall()
        if len(ids) > 1000:
            raise ValueError("ENTRY_EXPORT_SETUP_LIMIT")
        candles = connection.execute(
            """SELECT c.start_time,c.end_time,
              min(greatest(cs.created_at,cs.received_at,c.end_time)) available_at,
              min(c.close)::text close,count(DISTINCT c.close) versions
            FROM candle_snapshots cs JOIN decision_candles c ON c.snapshot_id=cs.id
            JOIN accounts ac ON ac.id=cs.account_id JOIN symbols sy ON sy.id=cs.symbol_id
            WHERE ac.provider_account_key_hash=%s AND ac.environment='demo' AND sy.name=%s
              AND cs.created_at >= %s AND cs.created_at < %s AND cs.complete
              AND cs.quality_flags <@ '["DECISION_COMPACT_V1"]'::jsonb
              AND c.timeframe='M1' AND c.complete
              AND c.quality_flags='[]'::jsonb AND c.start_time >= %s AND c.end_time < %s
            GROUP BY c.start_time,c.end_time ORDER BY c.end_time LIMIT 44642""",
            (account, symbol, start, until, start, until),
        ).fetchall()
    setups = []
    for row in ids:
        item = load_setup(connection, account, symbol, row["setup"])
        if item is None or item["originRelease"] != release:
            raise ValueError("ENTRY_EXPORT_SETUP_UNAVAILABLE")
        # Exact context/protection/close evidence can be observed later; the review
        # filters path/confirmation by causal availability and its explicit cutoff.
        setups.append(item)
    return {
        "schemaVersion": "entry-evidence-input-1.0",
        "release": release,
        "from": start.isoformat(),
        "until": until.isoformat(),
        "exportedAt": datetime.now(UTC).isoformat(),
        "snapshotScope": "SEPARATE_REPEATABLE_READ_PER_SETUP",
        "setups": setups,
        "completedM1": [
            {
                "startTime": r["start_time"].isoformat(),
                "endTime": r["end_time"].isoformat(),
                "availableAt": r["available_at"].isoformat(),
                "close": r["close"],
                "complete": True,
            }
            for r in candles
            if r["versions"] == 1
        ],
        "conflictingM1CandlesCensored": sum(r["versions"] != 1 for r in candles),
        "brokerAuthority": False,
        "counterfactualNet": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", required=True)
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=15000",
    ) as connection:
        result = export(
            connection,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            args.release,
            timestamp(args.start),
            timestamp(args.until),
        )
    write_new(args.output, result)


if __name__ == "__main__":
    main()
