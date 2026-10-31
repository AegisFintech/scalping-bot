"""Read-only health for the existing bot and research loop; never recovery authority."""

from __future__ import annotations

import argparse
import json
import os
import re
import resource
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import monotonic
from typing import Annotated, Any, Literal
from urllib.request import urlopen

from pydantic import Field, model_validator

from python.operations import flight_heartbeat
from python.operations import research_delivery as delivery
from python.research.codex_loop import StrictModel, timestamp
from python.research.experiment_registry import read
from python.research.learning_archive import atomic_bytes, bounded
from python.research.learning_evidence import Instant, encoded
from python.research.observation_cycle import sha

LIMIT = 65536
HealthState = Literal["CURRENT", "WAITING", "BLOCKED", "STALE", "UNAVAILABLE"]
STAGE_TTL = {
    "Demo": 180,
    "Flight recorder": 180,
    "Observation": 2400,
    "Experiments": 300,
    "Publishing": 300,
}


class Stage(StrictModel):
    name: Literal["Demo", "Flight recorder", "Observation", "Experiments", "Publishing"]
    state: HealthState
    checkedAt: Instant | None
    expiresAt: Instant | None
    detail: Annotated[str, Field(max_length=700)]

    @model_validator(mode="after")
    def deadline(self) -> Stage:
        if self.checkedAt is None and self.state != "UNAVAILABLE":
            raise ValueError("HEALTH_OBSERVATION_TIME_REQUIRED")
        expected = (
            timestamp(self.checkedAt) + timedelta(seconds=STAGE_TTL[self.name])
            if self.checkedAt
            else None
        )
        if (timestamp(self.expiresAt) if self.expiresAt else None) != expected:
            raise ValueError("HEALTH_STAGE_DEADLINE")
        return self


class ResearchHealth(StrictModel):
    checkedAt: Instant
    observation: Stage
    experiments: Stage
    question: Annotated[str, Field(max_length=600)] | None
    planId: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None
    trialId: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None
    closureCounts: (
        dict[
            Literal["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "REJECTED", "FAILED", "OPEN", "GAP"],
            Annotated[int, Field(ge=0, le=4000)],
        ]
        | None
    )

    @model_validator(mode="after")
    def roles(self) -> ResearchHealth:
        if self.observation.name != "Observation" or self.experiments.name != "Experiments":
            raise ValueError("HEALTH_RESEARCH_ROLE")
        return self


class PublisherHealth(StrictModel):
    checkedAt: Instant
    status: Literal["DISABLED", "BLOCKED", "DRAFT", "AWAITING_REVIEW", "CHECKING", "MERGED", "IDLE"]
    reason: Annotated[str, Field(pattern=r"^[A-Z_]{1,100}$")]
    pullRequest: Annotated[int, Field(ge=1, le=999999999)] | None
    headCommit: Annotated[str, Field(pattern=r"^[a-f0-9]{40}$")] | None


class HarnessHealth(StrictModel):
    version: Literal["harness-health-1.0"]
    checkedAt: Instant
    stages: Annotated[list[Stage], Field(min_length=5, max_length=5)]
    research: ResearchHealth | None
    publisher: PublisherHealth | None
    brokerAuthority: Literal[False]
    recoveryAuthority: Literal[False]
    promotionAuthority: Literal[False]

    @model_validator(mode="after")
    def roles(self) -> HarnessHealth:
        if [s.name for s in self.stages] != [
            "Demo",
            "Flight recorder",
            "Observation",
            "Experiments",
            "Publishing",
        ]:
            raise ValueError("HEALTH_STAGE_ROLES")
        return self


class RemoteHealth11(StrictModel):
    version: Literal["research-health-1.1"]
    core: ResearchHealth
    review: delivery.ReviewHealth | None


class HarnessEnvelope11(StrictModel):
    version: Literal["harness-health-1.1"]
    checkedAt: Instant
    core: HarnessHealth
    delivery: delivery.DeliveryHealth

    @model_validator(mode="after")
    def clock(self) -> HarnessEnvelope11:
        if self.checkedAt != self.core.checkedAt or self.checkedAt != self.delivery.checkedAt:
            raise ValueError("HEALTH_ENVELOPE_CLOCK")
        return self


def fresh(value: object, now: datetime, seconds: int) -> bool:
    if not isinstance(value, str):
        return False
    return now - timedelta(seconds=seconds) <= timestamp(value) <= now + timedelta(seconds=5)


def stage(name: Any, state: HealthState, at: str | None, detail: str) -> Stage:
    expiry = (timestamp(at) + timedelta(seconds=STAGE_TTL[name])).isoformat() if at else None
    return Stage(name=name, state=state, checkedAt=at, expiresAt=expiry, detail=detail)


def observation(root: Path, now: datetime) -> tuple[Stage, str | None, str | None]:
    try:
        value = read(root / "health.json")
        at = value["checkedAt"]
        if not fresh(at, now, 2400):
            return (
                stage("Observation", "STALE", at, "No current scheduled review evidence."),
                None,
                None,
            )
        if value["status"] != "CLOSED":
            return (
                stage(
                    "Observation",
                    "BLOCKED",
                    at,
                    "Latest review did not close; retained work is not replayed.",
                ),
                None,
                None,
            )
        key = value["planId"]
        if not re.fullmatch(r"[a-f0-9]{64}", key):
            raise ValueError("HEALTH_PLAN_ID")
        job = root / "archive/scalper-epoch314/current-observation-agenda" / key
        finding = read(job / "finding.json")
        closure = read(job / "closed.json")
        if closure != {"planId": key, "findingSha256": sha(encoded(finding)), "status": "CLOSED"}:
            raise ValueError("HEALTH_REVIEW_CLOSURE")
        question = finding["interpretation"]["nextQuestion"]
        return (
            stage(
                "Observation",
                "CURRENT",
                at,
                "Scheduled review closed; proposed question is unvalidated.",
            ),
            question,
            key,
        )
    except (OSError, ValueError, KeyError, TypeError):
        return stage("Observation", "UNAVAILABLE", None, "Review evidence unavailable."), None, None


def experiments(root: Path, now: datetime) -> tuple[Stage, str | None, dict[str, int] | None]:
    try:
        value = read(root / "experiments450/health.json")
        at = value["checkedAt"]
        if not fresh(at, now, 300):
            return (
                stage("Experiments", "STALE", at, "Coordinator observations are stale."),
                None,
                None,
            )
        if value.get("status") != "CHECKED":
            return (
                stage("Experiments", "BLOCKED", at, "Coordinator check did not complete."),
                None,
                None,
            )
        counts: Counter[str] = Counter()
        closures = list((root / "experiments450").glob("*/*/experiment-closed.json"))
        if len(closures) > 4000:
            raise ValueError("HEALTH_LEDGER_CAPACITY")
        for path in closures:
            closure = read(path)
            finding = read(path.parent / "experiment-finding.json")
            if (
                closure
                != {
                    "trialId": path.parent.name,
                    "findingSha256": sha(encoded(finding)),
                    "status": "CLOSED",
                }
                or finding["trialId"] != path.parent.name
            ):
                raise ValueError("HEALTH_EXPERIMENT_CLOSURE")
            counts[finding["kind"]] += 1
        recent = value.get("recent", [])
        trial = recent[-1]["trialId"] if recent else None
        unknown_states = {"RUNNING_OR_UNKNOWN", "NOT_RECEIVED", "TRANSFER_OR_RESULT_UNKNOWN"}
        permitted = (
            unknown_states
            | {"QUEUED"}
            | {
                "CLOSED_" + kind
                for kind in [
                    "POSITIVE",
                    "NEGATIVE",
                    "INCONCLUSIVE",
                    "REJECTED",
                    "FAILED",
                    "OPEN",
                    "GAP",
                ]
            }
        )
        if any(r["status"] not in permitted for r in recent):
            raise ValueError("HEALTH_JOB_STATUS_UNKNOWN")
        unknown = any(r["status"] in unknown_states for r in recent)
        budget_wait = value.get("admissionBlocker") == "RESEARCH_REGISTRY_TRIAL_BUDGET"
        state: HealthState = (
            "BLOCKED"
            if unknown or (value.get("admissionBlocker") and not budget_wait)
            else "WAITING"
            if budget_wait
            else "CURRENT"
        )
        detail = "Fixed-method experiments; recorded closures are trials, not trades."
        if unknown:
            detail = "Unknown remote outcome retained; queries never authorize redispatch."
        elif budget_wait:
            detail = (
                "Question trial budget exhausted; waiting for a distinct attributable question. "
                "Existing jobs still reconcile."
            )
        elif value.get("admissionBlocker"):
            detail = "New experiment admission blocked; existing jobs still reconcile."
        claims = list((root / "experiments450").glob("*/*/claim.json"))
        if len(claims) > 4000:
            raise ValueError("HEALTH_LEDGER_CAPACITY")
        unresolved = sum(not (path.parent / "experiment-closed.json").exists() for path in claims)
        if unresolved:
            if state == "CURRENT":
                state = "WAITING"
            detail += (
                f" {unresolved} claimed job outcomes unresolved across the ledger;"
                " recent checks are a subset."
            )
        return stage("Experiments", state, at, detail), trial, dict(counts)
    except (OSError, ValueError, KeyError, TypeError):
        return (
            stage("Experiments", "UNAVAILABLE", None, "Experiment evidence unavailable."),
            None,
            None,
        )


def export(root: Path, now: datetime) -> ResearchHealth:
    review, question, plan = observation(root, now)
    jobs, trial, counts = experiments(root, now)
    return ResearchHealth.model_validate(
        {
            "checkedAt": now.isoformat(),
            "observation": review.model_dump(),
            "experiments": jobs.model_dump(),
            "question": question,
            "planId": plan,
            "trialId": trial,
            "closureCounts": counts,
        }
    )


def demo(value: dict[str, Any], now: datetime) -> Stage:
    at = now.isoformat()
    if not isinstance(value, dict):
        raise ValueError("HEALTH_STATUS_SHAPE")
    if (
        value.get("mode") != "demo"
        or value.get("operationalReady") is not True
        or value.get("startupChecksPassed") is not True
    ):
        return stage("Demo", "BLOCKED", at, "Operational readiness is not established.")
    if value.get("pauseNewAnalyses") is True or value.get("emergencyStopped") is True:
        return stage("Demo", "BLOCKED", at, "Explicit pause or emergency stop is active.")
    activity = value.get("automationActivity") or {}
    if not isinstance(activity, dict):
        raise ValueError("HEALTH_ACTIVITY_SHAPE")
    state = activity.get("state")
    if state not in {
        "DISABLED",
        "PAUSED",
        "MANAGING_SETUP",
        "WAITING_FOR_MARKET",
        "STARTING",
        "RUNNING",
        "STALLED",
    }:
        return stage("Demo", "UNAVAILABLE", at, "Scheduler progress cannot be verified.")
    if state == "STALLED":
        return stage("Demo", "BLOCKED", at, "Existing analysis watchdog reports stalled progress.")
    if state in {"DISABLED", "PAUSED", "WAITING_FOR_MARKET", "STARTING"}:
        return stage("Demo", "WAITING", at, "Scheduler reports " + state + "; no forced analysis.")
    session = value.get("marketSession") or {}
    if not isinstance(session, dict):
        raise ValueError("HEALTH_SESSION_SHAPE")
    if not fresh(session.get("checkedAt"), now, 30) or not fresh(
        session.get("scheduleFetchedAt"), now, 30
    ):
        return stage("Demo", "WAITING", at, "Session evidence is stale; new risk remains gated.")
    if session.get("state") == "CLOSED":
        return stage(
            "Demo", "WAITING", at, "Broker session closed; protection and reconciliation continue."
        )
    if session.get("state") != "OPEN":
        return stage("Demo", "WAITING", at, "Session evidence unavailable; new risk remains gated.")
    if state == "MANAGING_SETUP":
        return stage(
            "Demo", "CURRENT", at, "Managing accepted setup; new analysis correctly waits."
        )
    reasons = value.get("reasonCodes", [])
    if not isinstance(reasons, list) or any(
        not isinstance(r, str) or not re.fullmatch(r"[A-Z0-9_]{1,100}", r) for r in reasons
    ):
        raise ValueError("HEALTH_REASON_SHAPE")
    if reasons:
        return stage("Demo", "WAITING", at, "Admission waits: " + ", ".join(reasons[:4]))
    if value.get("automaticAnalysisEnabled") is not True:
        return stage("Demo", "WAITING", at, "Automatic analysis is disabled.")
    if value.get("tradingEnabled") is not True:
        return stage("Demo", "WAITING", at, "Current deterministic admission is not granted.")
    return stage(
        "Demo", "CURRENT", at, "Operationally ready; deterministic admission gates remain active."
    )


def transfer_limit() -> None:
    resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT + 1, LIMIT + 1))


def fetch_research() -> bytes:
    with tempfile.TemporaryFile() as output:
        subprocess.run(
            ["ssh", "-F", str(Path.home() / ".ssh/config"), "scalper-research-health"],
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.DEVNULL,
            timeout=12,
            check=True,
            preexec_fn=transfer_limit,
            env={"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"},
        )
        output.seek(0)
        raw = output.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError("HEALTH_REMOTE_OVERSIZED")
    return raw


def collect_packet(now: datetime) -> HarnessEnvelope11:
    started = monotonic()

    def current() -> datetime:
        return now + timedelta(seconds=monotonic() - started)

    try:
        with urlopen("http://127.0.0.1:8080/v1/status", timeout=10) as response:
            raw = response.read(262145)
        if len(raw) > 262144:
            raise ValueError("HEALTH_STATUS_OVERSIZED")
        bot = demo(json.loads(raw), current())
    except (OSError, ValueError, TypeError):
        bot = stage("Demo", "UNAVAILABLE", None, "Read-only execution status unavailable.")
    try:
        heartbeat = flight_heartbeat.load(current())
        flight = stage(
            "Flight recorder",
            "BLOCKED"
            if heartbeat.state == "GAP"
            else "UNAVAILABLE"
            if heartbeat.state == "UNAVAILABLE"
            else "CURRENT",
            heartbeat.recordedAt,
            "Sampled recorder heartbeat: "
            + heartbeat.state
            + "; not complete tick coverage or broker state.",
        )
    except (OSError, ValueError, KeyError, TypeError):
        flight = stage(
            "Flight recorder", "UNAVAILABLE", None, "Recorder heartbeat unavailable or stale."
        )

    remote = None
    review = None
    try:
        packet = json.loads(fetch_research())
        if not isinstance(packet, dict):
            raise ValueError("HEALTH_REMOTE_SHAPE")
        if packet.get("version") == "research-health-1.1":
            parsed = RemoteHealth11.model_validate(packet)
            remote, review = parsed.core, parsed.review
        else:
            remote = ResearchHealth.model_validate(packet)
        if not fresh(remote.checkedAt, current(), 60):
            raise ValueError("HEALTH_REMOTE_STALE")
        research_stages = [remote.observation, remote.experiments]
    except (OSError, ValueError, subprocess.SubprocessError):
        remote = review = None
        research_stages = [
            stage(name, "UNAVAILABLE", None, "Remote research health unavailable.")
            for name in ["Observation", "Experiments"]
        ]
    publication = None
    try:
        publication = PublisherHealth.model_validate(
            read(Path("/var/lib/scalper-publisher/status.json"))
        )
        if not fresh(publication.checkedAt, current(), 300):
            raise ValueError("HEALTH_PUBLISHER_STALE")
        publication_state: HealthState = (
            "BLOCKED"
            if publication.status in {"BLOCKED", "DISABLED"}
            else "WAITING"
            if publication.status in {"DRAFT", "AWAITING_REVIEW", "CHECKING", "IDLE"}
            else "CURRENT"
        )
        publisher = stage(
            "Publishing",
            publication_state,
            publication.checkedAt,
            f"{publication.status}: {publication.reason}. Research delivery only.",
        )
    except (OSError, ValueError):
        publication = None
        publisher = stage(
            "Publishing",
            "UNAVAILABLE",
            None,
            "No current publisher receipt. No automatic publication is inferred.",
        )
    core = HarnessHealth(
        version="harness-health-1.0",
        checkedAt=current().isoformat(),
        stages=[bot, flight, *research_stages, publisher],
        research=remote,
        publisher=publication,
        brokerAuthority=False,
        recoveryAuthority=False,
        promotionAuthority=False,
    )

    return HarnessEnvelope11(
        version="harness-health-1.1",
        checkedAt=core.checkedAt,
        core=core,
        delivery=delivery.DeliveryHealth(
            version="research-delivery-health-1.0",
            checkedAt=core.checkedAt,
            generation=delivery.load(delivery.GENERATION, delivery.GenerationHealth, current()),
            review=review,
            brokerAuthority=False,
            promotionAuthority=False,
        ),
    )


def collect(now: datetime) -> HarnessHealth:
    return collect_packet(now).core


def load(path: Path, now: datetime) -> dict[str, Any]:
    try:
        raw = json.loads(bounded(path, LIMIT))
        if not isinstance(raw, dict):
            raise ValueError("HEALTH_SNAPSHOT_SHAPE")
        packet = (
            HarnessEnvelope11.model_validate(raw)
            if raw.get("version") == "harness-health-1.1"
            else None
        )
        value = packet.core if packet else HarnessHealth.model_validate(raw)
        if not fresh(value.checkedAt, now, 180):
            raise ValueError("HEALTH_STALE")
        for item in value.stages:
            if item.checkedAt and not fresh(item.checkedAt, now, STAGE_TTL[item.name]):
                item.state = "STALE"
                item.detail = "This component's observation has expired."
        if value.research:
            value.research.observation, value.research.experiments = value.stages[2:4]
            if value.stages[2].state in {"STALE", "UNAVAILABLE"}:
                value.research.question = value.research.planId = None
            if value.stages[3].state in {"STALE", "UNAVAILABLE"}:
                value.research.closureCounts = value.research.trialId = None
        if value.stages[-1].state in {"STALE", "UNAVAILABLE"}:
            value.publisher = None
        result = value.model_dump()
        if packet:
            result["delivery"] = delivery.view(packet.delivery, now)
        return result
    except (OSError, ValueError):
        return {"available": False, "reason": "Harness status unavailable or stale."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "collect"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise ValueError("HEALTH_DEDICATED_USER_REQUIRED")
    now = datetime.now(UTC)
    if args.action == "export":
        print(
            encoded(
                RemoteHealth11(
                    version="research-health-1.1",
                    core=export(args.path, now),
                    review=delivery.load(delivery.REVIEW, delivery.ReviewHealth, now),
                ).model_dump()
            ).decode()
        )
    else:
        packet = collect_packet(now)
        raw = encoded(packet.model_dump())
        atomic_bytes(args.path, raw, replace=True)
        args.path.chmod(0o644)
        print(
            encoded(
                {
                    "event": "HARNESS_HEALTH",
                    "checkedAt": now.isoformat(),
                    "stages": {s["name"]: s["state"] for s in json.loads(raw)["core"]["stages"]},
                }
            ).decode()
        )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("HARNESS_HEALTH_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
