"""Same-account XAUUSD daily closed-deal net across bot releases. SELECT only."""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime, time
from decimal import Decimal, localcontext
from typing import Annotated, Any, Literal

import psycopg
from psycopg.rows import dict_row
from pydantic import Field

from python.operations.demo_scorecards import MAX_DEALS, SG, CloseDeal, Day, summarize
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_evidence import Instant, Name, Number


class ReleaseNet(StrictModel):
    release: Name
    recordedNet: Number
    signedFeesIncluded: Number
    closeDeals: Annotated[int, Field(ge=0, le=MAX_DEALS)]


class DailyTradingNet(StrictModel):
    schemaVersion: Literal["daily-trading-net-1.0"] = "daily-trading-net-1.0"
    checkedAt: Instant
    timezone: Literal["Asia/Singapore"] = "Asia/Singapore"
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3,8}$")]
    basis: Literal["RECORDED_CLOSE_DEALS_ALL_BOT_RELEASES_NOT_ACCOUNT_RETURN"] = (
        "RECORDED_CLOSE_DEALS_ALL_BOT_RELEASES_NOT_ACCOUNT_RETURN"
    )
    totals: Day
    releases: Annotated[list[ReleaseNet], Field(max_length=MAX_DEALS)]
    scopeUnresolvedEvents: Annotated[int, Field(ge=0)]
    openJournalPositions: Annotated[int, Field(ge=0)]
    actualModelSpend: None = None
    openBrokerMark: None = None
    accountReturn: None = None
    externalCashflows: None = None
    economicQualification: Literal[False] = False
    brokerAuthority: Literal[False] = False
    promotionAuthority: Literal[False] = False


def summarize_day(
    rows: list[tuple[str, CloseDeal]], now: datetime, currency: str, unresolved: int, opened: int
) -> DailyTradingNet:
    if now.tzinfo is None:
        raise ValueError("DAILY_NET_TIMEZONE_REQUIRED")
    start = datetime.combine(now.astimezone(SG).date(), time(), SG).astimezone(UTC)
    totals = summarize([d for _, d in rows], start, now, currency, unresolved, opened).days[0]
    eligible: dict[str, list[CloseDeal]] = {}
    for release, deal in rows:
        if start <= timestamp(deal.occurredAt) < now and timestamp(deal.recordedAt) <= now:
            eligible.setdefault(release, []).append(deal)
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        releases = [
            ReleaseNet(
                release=release,
                recordedNet=format(sum((Decimal(d.net) for d in deals), Decimal(0)), "f"),
                signedFeesIncluded=format(
                    sum((Decimal(d.signedFeesIncluded) for d in deals), Decimal(0)), "f"
                ),
                closeDeals=len(deals),
            )
            for release, deals in sorted(eligible.items())
        ]
    return DailyTradingNet(
        checkedAt=now.isoformat(),
        currency=currency,
        totals=totals,
        releases=releases,
        scopeUnresolvedEvents=unresolved,
        openJournalPositions=opened,
    )


def load(now: datetime) -> dict[str, Any] | None:
    key, database = os.getenv("ACCOUNT_KEY", ""), os.getenv("DATABASE_URL", "")
    if not key or key == "unconfigured" or not database or os.getenv("TRADING_MODE") != "demo":
        return None
    try:
        if now.tzinfo is None:
            raise ValueError("DAILY_NET_TIMEZONE_REQUIRED")
        start = datetime.combine(now.astimezone(SG).date(), time(), SG).astimezone(UTC)
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
                """SELECT a.id AS account_id,s.id AS symbol_id,a.currency
                FROM accounts a JOIN symbols s ON s.account_id=a.id
                WHERE a.provider='ctrader' AND a.environment='demo' AND s.name='XAUUSD'
                  AND a.provider_account_key_hash=%s""",
                (hashlib.sha256(key.encode()).hexdigest(),),
            )
            identities = cursor.fetchall()
            if len(identities) != 1:
                return None
            identity = identities[0]
            scope = (identity["account_id"], identity["symbol_id"])
            cursor.execute(
                """SELECT v.version,d.occurred_at,d.recorded_at,
                (d.gross_profit+d.commission+d.swap+d.conversion_fee)::text AS net,
                (d.commission+d.swap+d.conversion_fee)::text AS fees
                FROM position_close_deals d JOIN positions p ON p.id=d.position_id
                JOIN order_groups g ON g.id=p.order_group_id
                JOIN analysis_runs a ON a.id=g.analysis_id
                JOIN strategy_versions v ON v.id=a.strategy_version_id
                WHERE d.account_id=%s AND d.symbol_id=%s AND g.mode='demo' AND p.strategy_owned
                  AND a.account_id=d.account_id AND a.symbol_id=d.symbol_id
                  AND p.account_id=d.account_id AND p.symbol_id=d.symbol_id
                  AND d.recorded_at<=%s AND d.occurred_at>=%s AND d.occurred_at<%s
                ORDER BY d.occurred_at,d.broker_deal_id LIMIT %s""",
                (*scope, now, start, now, MAX_DEALS + 1),
            )
            rows = [
                (
                    row["version"],
                    CloseDeal(
                        occurredAt=row["occurred_at"].isoformat(),
                        recordedAt=row["recorded_at"].isoformat(),
                        net=row["net"],
                        signedFeesIncluded=row["fees"],
                    ),
                )
                for row in cursor.fetchall()
            ]
            cursor.execute(
                """SELECT
                (SELECT count(*) FROM broker_execution_events WHERE account_id=%s
                 AND symbol_id=%s AND resolved_at IS NULL
                 AND (mapping_state<>'MAPPED' OR jsonb_array_length(reason_codes)>0)) AS unresolved,
                (SELECT count(*) FROM positions WHERE account_id=%s AND symbol_id=%s
                 AND strategy_owned AND state<>'CLOSED') AS opened""",
                (*scope, *scope),
            )
            state = cursor.fetchone()
            if state is None:
                return None
            return summarize_day(
                rows, now, identity["currency"], state["unresolved"], state["opened"]
            ).model_dump(mode="json")
    except (psycopg.Error, ValueError, TypeError, KeyError):
        return None
