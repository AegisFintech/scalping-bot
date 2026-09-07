"""Bounded read-only polling. Workers never call Streamlit or mutate broker state."""

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Literal


@dataclass(frozen=True)
class PollResult[T]:
    value: T | None
    state: Literal["loading", "ready", "unavailable"]
    revision: int


class BackgroundReader[T]:
    """One request at a time; preserve fresh data during a slow refresh, never stale data."""

    def __init__(
        self,
        load: Callable[[], T],
        *,
        interval: float = 10,
        maximum_age: float = 30,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._load = load
        self._interval = interval
        self._maximum_age = maximum_age
        self._clock = clock
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dashboard-read")
        self._lock = Lock()
        self._future: Future[T] | None = None
        self._value: T | None = None
        self._started = 0.0
        self._observed = 0.0
        self._next = 0.0
        self._revision = 0
        self._failed = False
        self._closed = False

    def poll(self) -> PollResult[T]:
        with self._lock:
            now = self._clock()
            if self._closed:
                return PollResult(None, "unavailable", self._revision)
            if self._future is not None and self._future.done():
                try:
                    self._value = self._future.result()
                    # Age starts before IO, not when the browser next collects it.
                    self._observed = self._started
                    self._failed = False
                except Exception:
                    # No transport exception text, URL or credentials reach the UI.
                    self._value = None
                    self._failed = True
                self._future = None
                self._revision += 1
            if self._future is None and now >= self._next:
                self._started = now
                self._future = self._executor.submit(self._load)
                self._next = now + self._interval
            if self._value is not None and 0 <= now - self._observed <= self._maximum_age:
                return PollResult(self._value, "ready", self._revision)
            state: Literal["unavailable", "loading"] = (
                "unavailable" if self._failed or self._revision else "loading"
            )
            return PollResult(None, state, self._revision)

    def close(self) -> None:
        with self._lock:
            self._closed = True
        self._executor.shutdown(wait=False, cancel_futures=True)
