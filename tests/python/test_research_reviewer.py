from __future__ import annotations

import copy
from types import SimpleNamespace

import pytest

from python.operations import research_reviewer as reviewer
from python.research.learning_evidence import encoded
from python.research.observation_cycle import sha
from tests.python import test_holding_publication as fixtures
from tests.python.test_source_review import answer


@pytest.fixture
def context(tmp_path, monkeypatch):
    payload = reviewer.publisher.HoldingPublication.model_validate(fixtures.publication())
    digest, head = "d" * 64, "c" * 40
    pr = {
        "number": 42,
        "draft": True,
        "state": "open",
        "merged": False,
        "mergeable": True,
        "mergeable_state": "clean",
        "node_id": "node42",
        "user": {"login": reviewer.publisher.PUBLISHER_LOGIN},
        "head": {
            "sha": head,
            "ref": "research/" + digest,
            "repo": {"full_name": reviewer.publisher.REPOSITORY},
        },
        "base": {
            "sha": payload.baseCommit,
            "ref": "main",
            "repo": {"full_name": reviewer.publisher.REPOSITORY},
        },
    }
    ctx = SimpleNamespace(
        payload=payload,
        digest=digest,
        head=head,
        pr=pr,
        reviews=[],
        calls=[],
        models=[],
        main=payload.baseCommit,
        ci="success",
        config={"signers": "/not-used"},
        root=tmp_path,
    )
    monkeypatch.setattr(reviewer.publisher, "authenticate", lambda *_: (payload, digest))
    monkeypatch.setattr(reviewer.publisher, "expected_commit", lambda *_: head)
    monkeypatch.setattr(reviewer, "rules", lambda _: None)

    def api(path):
        if path == "pulls/42":
            return copy.deepcopy(ctx.pr)
        if path == "git/ref/heads/main":
            return {"object": {"sha": ctx.main}}
        if path == "pulls/42/reviews?per_page=100":
            return copy.deepcopy(ctx.reviews)
        if path == f"commits/{head}/check-runs?per_page=100":
            return {
                "total_count": 1,
                "check_runs": [
                    {
                        "name": "qualify-exact-head",
                        "head_sha": head,
                        "app": {"id": 15368},
                        "status": "completed",
                        "conclusion": ctx.ci,
                    }
                ],
            }
        pytest.fail("unexpected endpoint " + path)

    monkeypatch.setattr(reviewer.publisher, "api", api)

    def command(args, **kwargs):
        assert args[:3] == ["gh", "api", "graphql"]
        ctx.calls.append("ready")
        ctx.pr["draft"] = False
        return b'{"data":{"markPullRequestReadyForReview":{"pullRequest":{"isDraft":false}}}}'

    monkeypatch.setattr(reviewer.publisher, "command", command)

    def mutation(path, method, payload):
        ctx.calls.append(method)
        if method == "POST":
            assert payload["commit_id"] == head and "Automated" in payload["body"]
            ctx.reviews.append(
                {
                    "id": 1,
                    "user": {"login": reviewer.REVIEWER},
                    "commit_id": head,
                    "state": "APPROVED",
                    "submitted_at": "2000-01-01T00:00:00Z",
                }
            )
            return {"state": "APPROVED"}
        assert method == "PUT" and payload == {"sha": head, "merge_method": "merge"}
        ctx.pr.update(merged=True, state="closed")
        return {"merged": True, "sha": "e" * 40}

    ctx.mutation = mutation
    monkeypatch.setattr(reviewer, "mutation", mutation)

    def model(value):
        ctx.models.append(value.axis)
        return {
            "status": "REVIEWED",
            "job": sha(encoded(value.model_dump())),
            "review": answer(value),
        }

    monkeypatch.setattr(reviewer, "model_review", model)
    return ctx


def process(ctx):
    return reviewer.process(42, b"signed-fixture", ctx.config, ctx.root)


def test_ready_approve_merge_and_duplicate_reconciliation(context):
    ctx = context
    assert process(ctx)["status"] == "READY_PENDING_RECHECK"
    assert process(ctx)["status"] == "APPROVED_PENDING_RECHECK"
    assert process(ctx)["status"] == "MERGE_PENDING_RECHECK"
    assert process(ctx)["status"] == "MERGED"
    assert process(ctx)["status"] == "MERGED"
    assert ctx.calls == ["ready", "POST", "PUT"] and ctx.models == ["standards", "spec"]


def test_ci_and_stale_head_block_before_model_or_actions(context):
    ctx = context
    ctx.ci = "failure"
    assert process(ctx)["status"] == "BLOCKED"
    ctx.ci = "success"
    ctx.main = "f" * 40
    with pytest.raises(ValueError, match="MAIN_DRIFT"):
        process(ctx)
    ctx.main = ctx.payload.baseCommit
    ctx.pr["head"]["sha"] = "f" * 40
    with pytest.raises(ValueError, match="REMOTE_AMBIGUOUS"):
        process(ctx)
    assert not ctx.models and not ctx.calls


def test_model_rejection_retained_without_repeat_or_approval(context, monkeypatch):
    ctx = context

    def model(value):
        ctx.models.append(value.axis)
        return {
            "status": "REVIEWED",
            "job": sha(encoded(value.model_dump())),
            "review": answer(value, decision="REQUEST_CHANGES", findings=["Concrete mismatch"]),
        }

    monkeypatch.setattr(reviewer, "model_review", model)
    assert process(ctx)["status"] == "MODEL_REQUEST_CHANGES"
    assert process(ctx)["status"] == "MODEL_REQUEST_CHANGES"
    assert ctx.models == ["standards"] and not ctx.calls


def test_model_unknown_claim_only_queries_saved_result(context, monkeypatch):
    ctx = context
    monkeypatch.setattr(reviewer, "model_review", lambda _: (_ for _ in ()).throw(TimeoutError()))
    with pytest.raises(TimeoutError):
        process(ctx)
    monkeypatch.setattr(reviewer, "model_review", lambda _: pytest.fail("model replay"))
    monkeypatch.setattr(
        reviewer,
        "saved_model",
        lambda v: {"status": "OUTCOME_UNKNOWN", "job": sha(encoded(v.model_dump()))},
    )
    assert process(ctx)["status"] == "OUTCOME_UNKNOWN" and not ctx.calls


def test_dismissal_pending_review_and_changes_requested_block(context):
    ctx = context
    for state in ("DISMISSED", "PENDING", "CHANGES_REQUESTED"):
        ctx.reviews[:] = [
            {
                "id": 1,
                "user": {"login": reviewer.REVIEWER},
                "commit_id": ctx.head,
                "state": state,
                "submitted_at": "2000-01-01T00:00:00Z",
            }
        ]
        assert process(ctx)["status"] == "BLOCKED"
    assert not ctx.models and not ctx.calls


def test_head_change_during_model_review_prevents_approval(context, monkeypatch):
    ctx = context

    def model(value):
        if value.axis == "spec":
            ctx.pr["head"]["sha"] = "f" * 40
        return {
            "status": "REVIEWED",
            "job": sha(encoded(value.model_dump())),
            "review": answer(value),
        }

    monkeypatch.setattr(reviewer, "model_review", model)
    with pytest.raises(ValueError, match="REMOTE_AMBIGUOUS"):
        process(ctx)
    assert not ctx.calls


def test_lost_approval_reply_reconciles_existing_review_without_posting_again(context, monkeypatch):
    ctx = context
    ctx.pr["draft"] = False

    def mutation(path, method, payload):
        result = ctx.mutation(path, method, payload)
        if method == "POST":
            raise TimeoutError
        return result

    monkeypatch.setattr(reviewer, "mutation", mutation)
    with pytest.raises(TimeoutError):
        process(ctx)
    assert process(ctx)["status"] == "MERGE_PENDING_RECHECK"
    assert process(ctx)["status"] == "MERGED"
    assert ctx.calls == ["POST", "PUT"] and len(ctx.models) == 2


def test_unreceived_approval_and_merge_never_blindly_replayed(context, monkeypatch):
    ctx = context
    ctx.pr["draft"] = False
    calls = []

    def lost(*_):
        calls.append(1)
        raise TimeoutError

    monkeypatch.setattr(reviewer, "mutation", lost)
    with pytest.raises(TimeoutError):
        process(ctx)
    assert process(ctx)["status"] == "APPROVAL_OUTCOME_UNKNOWN"
    assert len(calls) == 1
    ctx.reviews[:] = [
        {
            "id": 1,
            "user": {"login": reviewer.REVIEWER},
            "commit_id": ctx.head,
            "state": "APPROVED",
            "submitted_at": "2000-01-01T00:00:00Z",
        }
    ]
    with pytest.raises(TimeoutError):
        process(ctx)
    assert process(ctx)["status"] == "MERGE_OUTCOME_UNKNOWN" and len(calls) == 2


def test_late_source_gate_changes_before_merge(context, monkeypatch):
    ctx = context
    ctx.pr["draft"] = False
    ctx.reviews[:] = [
        {
            "id": 1,
            "user": {"login": reviewer.REVIEWER},
            "commit_id": ctx.head,
            "state": "APPROVED",
            "submitted_at": "2000-01-01T00:00:00Z",
        }
    ]
    real = reviewer.guard
    calls = []

    def guard(*args):
        calls.append(1)
        if len(calls) == 3:
            ctx.ci = "failure"
        return real(*args)

    monkeypatch.setattr(reviewer, "guard", guard)
    assert process(ctx)["status"] == "LATE_GATE_CHANGED"
    assert not ctx.calls


def test_closed_publication_reopening_does_not_restore_authority(context):
    ctx = context
    assert process(ctx)["status"] == "READY_PENDING_RECHECK"
    (ctx.root / ctx.digest / "terminal.json").write_bytes(
        encoded({"pullRequest": 42, "status": "CLOSED"})
    )
    assert process(ctx)["reason"] == "REVIEW_TERMINAL_HISTORY_CHANGED"
    assert ctx.calls == ["ready"]


def test_late_mergeability_boolean_must_still_be_verified(context, monkeypatch):
    ctx = context
    ctx.pr["draft"] = False
    ctx.reviews[:] = [
        {
            "id": 1,
            "user": {"login": reviewer.REVIEWER},
            "commit_id": ctx.head,
            "state": "APPROVED",
            "submitted_at": "2000-01-01T00:00:00Z",
        }
    ]
    original = reviewer.guard
    checks = []

    def guard(*args):
        checks.append(1)
        if len(checks) == 3:
            ctx.pr["mergeable"] = None
        return original(*args)

    monkeypatch.setattr(reviewer, "guard", guard)
    assert process(ctx)["status"] == "LATE_GATE_CHANGED"
    assert not ctx.calls
