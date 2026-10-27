from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg
import pytest

from python.operations.export_entry_evidence import export
from python.operations.setup_flight_recorder import load_setup
from tests.python.test_storage_database import database as database


def test_scoped_failed_intents_and_compact_completed_candles_are_retained(
    database: psycopg.Connection[dict[str, Any]],
) -> None:
    account, symbol, strategy, analysis, group, snapshot = (str(uuid4()) for _ in range(6))
    now = datetime.now(UTC)
    at = now.replace(second=0, microsecond=0) - timedelta(minutes=3)
    database.execute(
        """INSERT INTO accounts(id,provider_account_key_hash,environment,account_type,currency)
                     VALUES(%s,%s,'demo','demo','USD')""",
        (account, "a" * 64),
    )
    database.execute(
        """INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,
                     metadata_revision,metadata_at,volume_scale)
                     VALUES(%s,%s,'fixture','XAUUSD',2,0.01,'fixture',%s,0.01)""",
        (symbol, account, at),
    )
    database.execute(
        """INSERT INTO strategy_versions(id,version,code_hash,config_hash,
                     prompt_version,schema_version,feature_version)
                     VALUES(%s,'entry-fixture','fixture','fixture','fixture','fixture','fixture')""",
        (strategy,),
    )
    database.execute(
        """INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,
                     mode,state,analysis_time)
                     VALUES(%s,%s,%s,%s,'demo','REJECTED',%s)""",
        (analysis, account, symbol, strategy, at),
    )
    database.execute(
        """INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,created_at)
                     VALUES(%s,%s,%s,'demo','FAILED',%s,%s)""",
        (group, analysis, group, at + timedelta(minutes=5), at),
    )
    database.execute(
        """INSERT INTO candle_snapshots(id,account_id,symbol_id,analysis_time,server_time,
                     received_at,
                     max_skew_ms,complete,quality_flags,created_at)
                     VALUES(%s,%s,%s,%s,%s,%s,0,true,'["DECISION_COMPACT_V1"]',%s)""",
        (snapshot, account, symbol, at, at, at, at),
    )
    database.execute(
        """INSERT INTO candles(id,snapshot_id,timeframe,start_time,end_time,
                     open,high,low,close,complete)
                     VALUES(%s,%s,'M1',%s,%s,4000,4001,3999,4000,true)""",
        (str(uuid4()), snapshot, at, at + timedelta(minutes=1)),
    )
    database.commit()
    key = hashlib.sha256(group.encode()).hexdigest()[:24]
    s = load_setup(database, "a" * 64, "XAUUSD", key)
    assert s is not None and s["state"] == "FAILED" and s["entryContext"]["state"] == "UNAVAILABLE"
    b = export(database, "a" * 64, "XAUUSD", "entry-fixture", at - timedelta(seconds=1), now)
    assert len(b["setups"]) == 1 and len(b["completedM1"]) == 1
    assert b["setups"][0]["closedTrades"] == []
    assert b["completedM1"][0]["availableAt"] == (at + timedelta(minutes=1)).isoformat()
    assert not export(database, "b" * 64, "XAUUSD", "entry-fixture", at, now)["setups"]
    assert not export(database, "a" * 64, "OTHER", "entry-fixture", at, now)["setups"]
    with database.transaction():
        database.execute("SET TRANSACTION READ ONLY")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            database.execute("DELETE FROM orders")
