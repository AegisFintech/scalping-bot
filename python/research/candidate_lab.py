"""Append-only candidate trials and isolated prospective replay. Always HOLD."""

from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import re
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import wraps
from itertools import islice
from pathlib import Path
from typing import Any, Literal

from python.backtest import forward, paired
from python.research.codex_loop import Evidence, Report, encoded, timestamp

CandidateName = Literal["model_levels", "tp_0_75", "tp_1_25"]
NAMES = ("model_levels", "tp_0_75", "tp_1_25")
MAX_EVENTS = 10_000
ROOT = Path(__file__).resolve().parents[2]


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def source_hash() -> str:
    names = (*forward.SOURCES, "python/research/candidate_lab.py", "python/research/codex_loop.py")
    return sha(encoded({name: sha((ROOT / name).read_bytes()) for name in names}))


def bounded(path: Path, maximum: int = 128_000) -> bytes:
    if path.is_symlink():
        raise ValueError("CANDIDATE_SYMLINK_REJECTED")
    with path.open("rb") as handle:
        raw = handle.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("CANDIDATE_INPUT_TOO_LARGE")
    return raw


def serialized(method: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(method)
    def wrapped(self: Lab, *args: Any, **kwargs: Any) -> Any:
        with (self.directory / ".operation.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return method(self, *args, **kwargs)

    return wrapped


class Lab:
    """No broker/database feed credentials, provider dispatch or promotion tools."""

    def __init__(
        self,
        directory: Path,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        fingerprint: Callable[[], str] = source_hash,
    ):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory = directory
        self.clock = clock
        self.fingerprint = fingerprint
        db = directory / "trials.sqlite3"
        self.db = sqlite3.connect(db, timeout=5, isolation_level=None)
        db.chmod(0o600)
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1) or (
            version == 0
            and self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone()
            is not None
        ):
            self.db.close()
            raise ValueError("CANDIDATE_LEDGER_VERSION_UNSUPPORTED")
        self.db.execute("PRAGMA user_version=1")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, at TEXT NOT NULL,
            kind TEXT NOT NULL, body TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL);
          CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
            BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
          CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
            BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        """)
        self.events()

    def close(self) -> None:
        self.db.close()

    def events(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        total_bytes = 0
        previous = "0" * 64
        for seq, at, kind, body, prior, digest in self.db.execute(
            "SELECT seq,at,kind,body,previous,digest FROM events ORDER BY seq LIMIT ?",
            (MAX_EVENTS + 1,),
        ):
            total_bytes += len(body)
            if total_bytes > 32_000_000:
                raise ValueError("CANDIDATE_LEDGER_BYTE_CAPACITY")
            value = {
                "seq": seq,
                "at": at,
                "kind": kind,
                "body": json.loads(body),
                "previous": prior,
            }
            if seq != len(result) + 1 or prior != previous or sha(encoded(value)) != digest:
                raise ValueError("CANDIDATE_LEDGER_CORRUPT")
            previous = digest
            result.append({**value, "digest": digest})
        if len(result) > MAX_EVENTS:
            raise ValueError("CANDIDATE_LEDGER_CAPACITY")
        return result

    def append(self, kind: str, body: dict[str, Any]) -> dict[str, Any]:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            rows = self.events()
            if len(rows) >= MAX_EVENTS:
                raise ValueError("CANDIDATE_LEDGER_CAPACITY")
            now = self.clock()
            if (
                now.tzinfo is None
                or now.utcoffset() != timedelta(0)
                or (rows and now < timestamp(rows[-1]["at"]))
            ):
                raise ValueError("CANDIDATE_CLOCK_INVALID")
            value = {
                "seq": len(rows) + 1,
                "at": now.isoformat(),
                "kind": kind,
                "body": body,
                "previous": rows[-1]["digest"] if rows else "0" * 64,
            }
            raw = encoded(value)
            if len(raw) > 256_000:
                raise ValueError("CANDIDATE_EVENT_TOO_LARGE")
            digest = sha(raw)
            self.db.execute(
                "INSERT INTO events VALUES (?,?,?,?,?,?)",
                (
                    value["seq"],
                    value["at"],
                    kind,
                    encoded(body).decode(),
                    value["previous"],
                    digest,
                ),
            )
            self.db.execute("COMMIT")
            return {**value, "digest": digest}
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    @serialized
    def ingest(self, path: Path) -> dict[str, Any]:
        return self._ingest(path)

    def _ingest(self, path: Path) -> dict[str, Any]:
        # Record failures as trials too. Raw content is bounded and never executable.
        attempt = self.append("INGEST_ATTEMPT", {"source_code_sha256": self.fingerprint()})
        input_digest: str | None = None
        try:
            raw = bounded(path)
            input_digest = sha(raw)
            artifact = self.directory / f"proposal-{input_digest}.json"
            if not artifact.exists():
                forward.publish(
                    artifact, {"sha256": input_digest, "base64": base64.b64encode(raw).decode()}
                )
            report = Report.model_validate_json(raw)
            proposals = []
            seen = {
                c["hypothesis_sha256"]
                for e in self.events()
                if e["kind"] == "PROPOSALS"
                for c in e["body"]["candidates"]
            }
            for candidate in report.proposal.candidates:
                body = candidate.model_dump()
                identity = sha(
                    encoded(
                        {
                            key: " ".join(body[key].lower().split())
                            for key in ("hypothesis", "single_change", "baseline")
                        }
                    )
                )
                proposals.append(
                    {
                        "hypothesis_sha256": identity,
                        "duplicate": identity in seen,
                        "candidate": body,
                    }
                )
                seen.add(identity)
            return self.append(
                "PROPOSALS",
                {
                    "attempt": attempt["seq"],
                    "input_sha256": sha(raw),
                    "candidates": proposals,
                    "decision": "HOLD",
                    "source_verification": "PENDING_INDEPENDENT_RETRIEVAL_AND_REVIEW",
                },
            )
        except Exception:
            return self.append(
                "INGEST_FAILED",
                {
                    "attempt": attempt["seq"],
                    "reason": "INVALID_OR_UNAVAILABLE_REPORT",
                    "input_sha256": input_digest,
                    "decision": "HOLD",
                },
            )

    @serialized
    def scan(self, directory: Path) -> dict[str, Any]:
        if directory.is_symlink():
            raise ValueError("CANDIDATE_REPORT_DIRECTORY_INVALID")
        jobs = list(islice(directory.iterdir(), 1001))
        if len(jobs) > 1000:
            raise ValueError("CANDIDATE_REPORT_SCAN_LIMIT")
        seen = {e["body"]["job_sha256"] for e in self.events() if e["kind"] == "SCAN_CLAIM"}
        imported = 0
        for job in sorted(jobs):
            if (
                job.is_symlink()
                or not job.is_dir()
                or not re.fullmatch(r"(?:daily-\d{4}-\d{2}-\d{2}|weekly-\d{4}-W\d{2})", job.name)
            ):
                continue
            report = job / "report.json"
            failure = job / "failure.json"
            if not report.exists() and not failure.exists():
                continue
            identity = sha(
                encoded({"directory": sha(str(directory.resolve()).encode()), "job": job.name})
            )
            if identity in seen:
                continue
            claim_event = self.append(
                "SCAN_CLAIM", {"job_sha256": identity, "source_code_sha256": self.fingerprint()}
            )
            imported += 1
            try:
                claim_raw = bounded(job / "claim.json")
                claim = json.loads(claim_raw)
                if (
                    set(claim)
                    != {
                        "at",
                        "kind",
                        "input_sha256",
                        "source_input_sha256",
                        "prompt_sha256",
                        "worker_sha256",
                    }
                    or claim["kind"] not in ("daily", "weekly")
                    or timestamp(claim["at"]) > self.clock()
                ):
                    raise ValueError("CANDIDATE_GENERATOR_CLAIM_INVALID")
                if any(
                    not isinstance(claim[key], str) or not re.fullmatch(r"[a-f0-9]{64}", claim[key])
                    for key in (
                        "input_sha256",
                        "source_input_sha256",
                        "prompt_sha256",
                        "worker_sha256",
                    )
                ):
                    raise ValueError("CANDIDATE_GENERATOR_HASH_INVALID")
                evidence_raw = bounded(job / "evidence.json")
                Evidence.model_validate_json(evidence_raw)
                if sha(evidence_raw) != claim["input_sha256"] or not job.name.startswith(
                    claim["kind"] + "-"
                ):
                    raise ValueError("CANDIDATE_GENERATOR_INPUT_MISMATCH")
                if report.exists() and not failure.exists():
                    generated = Report.model_validate_json(bounded(report))
                    if claim["kind"] == "daily" and generated.proposal.candidates:
                        raise ValueError("CANDIDATE_DAILY_PROPOSALS_FORBIDDEN")
                    outcome = self._ingest(report)
                    self.append(
                        "SCAN_IMPORTED",
                        {
                            "claim": claim_event["seq"],
                            "generator_claim": claim,
                            "generator_claim_sha256": sha(claim_raw),
                            "outcome": outcome["seq"],
                        },
                    )
                elif failure.exists() and not report.exists():
                    raw = bounded(failure)
                    failed = json.loads(raw)
                    if (
                        failed.get("status") != "FAILED_OR_UNKNOWN"
                        or failed.get("decision") != "HOLD"
                        or failed.get("retry") is not False
                    ):
                        raise ValueError("CANDIDATE_GENERATOR_FAILURE_INVALID")
                    self.append(
                        "PROPOSAL_GENERATION_FAILED",
                        {
                            "claim": claim_event["seq"],
                            "generator_claim": claim,
                            "generator_claim_sha256": sha(claim_raw),
                            "failure_sha256": sha(raw),
                            "decision": "HOLD",
                        },
                    )
                else:
                    raise ValueError("CANDIDATE_GENERATOR_OUTCOME_AMBIGUOUS")
            except Exception:
                self.append(
                    "SCAN_FAILED",
                    {
                        "claim": claim_event["seq"],
                        "reason": "INVALID_GENERATOR_EVIDENCE",
                        "decision": "HOLD",
                    },
                )
            if imported == 2:
                break
        return {"kind": "SCAN_COMPLETE", "imported": imported, "decision": "HOLD"}

    @serialized
    def review_source(
        self,
        hypothesis: str,
        url: str,
        content: Path,
        *,
        reviewer: str,
        rationale: str,
        retrieved_at: str,
    ) -> dict[str, Any]:
        """Explicit human review receipt, never a model's self-attested citation."""
        attempt = self.append("SOURCE_REVIEW_ATTEMPT", {"hypothesis": hypothesis})
        try:
            candidates = [
                c
                for e in self.events()
                if e["kind"] == "PROPOSALS"
                for c in e["body"]["candidates"]
                if c["hypothesis_sha256"] == hypothesis
            ]
            if not candidates or not any(
                source["url"] == url for source in candidates[0]["candidate"]["sources"]
            ):
                raise ValueError("CANDIDATE_SOURCE_UNLINKED")
            # The caller must retrieve the cited page independently, inspect the
            # actual content and provide its explicit review; URL presence is not truth.
            from urllib.parse import urlsplit

            parsed = urlsplit(url)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("CANDIDATE_SOURCE_URL_INVALID")
            if not 1 <= len(reviewer) <= 80 or not 20 <= len(rationale) <= 2000:
                raise ValueError("CANDIDATE_REVIEW_REQUIRED")
            if timestamp(retrieved_at) > self.clock():
                raise ValueError("CANDIDATE_SOURCE_FUTURE")
            raw = bounded(content, 1_000_000)
            if not raw:
                raise ValueError("CANDIDATE_SOURCE_EMPTY")
            digest = sha(raw)
            artifact = self.directory / f"source-{digest}.json"
            if not artifact.exists():
                forward.publish(artifact, {"sha256": digest, "content_utf8": raw.decode("utf-8")})
            return self.append(
                "SOURCE_REVIEWED",
                {
                    "attempt": attempt["seq"],
                    "hypothesis": hypothesis,
                    "url": url,
                    "content_sha256": digest,
                    "retrieved_at": retrieved_at,
                    "reviewer": reviewer,
                    "rationale": rationale,
                    "verification": "OPERATOR_ATTESTED_INDEPENDENT_RETRIEVAL_AND_CLAIM_REVIEW",
                    "economic_validation": False,
                },
            )
        except Exception:
            return self.append(
                "SOURCE_REVIEW_FAILED",
                {
                    "attempt": attempt["seq"],
                    "hypothesis": hypothesis,
                    "reason": "MISSING_OR_INVALID_INDEPENDENT_REVIEW",
                },
            )

    def verify_sources(self, reviews: list[str]) -> None:
        events = {e["digest"]: e for e in self.events()}
        for identity in reviews:
            event = events[identity]
            if event["kind"] != "SOURCE_REVIEWED":
                raise ValueError("CANDIDATE_SOURCE_RECEIPT_INVALID")
            digest = event["body"]["content_sha256"]
            artifact = json.loads(bounded(self.directory / f"source-{digest}.json", 8_000_000))
            if artifact["sha256"] != digest or sha(artifact["content_utf8"].encode()) != digest:
                raise ValueError("CANDIDATE_SOURCE_CHANGED")

    @serialized
    def register(
        self, hypothesis: str, candidate: str, start: str, *, reviewer: str, rejection_rule: str
    ) -> dict[str, Any]:
        attempt = self.append(
            "REGISTRATION_ATTEMPT", {"hypothesis": hypothesis, "candidate": candidate}
        )
        try:
            events = self.events()
            proposals = [
                c
                for e in events
                if e["kind"] == "PROPOSALS"
                for c in e["body"]["candidates"]
                if c["hypothesis_sha256"] == hypothesis
            ]
            if (
                not proposals
                or candidate not in NAMES
                or not 1 <= len(reviewer) <= 80
                or not 20 <= len(rejection_rule) <= 2000
            ):
                raise ValueError("CANDIDATE_PROTOCOL_INVALID")
            urls = {source["url"] for source in proposals[0]["candidate"]["sources"]}
            reviews = [
                e["digest"]
                for e in events
                if e["kind"] == "SOURCE_REVIEWED"
                and e["body"]["hypothesis"] == hypothesis
                and e["body"]["url"] in urls
            ]
            reviewed = {
                e["body"]["url"]
                for e in events
                if e["kind"] == "SOURCE_REVIEWED" and e["body"]["hypothesis"] == hypothesis
            }
            if not urls <= reviewed:
                raise ValueError("CANDIDATE_SOURCES_UNREVIEWED")
            self.verify_sources(reviews)
            now = self.clock()
            begin = timestamp(start)
            if not timedelta(0) < begin - now <= timedelta(days=1):
                raise ValueError("CANDIDATE_WINDOW_NOT_FUTURE")
            if any(
                e["kind"] == "REGISTERED" and e["body"]["hypothesis"] == hypothesis for e in events
            ):
                raise ValueError("CANDIDATE_HYPOTHESIS_ALREADY_REGISTERED")
            protocol = {
                "attempt": attempt["seq"],
                "hypothesis": hypothesis,
                "candidate": candidate,
                "registered_at": now.isoformat(),
                "start": begin.isoformat(),
                "until": (begin + timedelta(days=30)).isoformat(),
                "days": 30,
                "window_seconds": 86400,
                "settlement_seconds": 600,
                "release": forward.RELEASE,
                "source_sha256": self.fingerprint(),
                "source_reviews": reviews,
                "reviewer": reviewer,
                "rejection_rule": rejection_rule,
                "comparison_family": list(NAMES),
                "family_variants": 3,
                "decision": "HOLD",
                "broker_authority": False,
                "promotion_authority": False,
                "counterfactual_net_pnl": None,
            }
            registration = self.append("REGISTERED", protocol)
            forward.publish(
                self.directory / f"registration-{registration['seq']}.json", registration
            )
            return registration
        except Exception:
            return self.append(
                "REGISTRATION_FAILED",
                {
                    "attempt": attempt["seq"],
                    "hypothesis": hypothesis,
                    "reason": "INVALID_OR_UNREVIEWED_FUTURE_PROTOCOL",
                    "decision": "HOLD",
                },
            )

    @serialized
    def evaluate(
        self,
        registration: int,
        day: int,
        input_path: Path,
        recordings: tuple[Path, ...],
        *,
        runner: Callable[..., dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        initial = next(
            (e for e in self.events() if e["seq"] == registration and e["kind"] == "REGISTERED"),
            None,
        )
        if initial is not None and type(day) is int and 0 <= day < 30:
            cutoff = timestamp(initial["body"]["start"]) + timedelta(days=day + 1, seconds=600)
            if self.clock() < cutoff:
                return self.append(
                    "EVALUATION_WAIT",
                    {"registration": registration, "day": day, "decision": "HOLD"},
                )
        attempt = self.append("EVALUATION_ATTEMPT", {"registration": registration, "day": day})
        try:
            events = self.events()
            registered = next(
                e for e in events if e["seq"] == registration and e["kind"] == "REGISTERED"
            )
            protocol = registered["body"]
            saved = json.loads(
                bounded(self.directory / f"registration-{registration}.json", 256_000)
            )
            if saved != registered:
                raise ValueError("CANDIDATE_REGISTRATION_CHANGED")
            self.verify_sources(protocol["source_reviews"])
            if protocol["source_sha256"] != self.fingerprint():
                raise ValueError("CANDIDATE_SOURCE_DRIFT")
            if type(day) is not int or not 0 <= day < 30 or not recordings:
                raise ValueError("CANDIDATE_DAY_INVALID")
            # Every attempted window is consumed, including crashes and failures.
            if any(
                e["kind"] == "EVALUATION_ATTEMPT"
                and e["seq"] != attempt["seq"]
                and e["body"] == attempt["body"]
                for e in events
            ):
                raise ValueError("CANDIDATE_WINDOW_ALREADY_ATTEMPTED")
            start = timestamp(protocol["start"]) + timedelta(days=day)
            end = start + timedelta(days=1)
            if self.clock() < end + timedelta(seconds=600):
                raise ValueError("CANDIDATE_WINDOW_INCOMPLETE")
            raw = bounded(input_path, 8_000_000)
            forward.publish(
                self.directory / f"evaluation-input-{attempt['seq']}.json",
                {"sha256": sha(raw), "base64": base64.b64encode(raw).decode()},
            )
            self.append(
                "EVALUATION_INPUT",
                {
                    "attempt": attempt["seq"],
                    "input_sha256": sha(raw),
                    "registration_sha256": registered["digest"],
                    "source_code_sha256": protocol["source_sha256"],
                },
            )
            payload = json.loads(raw)
            a, b = paired.input_window(payload)
            if (
                a != int(start.timestamp() * 1000)
                or b != int(end.timestamp() * 1000)
                or payload["release"] != protocol["release"]
            ):
                raise ValueError("CANDIDATE_INPUT_WINDOW_MISMATCH")
            if runner is None:
                tape = paired.load_tape(recordings[0], a, b, recordings[1:])
                forward.publish(
                    self.directory / f"tape-evidence-{attempt['seq']}.json", tape.evidence
                )
                self.append(
                    "EVALUATION_TAPE",
                    {
                        "attempt": attempt["seq"],
                        "tape_evidence_sha256": sha(forward.encoded(tape.evidence)),
                    },
                )
                result = paired.compare(payload, tape)
            else:
                result = runner(payload, recordings)
            if (
                result.get("decision") != "HOLD"
                or result.get("broker_authority") is not False
                or result.get("net_pnl") is not None
            ):
                raise ValueError("CANDIDATE_REPLAY_AUTHORITY_INVALID")
            if self.fingerprint() != protocol["source_sha256"]:
                raise ValueError("CANDIDATE_SOURCE_DRIFT")
            report = {
                "registration_sha256": registered["digest"],
                "attempt": attempt["seq"],
                "day": day,
                "input_sha256": sha(raw),
                "input": payload,
                "result": result,
                "decision": "HOLD",
                "promotion_authority": False,
                "counterfactual_net_pnl": None,
            }
            forward.publish(self.directory / f"evaluation-{registration}-{day}.json", report)
            return self.append(
                "EVALUATED",
                {
                    "attempt": attempt["seq"],
                    "registration": registration,
                    "day": day,
                    "report_sha256": sha(forward.encoded(report)),
                    "input_setups": result["input_setups"],
                    "decision": "HOLD",
                },
            )
        except Exception:
            return self.append(
                "EVALUATION_FAILED",
                {
                    "attempt": attempt["seq"],
                    "registration": registration,
                    "day": day,
                    "reason": "INCOMPLETE_INVALID_OR_CHANGED_EVIDENCE",
                    "decision": "HOLD",
                },
            )

    def review_packet(self, output: Path) -> None:
        events = self.events()
        counts = {
            kind: sum(e["kind"] == kind for e in events)
            for kind in sorted({e["kind"] for e in events})
        }
        # A crashed operation keeps its claim and an explicit unknown denominator.
        unfinished = {}
        for kind, terminal, reference in (
            ("INGEST_ATTEMPT", ("PROPOSALS", "INGEST_FAILED"), "attempt"),
            ("SOURCE_REVIEW_ATTEMPT", ("SOURCE_REVIEWED", "SOURCE_REVIEW_FAILED"), "attempt"),
            ("REGISTRATION_ATTEMPT", ("REGISTERED", "REGISTRATION_FAILED"), "attempt"),
            ("EVALUATION_ATTEMPT", ("EVALUATED", "EVALUATION_FAILED"), "attempt"),
            ("SCAN_CLAIM", ("SCAN_IMPORTED", "SCAN_FAILED", "PROPOSAL_GENERATION_FAILED"), "claim"),
        ):
            completed = {e["body"][reference] for e in events if e["kind"] in terminal}
            unfinished[kind] = sum(e["kind"] == kind and e["seq"] not in completed for e in events)
        # Include every failed attempt and duplicate. No winner-selection shortcut.
        forward.publish(
            output,
            {
                "label": "CANDIDATE_REVIEW_PACKET_V1",
                "decision": "HOLD",
                "broker_authority": False,
                "promotion_authority": False,
                "counterfactual_net_pnl": None,
                "events": events,
                "event_counts": counts,
                "unfinished_attempts": unfinished,
                "ledger_head": events[-1]["digest"] if events else "0" * 64,
                "limitations": [
                    "OPERATOR_SOURCE_REVIEW_IS_NOT_ECONOMIC_VALIDATION",
                    "LEXICAL_DEDUPLICATION_NOT_SEMANTIC_EQUIVALENCE",
                    "THREE_PREDECLARED_PAIRED_VARIANTS_PER_REGISTERED_FAMILY",
                    "DAILY_OPEN_GAP_OCO_CENSORING_RETAINED",
                    "UNKNOWN_COUNTERFACTUAL_COSTS_REMAIN_NULL",
                    "FROZEN_QUANTITIES_NOT_DYNAMIC_PORTFOLIO",
                    "THIRTY_DAYS_IS_COLLECTION_NOT_QUALIFICATION",
                ],
            },
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    commands = parser.add_subparsers(dest="action", required=True)
    scan = commands.add_parser("scan")
    scan.add_argument("--reports", type=Path, required=True)
    ingest = commands.add_parser("ingest")
    ingest.add_argument("--report", type=Path, required=True)
    review = commands.add_parser("review-source")
    for key in ("hypothesis", "url", "reviewer", "rationale", "retrieved-at"):
        review.add_argument("--" + key, required=True)
    review.add_argument("--content", type=Path, required=True)
    register = commands.add_parser("register")
    for key in ("hypothesis", "start", "reviewer", "rejection-rule"):
        register.add_argument("--" + key, required=True)
    register.add_argument("--candidate", choices=NAMES, required=True)
    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("--registration", type=int, required=True)
    evaluate.add_argument("--day", type=int, required=True)
    evaluate.add_argument("--input", type=Path, required=True)
    evaluate.add_argument("--recordings", type=Path, nargs="+", required=True)
    packet = commands.add_parser("packet")
    packet.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    lab = Lab(args.directory)
    try:
        if args.action == "scan":
            result = lab.scan(args.reports)
        elif args.action == "ingest":
            result = lab.ingest(args.report)
        elif args.action == "review-source":
            result = lab.review_source(
                args.hypothesis,
                args.url,
                args.content,
                reviewer=args.reviewer,
                rationale=args.rationale,
                retrieved_at=args.retrieved_at,
            )
        elif args.action == "register":
            result = lab.register(
                args.hypothesis,
                args.candidate,
                args.start,
                reviewer=args.reviewer,
                rejection_rule=args.rejection_rule,
            )
        elif args.action == "evaluate":
            result = lab.evaluate(args.registration, args.day, args.input, tuple(args.recordings))
        else:
            lab.review_packet(args.output)
            result = {"kind": "REVIEW_PACKET"}
        print(
            json.dumps({"status": result["kind"], "decision": "HOLD", "promotion_authority": False})
        )
    finally:
        lab.close()


if __name__ == "__main__":
    main()
