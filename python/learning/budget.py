"""Atomic resource reservations. Unknown outcomes retain their full reservation."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import Field

from python.research.codex_loop import StrictModel


class Policy(StrictModel):
    paused: bool = False
    dailyLimit: int = Field(default=1_000_000, ge=1, le=1_000_000_000)
    focus: str = Field(
        default="execution", pattern=r"^(costs|execution|entries|exits|data_quality|external_data)$"
    )
    guidance: str = Field(default="", max_length=1000)


class Budget:
    def __init__(self, root: Path, *, default_limit: int = 1_000_000):
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if any(p.is_symlink() for p in (root, *root.parents)):
            raise ValueError("BUDGET_PATH_INVALID")
        self.path = root / "usage.sqlite3"
        if self.path.is_symlink():
            raise ValueError("BUDGET_PATH_INVALID")
        self.default_limit = default_limit
        with self.transaction() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS policy (id INTEGER PRIMARY KEY CHECK(id=1), "
                "value TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, day TEXT NOT "
                "NULL, estimate INTEGER NOT NULL CHECK(estimate>0), actual INTEGER "
                "CHECK(actual>=0), status TEXT NOT NULL, topic TEXT NOT NULL, created TEXT "
                "NOT NULL, binding TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT "
                "NULL, value TEXT NOT NULL)"
            )
            db.execute(
                "INSERT OR IGNORE INTO policy VALUES(1,?)",
                (Policy(dailyLimit=default_limit).model_dump_json(),),
            )
        self.path.chmod(0o600)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        finally:
            db.close()

    def snapshot(self, now: datetime | None = None) -> dict[str, Any]:
        at = now or datetime.now(UTC)
        with self.transaction() as db:
            policy = Policy.model_validate_json(
                db.execute("SELECT value FROM policy WHERE id=1").fetchone()[0]
            )
            charged = db.execute(
                "SELECT COALESCE(SUM(COALESCE(actual,estimate)),0) FROM reservations WHERE "
                "day=? OR actual IS NULL",
                (at.date().isoformat(),),
            ).fetchone()[0]
            recent = [
                dict(r)
                for r in db.execute(
                    "SELECT day,estimate,actual,status,topic,created FROM reservations ORDER BY "
                    "created DESC LIMIT 20"
                )
            ]
            events = [
                json.loads(r[0])
                for r in db.execute("SELECT value FROM events ORDER BY id DESC LIMIT 10")
            ]
        for event in events:
            if "policy" in event:
                text = event["policy"].pop("guidance", "")
                event["guidanceSha256"] = hashlib.sha256(text.encode()).hexdigest()
        return {
            "checkedAt": at.isoformat(),
            "policy": policy.model_dump(),
            "charged": charged,
            "remaining": max(0, policy.dailyLimit - charged),
            "recent": recent,
            "events": events,
        }

    def update(self, value: Policy) -> None:
        at = datetime.now(UTC).isoformat()
        with self.transaction() as db:
            db.execute("UPDATE policy SET value=? WHERE id=1", (value.model_dump_json(),))
            db.execute(
                "INSERT INTO events(at,value) VALUES(?,?)",
                (
                    at,
                    json.dumps(
                        {"at": at, "action": "OPERATOR_POLICY_UPDATE", "policy": value.model_dump()}
                    ),
                ),
            )

    def reserve(
        self,
        key: str,
        estimate: int,
        topic: str,
        now: datetime | None = None,
        *,
        ceiling: int | None = None,
        binding: str = "",
    ) -> dict[str, Any]:
        if not key or len(key) > 256 or type(estimate) is not int or estimate <= 0:
            raise ValueError("BUDGET_RESERVATION_INVALID")
        at = now or datetime.now(UTC)
        with self.transaction() as db:
            prior = db.execute("SELECT * FROM reservations WHERE id=?", (key,)).fetchone()
            if prior is not None:
                if (
                    prior["estimate"] != estimate
                    or prior["topic"] != topic
                    or prior["binding"] != binding
                ):
                    raise ValueError("BUDGET_RESERVATION_CHANGED")
                return {
                    "status": "ADMITTED"
                    if prior["status"] == "RESERVED"
                    else "OUTCOME_ALREADY_CLAIMED"
                }
            policy = Policy.model_validate_json(
                db.execute("SELECT value FROM policy WHERE id=1").fetchone()[0]
            )
            if policy.paused:
                return {"status": "WAITING_LEARNING_PAUSED"}
            charged = db.execute(
                "SELECT COALESCE(SUM(COALESCE(actual,estimate)),0) FROM reservations WHERE "
                "day=? OR actual IS NULL",
                (at.date().isoformat(),),
            ).fetchone()[0]
            limit = min(policy.dailyLimit, ceiling) if ceiling is not None else policy.dailyLimit
            if charged + estimate > limit:
                return {"status": "WAITING_LEARNING_BUDGET"}
            db.execute(
                "INSERT INTO reservations VALUES(?,?,?,NULL,'RESERVED',?,?,?)",
                (key, at.date().isoformat(), estimate, topic, at.isoformat(), binding),
            )
        return {"status": "ADMITTED"}

    def reservation(self, key: str) -> dict[str, Any] | None:
        with self.transaction() as db:
            row = db.execute(
                "SELECT estimate,status,topic,binding FROM reservations WHERE id=?", (key,)
            ).fetchone()
        return dict(row) if row else None

    def dispatch(self, key: str, now: datetime | None = None) -> None:
        with self.transaction() as db:
            changed = db.execute(
                "UPDATE reservations SET status='DISPATCHED',day=? "
                "WHERE id=? AND status='RESERVED'",
                ((now or datetime.now(UTC)).date().isoformat(), key),
            ).rowcount
            if changed != 1:
                raise ValueError("BUDGET_ALREADY_DISPATCHED_OR_UNKNOWN")

    def settle(self, key: str, actual: int | None) -> None:
        if actual is not None and (type(actual) is not int or actual < 0):
            raise ValueError("BUDGET_USAGE_INVALID")
        with self.transaction() as db:
            row = db.execute("SELECT actual,status FROM reservations WHERE id=?", (key,)).fetchone()
            if row is None or row["status"] not in {"DISPATCHED", "COMPLETE", "UNKNOWN"}:
                raise ValueError("BUDGET_SETTLEMENT_INVALID")
            status = "UNKNOWN" if actual is None else "COMPLETE"
            if row["status"] in {"COMPLETE", "UNKNOWN"}:
                if row["actual"] != actual or row["status"] != status:
                    raise ValueError("BUDGET_SETTLEMENT_CHANGED")
                return
            db.execute(
                "UPDATE reservations SET actual=?,status=? WHERE id=?", (actual, status, key)
            )
