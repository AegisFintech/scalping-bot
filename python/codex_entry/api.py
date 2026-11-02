"""Loopback HTTP boundary. Deploy only as a credential-isolated non-root service."""

from __future__ import annotations

import hmac
import json
import os
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException
from fastapi import Request as HttpRequest
from starlette.concurrency import run_in_threadpool

from python.codex_entry.service import (
    MAX_BYTES,
    SUPPORTED_PROMPTS,
    Response,
    ResponseV11,
    ResponseV12,
    ResponseV13,
    ResponseV14,
    ResponseV15,
    parse_request,
    run,
)


def create_app(
    root: Path, prompt: str, token: str, *, prompt_version: str = "entry-pair-v4"
) -> FastAPI:
    if len(token) < 32:
        raise ValueError("CODEX_LOCAL_AUTH_REQUIRED")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/v1/provider-status")
    def provider_status(authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
        from python.codex_entry import openai_api

        try:
            control = openai_api.credential("provider-control-token")
        except (OSError, KeyError, ValueError):
            raise HTTPException(503, "PROVIDER_STATUS_UNAVAILABLE") from None
        if authorization is None or not hmac.compare_digest(
            authorization.encode(), ("Bearer " + control).encode()
        ):
            raise HTTPException(401, "PROVIDER_STATUS_UNAUTHORIZED")
        if not openai_api.CONFIG.exists():
            return {
                "provider": "subscription",
                "model": "gpt-6.1-sol",
                "budget": None,
                "activation": "API_PENDING_ACTIVATION",
                "creditBalance": None,
            }
        try:
            return {
                "provider": "openai-api",
                "model": "gpt-6.1-sol",
                "budget": openai_api.budget().snapshot(),
                "activation": "CONFIGURED",
                "creditBalance": None,
                "unit": "micro_usd_estimate",
                "configuredCeilingMicroUsd": openai_api.settings()["dailyLimitMicroUsd"],
                "subscriptionFallback": openai_api.settings().get("subscriptionFallback", False),
                "creditFallbackActive": (
                    openai_api.budget().snapshot()["policy"]["paused"]
                    and (openai_api.budget().path.parent / "credit-exhausted.json").exists()
                ),
            }
        except Exception:
            raise HTTPException(503, "PROVIDER_STATUS_UNAVAILABLE") from None

    @app.post("/v1/provider-control")
    async def provider_control(
        request: HttpRequest, authorization: Annotated[str | None, Header()] = None
    ) -> dict[str, object]:
        from python.codex_entry import openai_api
        from python.learning.budget import Policy

        try:
            control = openai_api.credential("provider-control-token")
        except (OSError, KeyError, ValueError):
            raise HTTPException(503, "PROVIDER_CONTROL_UNAVAILABLE") from None
        if authorization is None or not hmac.compare_digest(
            authorization.encode(), ("Bearer " + control).encode()
        ):
            raise HTTPException(401, "PROVIDER_CONTROL_UNAUTHORIZED")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 1024:
                raise HTTPException(413, "PROVIDER_CONTROL_OVERSIZED")
        try:
            value = json.loads(raw)
            if (
                set(value) != {"paused", "dailyLimitMicroUsd"}
                or type(value["paused"]) is not bool
                or type(value["dailyLimitMicroUsd"]) is not int
            ):
                raise ValueError()
            config = openai_api.settings()
            if not 1 <= value["dailyLimitMicroUsd"] <= config["dailyLimitMicroUsd"]:
                raise ValueError()
            local = openai_api.budget()
            policy = Policy.model_validate(local.snapshot()["policy"])
            local.update(
                policy.model_copy(
                    update={"paused": value["paused"], "dailyLimit": value["dailyLimitMicroUsd"]}
                )
            )
            marker = local.path.parent / "credit-exhausted.json"
            if marker.exists():
                import time

                marker.rename(
                    marker.with_name("credit-exhausted-resolved-" + str(time.time_ns()) + ".json")
                )
            return {
                "budget": local.snapshot(),
                "configuredCeilingMicroUsd": config["dailyLimitMicroUsd"],
            }
        except (ValueError, TypeError, KeyError):
            raise HTTPException(422, "PROVIDER_CONTROL_INVALID") from None

    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "alive"}

    @app.post(
        "/v1/entry-proposals",
        response_model=Response
        | ResponseV11
        | ResponseV12
        | ResponseV13
        | ResponseV14
        | ResponseV15,
    )
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
    from python.codex_entry import openai_api

    if openai_api.CONFIG.exists():
        openai_api.settings()
        openai_api.credential("openai-api-key")
        openai_api.credential("provider-control-token")
    root = Path.home() / "entry-jobs"
    prompt = Path(os.environ["CODEX_ENTRY_PROMPT_FILE"]).read_text().strip()
    expected = Path(os.environ["CODEX_ENTRY_PROMPT_FILE"]).stem
    if expected not in SUPPORTED_PROMPTS:
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
