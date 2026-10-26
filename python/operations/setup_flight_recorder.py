"""Read-only setup flight recorder. No provider, broker command or promotion authority."""

from __future__ import annotations

import argparse
import copy
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import time
from collections import deque
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.rows import dict_row

TERMINAL = {"CLOSED", "FAILED", "EXPIRED"}
MAX_BYTES = 512 * 1024**2
MIN_FREE = 2 * 1024**3


def timestamp(value: object) -> datetime:
    result = (
        value
        if isinstance(value, datetime)
        else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    )
    if result.tzinfo is None:
        raise ValueError("FLIGHT_TIME_INVALID")
    return result.astimezone(UTC)


def number(value: object) -> Decimal:
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError("FLIGHT_NUMBER_INVALID")
    return result


def plain(value: Decimal) -> str:
    return format(value, "f")


def encoded(value: object) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        default=lambda v: v.isoformat() if isinstance(v, datetime) else str(v),
        allow_nan=False,
    ).encode()


def atomic(path: Path, value: object) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("wb") as handle:
        os.chmod(temp, 0o600)
        handle.write(encoded(value))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def load_setup(
    connection: psycopg.Connection[dict[str, Any]],
    account_key_hash: str,
    symbol: str,
    setup_key: str | None = None,
) -> dict[str, Any] | None:
    """Consistent database snapshot; locally persisted submission is NOT broker acceptance."""
    if not re.fullmatch(r"[a-f0-9]{64}", account_key_hash):
        raise ValueError("FLIGHT_ACCOUNT_SCOPE_INVALID")
    if setup_key is not None and not re.fullmatch(r"[a-f0-9]{24}", setup_key):
        raise ValueError("FLIGHT_SETUP_SCOPE_INVALID")
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        row = connection.execute(
            """SELECT g.id,g.state,g.created_at,g.updated_at,g.execution_mode,
            sv.version origin_release,ac.currency account_currency
            FROM order_groups g JOIN analysis_runs a ON a.id=g.analysis_id
            JOIN accounts ac ON ac.id=a.account_id JOIN symbols sy ON sy.id=a.symbol_id
            JOIN strategy_versions sv ON sv.id=a.strategy_version_id
            WHERE ac.provider_account_key_hash=%s AND ac.environment='demo'
              AND sy.name=%s AND g.mode='demo' AND a.mode='demo'
              AND (%s::text IS NULL OR
                   substr(encode(sha256(convert_to(g.id::text,'UTF8')),'hex'),1,24)=%s)
            ORDER BY (g.state NOT IN ('CLOSED','FAILED','EXPIRED')) DESC,
            g.created_at DESC LIMIT 1""",
            (account_key_hash, symbol, setup_key, setup_key),
        ).fetchone()
        if row is None:
            return None
        key = row["id"]
        orders = connection.execute(
            """SELECT o.side,o.state,o.entry_price::text,o.stop_loss::text,o.take_profit::text,
            o.normalized_volume::text approved_volume,o.filled_volume::text,o.execution_order_type,
            o.time_in_force,o.submitted_at placement_result_recorded_at,o.updated_at,
            f.volume::text fill_volume,f.price::text fill_price,f.first_fill,f.last_fill,
            f.commission::text entry_journal_commission
            FROM orders o LEFT JOIN LATERAL
              (SELECT sum(volume) volume,sum(price*volume)/NULLIF(sum(volume),0) price,
               sum(commission) commission,
               min(occurred_at) first_fill,max(occurred_at) last_fill FROM fills
               WHERE order_id=o.id) f ON true
            WHERE o.order_group_id=%s AND o.strategy_owned ORDER BY o.side""",
            (key,),
        ).fetchall()
        protection = connection.execute(
            """SELECT p.side,p.state,p.volume::text,p.entry_price::text,p.updated_at,
            pp.stop_loss::text broker_sl,pp.take_profit::text broker_tp,pp.status protection_status,
            pp.observed_at FROM positions p LEFT JOIN position_protection pp ON pp.position_id=p.id
            WHERE p.order_group_id=%s AND p.strategy_owned ORDER BY p.side,p.opened_at""",
            (key,),
        ).fetchall()
        events = connection.execute(
            """SELECT execution_type,mapping_state,occurred_at,received_at,payload_hash
            FROM broker_execution_events WHERE order_group_id=%s
            ORDER BY received_at DESC,id DESC LIMIT 500""",
            (key,),
        ).fetchall()
        trades = connection.execute(
            """SELECT direction,realized_pnl::text net,fees::text signed_fees,opened_at,closed_at
            FROM trades WHERE order_group_id=%s ORDER BY closed_at""",
            (key,),
        ).fetchall()
        return {
            "setup": hashlib.sha256(str(key).encode()).hexdigest()[:24],
            "state": row["state"],
            "createdAt": row["created_at"].isoformat(),
            "updatedAt": row["updated_at"].isoformat(),
            "originRelease": row["origin_release"],
            "accountCurrency": row["account_currency"],
            "executionMode": row["execution_mode"],
            "orders": orders,
            "protection": protection,
            "brokerEvents": list(reversed(events)),
            "closedTrades": trades,
            "brokerEventsBounded": len(events) == 500,
        }


def estimate_net_pips(
    metadata: dict[str, Any], entry: Decimal, mark: Decimal, volume: Decimal, side: str
) -> Decimal:
    """Model only, excludes unknown swap/slippage. Not a fill or final net outcome."""
    if metadata["commission"]["type"] != "USD_PER_MILLION_USD" or metadata["quoteAsset"] != "USD":
        raise ValueError("FLIGHT_COST_UNSUPPORTED")
    pip, tick = number(metadata["pipSize"]), number(metadata["tickSize"])
    per_price = number(metadata["tickValue"]) * volume / tick
    if min(pip, tick, per_price, volume) <= 0:
        raise ValueError("FLIGHT_COST_INVALID")
    commission = metadata["commission"]
    minimum = number(commission["minimum"])
    if (
        minimum
        and commission["minimumType"] != "QUOTE_CURRENCY"
        and commission["minimumAsset"] not in {metadata["accountAsset"], metadata["quoteAsset"]}
    ):
        raise ValueError("FLIGHT_COMMISSION_CURRENCY_UNKNOWN")
    rate, fx = number(commission["rate"]), number(metadata["quoteToAccountConversionRate"])
    minimum_account = (
        minimum * fx
        if commission["minimumType"] == "QUOTE_CURRENCY"
        or commission["minimumAsset"] == metadata["quoteAsset"]
        else minimum
    )
    fee = sum(
        max(price * volume * number(metadata["volumeScale"]) * rate / 1000000 * fx, minimum_account)
        for price in [entry, mark]
    )
    gross = (mark - entry) * (1 if side == "BUY" else -1) * per_price
    conversion = abs(gross) * number(commission["pnlConversionFeeRate"]) / 100
    return (gross - fee - conversion) / per_price / pip


class StorageBudget:
    def __init__(self, directory: Path):
        self.directory = directory
        self.used = 0
        self.refresh()

    def refresh(self) -> None:
        self.used = sum(p.stat().st_size for p in self.directory.iterdir() if p.is_file())

    def claim(self, size: int) -> None:
        # Reserve space for atomic summaries and an 8 MiB compression transaction.
        if self.used + size > MAX_BYTES - 16 * 1024**2:
            raise ValueError("FLIGHT_STORAGE_BUDGET_FULL")
        self.used += size


class Flight:
    def __init__(
        self,
        directory: Path,
        setup: dict[str, Any],
        now: datetime,
        budget: StorageBudget | None = None,
        history_covered: bool = False,
    ):
        if directory.is_symlink():
            raise ValueError("FLIGHT_DIRECTORY_INVALID")
        self.directory = directory
        self.budget = budget or StorageBudget(directory)
        self.quiet_gap = False
        self.key = setup["setup"]
        self.base = f"flight-{self.key}-{now.strftime('%Y%m%dT%H%M%S%f')}"
        self.segment = 0
        self.path = directory / f"{self.base}-0000.jsonl"
        self.summary_path = directory / f"{self.base}.summary.json"
        self.previous = "0" * 64
        self.records = 0
        self.raw_bytes = 0
        self.snapshot_hash = ""
        self.setup = setup
        self.started = timestamp(setup["createdAt"]) if history_covered else now
        self.boundaries: dict[str, dict[str, Any]] = {}
        self.chart: list[dict[str, Any]] = []
        self.legs: dict[str, dict[str, Any]] = {}
        self.metric_history: deque[tuple[datetime, str, dict[str, Any]]] = deque(maxlen=8192)
        self.gaps = 0
        self.next_gap = True
        self.last_quote: datetime | None = None
        self.side_times: dict[str, datetime] = {}
        self.final = False
        self.append(
            "START",
            {
                "setup": setup,
                "coverageStart": self.started.isoformat(),
                "carryIn": not history_covered,
                "completeTickTape": False,
            },
        )
        if not history_covered:
            self.gap("RECORDER_START_PRIOR_PATH_UNKNOWN")

    def append(self, kind: str, payload: object) -> None:
        if self.final:
            raise ValueError("FLIGHT_ALREADY_FINAL")
        record = {
            "kind": kind,
            "payload": payload,
            "observedAt": datetime.now(UTC).isoformat(),
            "sequence": self.records + 1,
            "previous": self.previous,
        }
        digest = hashlib.sha256(encoded(record)).hexdigest()
        data = encoded({**record, "sha256": digest}) + b"\n"
        self.budget.claim(len(data))
        with self.path.open("ab") as handle:
            os.chmod(self.path, 0o600)
            handle.write(data)
        self.previous = digest
        self.records += 1
        self.raw_bytes += len(data)
        if self.path.stat().st_size >= 8 * 1024**2:
            self.compress()

    def compress(self) -> None:
        if not self.path.exists():
            return
        content = self.path.read_bytes()
        compressed = gzip.compress(content, mtime=0)
        target = self.path.with_suffix(self.path.suffix + ".gz")
        with target.open("xb") as handle:
            os.chmod(target, 0o400)
            handle.write(compressed)
            handle.flush()
            os.fsync(handle.fileno())
        if gzip.decompress(target.read_bytes()) != content:
            raise ValueError("FLIGHT_COMPRESSION_VERIFY_FAILED")
        self.path.unlink()
        self.budget.used += len(compressed) - len(content)
        self.segment += 1
        self.path = self.directory / f"{self.base}-{self.segment:04d}.jsonl"

    def gap(self, reason: str) -> None:
        if self.final:
            return
        self.gaps += 1
        self.next_gap = True
        for leg in self.legs.values():
            leg["previousPositiveAt"] = None
        self.append("GAP", {"reason": reason})

    def update(self, setup: dict[str, Any]) -> None:
        if self.final:
            return
        digest = hashlib.sha256(encoded(setup)).hexdigest()
        if digest != self.snapshot_hash:
            self.append("LIFECYCLE", setup)
            self.snapshot_hash = digest
            self.setup = setup
            # Broker close evidence can arrive after its timestamp. Remove already
            # observed post-close excursions from the displayed open-trade metrics.
            for trade in setup["closedTrades"]:
                side = "BUY" if trade["direction"] == "LONG" else "SELL"
                closed = timestamp(trade["closed_at"])
                leg = self.legs.get(side)
                if not leg or timestamp(leg["quoteAt"]) < closed:
                    continue
                before = next(
                    (
                        v
                        for at, sd, v in reversed(self.metric_history)
                        if sd == side and at < closed and v["basis"] == leg["basis"]
                    ),
                    None,
                )
                if before is not None:
                    self.legs[side] = copy.deepcopy(before)
                else:
                    self.gap("LATE_CLOSE_EXCURSIONS_CENSORED")
                    self.legs.pop(side, None)

    def quote(self, event: dict[str, Any], metadata: dict[str, Any], now: datetime) -> None:
        if self.final:
            return
        self.append("BROKER_QUOTE", event)
        try:
            if event["kind"] != "QUOTE":
                self.side_times.clear()
                raise ValueError("BROKER_RECONNECTED")
            source, received = timestamp(event["sourceTime"]), timestamp(event["receivedAt"])
            bid, ask, pip = number(event["bid"]), number(event["ask"]), number(metadata["pipSize"])
            for side in ["bid", "ask"]:
                if event.get(f"{side}Updated") is True:
                    self.side_times[side] = source
            if any(
                side not in self.side_times
                or not 0 <= (source - self.side_times[side]).total_seconds() <= 3
                for side in ["bid", "ask"]
            ):
                raise ValueError("QUOTE_SIDE_FRESHNESS_UNKNOWN")
            if not (
                0 <= (now - source).total_seconds() <= 3
                and source <= received <= now
                and 0 < bid <= ask
                and pip > 0
            ):
                raise ValueError("QUOTE_STALE_OR_INVALID")
            if self.last_quote and (
                source < self.last_quote or (source - self.last_quote).total_seconds() > 3
            ):
                self.gap("QUOTE_TIME_DISCONTINUITY")
            self.last_quote = source
            self.quiet_gap = False
            self.chart.append(
                {
                    "at": source.isoformat(),
                    "bid": plain(bid),
                    "ask": plain(ask),
                    "gap": self.next_gap,
                }
            )
            self.next_gap = False
            if len(self.chart) > 240:
                compact = [self.chart[0]]
                for i in range(1, len(self.chart), 2):
                    pair = self.chart[i : i + 2]
                    compact.append({**pair[-1], "gap": any(p["gap"] for p in pair)})
                self.chart = compact
            for order in self.setup["orders"]:
                side = order["side"]
                trigger_mark = ask if side == "BUY" else bid
                proximity = abs(trigger_mark - number(order["entry_price"])) / pip
                boundary = self.boundaries.setdefault(
                    side,
                    {
                        "side": side,
                        "closestEntryPips": None,
                        "observedBoundaryCross": False,
                        "counterfactualNet": None,
                    },
                )
                boundary["closestEntryPips"] = plain(
                    min(proximity, number(boundary["closestEntryPips"]))
                    if boundary["closestEntryPips"] is not None
                    else proximity
                )
                boundary["observedBoundaryCross"] = boundary["observedBoundaryCross"] or (
                    trigger_mark >= number(order["entry_price"])
                    if side == "BUY"
                    else trigger_mark <= number(order["entry_price"])
                )
                if (
                    order.get("fill_price") is None
                    or order.get("last_fill") is None
                    or source < timestamp(order["last_fill"])
                ):
                    continue
                # No quotes at/after a proven close contribute to open-position excursion.
                closes = [
                    timestamp(t["closed_at"])
                    for t in self.setup["closedTrades"]
                    if t["direction"] == ("LONG" if order["side"] == "BUY" else "SHORT")
                ]
                if closes and source >= min(closes):
                    continue
                side, entry, volume = (
                    order["side"],
                    number(order["fill_price"]),
                    number(order["fill_volume"]),
                )
                for current in self.setup["protection"]:
                    if (
                        current["side"] == side
                        and current.get("state") == "OPEN"
                        and current.get("updated_at") is not None
                        and timestamp(current["updated_at"]) <= source
                    ):
                        volume = number(current["volume"])
                if volume <= 0:
                    raise ValueError("POSITION_REMAINING_VOLUME_INVALID")
                basis = f"{entry}:{volume}"
                if side not in self.legs or self.legs[side]["basis"] != basis:
                    if side in self.legs:
                        self.gap("POSITION_VOLUME_BASIS_CHANGED_PRIOR_METRICS_CENSORED")
                    self.legs[side] = {
                        "side": side,
                        "basis": basis,
                        "entry": plain(entry),
                        "volume": plain(volume),
                        "samples": 0,
                        "mfePips": None,
                        "maePips": None,
                        "bestModeledNetPips": None,
                        "closestTpPips": None,
                        "closestSlPips": None,
                        "timeProfitableSeconds": "0",
                        "previousPositiveAt": None,
                    }
                leg = self.legs[side]
                direction = 1 if side == "BUY" else -1
                mark = bid if side == "BUY" else ask
                move = (mark - entry) * direction / pip
                target = (
                    entry
                    + abs(number(order["take_profit"]) - number(order["entry_price"])) * direction
                )
                stop = (
                    entry
                    - abs(number(order["stop_loss"]) - number(order["entry_price"])) * direction
                )
                leg["targetBasis"] = "FILL_RELATIVE_INTENT"
                leg["protectionObservedAt"] = None
                for p in self.setup["protection"]:
                    if (
                        p["side"] == side
                        and p["protection_status"] == "VERIFIED"
                        and p["broker_tp"]
                        and p["broker_sl"]
                        and p.get("observed_at") is not None
                        and timestamp(p["observed_at"]) <= source
                    ):
                        target, stop = number(p["broker_tp"]), number(p["broker_sl"])
                        leg["targetBasis"] = "LAST_OBSERVED_BROKER"
                        leg["protectionObservedAt"] = timestamp(p["observed_at"]).isoformat()
                leg["entrySlippagePips"] = plain(
                    (entry - number(order["entry_price"])) * direction / pip
                )
                lag = (
                    timestamp(order["first_fill"]) - timestamp(self.setup["createdAt"])
                ).total_seconds()
                leg["localIntentToBrokerFillSeconds"] = str(lag) if lag >= 0 else None
                leg.update(
                    target=plain(target),
                    stop=plain(stop),
                    mark=plain(mark),
                    quoteAt=source.isoformat(),
                    samples=leg["samples"] + 1,
                )
                leg["mfePips"] = plain(
                    max(Decimal(0), move, number(leg["mfePips"]))
                    if leg["mfePips"] is not None
                    else max(Decimal(0), move)
                )
                leg["maePips"] = plain(
                    min(Decimal(0), move, number(leg["maePips"]))
                    if leg["maePips"] is not None
                    else min(Decimal(0), move)
                )
                for key, value in [
                    ("closestTpPips", abs(target - mark) / pip),
                    ("closestSlPips", abs(stop - mark) / pip),
                ]:
                    leg[key] = plain(
                        min(value, number(leg[key])) if leg[key] is not None else value
                    )
                try:
                    net = estimate_net_pips(metadata, entry, mark, volume, side)
                    leg["modeledNetPips"] = plain(net)
                    leg["bestModeledNetPips"] = plain(
                        max(net, number(leg["bestModeledNetPips"]))
                        if leg["bestModeledNetPips"] is not None
                        else net
                    )
                    prior = leg["previousPositiveAt"]
                    if net > 0 and prior:
                        seconds = (source - timestamp(prior)).total_seconds()
                        if 0 <= seconds <= 3:
                            leg["timeProfitableSeconds"] = plain(
                                number(leg["timeProfitableSeconds"]) + Decimal(str(seconds))
                            )
                    leg["previousPositiveAt"] = source.isoformat() if net > 0 else None
                except (ValueError, ArithmeticError, KeyError):
                    leg["modeledNetPips"] = None
                self.metric_history.append((source, side, copy.deepcopy(leg)))
                while (
                    self.metric_history
                    and (source - self.metric_history[0][0]).total_seconds() > 10
                ):
                    self.metric_history.popleft()
            # Both boundaries and post-close moves remain raw observations, not hypothetical fills.
        except (ValueError, ArithmeticError, KeyError, TypeError) as error:
            reason = str(error) if re.fullmatch(r"[A-Z_]{1,100}", str(error)) else "QUOTE_INVALID"
            self.gap(reason)

    def summary(self, now: datetime) -> dict[str, Any]:
        return {
            "schemaVersion": "1.0",
            "checkedAt": now.isoformat(),
            "setup": self.key,
            "state": self.setup["state"],
            "originRelease": self.setup["originRelease"],
            "accountCurrency": self.setup.get("accountCurrency"),
            "executionMode": self.setup["executionMode"],
            "coverageStart": self.started.isoformat(),
            "gaps": self.gaps,
            "records": self.records,
            "completeTickTape": False,
            "final": self.final,
            "chart": self.chart,
            "legs": list(self.legs.values()),
            "boundaries": list(self.boundaries.values()),
            "orders": self.setup["orders"],
            "closedTrades": self.setup["closedTrades"],
            "costBasis": "MODELED_BROKER_COMMISSION_EXCLUDES_UNKNOWN_SWAP_SLIPPAGE",
            "counterfactualNet": None,
            "quoteAt": self.last_quote.isoformat() if self.last_quote else None,
        }

    def publish(self, now: datetime) -> None:
        if (
            not self.final
            and not self.quiet_gap
            and (self.last_quote is None or (now - self.last_quote).total_seconds() > 3)
        ):
            self.gap("NO_FRESH_QUOTE")
            self.quiet_gap = True
        if self.path.exists():
            with self.path.open("rb") as raw:
                os.fsync(raw.fileno())
        atomic(self.summary_path, self.summary(now))
        atomic(
            self.directory / "status.json",
            {
                "schemaVersion": "1.0",
                "checkedAt": now.isoformat(),
                "state": "RECORDING" if not self.final else "LAST_COMPLETED",
                "summary": self.summary_path.name,
                "brokerAuthority": False,
            },
        )

    def finish(self, now: datetime) -> None:
        if self.final:
            return
        self.append(
            "END",
            {
                "closedTrades": self.setup["closedTrades"],
                "gaps": self.gaps,
                "counterfactualNet": None,
            },
        )
        self.final = True
        self.publish(now)
        self.compress()
        os.chmod(self.summary_path, 0o400)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    directory: Path = args.output
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise ValueError("FLIGHT_DIRECTORY_INVALID")
    lock = (directory / "recorder.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    connection: psycopg.Connection[dict[str, Any]] | None = None
    flight: Flight | None = None
    post_flights: list[Flight] = []
    budget = StorageBudget(directory)
    seen: set[str] = set()
    stream, cursor = None, 0
    recent: deque[dict[str, Any]] = deque(maxlen=8192)
    last_database, last_publish, last_metadata = 0.0, 0.0, 0.0
    metadata: dict[str, Any] = {}
    storage_check = 0.0
    total_bytes = 0
    with httpx.Client(timeout=3, trust_env=False) as client:
        while True:
            now = datetime.now(UTC)
            try:
                if time.monotonic() - storage_check > 5:
                    budget.refresh()
                    total_bytes = budget.used
                    storage_check = time.monotonic()
                if (
                    total_bytes >= MAX_BYTES - 16 * 1024**2
                    or shutil.disk_usage(directory).free < MIN_FREE
                ):
                    raise ValueError("FLIGHT_STORAGE_BUDGET_FULL")
                if time.monotonic() - last_database >= 1:
                    source_response = client.get("http://127.0.0.1:8080/v1/flight-source")
                    source_response.raise_for_status()
                    status = source_response.json()
                    if (
                        status.get("mode") != "demo"
                        or status.get("strategyVersion") != args.release
                    ):
                        raise ValueError("FLIGHT_SOURCE_HALT")
                    if connection is None or connection.closed:
                        connection = psycopg.connect(
                            os.environ["DATABASE_URL"],
                            autocommit=True,
                            row_factory=dict_row,
                            options="-c default_transaction_read_only=on -c statement_timeout=2000",
                        )
                    for tracked in ([flight] if flight and not flight.final else []) + post_flights:
                        prior = load_setup(
                            connection,
                            os.environ["ACCOUNT_KEY_HASH"],
                            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
                            tracked.key,
                        )
                        if prior is not None:
                            tracked.update(prior)
                        else:
                            tracked.gap("SETUP_LIFECYCLE_READ_UNAVAILABLE")
                    setup = load_setup(
                        connection,
                        os.environ["ACCOUNT_KEY_HASH"],
                        os.environ.get("TRADING_SYMBOL", "XAUUSD"),
                    )
                    if (
                        setup
                        and (flight is None or flight.key != setup["setup"])
                        and setup["setup"] not in seen
                    ):
                        if flight and not flight.final:
                            if flight.setup["state"] in TERMINAL:
                                post_flights.append(flight)
                                if len(post_flights) > 8:
                                    oldest = post_flights.pop(0)
                                    oldest.gap("POST_WINDOW_CAPACITY_CENSORED")
                                    oldest.finish(now)
                            else:
                                flight.gap("NEXT_SETUP_WITHOUT_TERMINAL_PROOF_CENSORED")
                                flight.finish(now)
                        covered = bool(recent) and timestamp(recent[0]["receivedAt"]) <= timestamp(
                            setup["createdAt"]
                        )
                        flight = Flight(directory, setup, now, budget, covered)
                        for previous_event in recent:
                            if timestamp(previous_event["receivedAt"]) >= timestamp(
                                setup["createdAt"]
                            ):
                                flight.quote(previous_event, metadata, datetime.now(UTC))
                    if setup and flight and setup["setup"] == flight.key:
                        flight.update(setup)
                    last_database = time.monotonic()
                if time.monotonic() - last_metadata > 30:
                    response = client.post(
                        "http://127.0.0.1:8081/v1/session",
                        json={"symbol": os.environ.get("TRADING_SYMBOL", "XAUUSD")},
                    )
                    response.raise_for_status()
                    metadata = response.json()["metadata"]
                    last_metadata = time.monotonic()
                response = client.get(
                    "http://127.0.0.1:8081/v1/flight-quotes", params={"after": cursor}
                )
                response.raise_for_status()
                if len(response.content) > 2 * 1024**2:
                    raise ValueError("FLIGHT_BATCH_OVERSIZED")
                batch = response.json()
                if (
                    batch.get("schemaVersion") != "1.0"
                    or not isinstance(batch.get("events"), list)
                    or len(batch["events"]) > 2048
                ):
                    raise ValueError("FLIGHT_BATCH_INVALID")
                if stream != batch["streamId"]:
                    if flight:
                        flight.gap("QUOTE_STREAM_START_OR_RESTART")
                    stream, cursor = batch["streamId"], 0
                    recent.clear()
                    continue
                if batch["gap"]:
                    recent.clear()
                    if flight and not flight.final:
                        flight.gap("QUOTE_RING_OVERFLOW_OR_CURSOR_GAP")
                    if cursor > batch["latestSequence"]:
                        cursor = 0
                        continue
                for event in batch["events"]:
                    if not isinstance(event["sequence"], int) or event["sequence"] <= cursor:
                        raise ValueError("FLIGHT_EVENT_ORDER_INVALID")
                    if cursor and event["sequence"] != cursor + 1 and flight:
                        flight.gap("QUOTE_SEQUENCE_GAP")
                    cursor = event["sequence"]
                    recent.append(event)
                    while (
                        recent and (now - timestamp(recent[0]["receivedAt"])).total_seconds() > 10
                    ):
                        recent.popleft()
                    if (
                        flight
                        and not flight.final
                        and timestamp(event["receivedAt"]) >= timestamp(flight.setup["createdAt"])
                    ):
                        flight.quote(event, metadata, datetime.now(UTC))
                    for post in post_flights:
                        if timestamp(event["receivedAt"]) >= timestamp(post.setup["createdAt"]):
                            post.quote(event, metadata, datetime.now(UTC))
                if time.monotonic() - last_publish > 1:
                    for post in list(post_flights):
                        if now >= timestamp(post.setup["updatedAt"]) + timedelta(seconds=30):
                            post.finish(now)
                            seen.add(post.key)
                            if len(seen) > 8192:
                                seen = {flight.key} if flight else set()
                            post_flights.remove(post)
                        else:
                            # Do not replace the active setup's status pointer.
                            atomic(post.summary_path, post.summary(now))
                    if flight and not flight.final:
                        if flight.setup["state"] in TERMINAL and now >= timestamp(
                            flight.setup["updatedAt"]
                        ) + timedelta(seconds=30):
                            flight.finish(now)
                            seen.add(flight.key)
                            if len(seen) > 8192:
                                seen = {flight.key}
                        else:
                            flight.publish(now)
                    elif flight:
                        atomic(
                            directory / "status.json",
                            {
                                "schemaVersion": "1.0",
                                "checkedAt": now.isoformat(),
                                "state": "LAST_COMPLETED",
                                "summary": flight.summary_path.name,
                                "brokerAuthority": False,
                            },
                        )
                    last_publish = time.monotonic()

            except (
                httpx.HTTPError,
                psycopg.Error,
                OSError,
                ValueError,
                ArithmeticError,
                KeyError,
                TypeError,
            ) as error:
                if connection and not connection.closed:
                    connection.close()
                connection = None
                try:
                    if flight and not flight.final and budget.used < MAX_BYTES - 16 * 1024**2:
                        flight.gap("RECORDER_READ_STORAGE_OR_SOURCE_GAP")
                    atomic(
                        directory / "status.json",
                        {
                            "schemaVersion": "1.0",
                            "checkedAt": now.isoformat(),
                            "state": "GAP",
                            "reason": str(error)
                            if re.fullmatch(r"[A-Z_]{1,100}", str(error))
                            else "RECORDER_READ_GAP",
                            "summary": None,
                            "brokerAuthority": False,
                        },
                    )
                except (OSError, ValueError):
                    pass
                time.sleep(3)
            time.sleep(0.25)


if __name__ == "__main__":
    main()
