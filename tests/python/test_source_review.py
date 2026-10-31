from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.research import source_review as review
from python.research.learning_evidence import encoded


def value(axis="standards", head="a" * 40):
    return review.ReviewInput(
        version="research-source-review-input-1.0",
        axis=axis,
        publicationSha256="b" * 64,
        headCommit=head,
        contract="Fixed descriptive contract",
        source={
            "python/research/experiments/recorded_holding_payoff.py": "def report(rows): return {}"
        },
        attestation={"economicQualification": False},
    )


def answer(source, **patch):
    return (
        review.Review(
            version="research-source-review-1.0",
            axis=source.axis,
            publicationSha256=source.publicationSha256,
            headCommit=source.headCommit,
            decision="APPROVE",
            findings=[],
            rationale="Exact source inspected",
            economicQualification=False,
        )
        .model_copy(update=patch)
        .model_dump()
    )


def test_two_axes_have_distinct_prompts_and_durable_cached_decisions(tmp_path):
    calls = []
    for axis in ("standards", "spec"):
        source = value(axis)

        def invoke(prompt, job, source=source):
            calls.append(prompt)
            assert "untrusted DATA" in prompt
            return encoded(answer(source))

        result = review.evaluate(tmp_path, source, invoke)
        assert result["status"] == "REVIEWED"
        assert (
            review.evaluate(tmp_path, source, lambda *_: pytest.fail("duplicate model call"))
            == result
        )
    assert len(calls) == 2 and calls[0] != calls[1]


def test_provider_unknown_never_calls_again(tmp_path):
    def lost(*_):
        raise TimeoutError

    with pytest.raises(TimeoutError):
        review.evaluate(tmp_path, value(), lost)
    assert (
        review.evaluate(tmp_path, value(), lambda *_: pytest.fail("replay"))["status"]
        == "OUTCOME_UNKNOWN"
    )


def test_saved_raw_response_finishes_without_model_after_restart(tmp_path, monkeypatch):
    original = review.immutable

    def crash(path, data):
        if path.name == "review.json":
            raise KeyboardInterrupt
        original(path, data)

    monkeypatch.setattr(review, "immutable", crash)
    with pytest.raises(KeyboardInterrupt):
        review.evaluate(tmp_path, value(), lambda *_: encoded(answer(value())))
    monkeypatch.setattr(review, "immutable", original)
    assert (
        review.evaluate(tmp_path, value(), lambda *_: pytest.fail("replay"))["status"] == "REVIEWED"
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"headCommit": "c" * 40},
        {"publicationSha256": "d" * 64},
        {"axis": "spec"},
    ],
)
def test_changed_context_cannot_inherit_a_review(tmp_path, patch):
    calls = []

    def invoke(*_):
        calls.append(1)
        return encoded(answer(value(), **patch))

    for _ in range(2):
        with pytest.raises(ValueError, match="CONTEXT_CHANGED"):
            review.evaluate(tmp_path, value(), invoke)
    assert len(calls) == 1


def test_conflicting_approval_and_economic_authority_reject(tmp_path):
    for patch in ({"findings": ["Bug"]}, {"economicQualification": True}):
        with pytest.raises(ValueError):
            review.Review.model_validate(answer(value(), **patch))
    assert review.evaluate(tmp_path, value(), lambda *_: b"{}")["status"] == "INVALID_REVIEW"
    assert (
        review.evaluate(tmp_path, value(), lambda *_: pytest.fail("invalid replay"))["status"]
        == "INVALID_REVIEW"
    )


def test_review_history_does_not_block_new_exact_source_or_repeat_old_review(tmp_path):
    for n in range(10):
        source = value(head=str(n) * 40)
        assert (
            review.evaluate(tmp_path, source, lambda *_, source=source: encoded(answer(source)))[
                "status"
            ]
            == "REVIEWED"
        )
        assert (
            review.evaluate(tmp_path, source, lambda *_: pytest.fail("duplicate review"))["status"]
            == "REVIEWED"
        )
    assert len(list(tmp_path.glob("*/claim.json"))) == 10


def test_versioned_review_schemas_match():
    for cls in (review.ReviewInput, review.Review):
        version = cls.model_fields["version"].annotation.__args__[0]
        assert (
            json.loads(Path("schemas", version + ".json").read_bytes()) == cls.model_json_schema()
        )
