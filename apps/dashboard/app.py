"""Read-only landscape trading desk."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

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


@app.get("/health")
@app.get("/_stcore/health", include_in_schema=False)
def health() -> dict[str, str]:
    # The compatibility route preserves existing supervisor/proxy health probes.
    # Process health is separate from the desk's evidence availability.
    return {"status": "ok"}
