from __future__ import annotations

import argparse
import contextlib
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

SEGMENT = re.compile(r"^market-[a-z0-9._-]+-[0-9]{8}T[0-9]{6}Z-[a-f0-9-]+\.jsonl\.gz$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
BACKUP_NAME = re.compile(r"^backup-[0-9]{8}T[0-9]{6}Z-[a-z0-9]+$")


def timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("STORAGE_TIMESTAMP_INVALID")
    return parsed.astimezone(UTC)


def digest_file(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError("STORAGE_FILE_INVALID")
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def durable_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(value, output, sort_keys=True, indent=2, default=str)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def copy_verified(source: Path, destination: Path, expected: str) -> None:
    if not DIGEST.fullmatch(expected) or digest_file(source) != expected:
        raise ValueError("STORAGE_SOURCE_HASH_MISMATCH")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists():
        if digest_file(destination) != expected:
            raise ValueError("STORAGE_DESTINATION_CONFLICT")
        return
    descriptor, temporary_name = tempfile.mkstemp(prefix=".copy-", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        with source.open("rb") as source_file, os.fdopen(descriptor, "wb") as target:
            shutil.copyfileobj(source_file, target)
            target.flush()
            os.fsync(target.fileno())
        if digest_file(temporary) != expected:
            raise ValueError("STORAGE_COPY_HASH_MISMATCH")
        os.link(temporary, destination)
        directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def pg_environment(database_url: str) -> dict[str, str]:
    """Credentials go through the child environment, never command arguments."""
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("STORAGE_DATABASE_URL_INVALID")
    query = parse_qs(parsed.query)
    result = {
        **os.environ,
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGDATABASE": unquote(parsed.path.removeprefix("/")),
        "PGUSER": unquote(parsed.username or ""),
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGSSLMODE": "verify-full",
        "PGCONNECT_TIMEOUT": "10",
    }
    result["PGSSLROOTCERT"] = query.get("sslrootcert", ["/etc/ssl/certs/ca-certificates.crt"])[0]
    return result


def database_connection(database_url: str) -> psycopg.Connection[dict[str, Any]]:
    environment = pg_environment(database_url)
    return psycopg.connect(
        database_url,
        sslmode="verify-full",
        sslrootcert=environment["PGSSLROOTCERT"],
        connect_timeout=10,
        row_factory=dict_row,
        options="-c timezone=UTC -c statement_timeout=300000",
    )


def table_fingerprint(connection: psycopg.Connection[dict[str, Any]], table: str) -> str:
    digest = hashlib.sha256()
    with connection.cursor(name="storage_inventory") as cursor:
        cursor.execute(
            sql.SQL(
                'SELECT to_jsonb(t)::text AS value FROM {} t ORDER BY to_jsonb(t)::text COLLATE "C"'
            ).format(sql.Identifier(table))
        )
        for item in cursor:
            digest.update(item["value"].encode())
            digest.update(b"\n")
    return digest.hexdigest()


def inventory(connection: psycopg.Connection[dict[str, Any]]) -> dict[str, Any]:
    tables = connection.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename"
    ).fetchall()
    counts: dict[str, int] = {}
    fingerprints: dict[str, str] = {}
    for row in tables:
        table = str(row["tablename"])
        counts[table] = connection.execute(
            sql.SQL("SELECT count(*) AS n FROM {}").format(sql.Identifier(table))
        ).fetchone()["n"]  # type: ignore[index]
        fingerprints[table] = table_fingerprint(connection, table)
    return {"counts": counts, "fingerprints": fingerprints}


def backup(database_url: str, destination: Path, runtime: Path, scope: str = "current") -> Path:
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.is_symlink():
        raise ValueError("STORAGE_BACKUP_DIRECTORY_INVALID")
    name = "backup-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + os.urandom(4).hex()
    staging = Path(tempfile.mkdtemp(prefix=".preparing-", dir=destination))
    artifacts: list[dict[str, Any]] = []
    try:
        with database_connection(database_url) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            snapshot = connection.execute("SELECT pg_export_snapshot() AS snapshot").fetchone()
            if snapshot is None:
                raise ValueError("STORAGE_SNAPSHOT_UNAVAILABLE")
            captured_at = datetime.now(UTC).isoformat()
            state = inventory(connection)
            result = subprocess.run(
                [
                    "pg_dump",
                    "--format=custom",
                    "--no-owner",
                    "--no-privileges",
                    "--snapshot=" + snapshot["snapshot"],
                    "--file=" + str(staging / "database.dump"),
                ],
                env=pg_environment(database_url),
                capture_output=True,
                timeout=300,
                check=False,
            )
            if result.returncode:
                raise ValueError("STORAGE_DUMP_FAILED")
            (staging / "database.dump").chmod(0o600)
            charts = connection.execute(
                "SELECT DISTINCT image_sha256 FROM analysis_chart_artifacts "
                "WHERE storage_kind='local_sha256'"
            ).fetchall()
            for row in charts:
                digest = str(row["image_sha256"])
                relative = Path("charts") / (digest + ".png")
                copy_verified(
                    runtime / "analysis-charts" / relative.name, staging / relative, digest
                )
                artifacts.append({"file": str(relative), "sha256": digest})
            if "market_evidence_segments" in state["counts"]:
                segments = connection.execute(
                    "SELECT content_sha256,archive_file FROM market_evidence_segments "
                    "ORDER BY content_sha256"
                ).fetchall()
                for row in segments:
                    filename = str(row["archive_file"])
                    if not SEGMENT.fullmatch(filename):
                        raise ValueError("STORAGE_ARCHIVE_NAME_INVALID")
                    relative = Path("market") / filename
                    copy_verified(
                        runtime / "market-evidence" / filename,
                        staging / relative,
                        str(row["content_sha256"]),
                    )
                    artifacts.append({"file": str(relative), "sha256": row["content_sha256"]})
                    manifest_name = filename + ".manifest.json"
                    manifest_source = runtime / "market-evidence" / manifest_name
                    manifest_hash = digest_file(manifest_source)
                    copy_verified(
                        manifest_source, staging / "market" / manifest_name, manifest_hash
                    )
                    artifacts.append({"file": "market/" + manifest_name, "sha256": manifest_hash})
        manifest = {
            "version": 1,
            "scope": scope,
            "capturedAt": captured_at,
            "databaseSha256": digest_file(staging / "database.dump"),
            "inventory": state,
            "artifacts": artifacts,
        }
        durable_json(staging / "manifest.json", manifest)
        verify_backup(staging)
        target = destination / name
        os.replace(staging, target)
        descriptor = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return target
    except BaseException:
        # Preserve failed staging for diagnosis; it is never a valid recovery point.
        raise


def verify_backup(directory: Path) -> dict[str, Any]:
    if directory.is_symlink():
        raise ValueError("STORAGE_BACKUP_DIRECTORY_INVALID")
    manifest = json.loads((directory / "manifest.json").read_text())
    if (
        manifest.get("version") != 1
        or not isinstance(manifest.get("inventory"), dict)
        or manifest.get("scope") not in {"current", "historical-recovery"}
        or not isinstance(manifest.get("artifacts"), list)
        or not DIGEST.fullmatch(str(manifest.get("databaseSha256", "")))
    ):
        raise ValueError("STORAGE_MANIFEST_INVALID")
    timestamp(manifest["capturedAt"])
    if digest_file(directory / "database.dump") != manifest["databaseSha256"]:
        raise ValueError("STORAGE_BACKUP_HASH_MISMATCH")
    seen: set[str] = set()
    for artifact in manifest["artifacts"]:
        if artifact["file"] in seen or not DIGEST.fullmatch(str(artifact.get("sha256", ""))):
            raise ValueError("STORAGE_MANIFEST_INVALID")
        seen.add(artifact["file"])
        relative = Path(artifact["file"])
        if relative.is_absolute() or ".." in relative.parts or len(relative.parts) != 2:
            raise ValueError("STORAGE_ARTIFACT_PATH_INVALID")
        if relative.parts[0] not in {"charts", "market"}:
            raise ValueError("STORAGE_ARTIFACT_PATH_INVALID")
        target = directory / relative
        if target.parent.is_symlink() or digest_file(target) != artifact["sha256"]:
            raise ValueError("STORAGE_ARTIFACT_HASH_MISMATCH")
    return dict(manifest)


def restore_check(database_url: str, directory: Path) -> dict[str, Any]:
    manifest = verify_backup(directory)
    with database_connection(database_url) as connection:
        if connection.execute(
            "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' "
            "AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1"
        ).fetchone():
            raise ValueError("STORAGE_RESTORE_TARGET_NOT_EMPTY")
    environment = pg_environment(database_url)
    result = subprocess.run(
        [
            "pg_restore",
            "--exit-on-error",
            "--no-owner",
            "--no-privileges",
            "--dbname=" + environment["PGDATABASE"],
            str(directory / "database.dump"),
        ],
        env=environment,
        capture_output=True,
        timeout=300,
        check=False,
    )
    if result.returncode:
        raise ValueError("STORAGE_RESTORE_FAILED")
    with database_connection(database_url) as connection:
        observed = inventory(connection)
    if observed != manifest["inventory"]:
        raise ValueError("STORAGE_RESTORE_INVENTORY_MISMATCH")
    durable_json(
        directory / "restore-verification.json",
        {
            "version": 1,
            "databaseSha256": manifest["databaseSha256"],
            "inventorySha256": hashlib.sha256(
                json.dumps(observed, sort_keys=True).encode()
            ).hexdigest(),
            "verifiedAt": datetime.now(UTC).isoformat(),
        },
    )
    return {"restored": True, "verifiedTables": len(observed["counts"]), "scope": manifest["scope"]}


def verify_restore_proof(directory: Path, manifest: dict[str, Any]) -> None:
    proof = json.loads((directory / "restore-verification.json").read_text())
    expected_inventory = hashlib.sha256(
        json.dumps(manifest["inventory"], sort_keys=True).encode()
    ).hexdigest()
    if (
        proof.get("databaseSha256") != manifest["databaseSha256"]
        or proof.get("inventorySha256") != expected_inventory
    ):
        raise ValueError("STORAGE_RESTORE_PROOF_INVALID")


def compact_candles(database_url: str, directory: Path) -> dict[str, Any]:
    """One-time reviewed transition. Only redundant rows leave the legacy table."""
    manifest = verify_backup(directory)
    verify_restore_proof(directory, manifest)
    with database_connection(database_url) as connection:
        connection.execute("SET LOCAL lock_timeout='10s'")
        connection.execute("LOCK TABLE candles, candle_references, candle_values IN EXCLUSIVE MODE")
        if table_fingerprint(connection, "candles") != manifest["inventory"]["fingerprints"].get(
            "candles"
        ):
            raise ValueError("STORAGE_LEGACY_CANDLES_CHANGED")
        count = connection.execute("SELECT count(*) AS n FROM candles").fetchone()["n"]  # type: ignore[index]
        connection.execute("""INSERT INTO candle_values
            (symbol_id,timeframe,start_time,end_time,open,high,low,close,volume,complete,quality_flags)
            SELECT s.symbol_id,c.timeframe,c.start_time,c.end_time,c.open,c.high,c.low,c.close,
                   c.volume,c.complete,c.quality_flags
            FROM candles c JOIN candle_snapshots s ON s.id=c.snapshot_id
            ON CONFLICT DO NOTHING""")
        connection.execute("""INSERT INTO candle_references
            (id,snapshot_id,symbol_id,timeframe,start_time,candle_value_id)
            SELECT c.id,c.snapshot_id,s.symbol_id,c.timeframe,c.start_time,v.id
            FROM candles c JOIN candle_snapshots s ON s.id=c.snapshot_id
            JOIN candle_values v ON v.content_sha256=candle_value_hash(
                s.symbol_id,c.timeframe,c.start_time,c.end_time,c.open,c.high,c.low,
                c.close,c.volume,c.complete,c.quality_flags)
            ON CONFLICT DO NOTHING""")
        if connection.execute("""SELECT 1 FROM (
            (SELECT * FROM candles EXCEPT
             SELECT d.* FROM decision_candles d JOIN candles c ON c.id=d.id)
            UNION ALL
            (SELECT d.* FROM decision_candles d JOIN candles c ON c.id=d.id
             EXCEPT SELECT * FROM candles)
            ) mismatch LIMIT 1""").fetchone():
            raise ValueError("STORAGE_CANDLE_RECONSTRUCTION_MISMATCH")
        connection.execute("DELETE FROM candles")
        unique = connection.execute("SELECT count(*) AS n FROM candle_values").fetchone()["n"]  # type: ignore[index]
    # Space reclamation is outside the transition transaction and has no data authority.
    with database_connection(database_url) as connection:
        connection.autocommit = True
        connection.execute("SET lock_timeout='10s'")
        connection.execute("VACUUM (ANALYZE) candles")
        # VACUUM leaves empty index pages allocated; rebuild after the reviewed bulk move.
        for table in ("candles", "candle_references", "candle_values"):
            connection.execute(sql.SQL("REINDEX TABLE {}").format(sql.Identifier(table)))
            connection.execute(sql.SQL("ANALYZE {}").format(sql.Identifier(table)))
    return {
        "compactedReferences": count,
        "uniqueCandleValues": unique,
        "backupScope": manifest["scope"],
    }


def encrypted_export(directory: Path, recipient: Path, output: Path) -> dict[str, Any]:
    manifest = verify_backup(directory)
    if recipient.is_symlink() or not recipient.is_file() or output.exists() or output.is_symlink():
        raise ValueError("STORAGE_EXPORT_PATH_INVALID")
    if recipient.stat().st_size > 1024 * 1024:
        raise ValueError("STORAGE_RECIPIENT_INVALID")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, name = tempfile.mkstemp(prefix=".encrypt-", dir=output.parent)
    temporary = Path(name)
    try:
        with (
            os.fdopen(descriptor, "wb") as target,
            tempfile.TemporaryDirectory(prefix="scalper-gpg-") as home,
        ):
            with subprocess.Popen(
                [
                    "gpg",
                    "--batch",
                    "--no-options",
                    "--homedir",
                    home,
                    "--trust-model",
                    "always",
                    "--recipient-file",
                    str(recipient.resolve()),
                    "--encrypt",
                ],
                stdin=subprocess.PIPE,
                stdout=target,
                stderr=subprocess.DEVNULL,
            ) as process:
                assert process.stdin is not None
                try:
                    with tarfile.open(fileobj=process.stdin, mode="w|") as archive:
                        files = ["manifest.json", "database.dump"] + [
                            item["file"] for item in manifest["artifacts"]
                        ]
                        for filename in files:
                            archive.add(
                                directory / filename,
                                arcname=directory.name + "/" + filename,
                                recursive=False,
                            )
                finally:
                    process.stdin.close()
                if process.wait(timeout=300):
                    raise ValueError("STORAGE_ENCRYPTION_FAILED")
            target.flush()
            os.fsync(target.fileno())
        os.link(temporary, output)
        return {"encrypted": True, "sha256": digest_file(output), "uploaded": False}
    finally:
        temporary.unlink(missing_ok=True)


def retained_backups(entries: list[tuple[Path, datetime]]) -> set[Path]:
    ordered = sorted(entries, key=lambda value: value[1], reverse=True)
    daily: dict[str, Path] = {}
    weekly: dict[tuple[int, int], Path] = {}
    for path, captured in ordered:
        daily.setdefault(captured.date().isoformat(), path)
        week = captured.isocalendar()
        weekly.setdefault((week.year, week.week), path)
    return set(list(daily.values())[:7] + list(weekly.values())[:4])


def rotate_backups(directory: Path) -> int:
    entries: list[tuple[Path, datetime]] = []
    for path in directory.iterdir():
        if not BACKUP_NAME.fullmatch(path.name) or not path.is_dir():
            continue
        manifest = verify_backup(path)
        if manifest["scope"] == "current":
            entries.append((path, timestamp(manifest["capturedAt"])))
    retained = retained_backups(entries)
    restored = []
    for path, captured in entries:
        if (path / "restore-verification.json").is_file():
            verify_restore_proof(path, verify_backup(path))
            restored.append((path, captured))
    if not restored:
        return 0
    # Keep the most recent proven restore even when it falls outside the rotation window.
    retained.add(max(restored, key=lambda value: value[1])[0])
    for path, _ in entries:
        if path not in retained:
            shutil.rmtree(path)
    return len(entries) - len(retained)


def verify_segment(path: Path) -> dict[str, Any]:
    if not SEGMENT.fullmatch(path.name) or path.is_symlink():
        raise ValueError("STORAGE_SEGMENT_NAME_INVALID")
    sidecar = path.with_name(path.name + ".manifest.json")
    if sidecar.is_symlink():
        raise ValueError("STORAGE_MANIFEST_INVALID")
    manifest = json.loads(sidecar.read_text())
    if (
        manifest.get("schemaVersion") != "1.0"
        or manifest.get("file") != path.name
        or manifest.get("compressedBytes") != path.stat().st_size
        or manifest.get("sha256") != digest_file(path)
    ):
        raise ValueError("STORAGE_SEGMENT_HASH_MISMATCH")
    if (
        not isinstance(manifest.get("sampleCount"), int)
        or not 0 < manifest["sampleCount"] <= 100000
    ):
        raise ValueError("STORAGE_SEGMENT_COUNT_INVALID")
    started = timestamp(manifest["startedAt"])
    completed = timestamp(manifest["completedAt"])
    count = 0
    previous = started - timedelta(microseconds=1)
    symbol: str | None = None
    decoded_bytes = 0
    with gzip.open(path, "rb") as source:
        for line in source:
            decoded_bytes += len(line)
            if decoded_bytes > 256 * 1024 * 1024:
                raise ValueError("STORAGE_SEGMENT_OVERSIZED")
            row = json.loads(line)
            observed = timestamp(row["capturedAt"])
            if (
                row.get("schemaVersion") != "1.0"
                or (count == 0 and observed != started)
                or observed <= previous
                or observed < started
                or observed > completed
            ):
                raise ValueError("STORAGE_SEGMENT_ORDER_INVALID")
            current_symbol = row.get("symbol")
            if not isinstance(current_symbol, str) or not re.fullmatch(
                r"[A-Z0-9._-]{1,32}", current_symbol
            ):
                raise ValueError("STORAGE_SEGMENT_SYMBOL_INVALID")
            if symbol is not None and symbol != current_symbol:
                raise ValueError("STORAGE_SEGMENT_SYMBOL_INVALID")
            symbol = current_symbol
            previous = observed
            count += 1
    if count != manifest["sampleCount"] or previous != completed:
        raise ValueError("STORAGE_SEGMENT_COUNT_INVALID")
    return {**manifest, "symbol": symbol}


def expired_cache(
    entries: list[tuple[Path, datetime, int, bool]],
    now: datetime,
    byte_budget: int = 1024 * 1024 * 1024,
) -> list[Path]:
    """Protected evidence is archived first; this selects only redundant/cache copies."""
    remove = {path for path, completed, _, _ in entries if completed < now - timedelta(days=7)}
    unreferenced = sorted(
        (
            (path, completed, size)
            for path, completed, size, pinned in entries
            if not pinned and path not in remove
        ),
        key=lambda entry: entry[1],
    )
    total = sum(entry[2] for entry in unreferenced)
    for path, _, size in unreferenced:
        if total <= byte_budget:
            break
        remove.add(path)
        total -= size
    return sorted(remove)


def maintain_market(
    connection: psycopg.Connection[dict[str, Any]],
    runtime: Path,
    now: datetime,
) -> dict[str, int]:
    cache = runtime / "market-data"
    archive = runtime / "market-evidence"
    if cache.is_symlink() or archive.is_symlink():
        raise ValueError("STORAGE_DIRECTORY_INVALID")
    if not cache.exists():
        return {"archived": 0, "removedCacheSegments": 0}
    verified: list[tuple[Path, datetime, int, bool]] = []
    archived = 0
    # Complete files only; active .ndjson and partially committed sidecars stay untouched.
    for path in sorted(cache.iterdir()):
        if not SEGMENT.fullmatch(path.name):
            continue
        if not path.with_name(path.name + ".manifest.json").exists():
            continue
        manifest = verify_segment(path)
        contexts = connection.execute(
            """SELECT c.id FROM scenario_contexts c JOIN symbols s ON s.id=c.symbol_id
            LEFT JOIN order_groups g ON g.context_plan_id=c.id
            WHERE s.name=%s AND c.captured_at - interval '5 minutes'<=%s AND
              CASE WHEN g.id IS NOT NULL AND (
                g.state NOT IN ('CLOSED','EXPIRED','FAILED')
                OR EXISTS(SELECT 1 FROM positions p WHERE p.order_group_id=g.id
                    AND p.state<>'CLOSED')
                OR EXISTS(SELECT 1 FROM orders o WHERE o.order_group_id=g.id
                    AND o.state NOT IN ('FILLED','CANCELLED','EXPIRED','REJECTED'))
                OR EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.order_group_id=g.id
                    AND (e.mapping_state<>'MAPPED' OR jsonb_array_length(e.reason_codes)>0)))
              THEN 'infinity'::timestamptz
              ELSE GREATEST(c.valid_until,COALESCE(g.updated_at,c.completed_at,c.valid_until))
                    + interval '5 minutes' END >= %s""",
            (
                manifest["symbol"],
                timestamp(manifest["completedAt"]),
                timestamp(manifest["startedAt"]),
            ),
        ).fetchall()
        if contexts:
            existing = connection.execute(
                "SELECT archive_file FROM market_evidence_segments WHERE content_sha256=%s",
                (manifest["sha256"],),
            ).fetchone()
            name = path.name if existing is None else str(existing["archive_file"])
            if not SEGMENT.fullmatch(name):
                raise ValueError("STORAGE_ARCHIVE_NAME_INVALID")
            target = archive / name
            copy_verified(path, target, manifest["sha256"])
            sidecar = target.with_name(name + ".manifest.json")
            if existing is None:
                durable_json(
                    sidecar, {key: value for key, value in manifest.items() if key != "symbol"}
                )
            verify_segment(target)
            connection.execute(
                """INSERT INTO market_evidence_segments
                (content_sha256,archive_file,symbol,started_at,completed_at,sample_count,compressed_bytes,manifest)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT(content_sha256) DO NOTHING""",
                (
                    manifest["sha256"],
                    name,
                    manifest["symbol"],
                    manifest["startedAt"],
                    manifest["completedAt"],
                    manifest["sampleCount"],
                    manifest["compressedBytes"],
                    json.dumps(manifest),
                ),
            )
            for context in contexts:
                connection.execute(
                    """INSERT INTO context_market_evidence(context_id,content_sha256)
                    VALUES (%s,%s) ON CONFLICT DO NOTHING""",
                    (context["id"], manifest["sha256"]),
                )
            archived += existing is None
        verified.append(
            (path, timestamp(manifest["completedAt"]), manifest["compressedBytes"], bool(contexts))
        )
    # A failed database commit leaves every cache file intact.
    connection.commit()
    removed = expired_cache(verified, now)
    for path in removed:
        path.unlink()
        path.with_name(path.name + ".manifest.json").unlink()
    return {"archived": archived, "removedCacheSegments": len(removed)}


def maintain_metrics(
    connection: psycopg.Connection[dict[str, Any]], instance: str, now: datetime
) -> None:
    connection.execute(
        """WITH expired AS (
          DELETE FROM server_metrics WHERE instance_id=%s AND captured_at<%s RETURNING *
        ) INSERT INTO server_metrics_hourly
          (instance_id,hour,sample_count,max_memory_used_bytes,min_disk_available_bytes,max_process_cpu_percent)
        SELECT instance_id,date_trunc('hour',captured_at),count(*),max(memory_used_bytes),
               min(disk_available_bytes),max(process_cpu_percent)
        FROM expired GROUP BY instance_id,date_trunc('hour',captured_at)
        ON CONFLICT(instance_id,hour) DO UPDATE SET
          sample_count=server_metrics_hourly.sample_count+excluded.sample_count,
          max_memory_used_bytes=GREATEST(server_metrics_hourly.max_memory_used_bytes,excluded.max_memory_used_bytes),
          min_disk_available_bytes=LEAST(server_metrics_hourly.min_disk_available_bytes,excluded.min_disk_available_bytes),
          max_process_cpu_percent=GREATEST(server_metrics_hourly.max_process_cpu_percent,excluded.max_process_cpu_percent)""",
        (instance, now - timedelta(days=7)),
    )
    connection.execute(
        "DELETE FROM server_metrics_hourly WHERE instance_id=%s AND hour<%s",
        (instance, now - timedelta(days=30)),
    )


def prune_routine_logs(
    directory: Path, now: datetime, budget: int = 200 * 1024 * 1024
) -> dict[str, int]:
    if directory.is_symlink():
        raise ValueError("STORAGE_LOG_DIRECTORY_INVALID")
    open_files: set[str] = set()
    for process in Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            for descriptor in (process / "fd").iterdir():
                with contextlib.suppress(FileNotFoundError):
                    open_files.add(os.readlink(descriptor))
        except FileNotFoundError:
            continue
        except PermissionError:
            raise ValueError("STORAGE_LOG_OPEN_FILES_UNCERTAIN") from None
    files = [
        path
        for path in directory.glob("**/*.log*")
        if path.is_file() and not path.is_symlink() and not path.parent.is_symlink()
    ]
    files.sort(key=lambda path: path.stat().st_mtime)
    total = sum(path.stat().st_size for path in files)
    removed = 0
    for path in files:
        if str(path.resolve()) in open_files:
            continue
        info = path.stat()
        if datetime.fromtimestamp(info.st_mtime, UTC) < now - timedelta(days=7) or total > budget:
            path.unlink()
            total -= info.st_size
            removed += 1
    return {
        "removedClosedLogs": removed,
        "remainingLogBytes": total,
        "unreclaimedActiveLogBytes": max(0, total - budget),
    }


def database_identity(database_url: str) -> str:
    value = urlparse(database_url)
    return hashlib.sha256(
        json.dumps([value.hostname, value.port or 5432, value.path]).encode()
    ).hexdigest()


def require_current_storage(database_url: str, runtime: Path) -> None:
    marker = json.loads((runtime / "storage-activation.json").read_text())
    if marker.get("scope") != "current" or marker.get("databaseIdentity") != database_identity(
        database_url
    ):
        raise ValueError("STORAGE_CURRENT_RECOVERY_NOT_VERIFIED")


def maintenance(database_url: str, runtime: Path, logs: Path, instance: str) -> dict[str, Any]:
    require_current_storage(database_url, runtime)
    now = datetime.now(UTC)
    with database_connection(database_url) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(4287319090)")
        market = maintain_market(connection, runtime, now)
        maintain_metrics(connection, instance, now)
    rotated = subprocess.run(
        [
            "/usr/sbin/logrotate",
            "--state",
            str(runtime / "logrotate.state"),
            "/etc/scalping-bot/storage-logrotate.conf",
        ],
        capture_output=True,
        timeout=60,
        check=False,
    )
    if rotated.returncode:
        raise ValueError("STORAGE_LOG_ROTATION_FAILED")
    log_result = prune_routine_logs(logs, now)
    disk = shutil.disk_usage(runtime)
    reasons = []
    if disk.free * 100 < disk.total * 15:
        reasons.append("STORAGE_DISK_FREE_LOW")
    if log_result["unreclaimedActiveLogBytes"]:
        reasons.append("STORAGE_ACTIVE_LOG_BUDGET_EXCEEDED")
    backup_root = runtime / "backups" / "local"
    backup_times = []
    if backup_root.exists():
        for path in backup_root.iterdir():
            if BACKUP_NAME.fullmatch(path.name):
                manifest = json.loads((path / "manifest.json").read_text())
                if manifest.get("scope") == "current":
                    backup_times.append(timestamp(manifest["capturedAt"]))
    if not backup_times or max(backup_times) < now - timedelta(hours=30):
        reasons.append("STORAGE_BACKUP_OVERDUE")
    return {
        "version": 1,
        "observedAt": now.isoformat(),
        "healthy": not reasons,
        "reasons": reasons,
        "diskFreeBytes": disk.free,
        "diskTotalBytes": disk.total,
        **market,
        **log_result,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Local storage administration; no broker authority"
    )
    parser.add_argument(
        "command",
        choices=(
            "backup",
            "verify",
            "verify-activation",
            "restore-check",
            "compact-candles",
            "export",
            "maintenance",
        ),
    )
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--runtime", type=Path, default=Path(".runtime"))
    parser.add_argument("--logs", type=Path, default=Path("logs"))
    parser.add_argument("--scope", choices=("current", "historical-recovery"), default="current")
    parser.add_argument("--recipient", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    runtime: Path = arguments.runtime
    runtime.mkdir(exist_ok=True, parents=True, mode=0o700)
    lock = os.open(runtime / "storage-maintenance.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(
            lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if arguments.command == "maintenance" else 0)
        )
        url = os.environ.get("DATABASE_URL", "")
        if arguments.command == "backup":
            if arguments.scope == "current":
                require_current_storage(url, runtime)
            directory = arguments.directory or runtime / "backups" / "local"
            target = backup(url, directory, runtime, arguments.scope)
            removed = rotate_backups(directory)
            result = {
                "backup": target.name,
                "verified": True,
                "scope": arguments.scope,
                "retiredBackups": removed,
            }
        elif arguments.command == "verify-activation":
            require_current_storage(url, runtime)
            result = {"activationVerified": True}
        elif arguments.command == "verify":
            if arguments.directory is None:
                raise ValueError("STORAGE_DIRECTORY_REQUIRED")
            manifest = verify_backup(arguments.directory)
            result = {"verified": True, "scope": manifest["scope"]}
        elif arguments.command == "restore-check":
            if arguments.directory is None:
                raise ValueError("STORAGE_DIRECTORY_REQUIRED")
            result = restore_check(url, arguments.directory)
        elif arguments.command == "compact-candles":
            if arguments.directory is None:
                raise ValueError("STORAGE_DIRECTORY_REQUIRED")
            result = compact_candles(url, arguments.directory)
        elif arguments.command == "export":
            if (
                arguments.directory is None
                or arguments.recipient is None
                or arguments.output is None
            ):
                raise ValueError("STORAGE_EXPORT_ARGUMENTS_REQUIRED")
            result = encrypted_export(arguments.directory, arguments.recipient, arguments.output)
        else:
            result = maintenance(
                url, runtime, arguments.logs, os.environ.get("INSTANCE_ID", "local-1")
            )
            durable_json(runtime / "storage-status.json", result)
        print(json.dumps(result, sort_keys=True))
    except BlockingIOError:
        print(json.dumps({"status": "maintenance_already_running"}))
    except Exception as error:
        reason = (
            str(error)
            if re.fullmatch(r"STORAGE_[A-Z_]+", str(error))
            else "STORAGE_OPERATION_FAILED"
        )
        if arguments.command == "maintenance":
            durable_json(
                runtime / "storage-status.json",
                {
                    "version": 1,
                    "observedAt": datetime.now(UTC).isoformat(),
                    "healthy": False,
                    "reasons": [reason],
                },
            )
        print(json.dumps({"error": reason}))
        raise SystemExit(1) from None
    finally:
        os.close(lock)


if __name__ == "__main__":
    main()
