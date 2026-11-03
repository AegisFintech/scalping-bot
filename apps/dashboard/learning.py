"""Learning controls behind Cloudflare Access; browser reads never run inference."""

from __future__ import annotations

import json
import resource
import subprocess
import tempfile
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from apps.dashboard.learning_progress import progress
from python.learning.budget import Policy
from python.operations.breakout_observer import read_status
from python.operations.demo_scorecards import load as load_scorecard
from python.operations.demo_trial_witness import read_status as read_trial_witness
from python.research.demo_trial_status import TrialStatus

ASSETS = Path(__file__).with_name("assets")
SSH = Path("/etc/scalper-learning-ui/ssh.conf")
router = APIRouter()
HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; "
    "style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
}


def remote(value: dict[str, Any]) -> dict[str, Any]:
    raw = json.dumps(value, ensure_ascii=False).encode()
    if len(raw) > 8192:
        raise ValueError("LEARNING_CONTROL_OVERSIZED")

    def limit() -> None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (65537, 65537))

    with tempfile.TemporaryFile() as output:
        subprocess.run(
            ["ssh", "-F", str(SSH), "learning-control"],
            input=raw,
            stdout=output,
            stderr=subprocess.DEVNULL,
            timeout=8,
            check=True,
            preexec_fn=limit,
            env={"HOME": "/root", "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
        )
        output.seek(0)
        data = output.read(65537)
    if len(data) > 65536:
        raise ValueError("LEARNING_STATUS_OVERSIZED")
    return dict(json.loads(data))


def load() -> dict[str, Any]:
    try:
        result = remote({"action": "status"})
    except (OSError, ValueError, subprocess.SubprocessError):
        result = {"available": False, "reason": "LEARNING_UNAVAILABLE"}
    try:
        token_path = Path("/etc/scalper-learning-ui/provider-control-token")
        token = secret(token_path).decode()
        req = urllib.request.Request(
            "http://127.0.0.1:8084/v1/provider-status", headers={"Authorization": "Bearer " + token}
        )
        with urllib.request.urlopen(req, timeout=3) as reply:
            raw = reply.read(65537)
        if len(raw) > 65536:
            raise ValueError("PROVIDER_STATUS_OVERSIZED")
        result["trade"] = json.loads(raw)
    except (OSError, ValueError):
        result["trade"] = None
    try:
        with urllib.request.urlopen("http://127.0.0.1:8080/v1/demo-trials", timeout=3) as reply:
            raw = reply.read(131073)
        if len(raw) > 131072:
            raise ValueError("DEMO_TRIAL_STATUS_OVERSIZED")
        result["demoTrials"] = TrialStatus.model_validate_json(raw).model_dump(
            mode="json", by_alias=True
        )
    except (OSError, ValueError):
        result["demoTrials"] = None
    result["pipeline"] = progress(datetime.now(UTC))
    result["dayScorecard"] = load_scorecard(datetime.now(UTC))
    result["naturalTrialEvidence"] = read_trial_witness(datetime.now(UTC))
    result["registeredStudy"] = read_status(
        Path("/etc/scalper-breakout507-v2/registration.json"),
        Path("/var/lib/scalper-breakout507-v2"),
        Path("/opt/scalper-breakout507-v2"),
        datetime.now(UTC),
    )
    return result


def secret(path: Path) -> bytes:
    if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise ValueError("LEARNING_AUTH_INVALID")
    value = path.read_bytes().strip()
    if len(value) < 32:
        raise ValueError("LEARNING_AUTH_INVALID")
    return value


def write_origin(request: Request) -> None:
    host = request.headers.get("host", "")
    if (
        request.headers.get("origin") not in {"http://" + host, "https://" + host}
        or request.headers.get("x-learning-control") != "1"
    ):
        raise HTTPException(403, "LEARNING_ORIGIN_REQUIRED")


async def body(request: Request) -> dict[str, Any]:
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 8192:
            raise HTTPException(413, "LEARNING_INPUT_OVERSIZED")
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except ValueError:
        raise HTTPException(422, "LEARNING_INPUT_INVALID") from None


@router.get("/learning")
@router.get("/learning/")
def page() -> FileResponse:
    return FileResponse(ASSETS / "learning.html", headers=HEADERS)


@router.get("/learning/assets/{name}")
def asset(name: str) -> FileResponse:
    if name not in {"learning.css", "learning.mjs"}:
        raise HTTPException(404)
    return FileResponse(
        ASSETS / name,
        media_type="text/css" if name.endswith(".css") else "text/javascript",
        headers=HEADERS,
    )


@router.get("/api/learning")
def current(request: Request) -> JSONResponse:
    result = request.app.state.learning_reader.poll()
    return JSONResponse(
        {"readState": result.state, "data": result.value if result.state == "ready" else None},
        headers=HEADERS,
    )


@router.post("/api/learning/control")
async def control(request: Request) -> JSONResponse:
    write_origin(request)
    value = await body(request)
    try:
        policy = Policy.model_validate(value)
        if "sk-" in policy.guidance or "PRIVATE KEY" in policy.guidance:
            raise ValueError()
        result = remote({"action": "update", "policy": policy.model_dump()})
    except (ValueError, OSError, subprocess.SubprocessError):
        raise HTTPException(503, "LEARNING_CONTROL_UNAVAILABLE") from None
    return JSONResponse(result, headers=HEADERS)


@router.post("/api/learning/trading-control")
async def trading_control(request: Request) -> JSONResponse:
    write_origin(request)
    value = await body(request)
    if (
        set(value) != {"paused", "dailyLimitMicroUsd"}
        or type(value["paused"]) is not bool
        or type(value["dailyLimitMicroUsd"]) is not int
    ):
        raise HTTPException(422, "PROVIDER_CONTROL_INVALID")
    try:
        token = secret(Path("/etc/scalper-learning-ui/provider-control-token")).decode()
        req = urllib.request.Request(
            "http://127.0.0.1:8084/v1/provider-control",
            data=json.dumps(value).encode(),
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as reply:
            raw = reply.read(65537)
        if len(raw) > 65536:
            raise ValueError()
        return JSONResponse(json.loads(raw), headers=HEADERS)
    except (OSError, ValueError):
        raise HTTPException(503, "PROVIDER_CONTROL_UNAVAILABLE") from None
