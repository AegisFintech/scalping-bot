from threading import Event
from time import monotonic, sleep

from apps.dashboard.background import BackgroundReader, PollResult


def settled(reader: BackgroundReader[dict[str, int]], revision: int) -> PollResult[dict[str, int]]:
    deadline = monotonic() + 2
    while monotonic() < deadline:
        result = reader.poll()
        if result.revision >= revision:
            return result
        sleep(0.001)
    raise AssertionError("background read did not settle")


def test_slow_read_does_not_block_rendering_or_create_duplicate_reads() -> None:
    started, release = Event(), Event()
    calls = []

    def load() -> dict[str, int]:
        calls.append(1)
        started.set()
        assert release.wait(2)
        return {"equity": 100}

    reader = BackgroundReader(load)
    try:
        assert reader.poll().state == "loading"
        assert started.wait(1)
        before = monotonic()
        for _ in range(100):
            assert reader.poll().state == "loading"
        assert monotonic() - before < 0.1
        assert len(calls) == 1
        release.set()
        assert settled(reader, 1).value == {"equity": 100}
    finally:
        release.set()
        reader.close()


def test_failed_refresh_discards_data_and_recovers_without_leaking_exception() -> None:
    clock = [0.0]
    calls = []

    def load() -> dict[str, int]:
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("fixture-private-connection-string")
        return {"equity": len(calls)}

    reader = BackgroundReader(load, clock=lambda: clock[0])
    try:
        assert settled(reader, 1).value == {"equity": 1}
        clock[0] = 11
        failed = settled(reader, 2)
        assert failed.state == "unavailable" and failed.value is None
        assert "private" not in repr(failed)
        clock[0] = 22
        assert settled(reader, 3).value == {"equity": 3}
    finally:
        reader.close()
    assert reader.poll().state == "unavailable"


def test_stale_value_is_withheld_while_next_read_remains_blocked() -> None:
    clock = [0.0]
    release = Event()
    calls = []

    def load() -> dict[str, int]:
        calls.append(1)
        if len(calls) > 1:
            assert release.wait(2)
        return {"equity": 100}

    reader = BackgroundReader(load, clock=lambda: clock[0])
    try:
        assert settled(reader, 1).state == "ready"
        clock[0] = 11
        assert reader.poll().value == {"equity": 100}
        clock[0] = 31
        stale = reader.poll()
        assert stale.state == "unavailable" and stale.value is None
    finally:
        release.set()
        reader.close()


def test_late_completion_does_not_make_old_observation_fresh() -> None:
    clock = [0.0]
    release = Event()

    def load() -> dict[str, int]:
        assert release.wait(2)
        return {"equity": 100}

    reader = BackgroundReader(load, clock=lambda: clock[0])
    try:
        reader.poll()
        clock[0] = 31
        release.set()
        result = settled(reader, 1)
        assert result.value is None and result.state == "unavailable"
    finally:
        release.set()
        reader.close()
