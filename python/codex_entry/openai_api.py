"""Stateless, budgeted OpenAI proposals; never broker execution authority."""

from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.learning.budget import Budget, Policy
from python.research.codex_loop import publish
from python.research.isolated_worker import trusted_path
from python.research.learning_archive import atomic_bytes

CONFIG = Path("/etc/scalper-codex-entry/provider.json")
MODEL = "gpt-6.1-sol"
MAX_OUTPUT = 4096


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self, req: Any, fp: Any, code: Any, msg: Any, headers: Any, newurl: Any
    ) -> None:
        return None


def settings() -> dict[str, Any]:
    trusted_path(CONFIG)
    value = json.loads(CONFIG.read_bytes())
    if (
        value.get("provider") != "openai-api"
        or value.get("model") != MODEL
        or type(value.get("dailyLimitMicroUsd")) is not int
        or not 1 <= value["dailyLimitMicroUsd"] <= 1_000_000_000
        or type(value.get("subscriptionFallback", False)) is not bool
    ):
        raise ValueError("OPENAI_API_POLICY_INVALID")
    return dict(value)


def budget() -> Budget:
    value = settings()
    return Budget(Path.home() / "api-budget", default_limit=value["dailyLimitMicroUsd"])


def credential(name: str) -> str:
    path = Path(os.environ["CREDENTIALS_DIRECTORY"]) / name
    value = path.read_text().strip()
    if not value or any(c.isspace() for c in value):
        raise ValueError("OPENAI_API_CREDENTIAL_INVALID")
    return value


def reserve(job: Path, prompt: str) -> str | None:
    # UTF-8 byte bound plus schema/protocol allowance; output has a provider-enforced cap.
    estimate = ((len(prompt.encode()) + 16384) * 25 + MAX_OUTPUT * 100 + 9) // 10
    config = settings()
    local = budget()
    if (
        config.get("subscriptionFallback")
        and local.snapshot()["policy"]["paused"]
        and (local.path.parent / "credit-exhausted.json").exists()
    ):
        return "API_CREDIT_EXHAUSTED"
    result = local.reserve(
        job.name,
        estimate,
        "trading-api",
        ceiling=settings()["dailyLimitMicroUsd"],
        binding=hashlib.sha256(prompt.encode()).hexdigest(),
    )
    if result["status"] != "ADMITTED":
        publish(
            job / "not-dispatched.json", {"reason": result["status"], "providerDispatched": False}
        )
        if config.get("subscriptionFallback") and result["status"] == "WAITING_LEARNING_BUDGET":
            return "API_DAILY_LIMIT"
        raise ValueError("OPENAI_API_BUDGET_WAIT")
    return None


def invoke(prompt: str, job: Path, schema: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    if (job / "provider-dispatch.json").exists():
        raise ValueError("OPENAI_API_ALREADY_CLAIMED")
    key = credential("openai-api-key")
    body = {
        "model": MODEL,
        "reasoning": {"effort": "low"},
        "store": False,
        "service_tier": "default",
        "max_output_tokens": MAX_OUTPUT,
        "input": [{"role": "user", "content": prompt}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "scalp_decision",
                "strict": True,
                "schema": schema,
            }
        },
    }
    publish(job / "api-request.json", body)
    local = budget()
    local.dispatch(job.name)
    publish(
        job / "provider-dispatch.json",
        {"provider": "openai-api", "model": MODEL, "retryAllowed": False},
    )
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=85) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("OPENAI_API_RESPONSE_OVERSIZED")
        value = json.loads(raw)
        publish(job / "api-response.json", value)
        returned = value.get("model", "")
        if (
            not isinstance(returned, str)
            or not returned == MODEL
            or value.get("status") != "completed"
        ):
            raise ValueError("OPENAI_API_RESPONSE_INVALID")
        text = []
        for item in value.get("output", []):
            if item.get("type") == "reasoning":
                continue
            if item.get("type") != "message" or item.get("role") != "assistant":
                raise ValueError("OPENAI_API_OUTPUT_INVALID")
            for part in item.get("content", []):
                if part.get("type") != "output_text" or not isinstance(part.get("text"), str):
                    raise ValueError("OPENAI_API_OUTPUT_INVALID")
                text.append(part["text"])
        if len(text) != 1 or len(text[0].encode()) > 8192:
            raise ValueError("OPENAI_API_OUTPUT_INVALID")
        usage = value.get("usage", {})
        inp = usage.get("input_tokens")
        out = usage.get("output_tokens")
        details = usage.get("input_tokens_details") or {}
        cached = details.get("cached_tokens", 0)
        if any(type(v) is not int or v < 0 for v in [inp, out, cached]) or cached > inp:
            raise ValueError("OPENAI_API_USAGE_INVALID")
        request_id = value.get("id")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise ValueError("OPENAI_API_RESPONSE_INVALID")
        # Published standard rates; an estimate, never a statement of actual billing.
        estimate = ((inp - cached) * 25 + cached + out * 100 + 9) // 10
        local.settle(job.name, estimate)
        return text[0].encode(), {
            "returnedModel": returned,
            "inputTokens": inp,
            "outputTokens": out,
            "providerRequestId": request_id,
        }
    except urllib.error.HTTPError as error:
        credit_exhausted = False
        # Only explicit provider financial rejection may select subscription on
        # a FUTURE normally gated request. Rate limiting/timeout never does.
        if error.code in {402, 429}:
            try:
                data = error.read(8193)
                if len(data) <= 8192:
                    code = json.loads(data).get("error", {}).get("code")
                    credit_exhausted = code in {"insufficient_quota", "billing_hard_limit_reached"}
            except (OSError, ValueError, TypeError, AttributeError):
                pass
        if credit_exhausted:
            rejection = {"reason": "API_CREDIT_EXHAUSTED", "at": datetime.now(UTC).isoformat()}
            publish(job / "api-financial-rejection.json", rejection)
            atomic_bytes(
                local.path.parent / "credit-exhausted.json",
                json.dumps(rejection).encode(),
                replace=True,
            )
        if error.code in {401, 402, 403} or credit_exhausted:
            policy = Policy.model_validate(local.snapshot()["policy"])
            local.update(policy.model_copy(update={"paused": True}))
        local.settle(job.name, None)
        raise ValueError("OPENAI_API_UNAVAILABLE_OR_UNKNOWN") from None
    except Exception:
        local.settle(job.name, None)
        raise ValueError("OPENAI_API_UNAVAILABLE_OR_UNKNOWN") from None
