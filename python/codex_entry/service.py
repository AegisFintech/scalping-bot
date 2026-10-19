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
    rows: Annotated[list[list[Any]], Field(min_length=1, max_length=120)]

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
            if len(row) != 9 or row[7] is not True or row[8] != []:
                raise ValueError("CODEX_COMPLETED_CANDLES_REQUIRED")
            start, end = timestamp(row[0]), timestamp(row[1])
            seconds = {"M1": 60, "M5": 300, "M15": 900}[self.timeframe]
            if (end - start).total_seconds() != seconds or (
                previous is not None and start != previous
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
            if len(series.rows) > {"M1": 120, "M5": 72, "M15": 48}[series.timeframe]:
                raise ValueError("CODEX_CANDLE_LIMIT")
        return self


class Request(StrictModel):
    version: Literal["codex-entry-request-1.0"]
    analysisId: str
    symbol: Literal["XAUUSD"]
    promptVersion: Literal["entry-pair-v4"]
    promptSha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    payload: Payload

    @model_validator(mode="after")
    def identifier(self) -> Request:
        if str(UUID(self.analysisId)) != self.analysisId:
            raise ValueError("CODEX_ANALYSIS_ID_INVALID")
        return self


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
    request: Request,
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
            + "\nDo not use tools, execute commands or read files. Propose prices only.\nINPUT:\n"
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
            result = call(prompt, job)
            if len(result) > 8192:
                raise ValueError("CODEX_OUTPUT_OVERSIZED")
            # Preserve available response text even when validation fails.
            publish(job / "response-text.json", {"text": result.decode("utf-8")})
            entries = Entries.model_validate_json(result)
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
            response = Response.model_validate(response).model_dump()
            publish(job / "result.json", response)
            return response
        except Exception:
            publish(job / "failure.json", {"status": "FAILED_OR_UNKNOWN", "retryAllowed": False})
            raise ValueError("CODEX_FAILED_OR_UNKNOWN") from None
