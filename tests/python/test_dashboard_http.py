from datetime import UTC, datetime

from fastapi.testclient import TestClient

from apps.dashboard import app as dashboard
from apps.dashboard.background import PollResult


def test_desk_routes_are_read_only_bounded_and_do_not_expose_raw_snapshots(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    snapshot = {
        "captured_at": datetime.now(UTC),
        "status": {"mode": "demo", "startupChecksPassed": True},
        "private": "fixture-private-value",
    }
    monkeypatch.setattr(
        dashboard.BackgroundReader, "poll", lambda self: PollResult(snapshot, "ready", 1)
    )
    with TestClient(dashboard.app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert 'id="desk"' in response.text and "streamlit" not in response.text.lower()
        assert response.headers["cache-control"] == "no-store"
        for name in dashboard.ASSET_TYPES:
            assert client.get("/assets/" + name).status_code == 200
        for path in ["/assets/position_monitor.py", "/assets/.env", "/docs", "/openapi.json"]:
            assert client.get(path).status_code == 404
        payload = client.get("/api/desk")
        assert payload.json()["available"] is True
        assert "fixture-private-value" not in payload.text
        assert payload.headers["cache-control"] == "no-store"
        assert client.post("/api/desk").status_code == 405
        assert client.post("/v1/controls/emergency-stop").status_code == 404
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/_stcore/health").status_code == 200


def test_unavailable_poll_withholds_money_and_provider_outage_is_explicit(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    snapshot = {
        "captured_at": datetime.now(UTC),
        "status": {
            "mode": "demo",
            "startupChecksPassed": True,
            "automaticAnalysisEnabled": True,
            "scenarioContext": {"state": "FAILED", "reason": "AI_PROVIDER_TIMEOUT"},
            "lastCycle": {"outcome": "DEFERRED", "reasonCodes": ["SCENARIO_REFRESH_STARTED"]},
        },
    }
    result = [PollResult(snapshot, "ready", 1)]
    monkeypatch.setattr(dashboard.BackgroundReader, "poll", lambda self: result[0])
    with TestClient(dashboard.app) as client:
        payload = client.get("/api/desk").json()
        assert payload["title"] == "Entries blocked · model unavailable"
        assert "Latest execution check: DEFERRED" in payload["detail"]
        result[0] = PollResult(None, "unavailable", 2)
        payload = client.get("/api/desk").json()
        assert payload["available"] is False
        assert all(v["text"] == "Unavailable" for v in payload["values"].values())


def test_multiple_browser_reads_share_one_background_load_and_shutdown_closes_reader(
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    from threading import Event

    started, release = Event(), Event()
    calls = []

    def load():  # type: ignore[no-untyped-def]
        calls.append(1)
        started.set()
        assert release.wait(5)
        return {"captured_at": datetime.now(UTC), "status": {"mode": "demo"}}

    monkeypatch.setattr(dashboard, "load_snapshot", load)
    try:
        with TestClient(dashboard.app) as client:
            assert started.wait(1)
            for _ in range(20):
                assert client.get("/api/desk").json()["available"] is False
            assert len(calls) == 1
            reader = dashboard.app.state.reader
            release.set()
    finally:
        release.set()
    assert reader.poll().state == "unavailable"


def test_mode_proxy_requires_same_origin_and_explicit_operator_token(monkeypatch):  # type: ignore[no-untyped-def]
    import httpx

    calls = []

    def post(url, **kwargs):  # type: ignore[no-untyped-def]
        calls.append((url, kwargs))
        return httpx.Response(
            200, json={"accepted": True, "entryMode": {"mode": "OCO_LIMIT", "revision": "a" * 36}}
        )

    monkeypatch.setattr(dashboard.httpx, "post", post)
    monkeypatch.setattr(dashboard.BackgroundReader, "poll", lambda self: PollResult({}, "ready", 1))
    body = {"mode": "OCO_LIMIT", "expectedRevision": "a" * 36}
    with TestClient(dashboard.app) as client:
        assert client.post("/api/entry-mode", json=body).status_code == 403
        assert (
            client.post(
                "/api/entry-mode", json=body, headers={"origin": "http://testserver"}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/entry-mode",
                json=body,
                headers={"origin": "http://attacker", "x-control-token": "x" * 32},
            ).status_code
            == 403
        )
        headers = {"origin": "http://testserver", "x-control-token": "x" * 32}
        result = client.post("/api/entry-mode", json=body, headers=headers)
        assert result.status_code == 200 and "x" * 32 not in result.text
        assert calls[0][0] == "http://127.0.0.1:8080/v1/controls/entry-mode"
        assert calls[0][1]["headers"]["x-control-token"] == "x" * 32
        assert (
            client.post(
                "/api/entry-mode", json={**body, "mode": "ANY"}, headers=headers
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/entry-mode", json={**body, "url": "http://attacker"}, headers=headers
            ).status_code
            == 422
        )
