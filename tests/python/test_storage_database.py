from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql

from python.operations import storage
from tests.python.test_storage_operations import backup_fixture, segment_fixture


@pytest.fixture
def database(monkeypatch: pytest.MonkeyPatch) -> Iterator[psycopg.Connection[dict[str, Any]]]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("isolated TEST_DATABASE_URL required")
    original = storage.database_connection
    schema = "storage_python_" + uuid4().hex
    with original(url) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))

    def connect(_url: str) -> psycopg.Connection[dict[str, Any]]:
        connection = original(url)
        connection.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        connection.commit()
        return connection

    monkeypatch.setattr(storage, "database_connection", connect)
    connection = connect(url)
    try:
        for path in sorted(Path("migrations").glob("*.sql")):
            connection.execute(path.read_text())
        connection.commit()
        yield connection
    finally:
        connection.close()
        with original(url) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def identity(connection: psycopg.Connection[dict[str, Any]]) -> tuple[str, str]:
    account, symbol = str(uuid4()), str(uuid4())
    connection.execute(
        """INSERT INTO accounts
        (id,provider,provider_account_key_hash,environment,account_type,currency)
        VALUES(%s,'paper',%s,'paper','paper','USD')""",
        (account, "a" * 64),
    )
    connection.execute(
        """INSERT INTO symbols
        (id,account_id,provider_symbol_id,name,digits,tick_size,
         metadata_revision,metadata_at,volume_scale)
        VALUES(%s,%s,'fixture','XAUUSD',2,0.01,'fixture',now(),0.01)""",
        (symbol, account),
    )
    return account, symbol


def test_archive_precedes_cache_eviction_and_failed_commit_preserves_source(
    database: psycopg.Connection[dict[str, Any]], tmp_path: Path
) -> None:
    account, symbol = identity(database)
    strategy, analysis, context = str(uuid4()), str(uuid4()), str(uuid4())
    at = datetime.now(UTC) - timedelta(days=8)
    database.execute(
        """INSERT INTO strategy_versions
        (id,version,code_hash,config_hash,prompt_version,schema_version,feature_version)
        VALUES(%s,'fixture','fixture','fixture','fixture','fixture','fixture')""",
        (strategy,),
    )
    database.execute(
        """INSERT INTO analysis_runs
        (id,account_id,symbol_id,strategy_version_id,mode,state,analysis_time)
        VALUES(%s,%s,%s,%s,'paper','REJECTED',%s)""",
        (analysis, account, symbol, strategy, at),
    )
    database.execute(
        """INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,
        requested_at,captured_at,valid_until,state,requested_model,tick_size)
        VALUES(%s,%s,%s,%s,'paper',%s,%s,%s,'FAILED','deepseek-v4-pro/u5W','0.01')""",
        (context, account, symbol, analysis, at, at, at + timedelta(minutes=5)),
    )
    database.commit()
    segment = segment_fixture(tmp_path / "market-data", at, (at + timedelta(milliseconds=250),))

    class FailedCommit:
        execute = database.execute

        def commit(self) -> None:
            raise RuntimeError("fixture commit failure")

    with pytest.raises(RuntimeError, match="fixture commit failure"):
        storage.maintain_market(FailedCommit(), tmp_path, datetime.now(UTC))  # type: ignore[arg-type]
    database.rollback()
    assert segment.exists()
    result = storage.maintain_market(database, tmp_path, datetime.now(UTC))
    assert result == {"archived": 1, "removedCacheSegments": 1}
    assert not segment.exists()
    archive = tmp_path / "market-evidence" / segment.name
    assert storage.verify_segment(archive)["sampleCount"] == 1
    assert (
        database.execute("SELECT count(*) AS n FROM context_market_evidence").fetchone()["n"] == 1
    )


def test_metrics_rollup_is_scoped_and_idempotent(
    database: psycopg.Connection[dict[str, Any]],
) -> None:
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    for instance, when, memory, disk in [
        ("fixture", now - timedelta(days=8), 10, 90),
        ("fixture", now - timedelta(days=8) + timedelta(minutes=1), 20, 80),
        ("other", now - timedelta(days=8), 50, 50),
        ("fixture", now, 30, 70),
    ]:
        database.execute(
            "INSERT INTO server_metrics"
            "(instance_id,captured_at,memory_used_bytes,disk_available_bytes) "
            "VALUES(%s,%s,%s,%s)",
            (instance, when, memory, disk),
        )
    storage.maintain_metrics(database, "fixture", now)
    storage.maintain_metrics(database, "fixture", now)
    rows = database.execute(
        "SELECT sample_count,max_memory_used_bytes,min_disk_available_bytes "
        "FROM server_metrics_hourly"
    ).fetchall()
    assert rows == [
        {"sample_count": 2, "max_memory_used_bytes": 20, "min_disk_available_bytes": 80}
    ]
    assert database.execute("SELECT count(*) AS n FROM server_metrics").fetchone()["n"] == 2


def test_compaction_preserves_exact_rows_and_rejects_changed_backup(
    database: psycopg.Connection[dict[str, Any]], tmp_path: Path
) -> None:
    account, symbol = identity(database)
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    for index in range(2):
        snapshot = str(uuid4())
        database.execute(
            """INSERT INTO candle_snapshots
            (id,account_id,symbol_id,analysis_time,server_time,received_at,max_skew_ms,complete)
            VALUES(%s,%s,%s,%s,%s,%s,0,true)""",
            (snapshot, account, symbol, now + timedelta(seconds=index), now, now),
        )
        database.execute(
            """INSERT INTO candles
            (id,snapshot_id,timeframe,start_time,end_time,open,high,low,close,volume,complete)
            VALUES(%s,%s,'M1',%s,%s,4400,4402,4399,4401,NULL,true)""",
            (str(uuid4()), snapshot, now - timedelta(minutes=1), now),
        )
    before = storage.table_fingerprint(database, "candles")
    state = storage.inventory(database)
    database.commit()
    directory = backup_fixture(tmp_path, now, "historical-recovery")
    manifest = storage.verify_backup(directory)
    manifest["inventory"] = state
    storage.durable_json(directory / "manifest.json", manifest)
    storage.durable_json(
        directory / "restore-verification.json",
        {
            "databaseSha256": manifest["databaseSha256"],
            "inventorySha256": hashlib.sha256(
                json.dumps(state, sort_keys=True).encode()
            ).hexdigest(),
        },
    )
    result = storage.compact_candles("fixture", directory)
    assert result["compactedReferences"] == 2 and result["uniqueCandleValues"] == 1
    assert storage.table_fingerprint(database, "decision_candles") == before
    database.commit()
    with pytest.raises(ValueError, match="STORAGE_LEGACY_CANDLES_CHANGED"):
        storage.compact_candles("fixture", directory)
    # Documented reverse transition preserves every original candle identifier/value.
    database.execute("INSERT INTO candles SELECT * FROM decision_candles")
    assert storage.table_fingerprint(database, "candles") == before
