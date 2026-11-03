"""Read-only programme scorecards. Closed deals are not equity or external cashflows."""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, localcontext
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from pydantic import Field, model_validator

from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import Instant, Number

SG = ZoneInfo("Asia/Singapore")
RELEASE: Literal["0.10.0-demo-trials.1-codex.1"] = "0.10.0-demo-trials.1-codex.1"
MAX_DEALS = 5000
Count = Annotated[int, Field(ge=0, le=MAX_DEALS)]


class CloseDeal(StrictModel):
    occurredAt: Instant
    recordedAt: Instant
    net: Number
    signedFeesIncluded: Number

    @model_validator(mode="after")
    def causal_record(self) -> CloseDeal:
        if timestamp(self.occurredAt) > timestamp(self.recordedAt):
            raise ValueError("SCORECARD_CLOSE_CLOCK_UNORDERED")
        return self


class Day(StrictModel):
    day: date
    since: Instant
    until: Instant
    completeCalendarDay: bool
    recordedNet: Number
    signedFeesIncluded: Number
    closeDeals: Count
    winningCloseDeals: Count
    losingCloseDeals: Count
    flatCloseDeals: Count
    worstCloseDeal: Number | None


class Scorecard(StrictModel):
    schemaVersion: Literal["demo-day-scorecard-1.0"] = "demo-day-scorecard-1.0"
    checkedAt: Instant
    since: Instant
    until: Instant
    timezone: Literal["Asia/Singapore"] = "Asia/Singapore"
    release: Literal["0.10.0-demo-trials.1-codex.1"] = RELEASE
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3,8}$")]
    basis: Literal["RECORDED_CLOSE_DEALS_NOT_ACCOUNT_RETURN"] = (
        "RECORDED_CLOSE_DEALS_NOT_ACCOUNT_RETURN"
    )
    days: Annotated[list[Day], Field(min_length=1, max_length=7)]
    recordedNet: Number
    realizedLedgerDrawdownLowerBound: Number
    completePositiveDays: Annotated[int, Field(ge=0, le=7)] | None
    completeNegativeDays: Annotated[int, Field(ge=0, le=7)] | None
    completeFlatDays: Annotated[int, Field(ge=0, le=7)] | None
    scopeUnresolvedEvents: Annotated[int, Field(ge=0)]
    openJournalPositions: Annotated[int, Field(ge=0)]
    externalCashflows: None = None
    openBrokerMark: None = None
    actualModelSpend: None = None
    accountReturn: None = None
    equityDrawdown: None = None
    economicQualification: Literal[False] = False
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False


def bounds(start: datetime, now: datetime) -> tuple[datetime, datetime]:
    if start.tzinfo is None or now.tzinfo is None or start > now:
        raise ValueError("SCORECARD_WINDOW_INVALID")
    first = datetime.combine(now.astimezone(SG).date() - timedelta(days=6), time(), SG)
    return max(first.astimezone(UTC), start.astimezone(UTC)), now.astimezone(UTC)


def summarize(
    deals: list[CloseDeal],
    start: datetime,
    now: datetime,
    currency: str,
    unresolved: int,
    opened: int,
) -> Scorecard:
    lower, upper = bounds(start, now)
    if len(deals) > MAX_DEALS:
        raise ValueError("SCORECARD_DEAL_LIMIT")
    eligible = []
    for d in deals:
        occurred, recorded = timestamp(d.occurredAt), timestamp(d.recordedAt)
        if recorded <= upper and occurred > upper:
            raise ValueError("SCORECARD_FUTURE_BROKER_CLOCK")
        if lower <= occurred < upper and recorded <= upper:
            eligible.append(d)
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        days: list[Day] = []
        cursor = lower
        total = Decimal(0)
        peak = Decimal(0)
        drawdown = Decimal(0)
        # Order within equal broker timestamps is unknowable; aggregate ties.
        marks: dict[datetime, Decimal] = {}
        for d in eligible:
            at = timestamp(d.occurredAt)
            marks[at] = marks.get(at, Decimal(0)) + Decimal(d.net)
        for at in sorted(marks):
            total += marks[at]
            peak = max(peak, total)
            drawdown = max(drawdown, peak - total)
        while cursor < upper or not days or days[-1].day != upper.astimezone(SG).date():
            day = cursor.astimezone(SG).date()
            day_start = datetime.combine(day, time(), SG).astimezone(UTC)
            day_end = day_start + timedelta(days=1)
            end = min(day_end, upper)
            rows = [d for d in eligible if cursor <= timestamp(d.occurredAt) < end]
            net = [Decimal(d.net) for d in rows]
            days.append(
                Day(
                    day=day,
                    since=cursor.isoformat(),
                    until=end.isoformat(),
                    completeCalendarDay=cursor == day_start and end == day_end,
                    recordedNet=format(sum(net, Decimal(0)), "f"),
                    signedFeesIncluded=format(
                        sum((Decimal(d.signedFeesIncluded) for d in rows), Decimal(0)), "f"
                    ),
                    closeDeals=len(rows),
                    winningCloseDeals=sum(v > 0 for v in net),
                    losingCloseDeals=sum(v < 0 for v in net),
                    flatCloseDeals=sum(v == 0 for v in net),
                    worstCloseDeal=format(min(net), "f") if net else None,
                )
            )
            cursor = end
        complete = [d for d in days if d.completeCalendarDay]
        return Scorecard(
            checkedAt=upper.isoformat(),
            since=lower.isoformat(),
            until=upper.isoformat(),
            currency=currency,
            days=days,
            recordedNet=format(total, "f"),
            realizedLedgerDrawdownLowerBound=format(drawdown, "f"),
            completePositiveDays=None
            if unresolved
            else sum(Decimal(d.recordedNet) > 0 for d in complete),
            completeNegativeDays=None
            if unresolved
            else sum(Decimal(d.recordedNet) < 0 for d in complete),
            completeFlatDays=None
            if unresolved
            else sum(Decimal(d.recordedNet) == 0 for d in complete),
            scopeUnresolvedEvents=unresolved,
            openJournalPositions=opened,
        )


def load(now: datetime) -> dict[str, Any] | None:
    """One bounded repeatable-read snapshot, using existing dashboard credentials."""
    key, database = os.getenv("ACCOUNT_KEY", ""), os.getenv("DATABASE_URL", "")
    if not key or key == "unconfigured" or not database or os.getenv("TRADING_MODE") != "demo":
        return None
    try:
        with (
            psycopg.connect(
                database,
                row_factory=dict_row,
                connect_timeout=2,
                options="-c statement_timeout=1500 -c default_transaction_read_only=on",
            ) as connection,
            connection.cursor() as cursor,
        ):
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            cursor.execute(
                """SELECT a.id AS account_id,s.id AS symbol_id,a.currency,
                (SELECT min(t.starts_at) FROM demo_trials t WHERE t.account_id=a.id
                 AND t.symbol_id=s.id AND t.mode='demo') AS starts_at
                FROM accounts a JOIN symbols s ON s.account_id=a.id
                WHERE a.provider='ctrader' AND a.environment='demo' AND s.name='XAUUSD'
                  AND a.provider_account_key_hash=%s""",
                (hashlib.sha256(key.encode()).hexdigest(),),
            )
            identities = cursor.fetchall()
            if len(identities) != 1 or identities[0]["starts_at"] is None:
                return None
            identity = identities[0]
            start, until = bounds(identity["starts_at"], now)
            scope = (identity["account_id"], identity["symbol_id"])
            cursor.execute(
                """SELECT d.occurred_at,d.recorded_at,
                (d.gross_profit+d.commission+d.swap+d.conversion_fee)::text AS net,
                (d.commission+d.swap+d.conversion_fee)::text AS fees
                FROM position_close_deals d JOIN positions p ON p.id=d.position_id
                JOIN order_groups g ON g.id=p.order_group_id
                JOIN analysis_runs a ON a.id=g.analysis_id
                JOIN strategy_versions v ON v.id=a.strategy_version_id
                JOIN demo_trial_contexts dc ON dc.context_id=g.context_plan_id
                JOIN demo_trials t ON t.id=dc.trial_id
                WHERE d.account_id=%s AND d.symbol_id=%s AND g.mode='demo'
                  AND v.version=%s AND t.account_id=d.account_id AND t.symbol_id=d.symbol_id
                  AND a.account_id=d.account_id AND a.symbol_id=d.symbol_id
                  AND p.account_id=d.account_id AND p.symbol_id=d.symbol_id
                  AND t.strategy_version_id=a.strategy_version_id AND t.mode='demo'
                  AND d.recorded_at<=%s AND d.occurred_at>=%s
                ORDER BY d.occurred_at,d.broker_deal_id LIMIT %s""",
                (*scope, RELEASE, until, start, MAX_DEALS + 1),
            )
            deals = [
                CloseDeal(
                    occurredAt=r["occurred_at"].isoformat(),
                    recordedAt=r["recorded_at"].isoformat(),
                    net=r["net"],
                    signedFeesIncluded=r["fees"],
                )
                for r in cursor.fetchall()
            ]
            cursor.execute(
                """SELECT
                (SELECT count(*) FROM broker_execution_events WHERE account_id=%s
                 AND symbol_id=%s AND resolved_at IS NULL
                 AND (mapping_state<>'MAPPED' OR jsonb_array_length(reason_codes)>0)) AS unresolved,
                (SELECT count(*) FROM positions WHERE account_id=%s AND symbol_id=%s
                 AND state<>'CLOSED') AS opened""",
                (*scope, *scope),
            )
            state = cursor.fetchone()
            if state is None:
                return None
            return summarize(
                deals,
                identity["starts_at"],
                until,
                identity["currency"],
                state["unresolved"],
                state["opened"],
            ).model_dump(mode="json")
    except (psycopg.Error, ValueError, TypeError, KeyError):
        return None
