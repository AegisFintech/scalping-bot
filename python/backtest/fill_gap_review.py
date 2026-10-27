"""Read-only quote-to-fill and visible-book diagnostics. Not a fill simulator or SL/TP cause.

Every gap is adverse-positive: a BUY that filled above the executable ask, or a SELL that
filled below the executable bid, reports a positive gap. Reference quotes are sampled
observations bound by broker source time, never a complete tick tape.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

from python.backtest.breakout_entry_review import audit_tp, verify_records, write_new
from python.operations.entry_context import number, timestamp

PROTOCOL = "fill-gap-review-1.0"
PATTERN_PROTOCOL = "native-tp-fill-pattern-1.0"
MAX_FILLS = 10000
MAX_INPUT = 16 * 1024**2
MAX_AGE = timedelta(seconds=3)
VOLUME_BUCKETS = (Decimal(100), Decimal(200), Decimal(300))
NATIVE_PROTECTION_ORDER = 4
MARKET_ORDER = 1
# The retained #387 cohort records cTrader native volume (cents of a unit).
RETAINED_VOLUME_SCALE = Decimal("0.01")


def plain(value: Decimal) -> str:
    """Canonical decimal text without exponent or trailing zeros."""
    text = format(value.normalize(), "f")
    return "0" if text in {"-0", ""} else text


@dataclass(frozen=True)
class QuotePoint:
    source: datetime
    received: datetime
    bid: Decimal
    ask: Decimal
    bid_at: datetime
    ask_at: datetime
    origin: str


@dataclass(frozen=True)
class BookPoint:
    source: datetime
    bids: tuple[tuple[Decimal, Decimal], ...]
    asks: tuple[tuple[Decimal, Decimal], ...]


def flight_points(records: list[dict[str, Any]]) -> list[QuotePoint]:
    """Ring events keep partial-side flags; a side is usable only after its own update."""
    sides: dict[str, datetime] = {}
    points: list[QuotePoint] = []
    for record in records:
        if record["kind"] == "GAP":
            sides.clear()
            continue
        if record["kind"] != "BROKER_QUOTE":
            continue
        q = record["payload"]
        if q.get("kind") != "QUOTE" or not q.get("sourceTime"):
            sides.clear()
            continue
        try:
            source, received = timestamp(q["sourceTime"]), timestamp(q["receivedAt"])
            bid, ask = number(q["bid"]), number(q["ask"])
        except (KeyError, TypeError, ValueError, ArithmeticError):
            sides.clear()
            continue
        if not 0 < bid < ask or not source <= received or received - source > MAX_AGE:
            sides.clear()
            continue
        for side in ("bid", "ask"):
            if q.get(f"{side}Updated") is True:
                sides[side] = source
        if "bid" in sides and "ask" in sides:
            points.append(
                QuotePoint(source, received, bid, ask, sides["bid"], sides["ask"], "FLIGHT")
            )
    return points


def near(times: list[datetime], at: datetime) -> bool:
    """True when a sample lies within the freshness window of some fill time."""
    index = bisect_right(times, at - MAX_AGE)
    return index < len(times) and times[index] - at <= MAX_AGE


def market_samples(
    directories: list[Path], times: list[datetime]
) -> tuple[list[QuotePoint], list[BookPoint], dict[str, Any]]:
    """Sealed 250 ms quote/DOM segments: checksum, count and order precede use.

    Only samples within three seconds of an exported fill are retained.
    """
    times = sorted(times)
    quotes: list[QuotePoint] = []
    books: list[BookPoint] = []
    rejected: Counter[str] = Counter()
    hashes: set[str] = set()
    if any(root.is_symlink() or not root.is_dir() for root in directories):
        raise ValueError("FILL_MARKET_DIRECTORY_INVALID")
    paths = sorted(
        (p for root in directories for p in root.glob("*.jsonl.gz")),
        key=lambda p: (p.name, str(p)),
    )
    for path in paths:
        manifest_path = Path(str(path) + ".manifest.json")
        if path.is_symlink() or not manifest_path.is_file():
            rejected["UNSEALED_SEGMENT"] += 1
            continue
        if manifest_path.stat().st_size > 16384 or path.stat().st_size > 8_000_000:
            raise ValueError("FILL_MARKET_SEGMENT_BOUNDS_INVALID")
        manifest = json.loads(manifest_path.read_text())
        started, completed = timestamp(manifest["startedAt"]), timestamp(manifest["completedAt"])
        first = bisect_left(times, started - MAX_AGE)
        if first == len(times) or times[first] > completed + MAX_AGE:
            continue
        contents = path.read_bytes()
        digest = hashlib.sha256(contents).hexdigest()
        if digest != manifest["sha256"]:
            raise ValueError("FILL_MARKET_SEGMENT_CHECKSUM_MISMATCH")
        if digest in hashes:
            continue
        hashes.add(digest)
        if len(hashes) > 10000:
            raise ValueError("FILL_MARKET_SEGMENT_LIMIT")
        count, previous = 0, None
        with gzip.open(BytesIO(contents), "rt") as stream:
            while line := stream.readline(100_001):
                count += 1
                if count > 100_000 or len(line) > 100_000:
                    raise ValueError("FILL_MARKET_SEGMENT_EXPANSION_LIMIT")
                row = json.loads(line)
                captured = timestamp(row["capturedAt"])
                if (previous is not None and captured < previous) or not (
                    started <= captured <= completed
                ):
                    raise ValueError("FILL_MARKET_SEGMENT_TIME_INVALID")
                previous = captured
                if not near(times, captured):
                    continue
                try:
                    if row.get("schemaVersion") not in {"1.0", "1.1"}:
                        raise ValueError("SAMPLE_CONTRACT_INVALID")
                    raw, book = row["quote"], row["orderBook"]
                    source, received = timestamp(raw["sourceTime"]), timestamp(raw["receivedAt"])
                    bid, ask = number(raw["bid"]), number(raw["ask"])
                    if not source <= received <= captured or captured - source > MAX_AGE:
                        raise ValueError("SAMPLE_TIME_INVALID")
                    if not 0 < bid < ask:
                        raise ValueError("SAMPLE_QUOTE_INVALID")
                    quotes.append(
                        QuotePoint(source, received, bid, ask, source, source, "MARKET_SAMPLE")
                    )
                    if book.get("complete") is not True or book.get("discontinuity") is not False:
                        raise ValueError("SAMPLE_BOOK_INCOMPLETE")
                    levels = {
                        side: tuple(
                            (number(level["price"]), number(level["size"]))
                            for level in book[side][:20]
                        )
                        for side in ("bids", "asks")
                    }
                    if any(p <= 0 or s <= 0 for side in levels.values() for p, s in side):
                        raise ValueError("SAMPLE_BOOK_INVALID")
                    books.append(
                        BookPoint(
                            timestamp(book["sourceTime"]),
                            tuple(sorted(levels["bids"], key=lambda x: -x[0])),
                            tuple(sorted(levels["asks"], key=lambda x: x[0])),
                        )
                    )
                except (KeyError, TypeError, ValueError, ArithmeticError) as error:
                    rejected[str(error) if str(error).startswith("SAMPLE_") else "SAMPLE"] += 1
        if count != manifest["sampleCount"]:
            raise ValueError("FILL_MARKET_SEGMENT_COUNT_MISMATCH")
    return (
        quotes,
        books,
        {
            "segments": len(hashes),
            "quoteSamples": len(quotes),
            "bookSamples": len(books),
            "rejected": dict(rejected),
            "sha256": hashlib.sha256("".join(sorted(hashes)).encode()).hexdigest(),
            "kind": "SAMPLED_QUOTES_AND_BROKER_DEPTH_NOT_COMPLETE_TICKS",
        },
    )


def executable(kind: str, side: str) -> str:
    """Entries trade the side they buy/sell; closes trade the opposite of the position."""
    buying = (side == "BUY") == (kind == "ENTRY")
    return "ask" if buying else "bid"


def adverse(price: Decimal, reference: Decimal, quote_side: str) -> Decimal:
    return price - reference if quote_side == "ask" else reference - price


@dataclass(frozen=True)
class Observations:
    points: list[QuotePoint]
    point_times: list[datetime]
    books: list[BookPoint]
    book_times: list[datetime]

    @classmethod
    def build(cls, points: list[QuotePoint], books: list[BookPoint]) -> Observations:
        points = sorted(points, key=lambda p: (p.source, p.received, p.origin))
        books = sorted(books, key=lambda b: b.source)
        return cls(points, [p.source for p in points], books, [b.source for b in books])


def reference(observed: Observations, at: datetime, quote_side: str) -> QuotePoint | None:
    """Latest observation at or before the broker fill time with a fresh relevant side."""
    points = observed.points
    index = bisect_right(observed.point_times, at)
    for point in reversed(points[max(0, index - 64) : index]):
        side_at = point.ask_at if quote_side == "ask" else point.bid_at
        if at - point.source > MAX_AGE:
            return None
        if at - side_at <= MAX_AGE:
            return point
    return None


def visible_book(
    observed: Observations, at: datetime, quote_side: str, units: Decimal
) -> dict[str, Any] | None:
    """Walk only the recorded visible ladder; a shortfall is not proof of missing liquidity."""
    index = bisect_right(observed.book_times, at)
    if not index or at - observed.books[index - 1].source > MAX_AGE:
        return None
    book = observed.books[index - 1]
    levels = book.asks if quote_side == "ask" else book.bids
    if not levels:
        return None
    remaining, cost, needed = units, Decimal(0), 0
    for price, size in levels:
        if remaining <= 0:
            break
        take = min(size, remaining)
        cost += take * price
        remaining -= take
        needed += 1
    walk = (cost / units).quantize(Decimal("1e-10")) if remaining <= 0 else None
    return {
        "bookAt": book.source.isoformat(),
        "timeBasis": "BOOK_SOURCE_IS_LAST_BROKER_SPOT_TIME",
        "levels": [[plain(p), plain(s)] for p, s in levels[:4]],
        "visibleUnits": plain(sum((s for _, s in levels), Decimal(0))),
        "levelsNeeded": needed if walk is not None else None,
        "visibleWalkPrice": plain(walk) if walk is not None else None,
        "visibleWalkGap": plain(adverse(walk, levels[0][0], quote_side))
        if walk is not None
        else None,
        "visibleShortfallUnits": plain(remaining) if remaining > 0 else "0",
        "scope": "BROKER_DEPTH_ONLY_NOT_CONSOLIDATED_LIQUIDITY",
    }


def close_class(fill: dict[str, Any], price: Decimal, at: datetime) -> str:
    if fill.get("externalIntervention") is True:
        return "EXTERNAL_CLOSE"
    order_type = fill.get("closingOrderType")
    if order_type == MARKET_ORDER:
        return "MARKET_CLOSE"
    if order_type != NATIVE_PROTECTION_ORDER:
        return "CLOSE_TYPE_UNAVAILABLE"
    observed = fill.get("protectionObservedAt")
    tp, sl = fill.get("brokerTakeProfit"), fill.get("brokerStopLoss")
    if not observed or not tp or not sl or timestamp(observed) > at:
        return "NATIVE_LEVEL_UNKNOWN"
    tp_price, sl_price, long = number(tp), number(sl), fill["side"] == "BUY"
    if (price >= tp_price) if long else (price <= tp_price):
        return "NATIVE_AT_OR_BEYOND_TP"
    if (price <= sl_price) if long else (price >= sl_price):
        return "NATIVE_AT_OR_BEYOND_SL"
    return "NATIVE_BETWEEN_LEVELS"


def tp_crossings(
    crossings: list[dict[str, Any]], side: str, at: datetime, filled_tp: bool
) -> dict[str, Any] | None:
    """Recorded TP-side quote crossings before a close; never a missed-fill claim."""
    rows = [c for c in crossings if c["side"] == side and timestamp(c["quoteAt"]) <= at]
    if not rows:
        return None

    def beyond(c: dict[str, Any]) -> Decimal:
        mark, tp = number(c["mark"]), number(c["brokerTp"])
        return mark - tp if side == "BUY" else tp - mark

    last = rows[-1]
    return {
        "brokerTp": plain(number(last["brokerTp"])),
        "crossings": len(rows),
        "firstCrossingAt": rows[0]["quoteAt"],
        "firstCrossingToFillSeconds": plain(
            Decimal(str((at - timestamp(rows[0]["quoteAt"])).total_seconds()))
        ),
        "maxExcursionBeyondTp": plain(max(beyond(c) for c in rows)),
        "lastCrossingBeforeFill": {
            "quoteAt": last["quoteAt"],
            "mark": plain(number(last["mark"])),
            "excursionBeyondTp": plain(beyond(last)),
            "lagToFillSeconds": plain(
                Decimal(str((at - timestamp(last["quoteAt"])).total_seconds()))
            ),
        },
        "tpFilled": filled_tp,
        "basis": "RECORDED_SAMPLED_QUOTES_PRIOR_VERIFIED_PROTECTION",
    }


def stats(values: list[Decimal]) -> dict[str, Any] | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    median = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return {
        "n": len(ordered),
        "min": plain(ordered[0]),
        "median": plain(median),
        "max": plain(ordered[-1]),
    }


def bucket(units: Decimal) -> str:
    lower = Decimal(0)
    for edge in VOLUME_BUCKETS:
        if units < edge:
            return f"{plain(lower)}-{plain(edge)}"
        lower = edge
    return f"{plain(lower)}+"


def evaluate(
    fill: dict[str, Any], observed: Observations, crossings: list[dict[str, Any]]
) -> dict[str, Any]:
    at = timestamp(fill["occurredAt"])
    price, kind, side = number(fill["fillPrice"]), fill["kind"], fill["side"]
    if kind not in {"ENTRY", "CLOSE"} or side not in {"BUY", "SELL"} or price <= 0:
        raise ValueError("FILL_ROW_INVALID")
    units = number(fill["fillVolume"]) * number(fill["volumeScale"])
    if units <= 0:
        raise ValueError("FILL_VOLUME_INVALID")
    quote_side = executable(kind, side)
    result: dict[str, Any] = {
        "setup": fill["setup"],
        "originRelease": fill["originRelease"],
        "kind": kind,
        "side": side,
        "fillAt": at.isoformat(),
        "fillPrice": plain(price),
        "units": plain(units),
        "volumeBucket": bucket(units),
        "executableSide": quote_side,
        "counterfactualNet": None,
    }
    if kind == "ENTRY":
        trigger = number(fill["triggerPrice"])
        result |= {
            "executionOrderType": fill.get("executionOrderType"),
            "triggerPrice": plain(trigger),
            "triggerGap": plain(adverse(price, trigger, quote_side)),
            "acceptedToFillSeconds": plain(
                Decimal(str((at - timestamp(fill["brokerAcceptedAt"])).total_seconds()))
            )
            if fill.get("brokerAcceptedAt")
            else None,
        }
    else:
        klass = close_class(fill, price, at)
        level = (
            fill.get("brokerTakeProfit")
            if klass == "NATIVE_AT_OR_BEYOND_TP"
            else fill.get("brokerStopLoss")
            if klass == "NATIVE_AT_OR_BEYOND_SL"
            else None
        )
        result |= {
            "closeClass": klass,
            "closeClassBasis": "CLOSING_ORDER_TYPE_AND_PRICE_VS_LAST_OBSERVED_PROTECTION",
            # Negative means the native level filled better than its stated price.
            "levelSlippage": plain(adverse(price, number(level), quote_side)) if level else None,
            "tpCrossing": tp_crossings(crossings, side, at, klass == "NATIVE_AT_OR_BEYOND_TP"),
        }
    ref = reference(observed, at, quote_side)
    result["quoteReference"] = (
        {
            "origin": ref.origin,
            "quoteAt": ref.source.isoformat(),
            "price": plain(ref.ask if quote_side == "ask" else ref.bid),
            "gap": plain(adverse(price, ref.ask if quote_side == "ask" else ref.bid, quote_side)),
            "delayMs": (at - ref.source) // timedelta(milliseconds=1),
            "spread": plain(ref.ask - ref.bid),
        }
        if ref is not None
        else None
    )
    result["visibleBook"] = visible_book(observed, at, quote_side, units)
    return result


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(row.get("closeClass", row["kind"]), []).append(row)
    summary: dict[str, Any] = {}
    for name, items in sorted(groups.items()):
        refs = [r["quoteReference"] for r in items if r["quoteReference"]]
        books = [r["visibleBook"] for r in items if r["visibleBook"]]
        summary[name] = {
            "fills": len(items),
            "quoteGap": stats([number(r["gap"]) for r in refs]),
            "quoteDelayMs": stats([Decimal(r["delayMs"]) for r in refs]),
            "triggerGap": stats([number(r["triggerGap"]) for r in items if "triggerGap" in r]),
            "levelSlippage": stats(
                [number(r["levelSlippage"]) for r in items if r.get("levelSlippage")]
            ),
            "visibleWalkGap": stats(
                [number(b["visibleWalkGap"]) for b in books if b["visibleWalkGap"] is not None]
            ),
            "visibleDepthShortfalls": sum(b["visibleWalkPrice"] is None for b in books),
            "byVolume": {
                key: stats(
                    [
                        number(r["quoteReference"]["gap"])
                        for r in items
                        if r["volumeBucket"] == key and r["quoteReference"]
                    ]
                )
                for key in sorted({r["volumeBucket"] for r in items})
            },
        }
    crossed = [r for r in rows if r.get("tpCrossing")]
    summary["tpCrossings"] = {
        "filledAtTp": stats(
            [
                number(r["tpCrossing"]["lastCrossingBeforeFill"]["excursionBeyondTp"])
                for r in crossed
                if r["tpCrossing"]["tpFilled"]
            ]
        ),
        "filledLagSeconds": stats(
            [
                number(r["tpCrossing"]["lastCrossingBeforeFill"]["lagToFillSeconds"])
                for r in crossed
                if r["tpCrossing"]["tpFilled"]
            ]
        ),
        "crossedWithoutTpFillMaxExcursion": stats(
            [
                number(r["tpCrossing"]["maxExcursionBeyondTp"])
                for r in crossed
                if not r["tpCrossing"]["tpFilled"]
            ]
        ),
    }
    return summary


def chains(directory: Path, key: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for summary in sorted(directory.glob(f"flight-{key}-*.summary.json")):
        paths = sorted(directory.glob(summary.name.removesuffix(".summary.json") + "-*.jsonl*"))
        if not paths:
            continue
        chain = verify_records(paths)
        if chain[0]["payload"]["setup"]["setup"] != key:
            raise ValueError("FILL_FLIGHT_SCOPE_MISMATCH")
        if records:
            records.append({"kind": "GAP", "payload": {"reason": "RECORDER_RESTART"}})
        records.extend(chain)
    return records


def review(bundle: dict[str, Any], recordings: Path | None, markets: list[Path]) -> dict[str, Any]:
    if bundle.get("schemaVersion") != "fill-evidence-input-1.0" or len(bundle["fills"]) > MAX_FILLS:
        raise ValueError("FILL_REVIEW_INPUT_INVALID")
    fills = bundle["fills"]
    keys = sorted({f["setup"] for f in fills})
    if len(keys) > 1000 or (recordings is not None and recordings.is_symlink()):
        raise ValueError("FILL_REVIEW_BOUNDS_INVALID")
    if not all(isinstance(k, str) and re.fullmatch(r"[a-f0-9]{24}", k) for k in keys):
        raise ValueError("FILL_SETUP_INVALID")
    unique: dict[tuple[datetime, datetime, Decimal, Decimal], QuotePoint] = {}
    crossings: dict[str, list[dict[str, Any]]] = {}
    bounded: set[str] = set()
    for key in keys:
        records = chains(recordings, key) if recordings is not None else []
        # The same ring event can appear in overlapping setup chains; keep one copy.
        for point in flight_points(records):
            identity = (point.source, point.received, point.bid, point.ask)
            prior = unique.get(identity)
            # Each side keeps its freshest known update across overlapping chains.
            unique[identity] = (
                point
                if prior is None
                else replace(
                    prior,
                    bid_at=max(prior.bid_at, point.bid_at),
                    ask_at=max(prior.ask_at, point.ask_at),
                )
            )
        audit = audit_tp(records) if records else {"crossings": [], "crossingsBounded": False}
        crossings[key] = audit["crossings"]
        if audit["crossingsBounded"]:
            bounded.add(key)
    evidence: dict[str, Any] | None = None
    samples: list[QuotePoint] = []
    books: list[BookPoint] = []
    if markets and fills:
        samples, books, evidence = market_samples(
            markets, [timestamp(f["occurredAt"]) for f in fills]
        )
    observed = Observations.build([*unique.values(), *samples], books)
    rows = [evaluate(f, observed, crossings[f["setup"]]) for f in fills]
    for row in rows:
        if row.get("tpCrossing"):
            row["tpCrossing"]["crossingsBounded"] = row["setup"] in bounded
    return {
        "schemaVersion": PROTOCOL,
        "from": bundle["from"],
        "until": bundle["until"],
        "fills": rows,
        "summary": summarize(rows),
        "flightQuotePoints": len(unique),
        "marketEvidence": evidence,
        "brokerAuthority": False,
        "promotion": "HOLD",
        "counterfactualNet": None,
        "causeInference": None,
        "completeTickTape": False,
    }


def pattern_from_entry_review(report: dict[str, Any]) -> dict[str, Any]:
    """#388 pack from the retained sanitized breakout review; close prices are derived.

    The retained review has no closing deal price, so it is reconstructed from canonical
    net, signed fees and volume. Close class compares that price with the recorded
    broker TP; it never uses the sign of P/L and is not the broker's closing reason.
    """
    if report.get("schemaVersion") != "breakout-entry-observer-1.0":
        raise ValueError("TP_PATTERN_INPUT_INVALID")
    closes: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []
    for setup in report["setups"]:
        crossings = setup["tpAudit"].get("crossings", [])
        touch: dict[str, Any] = next(
            (c for c in setup["candidates"] if c["candidate"] == "TOUCH"), {}
        )
        for trade in setup["actualClosedTrades"]:
            side = "BUY" if trade["direction"] == "LONG" else "SELL"
            matches = [e for e in setup["actualEntries"] if e["side"] == side]
            if len(matches) != 1:
                continue
            entry = matches[0]
            fill = number(entry["price"])
            units = number(entry["volume"]) * RETAINED_VOLUME_SCALE
            gross = number(trade["net"]) - number(trade["signed_fees"])
            close = fill + gross / units if side == "BUY" else fill - gross / units
            at = timestamp(trade["closed_at"])
            prior = [c for c in crossings if c["side"] == side and timestamp(c["quoteAt"]) <= at]
            at_tp = None
            if prior:
                tp = number(prior[-1]["brokerTp"])
                at_tp = close >= tp if side == "BUY" else close <= tp
            pattern = tp_crossings(crossings, side, at, at_tp is True)
            quote_side = "bid" if side == "BUY" else "ask"
            closes.append(
                {
                    "setup": setup["setup"],
                    "side": side,
                    "entryFill": plain(fill),
                    "derivedClosePrice": plain(close),
                    "closedAt": at.isoformat(),
                    "net": plain(number(trade["net"])),
                    "signedFees": plain(number(trade["signed_fees"])),
                    "units": plain(units),
                    "closeAtOrBeyondRecordedTp": at_tp,
                    "tpCrossing": pattern,
                    # Only a TP fill is compared with the crossing quote just before it.
                    "closeVersusLastCrossingQuote": plain(
                        adverse(
                            close, number(pattern["lastCrossingBeforeFill"]["mark"]), quote_side
                        )
                    )
                    if pattern and at_tp
                    else None,
                }
            )
        for entry in setup["actualEntries"]:
            side, first = entry["side"], timestamp(entry["firstFill"])
            signal = next(
                (
                    s
                    for s in touch.get("signals", [])
                    if s["side"] == side and s["crossingProvenInObservedQuotes"]
                ),
                None,
            )
            # A first observation after the fill cannot be the quote that triggered it.
            if signal is None or timestamp(signal["firstObservedAt"]) > first:
                continue
            reference_price, fill = (
                number(signal["executableQuoteReference"]),
                number(entry["price"]),
            )
            entries.append(
                {
                    "setup": setup["setup"],
                    "side": side,
                    "trigger": plain(number(signal["level"])),
                    "firstCrossingQuote": plain(reference_price),
                    "fill": plain(fill),
                    "gap": plain(adverse(fill, reference_price, "ask" if side == "BUY" else "bid")),
                    "lagSeconds": plain(
                        Decimal(str((first - timestamp(signal["firstObservedAt"])).total_seconds()))
                    ),
                }
            )
    filled = [c for c in closes if c["tpCrossing"] and c["tpCrossing"]["tpFilled"]]
    unfilled = [c for c in closes if c["tpCrossing"] and not c["tpCrossing"]["tpFilled"]]

    def last(c: dict[str, Any], field: str) -> Decimal:
        return number(c["tpCrossing"]["lastCrossingBeforeFill"][field])

    return {
        "schemaVersion": PATTERN_PROTOCOL,
        "source": {
            "schemaVersion": report["schemaVersion"],
            "bundleSha256": report.get("bundleSha256"),
            "release": report["release"],
            "from": report["from"],
            "until": report["until"],
            "prospective": report.get("prospective", False),
        },
        "closePriceBasis": "DERIVED_FROM_CANONICAL_NET_FEES_AND_VOLUME_NO_SWAP_OR_CONVERSION",
        "volumeScale": plain(RETAINED_VOLUME_SCALE),
        "closes": closes,
        "entries": entries,
        "summary": {
            "closesAtOrBeyondTp": len(filled),
            "closesWithTpCrossingButNoTpFill": len(unfilled),
            "tpFilledLastCrossingExcursion": stats([last(c, "excursionBeyondTp") for c in filled]),
            "tpFilledLagSeconds": stats([last(c, "lagToFillSeconds") for c in filled]),
            "tpFilledFirstCrossingToFillSeconds": stats(
                [number(c["tpCrossing"]["firstCrossingToFillSeconds"]) for c in filled]
            ),
            "tpFilledCloseVersusLastCrossingQuote": stats(
                [number(c["closeVersusLastCrossingQuote"]) for c in filled]
            ),
            "crossedWithoutTpFillMaxExcursion": stats(
                [number(c["tpCrossing"]["maxExcursionBeyondTp"]) for c in unfilled]
            ),
            "entryFillVersusFirstCrossingQuote": stats([number(e["gap"]) for e in entries]),
            "entryLagSeconds": stats([number(e["lagSeconds"]) for e in entries]),
        },
        "selection": "ALL_CLOSES_IN_RETAINED_14_INTENT_COHORT_NOT_PROSPECTIVE",
        "brokerAuthority": False,
        "causeInference": None,
        "counterfactualNet": None,
        "completeTickTape": False,
    }


def load(path: Path) -> Any:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_INPUT:
        raise ValueError("FILL_REVIEW_INPUT_BOUNDS_INVALID")
    return json.loads(path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["review", "pattern"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fills", type=Path)
    parser.add_argument("--recordings", type=Path)
    parser.add_argument("--market", type=Path, action="append", default=[])
    parser.add_argument("--entry-review", type=Path)
    args = parser.parse_args()
    if args.command == "pattern":
        if not args.entry_review:
            raise ValueError("TP_PATTERN_INPUT_REQUIRED")
        result = pattern_from_entry_review(load(args.entry_review))
        result["source"]["sha256"] = hashlib.sha256(args.entry_review.read_bytes()).hexdigest()
    else:
        if not args.fills:
            raise ValueError("FILL_REVIEW_INPUT_REQUIRED")
        result = review(load(args.fills), args.recordings, args.market)
        result["inputSha256"] = hashlib.sha256(args.fills.read_bytes()).hexdigest()
    write_new(args.output, result)


if __name__ == "__main__":
    main()
