"""Loopback HTTP boundary. Deploy only as a credential-isolated non-root service."""

from __future__ import annotations

import hmac
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException
from fastapi import Request as HttpRequest
from starlette.concurrency import run_in_threadpool

from python.codex_entry.service import (
    MAX_BYTES,
    Response,
    ResponseV11,
    ResponseV12,
    parse_request,
    run,
)


def create_app(
    root: Path, prompt: str, token: str, *, prompt_version: str = "entry-pair-v4"
) -> FastAPI:
    if len(token) < 32:
        raise ValueError("CODEX_LOCAL_AUTH_REQUIRED")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "alive"}

    @app.post("/v1/entry-proposals", response_model=Response | ResponseV11 | ResponseV12)
    async def propose(
        request: HttpRequest, authorization: Annotated[str | None, Header()] = None
    ) -> dict[str, object]:
        if authorization is None or not hmac.compare_digest(
            authorization.encode(), ("Bearer " + token).encode()
        ):
            raise HTTPException(status_code=401, detail="CODEX_UNAUTHORIZED")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise HTTPException(status_code=413, detail="CODEX_INPUT_OVERSIZED")
        try:
            validated = parse_request(bytes(body))
            if validated.promptVersion != prompt_version:
                raise ValueError("CODEX_PROMPT_VERSION_MISMATCH")
        except Exception:
            raise HTTPException(status_code=422, detail="CODEX_REQUEST_INVALID") from None
        try:
            return await run_in_threadpool(run, validated, root, prompt)
        except Exception:
            # Do not disclose model output, paths, credentials or raw CLI errors.
            raise HTTPException(status_code=503, detail="CODEX_UNAVAILABLE_OR_UNKNOWN") from None

    return app


def main() -> None:
    import uvicorn

    if os.geteuid() == 0:
        raise ValueError("CODEX_DEDICATED_USER_REQUIRED")
    root = Path.home() / "entry-jobs"
    prompt = Path(os.environ["CODEX_ENTRY_PROMPT_FILE"]).read_text().strip()
    expected = Path(os.environ["CODEX_ENTRY_PROMPT_FILE"]).stem
    if expected not in {
        "entry-pair-v4",
        "entry-pair-v5",
        "entry-pair-v6",
        "entry-pair-v7",
        "entry-pair-v8",
        "entry-direction-v1",
        "entry-modes-v1",
        "entry-quick-oco-v1",
        "entry-quick-oco-v2",
    }:
        raise ValueError("CODEX_PROMPT_VERSION_INVALID")
    app = create_app(root, prompt, os.environ["CODEX_ENTRY_LOCAL_TOKEN"], prompt_version=expected)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8084,
        access_log=False,
        workers=1,
        limit_concurrency=4,
        timeout_keep_alive=5,
    )


if __name__ == "__main__":
    main()
