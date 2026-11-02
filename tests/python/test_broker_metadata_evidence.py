import json
from datetime import timedelta

import pytest

from python.research import broker_metadata_evidence as m
from tests.python.test_setup_flight import NOW, metadata


def test_metadata_is_allowlisted_clocked_and_never_actual_cost_or_original_ack(tmp_path):
    data = metadata()
    data.update(accountId="private", token="secret", extra={"credentials": "private"})
    value = m.observation(data, "XAUUSD", NOW, NOW + timedelta(seconds=1))
    assert value.terms["pipSize"] == "0.01" and value.terms["commissionRate"] == "30"
    assert value.brokerSourceTime is None and value.actualClosingCosts is None
    assert not any(
        x in value.model_dump_json() for x in ("private", "secret", "accountId", "token")
    )
    assert m.persist(tmp_path, value) > 0 and m.persist(tmp_path, value) == 0
    assert (
        json.loads((tmp_path / m.filename(value)).read_text())["evidenceSha256"]
        == value.evidenceSha256
    )


def test_bad_terms_are_explicit_unknowns_and_clock_or_hash_corruption_rejects():
    data = metadata()
    data["pipSize"] = "NaN"
    value = m.observation(data, "XAUUSD", NOW, NOW)
    assert value.terms["pipSize"] is None and "pipSize" in value.unavailableFields
    with pytest.raises(ValueError):
        m.observation(data, "XAUUSD", NOW, NOW - timedelta(seconds=1))
    with pytest.raises(ValueError):
        m.MetadataObservation.model_validate(value.model_dump() | {"symbol": "DIFFERENT"})
