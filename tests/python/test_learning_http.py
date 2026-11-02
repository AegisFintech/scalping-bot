from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.dashboard import learning
from apps.dashboard.background import PollResult


def client(tmp_path, monkeypatch):
    app = FastAPI()
    app.include_router(learning.router)

    class Reader:
        def poll(self):
            return PollResult({"policy": {"paused": False}}, "ready", 1)

    app.state.learning_reader = Reader()
    return TestClient(app)


def test_access_protected_learning_has_no_local_login_and_keeps_csrf_and_bounded_reads(
    tmp_path, monkeypatch
):
    web = client(tmp_path, monkeypatch)
    monkeypatch.setattr(
        learning,
        "remote",
        lambda _: (_ for _ in ()).throw(AssertionError("read requested a mutation")),
    )
    assert web.get("/learning").status_code == 200
    assert web.get("/learning/assets/learning.mjs").status_code == 200
    assert web.get("/learning/assets/.env").status_code == 404
    assert web.get("/api/learning").status_code == 200
    assert 'id="login"' not in web.get("/learning").text
    assert web.post("/api/learning/login", json={"token": "unused"}).status_code == 404
    assert web.post("/api/learning/control", json={}).status_code == 403
    assert web.post("/api/learning/trading-control", json={}).status_code == 403
    assert (
        web.post(
            "/api/learning/control",
            json={},
            headers={"origin": "https://evil.invalid", "x-learning-control": "1"},
        ).status_code
        == 403
    )


def test_access_protected_direction_is_typed_and_audited_at_receiver(tmp_path, monkeypatch):
    web = client(tmp_path, monkeypatch)
    headers = {"origin": "http://testserver", "x-learning-control": "1"}
    calls = []
    monkeypatch.setattr(learning, "remote", lambda v: calls.append(v) or {"saved": True})
    policy = {
        "paused": True,
        "dailyLimit": 100000,
        "focus": "costs",
        "guidance": "Review commission drag",
    }
    assert web.post("/api/learning/control", json=policy, headers=headers).status_code == 200
    assert calls == [{"action": "update", "policy": policy}]
    assert (
        web.post(
            "/api/learning/control", json={**policy, "execute": "trade"}, headers=headers
        ).status_code
        == 503
    )
    assert (
        web.post("/api/learning/control", content=b"x" * 8193, headers=headers).status_code == 413
    )
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("owner", "mode", "symlink", "valid"),
    [
        (0, 0o100600, False, True),
        (1000, 0o100600, False, False),
        (0, 0o100644, False, False),
        (0, 0o100600, True, False),
    ],
)
def test_provider_control_secret_requires_root_private_regular_path(owner, mode, symlink, valid):
    path = Mock()
    path.is_symlink.return_value = symlink
    path.stat.return_value = SimpleNamespace(st_uid=owner, st_mode=mode)
    path.read_bytes.return_value = b"fixture-credential-" + b"x" * 32
    if valid:
        assert learning.secret(path) == path.read_bytes.return_value
    else:
        with pytest.raises(ValueError, match="AUTH_INVALID"):
            learning.secret(path)
