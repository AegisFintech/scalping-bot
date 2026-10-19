"""Loopback HTTP boundary. Deploy only as a credential-isolated non-root service."""

from __future__ import annotations

import hmac
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException
from fastapi import Request as HttpRequest
from starlette.concurrency import run_in_threadpool

from python.codex_entry.service import MAX_BYTES, Request, Response, run


def create_app(root: Path, prompt: str, token: str) -> FastAPI:
    if len(token) < 32:
        raise ValueError("CODEX_LOCAL_AUTH_REQUIRED")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "alive"}

    @app.post("/v1/entry-proposals", response_model=Response)
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
            validated = Request.model_validate_json(bytes(body))
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
    app = create_app(root, prompt, os.environ["CODEX_ENTRY_LOCAL_TOKEN"])
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
