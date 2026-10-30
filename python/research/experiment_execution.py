"""Authenticated fixed-method job mailbox. Candidate output never grants authority."""

from __future__ import annotations

import fcntl
import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field

from python.research import isolated_worker as worker
from python.research.codex_loop import StrictModel, timestamp
from python.research.experiment_registry import Method, Outcome, Registration, Registry, read
from python.research.learning_archive import (
    atomic_bytes,
    bounded,
    immutable,
    parse,
    sync_directory,
    unique,
)
from python.research.learning_evidence import MAX_BYTES, Digest, Instant, encoded
from python.research.observation_cycle import sha
from python.research.source_verifier import GitObjects, MirrorTrust

METHOD = "cohort-cost-clock-audit-1.0"
SOURCE = "python/research/experiments/cohort_audit.py"
MAX_REQUEST = 2 * MAX_BYTES + 65536
MAX_RECEIPT = 160000


class Receipt(StrictModel):
    trialId: Digest
    status: Literal["FAILED", "RETURNED"]
    requestSha256: Digest
    startedAt: Instant
    completedAt: Instant
    registrationSha256: Digest
    claimSha256: Digest
    packetSha256: Digest
    codeBundleSha256: Digest
    runtimeSha256: Digest
    verifierSha256: Digest
    sourceCommit: Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")]
    outputHex: Annotated[str, Field(pattern=r"^(?:[a-f0-9]{2})*$", max_length=131072)]
    exitCode: int | None
    error: Annotated[str, Field(pattern=r"^(?:WORKER|RESEARCH)_[A-Z_]{1,100}$")] | None
    brokerAuthority: Literal[False]
    promotionAuthority: Literal[False]


@dataclass(frozen=True)
class ApprovedMethod:
    """Root-provisioned source/worker pins; never populated from a remote request."""

    source_commit: str
    code: bytes
    trust: worker.WorkerTrust

    @property
    def files(self) -> dict[str, bytes]:
        return {SOURCE: self.code}

    @property
    def bundle(self) -> str:
        return worker.bundle_digest(self.files)

    def method(self) -> Method:
        return Method(
            methodId=METHOD,
            hypothesis=(
                "This packet establishes positive window-closed net "
                "and complete causal entry acceptance clocks."
            ),
            baseline="All scoped observations; window closes selected only by actual close time.",
            measurement=(
                "Signed recorded fees/net and provider availability to actual broker "
                "acceptance; retain all roles and missing clocks."
            ),
            falsification=(
                "Nonpositive closed-row net or missing/invalid clocks refutes "
                "the joint claim; no closes is inconclusive."
            ),
            runtimeSha256=self.trust.runtime_sha256,
            costPolicy="RECORDED_SIGNED_COSTS_ONLY_UNKNOWN_COUNTERFACTUALS_NULL",
            cohortPolicy="ALL_ROWS_RETAIN_OPEN_GAP_PARTIAL_NONFILL_AND_CARRY_IN",
            dataUse="RETROSPECTIVE_EXPLORATORY_NOT_PROSPECTIVE",
        )


def provisioned(path: Path) -> ApprovedMethod:
    worker.trusted_path(path)
    config = read(path)
    trust = worker.WorkerTrust(
        **{
            **config["worker"],
            "runtime": Path(config["worker"]["runtime"]),
            "verifier": Path(config["worker"]["verifier"]),
        }
    )
    source = Path(config["sourceFile"])
    worker.trusted_path(source)
    code = bounded(source, 262144)
    if sha(code) != config["sourceSha256"]:
        raise ValueError("RESEARCH_APPROVED_SOURCE_CHANGED")
    if not re.fullmatch(r"[a-f0-9]{40}", config["sourceCommit"]):
        raise ValueError("RESEARCH_APPROVED_COMMIT_INVALID")
    return ApprovedMethod(config["sourceCommit"], code, trust)


def verify_source(approved: ApprovedMethod, trust: MirrorTrust) -> None:
    """Reuse #448 raw Git object verification for this reviewed, fixed main-tree module."""
    trust.verify()
    objects = GitObjects(trust)
    commit = objects.main()
    tree = objects.read(commit, "commit").split(b"\n", 1)[0]
    if not tree.startswith(b"tree ") or commit != approved.source_commit:
        raise ValueError("RESEARCH_APPROVED_SOURCE_COMMIT")
    _, files = objects.snapshot(tree[5:].decode())
    if files.get(SOURCE) != approved.code:
        raise ValueError("RESEARCH_APPROVED_SOURCE_BYTES")
    objects.main()


def request(registry: Registry, value: Registration, approved: ApprovedMethod) -> dict[str, Any]:
    job, loaded = registry.load(value.questionId, value.trialId)
    if (
        loaded != value
        or value.method != approved.method()
        or value.codeBundleSha256 != approved.bundle
    ):
        raise ValueError("RESEARCH_METHOD_NOT_APPROVED")
    return {
        "registration": value.model_dump(),
        "claim": read(job / "claim.json"),
        "packet": bounded(job / "input.json", MAX_BYTES).decode(),
        "sourceCommit": approved.source_commit,
        "verifierSha256": approved.trust.verifier_sha256,
    }


def validate_request(value: dict[str, Any], approved: ApprovedMethod) -> Registration:
    if set(value) != {"registration", "claim", "packet", "sourceCommit", "verifierSha256"}:
        raise ValueError("RESEARCH_REQUEST_FIELDS")
    reg = Registration.model_validate(value["registration"])
    claim = value["claim"]
    packet = parse(value["packet"].encode(), reg.packetSha256)
    if any(g.accountCurrency != "USD" for g in packet.setups):
        raise ValueError("RESEARCH_METHOD_CURRENCY_UNSUPPORTED")
    identities = [t.id for g in packet.setups for t in g.closedTrades]
    if len(identities) != len(set(identities)):
        raise ValueError("RESEARCH_DUPLICATE_CLOSED_ROW")
    identity = sha(
        encoded([reg.questionId, reg.packetSha256, reg.codeBundleSha256, reg.method.model_dump()])
    )
    if (
        reg.trialId != identity
        or reg.method != approved.method()
        or reg.codeBundleSha256 != approved.bundle
        or packet.sourceId != reg.sourceId
        or reg.questionId != sha(encoded([reg.sourceId, " ".join(reg.question.casefold().split())]))
        or value["sourceCommit"] != approved.source_commit
        or value["verifierSha256"] != approved.trust.verifier_sha256
        or set(claim) != {"trialId", "registrationSha256", "claimedAt"}
        or claim["trialId"] != reg.trialId
        or claim["registrationSha256"] != sha(encoded(reg.model_dump()))
        or timestamp(claim["claimedAt"]) < timestamp(reg.registeredAt)
        or timestamp(reg.registeredAt) < timestamp(packet.exportedAt)
    ):
        raise ValueError("RESEARCH_REQUEST_BINDING")
    return reg


class Mailbox(Registry):
    """Only the forced-command receiver and trusted worker own this bounded mailbox."""

    def submit(self, raw: bytes, approved: ApprovedMethod) -> dict[str, Any]:
        if len(raw) > MAX_REQUEST:
            raise ValueError("RESEARCH_REQUEST_LIMIT")
        data = json.loads(raw, object_pairs_hook=unique)
        reg = validate_request(data, approved)
        with self.locked():
            job = self.directory(reg.trialId)
            if not job.exists():
                if sum(p.is_dir() for p in self.root.iterdir()) >= 1000:
                    raise ValueError("RESEARCH_MAILBOX_CAPACITY")
                job.mkdir(mode=0o700)
                sync_directory(self.root)
            # Canonical bytes make equivalent repeated deliveries idempotent.
            path = job / "request.json"
            canonical = encoded(data)
            if path.exists():
                if bounded(path, MAX_REQUEST) != canonical:
                    raise ValueError("RESEARCH_REQUEST_CONFLICT")
            else:
                atomic_bytes(path, canonical, replace=False)
        return self.query(reg.trialId)

    def query(self, trial: str) -> dict[str, Any]:
        job = self.directory(trial)
        if not (job / "request.json").exists():
            return {"trialId": trial, "status": "NOT_RECEIVED"}
        if (job / "receipt.json").exists():
            return dict(read(job / "receipt.json", MAX_RECEIPT))
        return {
            "trialId": trial,
            "status": "RUNNING_OR_UNKNOWN" if (job / "execution.json").exists() else "QUEUED",
        }

    def execute_one(
        self, approved: ApprovedMethod, execute: Callable[..., worker.WorkerResult] = worker.run
    ) -> dict[str, Any]:
        # Intake stays available while one worker holds the separate execution lock.
        lock = self.root / "worker.lock"
        if lock.is_symlink():
            raise ValueError("RESEARCH_MAILBOX_LOCK_INVALID")
        with lock.open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for job in sorted(self.root.iterdir()):
                if not job.is_dir() or job.is_symlink() or not (job / "request.json").exists():
                    continue
                self.directory(job.name)
                if (job / "execution.json").exists():
                    continue  # A claimed job is queried, never run again after restart.
                data = read(job / "request.json", MAX_REQUEST)
                reg = validate_request(data, approved)
                if reg.trialId != job.name:
                    raise ValueError("RESEARCH_MAILBOX_IDENTITY")
                claim = {
                    "requestSha256": sha(encoded(data)),
                    "startedAt": datetime.now(UTC).isoformat(),
                }
                immutable(job / "execution.json", claim)
                receipt: dict[str, Any] = {
                    "trialId": reg.trialId,
                    "status": "FAILED",
                    **claim,
                    "registrationSha256": sha(encoded(reg.model_dump())),
                    "claimSha256": sha(encoded(data["claim"])),
                    "packetSha256": reg.packetSha256,
                    "codeBundleSha256": approved.bundle,
                    "runtimeSha256": approved.trust.runtime_sha256,
                    "verifierSha256": approved.trust.verifier_sha256,
                    "sourceCommit": approved.source_commit,
                    "outputHex": "",
                    "exitCode": None,
                    "error": None,
                    "brokerAuthority": False,
                    "promotionAuthority": False,
                }
                try:
                    result = execute(
                        approved.files,
                        approved.bundle,
                        approved.trust,
                        data=data["packet"].encode(),
                        expected_input=reg.packetSha256,
                    )
                    if (
                        result.bundle_sha256 != approved.bundle
                        or result.input_sha256 != reg.packetSha256
                        or result.runtime_sha256 != approved.trust.runtime_sha256
                        or result.verifier_sha256 != approved.trust.verifier_sha256
                        or len(result.output) > worker.MAX_OUTPUT
                    ):
                        raise ValueError("RESEARCH_WORKER_RECEIPT_BINDING")
                    receipt.update(
                        status="RETURNED", outputHex=result.output.hex(), exitCode=result.exit_code
                    )
                except (OSError, ValueError) as error:
                    reason = str(error)
                    receipt["error"] = (
                        reason
                        if re.fullmatch(r"(?:WORKER|RESEARCH)_[A-Z_]{1,100}", reason)
                        else "RESEARCH_WORKER_FAILED"
                    )
                receipt["completedAt"] = datetime.now(UTC).isoformat()
                immutable(job / "receipt.json", receipt)
                return receipt
        return {"status": "IDLE"}


def independently_measure(raw: bytes) -> dict[str, Any]:
    """Trusted typed-data scorer, separately implemented; never imports worker source."""
    packet = parse(raw, sha(raw))
    with localcontext() as precision:
        precision.prec = 100
        trades = {t.id: t for g in packet.setups for t in g.closedTrades}
        rows = [
            t
            for t in trades.values()
            if timestamp(packet.start) <= timestamp(t.closedAt) < timestamp(packet.until)
        ]
        clocks = []
        contexts = {c.id: c for c in packet.contexts}
        for group in packet.setups:
            ctx = contexts.get(group.contextId or "")
            for order in group.orders:
                times = [
                    timestamp(e.occurredAt)
                    for e in group.brokerEvents
                    if e.orderId == order.id
                    and e.executionType == 2
                    and not e.closingOrder
                    and e.mappingState == "MAPPED"
                    and e.clockStatus == "CAUSAL"
                ]
                delta = None
                if times and ctx and ctx.availableAt and ctx.clockStatus == "CAUSAL":
                    micros = min(times) - timestamp(ctx.availableAt)
                    value = (
                        micros.days * 86400000000 + micros.seconds * 1000000 + micros.microseconds
                    )
                    if value >= 0:
                        delta = str(value)
                clocks.append({"orderId": order.id, "availabilityToAcceptanceMicros": delta})
        return {
            "method": METHOD,
            "roles": {
                f: dict(Counter(r.cohortRole for r in getattr(packet, f)))
                for f in ("contexts", "analyses", "setups", "flight")
            },
            "decisions": dict(Counter(c.decision for c in packet.contexts)),
            "analysisReasons": dict(Counter(r for a in packet.analyses for r in a.reasonCodes)),
            "setupStates": dict(Counter(g.state for g in packet.setups)),
            "orderStates": dict(Counter(o.state for g in packet.setups for o in g.orders)),
            "recordedFillRows": sum(len(g.fills) for g in packet.setups),
            "recordedPartialOrders": sum(
                0 < Decimal(o.filledVolume) < Decimal(o.approvedVolume)
                for g in packet.setups
                for o in g.orders
            ),
            "recordedOpenPositions": sum(
                p.positionState != "CLOSED" for g in packet.setups for p in g.currentProtection
            ),
            "closedRowsInPacket": len(trades),
            "closedInWindow": len(rows),
            "wins": sum(Decimal(t.realizedNet) > 0 for t in rows),
            "losses": sum(Decimal(t.realizedNet) < 0 for t in rows),
            "net": format(sum((Decimal(t.realizedNet) for t in rows), Decimal(0)), "f"),
            "signedFees": format(sum((Decimal(t.signedFees) for t in rows), Decimal(0)), "f"),
            "acceptanceClocks": clocks,
            "flightUnavailable": sum(f.unavailableReason is not None for f in packet.flight),
            "flightGaps": sum(f.gaps or 0 for f in packet.flight),
            "coverageWarnings": packet.coverageWarnings,
            "counterfactualNet": None,
            "economicQualification": False,
        }


def reconcile(
    registry: Registry, reg: Registration, approved: ApprovedMethod, receipt: dict[str, Any]
) -> str:
    expected = request(registry, reg, approved)
    if receipt["trialId"] != reg.trialId:
        raise ValueError("RESEARCH_RESULT_TRIAL_MISMATCH")
    if receipt["status"] in {"NOT_RECEIVED", "QUEUED", "RUNNING_OR_UNKNOWN"}:
        return str(receipt["status"])  # No resubmission authority, even when remote says absent.
    receipt = Receipt.model_validate(receipt).model_dump()
    for key, value in {
        "requestSha256": sha(encoded(expected)),
        "registrationSha256": sha(encoded(reg.model_dump())),
        "claimSha256": sha(encoded(expected["claim"])),
        "packetSha256": reg.packetSha256,
        "codeBundleSha256": approved.bundle,
        "runtimeSha256": approved.trust.runtime_sha256,
        "verifierSha256": approved.trust.verifier_sha256,
        "sourceCommit": approved.source_commit,
        "brokerAuthority": False,
        "promotionAuthority": False,
    }.items():
        if receipt.get(key) != value:
            raise ValueError("RESEARCH_RESULT_BINDING")
    if (
        not timestamp(expected["claim"]["claimedAt"])
        <= timestamp(receipt["startedAt"])
        <= timestamp(receipt["completedAt"])
        <= datetime.now(UTC)
    ):
        raise ValueError("RESEARCH_RESULT_CLOCK")
    output = bytes.fromhex(receipt["outputHex"])
    if len(output) > worker.MAX_OUTPUT or receipt["status"] not in {"FAILED", "RETURNED"}:
        raise ValueError("RESEARCH_RESULT_LIMIT_OR_STATUS")
    measured = None
    kind = "FAILED"
    if receipt["status"] == "RETURNED" and receipt["exitCode"] == 0:
        try:
            measured = json.loads(output, object_pairs_hook=unique)
        except ValueError:
            measured = None
        trusted = independently_measure(expected["packet"].encode())
        if measured != trusted:
            kind = "REJECTED"
            measured = None
        else:
            kind = (
                "INCONCLUSIVE"
                if not trusted["closedInWindow"]
                else "POSITIVE"
                if Decimal(trusted["net"]) > 0
                and all(
                    c["availabilityToAcceptanceMicros"] is not None
                    for c in trusted["acceptanceClocks"]
                )
                else "NEGATIVE"
            )
    outcome = Outcome.model_validate(
        {
            "trialId": reg.trialId,
            "claimSha256": receipt["claimSha256"],
            "resultSha256": sha(output),
            "kind": kind,
            "recordedAt": receipt["completedAt"],
            "independentValidation": False,
            "counterfactualNet": None,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
    )
    registry.retain(reg.questionId, outcome, output)
    job, _ = registry.load(reg.questionId, reg.trialId)
    with registry.locked():
        immutable(job / "remote-receipt.json", receipt)
        finding = {
            "trialId": reg.trialId,
            "registrationSha256": receipt["registrationSha256"],
            "receiptSha256": sha(encoded(receipt)),
            "resultSha256": sha(output),
            "kind": kind,
            "origin": "AUTONOMOUS_FIXED_METHOD_EXPERIMENT",
            "measurementValidated": measured is not None,
            "measurement": measured,
            "originalQuestionAnswered": False,
            "scope": "FIXED_COST_CLOCK_PREREQUISITE_NOT_ARBITRARY_QUESTION_OR_STRATEGY_TEST",
            "counterfactualNet": None,
            "brokerAuthority": False,
            "promotionAuthority": False,
        }
        immutable(job / "experiment-finding.json", finding)
        immutable(
            job / "experiment-closed.json",
            {"trialId": reg.trialId, "findingSha256": sha(encoded(finding)), "status": "CLOSED"},
        )
    return "CLOSED_" + kind
