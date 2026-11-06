"""Characterize the frozen worker boundary; no provider or trading authority."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from python.codex_entry import api, service
from python.codex_entry.service import timestamp
from tests.python.test_codex_entry import NOW, PROMPT
from tests.python.test_trend_protocol import call, trend_request


def history_request(case: str) -> dict[str, Any]:
    raw = trend_request().model_dump()
    for frame in raw["payload"]["candles"]:
        period = {"M1": 60, "M5": 300, "M15": 900}[frame["timeframe"]]
        template = frame["rows"][-1]
        frame["rows"] = [
            [
                (NOW - timedelta(seconds=period * (12 - i))).isoformat(),
                (NOW - timedelta(seconds=period * (11 - i))).isoformat(),
                *template[2:8],
                [],
            ]
            for i in range(12)
        ]
    frame = raw["payload"]["candles"][-1]
    rows = frame["rows"]
    if case == "short":
        frame["rows"] = rows[-5:]
    elif case == "session_gap":
        for row in rows[:6]:
            # Preserve the latest completed end and the independently captured clocks.
            row[0] = (timestamp(row[0]) - timedelta(minutes=15)).isoformat()
            row[1] = (timestamp(row[1]) - timedelta(minutes=15)).isoformat()
        rows[6][8] = ["BROKER_SESSION_GAP_BEFORE"]
    elif case == "malformed":
        rows[-1][8] = ["UNRECOGNIZED_FLAG"]
    elif case == "stale":
        # Market/history timestamps remain unchanged; the worker sees an old capture.
        pass
    elif case == "unknown_history":
        raw["payload"]["technical_context"]["history_targets_met"] = False
    elif case != "contiguous":
        raise AssertionError(case)
    return raw


@pytest.mark.parametrize(
    "case,status,dispatches",
    [
        ("contiguous", 200, 1),
        ("short", 200, 1),
        ("session_gap", 200, 1),
        ("malformed", 422, 0),
        ("stale", 503, 0),
        ("unknown_history", 422, 0),
    ],
)
def test_frozen_http_history_admission(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: str, status: int, dispatches: int
) -> None:
    raw = history_request(case)
    observed: list[str] = []

    def provider(text: str, job: Path) -> bytes:
        observed.append(text)
        return call(text, job)

    def worker(request: Any, root: Path, prompt: str, **kwargs: Any) -> dict[str, Any]:
        return service.run(
            request,
            root,
            prompt,
            now=lambda: NOW + timedelta(seconds=31 if case == "stale" else 0),
            call=provider,
            **kwargs,
        )

    monkeypatch.setattr(api, "run", worker)
    client = TestClient(
        api.create_app(
            tmp_path,
            PROMPT,
            "x" * 64,
            prompt_version="entry-scalp-v4",
            trial_source_sha256="b" * 64,
        ),
        raise_server_exceptions=False,
    )
    response = client.post(
        "/v1/entry-proposals",
        json=raw,
        headers={"authorization": "Bearer " + "x" * 64},
    )
    assert response.status_code == status, response.text
    assert len(observed) == dispatches
    job = tmp_path / raw["analysisId"]
    assert (job / "claim.json").exists() is bool(dispatches)
    if dispatches:
        saved = json.loads((job / "request.json").read_text())
        assert saved["payload"] == raw["payload"]
        assert response.json()["executionAuthority"] is False
        # A successful receipt is not permission to replay a durable claim.
        repeated = client.post(
            "/v1/entry-proposals",
            json=raw,
            headers={"authorization": "Bearer " + "x" * 64},
        )
        assert repeated.status_code == 503
        assert len(observed) == 1
    else:
        assert not job.exists()
