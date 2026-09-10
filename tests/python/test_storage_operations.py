from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import subprocess
import tarfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from apps.dashboard.storage_status import local_storage_status
from python.operations.storage import (
    copy_verified,
    database_identity,
    durable_json,
    encrypted_export,
    expired_cache,
    pg_environment,
    prune_routine_logs,
    require_current_storage,
    retained_backups,
    rotate_backups,
    verify_backup,
    verify_segment,
)


def backup_fixture(root: Path, at: datetime, scope: str = "current") -> Path:
    directory = root / ("backup-" + at.strftime("%Y%m%dT%H%M%SZ-") + "fixture")
    directory.mkdir(parents=True)
    (directory / "database.dump").write_bytes(b"fixture archive")
    digest = hashlib.sha256(b"fixture archive").hexdigest()
    durable_json(
        directory / "manifest.json",
        {
            "version": 1,
            "scope": scope,
            "capturedAt": at.isoformat(),
            "inventory": {"counts": {}, "fingerprints": {}},
            "databaseSha256": digest,
            "artifacts": [],
        },
    )
    return directory


def segment_fixture(directory: Path, at: datetime) -> Path:
    directory.mkdir(exist_ok=True, parents=True)
    path = directory / ("market-fixture-" + at.strftime("%Y%m%dT%H%M%SZ-") + "abcd.jsonl.gz")
    content = (
        json.dumps({"schemaVersion": "1.0", "capturedAt": at.isoformat(), "symbol": "XAUUSD"})
        + "\n"
    ).encode()
    path.write_bytes(gzip.compress(content))
    durable_json(
        path.with_name(path.name + ".manifest.json"),
        {
            "schemaVersion": "1.0",
            "file": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "compressedBytes": path.stat().st_size,
            "sampleCount": 1,
            "startedAt": at.isoformat(),
            "completedAt": at.isoformat(),
        },
    )
    return path


def test_backup_integrity_paths_and_symlinks(tmp_path: Path) -> None:
    directory = backup_fixture(tmp_path, datetime.now(UTC))
    assert verify_backup(directory)["scope"] == "current"
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest["artifacts"] = [{"file": "../escape", "sha256": "a" * 64}]
    durable_json(directory / "manifest.json", manifest)
    with pytest.raises(ValueError, match="STORAGE_ARTIFACT_PATH_INVALID"):
        verify_backup(directory)
    manifest["artifacts"] = []
    durable_json(directory / "manifest.json", manifest)
    (directory / "database.dump").write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="STORAGE_BACKUP_HASH_MISMATCH"):
        verify_backup(directory)
    alias = tmp_path / "alias"
    alias.symlink_to(directory)
    with pytest.raises(ValueError, match="STORAGE_BACKUP_DIRECTORY_INVALID"):
        verify_backup(alias)


def test_archival_copy_never_overwrites_conflicting_evidence(tmp_path: Path) -> None:
    source, target = tmp_path / "source", tmp_path / "archive"
    source.write_bytes(b"exact evidence")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    copy_verified(source, target, digest)
    copy_verified(source, target, digest)
    assert target.read_bytes() == source.read_bytes()
    assert target.stat().st_mode & 0o777 == 0o600
    source.write_bytes(b"changed")
    with pytest.raises(ValueError, match="STORAGE_SOURCE_HASH_MISMATCH"):
        copy_verified(source, target, digest)
    with pytest.raises(ValueError, match="STORAGE_DESTINATION_CONFLICT"):
        copy_verified(source, target, hashlib.sha256(source.read_bytes()).hexdigest())


def test_market_cache_budget_excludes_archived_evidence(tmp_path: Path) -> None:
    now = datetime.now(UTC)
    path = segment_fixture(tmp_path, now)
    assert verify_segment(path)["symbol"] == "XAUUSD"
    protected, old = tmp_path / "protected", tmp_path / "old"
    entries = [
        (path, now, 100, False),
        (protected, now, 999999, True),
        (old, now - timedelta(days=8), 100, True),
    ]
    assert expired_cache(entries, now, 100) == [old]
    assert set(expired_cache(entries, now, 0)) == {old, path}
    manifest_path = path.with_name(path.name + ".manifest.json")
    manifest = json.loads(manifest_path.read_text())
    manifest["sampleCount"] = 2
    durable_json(manifest_path, manifest)
    with pytest.raises(ValueError, match="STORAGE_SEGMENT_COUNT_INVALID"):
        verify_segment(path)


def test_backup_rotation_preserves_historical_and_proven_restore(tmp_path: Path) -> None:
    now = datetime.now(UTC)
    entries = [backup_fixture(tmp_path, now - timedelta(days=i)) for i in range(35)]
    historical = backup_fixture(tmp_path, now - timedelta(days=50), "historical-recovery")
    assert rotate_backups(tmp_path) == 0
    manifest = verify_backup(entries[-1])
    durable_json(
        entries[-1] / "restore-verification.json",
        {
            "databaseSha256": manifest["databaseSha256"],
            "inventorySha256": hashlib.sha256(
                json.dumps(manifest["inventory"], sort_keys=True).encode()
            ).hexdigest(),
        },
    )
    expected = retained_backups(
        [(path, now - timedelta(days=i)) for i, path in enumerate(entries)]
    ) | {entries[-1]}
    assert rotate_backups(tmp_path) == len(entries) - len(expected)
    assert historical.exists()
    assert {path for path in entries if path.exists()} == expected


def test_cleanup_leaves_open_logs_while_pruning_closed_routine_files(tmp_path: Path) -> None:
    active, closed = tmp_path / "active.log", tmp_path / "old.log.1.gz"
    active.write_bytes(b"active")
    closed.write_bytes(b"old")
    with active.open("rb"):
        result = prune_routine_logs(tmp_path, datetime.now(UTC), budget=0)
    assert active.exists() and not closed.exists()
    assert result["unreclaimedActiveLogBytes"] == 6


def test_historical_restore_cannot_activate_cleanup(tmp_path: Path) -> None:
    url = "postgresql://fixture:private@localhost/fixture"
    durable_json(
        tmp_path / "storage-activation.json",
        {"scope": "historical-recovery", "databaseIdentity": database_identity(url)},
    )
    with pytest.raises(ValueError, match="STORAGE_CURRENT_RECOVERY_NOT_VERIFIED"):
        require_current_storage(url, tmp_path)
    durable_json(
        tmp_path / "storage-activation.json",
        {"scope": "current", "databaseIdentity": database_identity(url)},
    )
    require_current_storage(url, tmp_path)
    with pytest.raises(ValueError, match="STORAGE_CURRENT_RECOVERY_NOT_VERIFIED"):
        require_current_storage(url + "-other", tmp_path)
    environment = pg_environment(url + "?sslmode=require")
    assert environment["PGSSLMODE"] == "verify-full"
    assert environment["PGPASSWORD"] == "private"


def test_local_health_is_bounded_redacted_and_expires(tmp_path: Path) -> None:
    now = datetime.now(UTC)
    durable_json(
        tmp_path / "database-status.json",
        {
            "version": 1,
            "observedAt": now.isoformat(),
            "state": "waiting",
            "reason": "DATABASE_COMPUTE_QUOTA",
            "private": "never display",
        },
    )
    value = local_storage_status(tmp_path, now)
    assert value["database"]["reason"] == "DATABASE_COMPUTE_QUOTA"
    assert "private" not in json.dumps(value)
    assert value["storage"]["state"] == "unavailable"
    assert (
        local_storage_status(tmp_path, now + timedelta(seconds=91))["database"]["state"] == "stale"
    )
    (tmp_path / "database-status.json").write_text("x" * 17000)
    assert local_storage_status(tmp_path, now)["database"]["state"] == "unavailable"


def test_export_rejects_existing_destination_before_encryption(tmp_path: Path) -> None:
    directory = backup_fixture(tmp_path, datetime.now(UTC))
    recipient, output = tmp_path / "recipient", tmp_path / "existing.gpg"
    recipient.write_text("fixture")
    output.write_text("preserve")
    with pytest.raises(ValueError, match="STORAGE_EXPORT_PATH_INVALID"):
        encrypted_export(directory, recipient, output)
    assert output.read_text() == "preserve"


@pytest.mark.skipif(shutil.which("gpg") is None, reason="GnuPG required for export drill")
def test_encrypted_export_round_trip_and_invalid_key(tmp_path: Path) -> None:
    directory = backup_fixture(tmp_path, datetime.now(UTC))
    (directory / "unlisted-private-file").write_text("exclude")
    home = tmp_path / "keyring"
    home.mkdir(mode=0o700)
    base = ["gpg", "--batch", "--no-options", "--homedir", str(home)]
    subprocess.run(
        [
            *base,
            "--pinentry-mode",
            "loopback",
            "--passphrase",
            "",
            "--quick-generate-key",
            "Storage export fixture",
            "rsa2048",
            "encr",
            "1d",
        ],
        capture_output=True,
        check=True,
        timeout=30,
    )
    public_key = subprocess.run(
        [*base, "--armor", "--export"], capture_output=True, check=True, timeout=10
    ).stdout
    recipient = tmp_path / "recipient.asc"
    recipient.write_bytes(public_key)
    output = tmp_path / "export.gpg"
    assert encrypted_export(directory, recipient, output)["uploaded"] is False
    restored = tmp_path / "restored.tar"
    subprocess.run(
        [*base, "--output", str(restored), "--decrypt", str(output)],
        capture_output=True,
        check=True,
        timeout=10,
    )
    with tarfile.open(restored) as archive:
        assert not any("unlisted-private-file" in item for item in archive.getnames())
        source = archive.extractfile(directory.name + "/database.dump")
        assert source is not None and source.read() == b"fixture archive"
    recipient.write_text("invalid key")
    with pytest.raises((ValueError, BrokenPipeError)):
        encrypted_export(directory, recipient, tmp_path / "invalid.gpg")
    assert not (tmp_path / "invalid.gpg").exists()
