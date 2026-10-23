"""Landscape desk with explicit authenticated operator mode controls."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from apps.dashboard.background import BackgroundReader
from apps.dashboard.landscape_model import landscape_model
from apps.dashboard.snapshot import load_snapshot

ASSETS = Path(__file__).with_name("assets")
NO_CACHE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
ASSET_TYPES = {
    "landscape.css": "text/css",
    "landscape.mjs": "text/javascript",
    "desk.mjs": "text/javascript",
}


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    # All clients share one bounded single-flight reader. Browser requests never
    # start a provider call or broker command, nor multiply database polling.
    reader = BackgroundReader(load_snapshot, interval=2)
    application.state.reader = reader
    reader.poll()
    try:
        yield
    finally:
        reader.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    shell = (ASSETS / "landscape.html").read_text()
    return HTMLResponse(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="dark"><title>Scalper / Trading desk</title>'
        '<link rel="stylesheet" href="./assets/landscape.css">'
        '<script type="module" src="./assets/desk.mjs"></script>'
        "</head><body>" + shell + "</body></html>",
        headers=NO_CACHE,
    )


@app.get("/assets/{name}")
def asset(name: str) -> FileResponse:
    if name not in ASSET_TYPES:
        raise HTTPException(status_code=404)
    return FileResponse(ASSETS / name, media_type=ASSET_TYPES[name], headers=NO_CACHE)


@app.get("/api/desk")
def desk(request: Request) -> JSONResponse:
    result = request.app.state.reader.poll()
    return JSONResponse(
        landscape_model(result.value or {}, result.state, datetime.now(UTC)), headers=NO_CACHE
    )


class EntryModeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["OCO_STOP_LIMIT", "OCO_LIMIT", "SINGLE_STOP_LIMIT", "SINGLE_LIMIT"]
    expectedRevision: str = Field(pattern=r"^[0-9a-f-]{36}$")


@app.post("/api/entry-mode")
def select_entry_mode(body: EntryModeRequest, request: Request) -> JSONResponse:
    # Browser supplies the existing operator token in memory. Never embed or read
    # the server's credential on behalf of an unauthenticated dashboard viewer.
    origin = request.headers.get("origin", "")
    token = request.headers.get("x-control-token", "")
    if not origin or urlsplit(origin).netloc != request.headers.get("host"):
        raise HTTPException(status_code=403, detail="SAME_ORIGIN_REQUIRED")
    if not 24 <= len(token) <= 512:
        raise HTTPException(status_code=401, detail="OPERATOR_TOKEN_REQUIRED")
    try:
        response = httpx.post(
            "http://127.0.0.1:8080/v1/controls/entry-mode",
            json={
                **body.model_dump(),
                "actor": "dashboard-operator",
                "reason": "Operator selected next-setup entry profile",
            },
            headers={"x-control-token": token},
            timeout=5,
            trust_env=False,
        )
        if response.status_code not in {200, 400, 401, 409}:
            raise HTTPException(status_code=503, detail="ENTRY_MODE_UNAVAILABLE")
        result = response.json()
        if response.status_code == 200:
            return JSONResponse(
                {"accepted": True, "entryMode": result["entryMode"]}, headers=NO_CACHE
            )
        return JSONResponse(
            {"error": "ENTRY_MODE_REFRESH_OR_UNLOCK_REQUIRED"},
            status_code=response.status_code,
            headers=NO_CACHE,
        )
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(status_code=503, detail="ENTRY_MODE_UNAVAILABLE") from None


@app.get("/health")
@app.get("/_stcore/health", include_in_schema=False)
def health() -> dict[str, str]:
    # The compatibility route preserves existing supervisor/proxy health probes.
    # Process health is separate from the desk's evidence availability.
    return {"status": "ok"}
