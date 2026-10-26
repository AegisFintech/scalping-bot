"""Subscription-authenticated proposal worker, separate from execution authority."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import signal
import subprocess
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, encoded, publish, read_bounded, timestamp
from python.technical.models import ContextEvidence

MODEL = "gpt-6.1-sol"
MAX_BYTES = 128_000
TIMEOUT = 90
Price = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]{0,12})(\.[0-9]{1,10})?$", max_length=24)]


class Quote(StrictModel):
    bid: Price
    ask: Price
    sourceTime: str
    receivedAt: str


class Bounds(StrictModel):
    minimum_entry_distance: Price
    buy_stop_minimum: Price
    sell_stop_maximum: Price
    movement_buffer: Price
    preferred_buy_stop_minimum: Price
    preferred_sell_stop_maximum: Price


class Candles(StrictModel):
    timeframe: Literal["M1", "M5", "M15"]
    columns: list[str]
    rows: Annotated[list[list[Any]], Field(min_length=1, max_length=288)]

    @model_validator(mode="after")
    def complete(self) -> Candles:
        if self.columns != [
            "startTime",
            "endTime",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "complete",
            "qualityFlags",
        ]:
            raise ValueError("CODEX_COLUMNS_INVALID")
        previous: datetime | None = None
        for row in self.rows:
            if (
                len(row) != 9
                or row[7] is not True
                or row[8] not in ([], ["BROKER_SESSION_GAP_BEFORE"])
            ):
                raise ValueError("CODEX_COMPLETED_CANDLES_REQUIRED")
            start, end = timestamp(row[0]), timestamp(row[1])
            seconds = {"M1": 60, "M5": 300, "M15": 900}[self.timeframe]
            if (end - start).total_seconds() != seconds:
                raise ValueError("CODEX_CANDLE_TIME_INVALID")
            # Same trusted broker-session marker contract as analytics and the Node planner.
            # No inferred gap repair: unmarked, fractional, overlapping or excessive gaps reject.
            gap = 0.0 if previous is None else (start - previous).total_seconds()
            marked = row[8] == ["BROKER_SESSION_GAP_BEFORE"]
            if (
                (gap == 0 and marked)
                or gap < 0
                or (gap > 0 and (not marked or gap % seconds != 0 or gap > 14 * 86400))
            ):
                raise ValueError("CODEX_CANDLE_TIME_INVALID")
            previous = end
            for value in row[2:6]:
                if (
                    not isinstance(value, str)
                    or len(value) > 24
                    or not Decimal(value).is_finite()
                    or Decimal(value) <= 0
                ):
                    raise ValueError("CODEX_PRICE_INVALID")
            opened, high, low, close = map(Decimal, row[2:6])
            if low > min(opened, close) or high < max(opened, close) or low > high:
                raise ValueError("CODEX_CANDLE_RANGE_INVALID")
            volume = row[6]
            if volume is not None and (
                not isinstance(volume, str)
                or len(volume) > 24
                or not Decimal(volume).is_finite()
                or Decimal(volume) < 0
            ):
                raise ValueError("CODEX_VOLUME_INVALID")
        return self


class Payload(StrictModel):
    captured_at: str
    tick_size: Price
    quote: Quote
    minimum_entry_distance: Price
    entry_boundaries: Bounds
    candles: Annotated[list[Candles], Field(min_length=3, max_length=3)]

    @model_validator(mode="after")
    def market(self) -> Payload:
        if {s.timeframe for s in self.candles} != {"M1", "M5", "M15"}:
            raise ValueError("CODEX_TIMEFRAMES_INVALID")
        captured = timestamp(self.captured_at)
        if (
            Decimal(self.tick_size) <= 0
            or Decimal(self.quote.bid) <= 0
            or Decimal(self.quote.ask) < Decimal(self.quote.bid)
        ):
            raise ValueError("CODEX_QUOTE_INVALID")
        for series in self.candles:
            age = captured - timestamp(series.rows[-1][1])
            period = {"M1": 60, "M5": 300, "M15": 900}[series.timeframe]
            if not timedelta(0) <= age < timedelta(seconds=period + 30):
                raise ValueError("CODEX_CANDLE_STALE_OR_FUTURE")
            if len(series.rows) > {"M1": 120, "M5": 144, "M15": 288}[series.timeframe]:
                raise ValueError("CODEX_CANDLE_LIMIT")
        return self


class Request(StrictModel):
    version: Literal["codex-entry-request-1.0", "codex-entry-request-1.1"]
    analysisId: str
    symbol: Literal["XAUUSD"]
    promptVersion: Literal["entry-pair-v4", "entry-pair-v5"]
    promptSha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    payload: Payload

    @model_validator(mode="after")
    def identifier(self) -> Request:
        expected = {
            "codex-entry-request-1.0": "entry-pair-v4",
            "codex-entry-request-1.1": "entry-pair-v5",
        }
        if self.promptVersion != expected[self.version]:
            raise ValueError("CODEX_PROMPT_VERSION_MISMATCH")
        if self.version == "codex-entry-request-1.0" and any(
            len(s.rows) > {"M1": 120, "M5": 72, "M15": 48}[s.timeframe]
            for s in self.payload.candles
        ):
            raise ValueError("CODEX_LEGACY_CANDLE_LIMIT")
        if str(UUID(self.analysisId)) != self.analysisId:
            raise ValueError("CODEX_ANALYSIS_ID_INVALID")
        return self


class RequestV11(Request):
    """Published 1.1 transport contract; historical schema stays immutable."""

    version: Literal["codex-entry-request-1.1"]
    promptVersion: Literal["entry-pair-v5"]


class PayloadV12(Payload):
    market_captured_at: str
    technical_context: ContextEvidence
    context_input_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

    @model_validator(mode="after")
    def context_matches_capture(self) -> PayloadV12:
        captured = timestamp(self.captured_at)
        market_captured = timestamp(self.market_captured_at)
        if not timedelta(0) <= market_captured - captured <= timedelta(seconds=3):
            raise ValueError("CODEX_SNAPSHOT_CLOCK_SKEW_INVALID")
        context = self.technical_context
        if not context.history_targets_met or {f.timeframe for f in context.frames} != {
            "M1",
            "M5",
            "M15",
        }:
            raise ValueError("CODEX_CONTEXT_HISTORY_INVALID")
        for frame in context.frames:
            series = next(s for s in self.candles if s.timeframe == frame.timeframe)
            if len(series.rows) > 12 or timestamp(frame.latest_completed_at) != timestamp(
                series.rows[-1][1]
            ):
                raise ValueError("CODEX_CONTEXT_CANDLES_MISMATCH")
            if frame.candle_count < {"M1": 720, "M5": 576, "M15": 480}[frame.timeframe]:
                raise ValueError("CODEX_CONTEXT_HISTORY_INVALID")
            references = [p.available_at for p in frame.pivots] + [
                e.available_at for e in frame.events
            ]
            references += [
                z.available_at for z in frame.nearest_active_zones + frame.recent_resolved_zones
            ]
            references += [p.available_at for p in frame.liquidity_pools]
            if any(timestamp(at) > captured for at in references):
                raise ValueError("CODEX_CONTEXT_LOOKAHEAD")
            for pivot in frame.pivots:
                if timestamp(pivot.candle_at) > timestamp(pivot.available_at):
                    raise ValueError("CODEX_CONTEXT_PROVENANCE_INVALID")
            for event in frame.events:
                if timestamp(event.pivot_at) > timestamp(event.available_at):
                    raise ValueError("CODEX_CONTEXT_PROVENANCE_INVALID")
            for zone in frame.nearest_active_zones + frame.recent_resolved_zones:
                available = timestamp(zone.available_at)
                if timestamp(zone.origin_at) > available:
                    raise ValueError("CODEX_CONTEXT_PROVENANCE_INVALID")
                lower, upper = Decimal(zone.lower), Decimal(zone.upper)
                if not lower.is_finite() or not upper.is_finite() or not 0 < lower <= upper:
                    raise ValueError("CODEX_CONTEXT_ZONE_INVALID")
                for changed_at in (zone.first_touched_at, zone.resolved_at):
                    if changed_at is not None and not available < timestamp(changed_at) <= captured:
                        raise ValueError("CODEX_CONTEXT_PROVENANCE_INVALID")
                if zone.status == "FRESH" and (
                    zone.first_touched_at is not None or zone.resolved_at is not None
                ):
                    raise ValueError("CODEX_CONTEXT_ZONE_INVALID")
                if zone.status in {"FILLED", "INVALIDATED"} and zone.resolved_at is None:
                    raise ValueError("CODEX_CONTEXT_ZONE_INVALID")
            for value in (frame.atr, frame.ema_fast, frame.ema_slow):
                if not Decimal(value).is_finite() or Decimal(value) <= 0:
                    raise ValueError("CODEX_CONTEXT_INDICATOR_INVALID")

        depth = context.depth
        sourced, received = timestamp(depth.source_at), timestamp(depth.received_at)
        if not sourced <= received <= market_captured or market_captured - sourced > timedelta(
            seconds=3
        ):
            raise ValueError("CODEX_CONTEXT_DEPTH_STALE")
        return self


class RequestV12(StrictModel):
    version: Literal["codex-entry-request-1.2"]
    analysisId: str
    symbol: Literal["XAUUSD"]
    promptVersion: Literal["entry-pair-v6"]
    promptSha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    payload: PayloadV12

    @model_validator(mode="after")
    def identifier(self) -> RequestV12:
        if str(UUID(self.analysisId)) != self.analysisId:
            raise ValueError("CODEX_ANALYSIS_ID_INVALID")
        return self


class ClosedOutcome(StrictModel):
    closed_at: str
    direction: Literal["LONG", "SHORT"]
    realized_net: Annotated[str, Field(pattern=r"^-?(0|[1-9][0-9]*)(\.[0-9]{1,10})?$")]
    strategy_version: Annotated[str, Field(min_length=1, max_length=128)]


class ExecutionContext(StrictModel):
    spread_price: Price
    modeled_round_trip_cost_price: Price
    cost_basis: Literal["CONSERVATIVE_MIN_VOLUME_RESERVE_EXCLUDES_SPREAD"]
    shared_setup_risk_percent: Literal["1"]
    recent_closed_outcomes: Annotated[list[ClosedOutcome], Field(max_length=8)]


class PayloadV13(PayloadV12):
    execution_context: ExecutionContext

    @model_validator(mode="after")
    def outcomes(self) -> PayloadV13:
        at = timestamp(self.captured_at)
        previous = at
        for outcome in self.execution_context.recent_closed_outcomes:
            closed = timestamp(outcome.closed_at)
            if closed > previous or at - closed > timedelta(days=1):
                raise ValueError("CODEX_OUTCOME_PROVENANCE_INVALID")
            previous = closed
        if Decimal(self.execution_context.spread_price) != Decimal(self.quote.ask) - Decimal(
            self.quote.bid
        ):
            raise ValueError("CODEX_SPREAD_CONTEXT_MISMATCH")
        return self


class RequestV13(RequestV12):
    version: Literal["codex-entry-request-1.3"]  # type: ignore[assignment]
    promptVersion: Literal["entry-pair-v7"]  # type: ignore[assignment]
    payload: PayloadV13


class RequestV14(RequestV13):
    version: Literal["codex-entry-request-1.4"]  # type: ignore[assignment]
    promptVersion: Literal["entry-pair-v8"]  # type: ignore[assignment]


class RequestV15(RequestV14):
    version: Literal["codex-entry-request-1.5"]  # type: ignore[assignment]
    promptVersion: Literal["entry-direction-v1"]  # type: ignore[assignment]


class RequestV16(RequestV15):
    version: Literal["codex-entry-request-1.6"]  # type: ignore[assignment]
    promptVersion: Literal["entry-modes-v1"]  # type: ignore[assignment]


class ExecutionContextV17(ExecutionContext):
    shared_setup_risk_percent: Literal["5"]  # type: ignore[assignment]


class PayloadV17(PayloadV13):
    execution_context: ExecutionContextV17


class RequestV17(RequestV16):
    version: Literal["codex-entry-request-1.7"]  # type: ignore[assignment]
    promptVersion: Literal["entry-quick-oco-v1"]  # type: ignore[assignment]
    payload: PayloadV17


def parse_request(
    raw: bytes,
) -> Request | RequestV12 | RequestV13 | RequestV14 | RequestV15 | RequestV16 | RequestV17:
    value = json.loads(raw)
    if isinstance(value, dict) and value.get("version") == "codex-entry-request-1.7":
        return RequestV17.model_validate_json(raw)
    if isinstance(value, dict) and value.get("version") == "codex-entry-request-1.6":
        return RequestV16.model_validate_json(raw)
    if isinstance(value, dict) and value.get("version") == "codex-entry-request-1.5":
        return RequestV15.model_validate_json(raw)
    if isinstance(value, dict) and value.get("version") == "codex-entry-request-1.4":
        return RequestV14.model_validate_json(raw)
    if isinstance(value, dict) and value.get("version") == "codex-entry-request-1.3":
        return RequestV13.model_validate_json(raw)
    if isinstance(value, dict) and value.get("version") == "codex-entry-request-1.2":
        return RequestV12.model_validate_json(raw)
    return Request.model_validate_json(raw)


class Entries(StrictModel):
    buy_stop: Price
    sell_stop: Price

    @model_validator(mode="after")
    def positive(self) -> Entries:
        if min(Decimal(self.buy_stop), Decimal(self.sell_stop)) <= 0:
            raise ValueError("CODEX_ENTRY_INVALID")
        return self


class Response(StrictModel):
    version: Literal["codex-entry-response-1.0"]
    analysisId: str
    requestedModel: Literal["gpt-6.1-sol"]
    returnedModel: None
    promptSha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    capturedAt: str
    receivedAt: str
    entries: Entries
    rawResponse: Annotated[str, Field(max_length=8192)]
    inputTokens: None
    outputTokens: None
    costAmount: None
    executionAuthority: Literal[False]


class Decision(StrictModel):
    decision: Literal["OCO", "WAIT"]
    reason: Annotated[str, Field(min_length=1, max_length=1200)]
    buy_stop: Price | None
    sell_stop: Price | None

    @model_validator(mode="after")
    def consistent(self) -> Decision:
        if self.decision == "WAIT":
            if self.buy_stop is not None or self.sell_stop is not None:
                raise ValueError("CODEX_WAIT_HAS_ENTRIES")
        elif (
            self.buy_stop is None
            or self.sell_stop is None
            or min(Decimal(self.buy_stop), Decimal(self.sell_stop)) <= 0
        ):
            raise ValueError("CODEX_OCO_ENTRIES_REQUIRED")
        return self


class MemoryReceipt(StrictModel):
    day: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    threadId: Annotated[str, Field(min_length=1, max_length=128)]
    turnId: Annotated[str, Field(min_length=1, max_length=128)]
    compacted: bool


class DirectionalDecision(StrictModel):
    decision: Literal["BUY", "SELL", "WAIT"]
    reason: Annotated[str, Field(min_length=1, max_length=1200)]
    upper_breakout: Price | None
    lower_breakout: Price | None

    @model_validator(mode="after")
    def consistent(self) -> DirectionalDecision:
        if self.decision == "WAIT":
            if self.upper_breakout is not None or self.lower_breakout is not None:
                raise ValueError("CODEX_DIRECTION_INVALID")
        elif (
            self.upper_breakout is None
            or self.lower_breakout is None
            or not Decimal(self.upper_breakout) > Decimal(self.lower_breakout) > 0
        ):
            raise ValueError("CODEX_DIRECTION_INVALID")
        return self


class ResponseV11(Response):
    version: Literal["codex-entry-response-1.1"]  # type: ignore[assignment]
    entries: Decision  # type: ignore[assignment]
    memory: MemoryReceipt


class ResponseV12(ResponseV11):
    version: Literal["codex-entry-response-1.2"]  # type: ignore[assignment]
    entries: DirectionalDecision  # type: ignore[assignment]


def invoke(prompt: str, job: Path) -> bytes:
    if os.geteuid() == 0 or not job.resolve().is_relative_to(Path.home().resolve()):
        raise ValueError("CODEX_DEDICATED_USER_REQUIRED")
    publish(job / "schema.json", Entries.model_json_schema())
    output = job / "output.json"
    command = [
        "codex",
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--model",
        MODEL,
        "--output-schema",
        str(job / "schema.json"),
        "--output-last-message",
        str(output),
        "-c",
        'approval_policy="never"',
        "-c",
        'web_search="disabled"',
        "-c",
        'model_reasoning_effort="low"',
        "-",
    ]
    env = {"HOME": str(Path.home()), "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}
    process = subprocess.Popen(
        command,
        cwd=job,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        process.communicate(prompt.encode(), timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise ValueError("CODEX_TIMEOUT_UNKNOWN") from None
    if process.returncode != 0:
        raise ValueError("CODEX_FAILED_UNKNOWN")
    return read_bounded(output)


def run(
    request: Request | RequestV12 | RequestV13 | RequestV14 | RequestV15 | RequestV16 | RequestV17,
    root: Path,
    system_prompt: str,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    call: Callable[[str, Path], bytes] = invoke,
) -> dict[str, Any]:
    """Never retry a claimed ID, including failed or unknown dispatch after restart."""
    started = now()
    captured = timestamp(request.payload.captured_at)
    if (
        started.tzinfo is None
        or started.utcoffset() != timedelta(0)
        or not timedelta(0) <= started - captured <= timedelta(seconds=30)
    ):
        raise ValueError("CODEX_INPUT_STALE")
    if hashlib.sha256(system_prompt.encode()).hexdigest() != request.promptSha256:
        raise ValueError("CODEX_PROMPT_MISMATCH")
    for at in [request.payload.quote.sourceTime, request.payload.quote.receivedAt]:
        if not timedelta(0) <= started - timestamp(at) <= timedelta(seconds=30):
            raise ValueError("CODEX_QUOTE_STALE")
    raw = encoded(request.model_dump())
    if len(raw) > MAX_BYTES:
        raise ValueError("CODEX_INPUT_OVERSIZED")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (root / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        job = root / request.analysisId
        if job.exists():
            raise ValueError("CODEX_ALREADY_CLAIMED")
        job.mkdir(mode=0o700)
        prompt = (
            system_prompt
            + "\nDo not use tools, execute commands or read files. "
            + (
                "Return BUY, SELL or WAIT only."
                if isinstance(request, RequestV15)
                else "Return OCO or WAIT only."
                if isinstance(request, RequestV13)
                else "Propose prices only."
            )
            + "\nINPUT:\n"
            + json.dumps(request.payload.model_dump(), separators=(",", ":"))
        )
        publish(job / "request.json", request.model_dump())
        publish(job / "prompt.json", {"text": prompt})
        publish(
            job / "claim.json",
            {
                "at": started.isoformat(),
                "input_sha256": hashlib.sha256(raw).hexdigest(),
                "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "requested_model": MODEL,
            },
        )
        # Persist both directory entries before a potentially billable dispatch.
        for directory in (root, root.parent):
            descriptor = os.open(directory, os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        try:
            if isinstance(request, RequestV13) and call is invoke:
                from python.codex_entry.memory import invoke_daily

                result = invoke_daily(
                    prompt,
                    job,
                    schema=(
                        DirectionalDecision if isinstance(request, RequestV15) else Decision
                    ).model_json_schema(),
                    model=MODEL,
                )
            else:
                result = call(prompt, job)
            if len(result) > 8192:
                raise ValueError("CODEX_OUTPUT_OVERSIZED")
            # Preserve available response text even when validation fails.
            publish(job / "response-text.json", {"text": result.decode("utf-8")})
            entries = (
                DirectionalDecision
                if isinstance(request, RequestV15)
                else Decision
                if isinstance(request, RequestV13)
                else Entries
            ).model_validate_json(result)
            ended = now()
            if ended < started or ended - started > timedelta(seconds=TIMEOUT):
                raise ValueError("CODEX_RESULT_STALE")
            response = {
                "version": "codex-entry-response-1.0",
                "analysisId": request.analysisId,
                "requestedModel": MODEL,
                "returnedModel": None,
                "promptSha256": request.promptSha256,
                "capturedAt": request.payload.captured_at,
                "receivedAt": ended.isoformat(),
                "entries": entries.model_dump(),
                "rawResponse": result.decode("utf-8"),
                "inputTokens": None,
                "outputTokens": None,
                "costAmount": None,
                "executionAuthority": False,
            }
            if isinstance(request, RequestV13):
                response["version"] = (
                    "codex-entry-response-1.2"
                    if isinstance(request, RequestV15)
                    else "codex-entry-response-1.1"
                )
                response["memory"] = json.loads(read_bounded(job / "memory-result.json"))
                response = (
                    (ResponseV12 if isinstance(request, RequestV15) else ResponseV11)
                    .model_validate(response)
                    .model_dump()
                )
            else:
                response = Response.model_validate(response).model_dump()
            publish(job / "result.json", response)
            return response
        except Exception:
            publish(job / "failure.json", {"status": "FAILED_OR_UNKNOWN", "retryAllowed": False})
            raise ValueError("CODEX_FAILED_OR_UNKNOWN") from None
