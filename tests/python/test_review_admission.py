from __future__ import annotations

import copy

import pytest

from python.operations import publisher_service as service

HEAD = "a" * 40


def run(**patch):
    return {
        "name": "qualify-exact-head",
        "head_sha": HEAD,
        "app": {"id": 15368},
        "status": "completed",
        "conclusion": "success",
        **patch,
    }


def review(state="APPROVED", **patch):
    return {
        "id": 1,
        "user": {"login": "aloycwl"},
        "commit_id": HEAD,
        "state": state,
        "submitted_at": "2000-01-01T00:00:00Z",
        **patch,
    }


def observe(monkeypatch, runs, reviews=(), count=None):
    def api(path):
        if path == f"commits/{HEAD}/check-runs?per_page=100":
            return {"total_count": len(runs) if count is None else count, "check_runs": runs}
        assert path == "pulls/42/reviews?per_page=100"
        return list(reviews)

    monkeypatch.setattr(service.publisher, "api", api)
    return service.review_status(42, HEAD)


@pytest.mark.parametrize("runs", [[], [run(status="in_progress", conclusion=None)]])
def test_missing_or_running_checks_wait(monkeypatch, runs):
    assert observe(monkeypatch, runs)["reason"] == "PUBLICATION_CI_PENDING"


def test_failure_outranks_another_pending_check(monkeypatch):
    result = observe(
        monkeypatch, [run(conclusion="failure"), run(status="queued", conclusion=None)]
    )
    assert result["status"] == "BLOCKED" and result["reason"] == "PUBLICATION_CI_FAILED"


@pytest.mark.parametrize(
    "patch", [{"head_sha": "b" * 40}, {"app": {"id": 9}}, {"status": "unknown"}]
)
def test_wrong_source_and_unknown_state_reject(monkeypatch, patch):
    with pytest.raises(ValueError):
        observe(monkeypatch, [run(**patch)])


def test_truncated_checks_or_reviews_reject(monkeypatch):
    with pytest.raises(ValueError, match="CHECKS_INCOMPLETE"):
        observe(monkeypatch, [run()], count=101)
    with pytest.raises(ValueError, match="REVIEWS_INCOMPLETE"):
        observe(monkeypatch, [run()], [review()] * 100)


def test_only_separate_reviewer_on_exact_head_counts(monkeypatch):
    wrong = [review(user={"login": "AegisWalletApp"}), review(commit_id="b" * 40)]
    assert (
        observe(monkeypatch, [run()], wrong)["reason"] == "PUBLICATION_INDEPENDENT_REVIEW_REQUIRED"
    )
    assert (
        observe(monkeypatch, [run()], [review()])["reason"]
        == "PUBLICATION_INDEPENDENT_REVIEW_APPROVED"
    )


@pytest.mark.parametrize(
    "state,reason",
    [
        ("CHANGES_REQUESTED", "PUBLICATION_CHANGES_REQUESTED"),
        ("DISMISSED", "PUBLICATION_INDEPENDENT_REVIEW_REQUIRED"),
    ],
)
def test_later_binding_review_overrides_approval(monkeypatch, state, reason):
    assert (
        observe(
            monkeypatch,
            [run()],
            [review(state, id=2, submitted_at="2000-01-01T00:00:01Z"), review()],
        )["reason"]
        == reason
    )


def test_comment_does_not_revoke_but_conflicting_ids_reject(monkeypatch):
    assert (
        observe(monkeypatch, [run()], [review(), review("COMMENTED", id=2)])["reason"]
        == "PUBLICATION_INDEPENDENT_REVIEW_APPROVED"
    )
    with pytest.raises(ValueError, match="ID_CONFLICT"):
        observe(monkeypatch, [run()], [review(), review("DISMISSED")])
    bad = copy.deepcopy(review())
    bad["state"] = "UNRECOGNIZED"
    with pytest.raises(ValueError, match="STATE_UNKNOWN"):
        observe(monkeypatch, [run()], [bad])


def test_submission_time_not_id_orders_binding_decisions(monkeypatch):
    older = review(id=99)
    later = review("CHANGES_REQUESTED", id=1, submitted_at="2000-01-01T00:00:01Z")
    assert (
        observe(monkeypatch, [run()], [later, older])["reason"] == "PUBLICATION_CHANGES_REQUESTED"
    )


def test_equal_time_conflict_and_invalid_submission_times_reject(monkeypatch):
    with pytest.raises(ValueError, match="ORDER_AMBIGUOUS"):
        observe(monkeypatch, [run()], [review(), review("CHANGES_REQUESTED", id=2)])
    for stamp in [None, "unknown", "2000-01-01T00:00:00", "9999-01-01T00:00:00Z"]:
        with pytest.raises(ValueError, match="TIME_INVALID"):
            observe(monkeypatch, [run()], [review(submitted_at=stamp)])
