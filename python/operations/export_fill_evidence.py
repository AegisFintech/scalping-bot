"""SELECT-only bounded per-deal fill export for quote-to-fill diagnostics. No broker IDs."""

from __future__ import annotations

import argparse
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from python.backtest.breakout_entry_review import write_new
from python.operations.entry_context import timestamp

if TYPE_CHECKING:
    import psycopg

MAX_FILLS = 10000
SCHEMA_VERSION = "fill-evidence-input-1.0"

# Entry deals carry their order; broker-generated closing deals carry only the position.
FILLS_SQL = """
SELECT * FROM (
  SELECT substr(encode(sha256(convert_to(g.id::text,'UTF8')),'hex'),1,24) setup,
    sv.version origin_release,'ENTRY' kind,o.side,o.execution_order_type,
    o.entry_price::text trigger_price,NULL::text position_entry_price,
    f.price::text fill_price,f.volume::text fill_volume,f.occurred_at,f.received_at,
    (SELECT min(e.occurred_at) FROM broker_execution_events e
      WHERE e.order_id=o.id AND e.order_group_id=o.order_group_id
        AND e.mapping_state='MAPPED' AND e.execution_type=2 AND NOT e.closing_order)
      broker_accepted_at,
    NULL::integer closing_order_type,NULL::boolean external_intervention,
    NULL::text broker_sl,NULL::text broker_tp,NULL::timestamptz protection_observed_at,
    sy.volume_scale::text volume_scale,sy.tick_size::text tick_size
  FROM fills f JOIN orders o ON o.id=f.order_id
  JOIN order_groups g ON g.id=o.order_group_id
  JOIN analysis_runs a ON a.id=g.analysis_id
  JOIN accounts ac ON ac.id=a.account_id JOIN symbols sy ON sy.id=a.symbol_id
  JOIN strategy_versions sv ON sv.id=a.strategy_version_id
  WHERE ac.provider_account_key_hash=%(account)s AND ac.environment='demo'
    AND sy.name=%(symbol)s AND g.mode='demo' AND a.mode='demo' AND o.strategy_owned
    AND f.occurred_at >= %(start)s AND f.occurred_at < %(until)s
  UNION ALL
  SELECT substr(encode(sha256(convert_to(g.id::text,'UTF8')),'hex'),1,24) setup,
    sv.version origin_release,'CLOSE' kind,p.side,NULL::text execution_order_type,
    NULL::text trigger_price,p.entry_price::text position_entry_price,
    f.price::text fill_price,f.volume::text fill_volume,f.occurred_at,f.received_at,
    NULL::timestamptz broker_accepted_at,
    (SELECT e.broker_order_type FROM broker_execution_events e
      WHERE e.account_id=p.account_id AND e.broker_fill_id=f.broker_fill_id
        AND e.closing_order AND e.mapping_state='MAPPED'
      ORDER BY e.received_at,e.id LIMIT 1) closing_order_type,
    d.external_intervention,pp.stop_loss::text broker_sl,pp.take_profit::text broker_tp,
    pp.observed_at protection_observed_at,
    sy.volume_scale::text volume_scale,sy.tick_size::text tick_size
  FROM fills f JOIN positions p ON p.id=f.position_id
  JOIN order_groups g ON g.id=p.order_group_id
  JOIN analysis_runs a ON a.id=g.analysis_id
  JOIN accounts ac ON ac.id=a.account_id AND ac.id=p.account_id
  JOIN symbols sy ON sy.id=a.symbol_id AND sy.id=p.symbol_id
  JOIN strategy_versions sv ON sv.id=a.strategy_version_id
  LEFT JOIN position_close_deals d ON d.account_id=p.account_id AND d.position_id=p.id
    AND d.broker_deal_id=f.broker_fill_id
  LEFT JOIN position_protection pp ON pp.position_id=p.id
  WHERE f.order_id IS NULL AND p.strategy_owned
    AND ac.provider_account_key_hash=%(account)s AND ac.environment='demo'
    AND sy.name=%(symbol)s AND g.mode='demo' AND a.mode='demo'
    AND f.occurred_at >= %(start)s AND f.occurred_at < %(until)s
) rows ORDER BY occurred_at,kind DESC,setup,side LIMIT 10001
"""


def text(value: Any) -> str | None:
    return None if value is None else str(value)


def instant(value: Any) -> str | None:
    return None if value is None else timestamp(value).isoformat()


def project(row: dict[str, Any]) -> dict[str, Any]:
    """Decimal strings and UTC times only; hashed setup keys, never broker identifiers."""
    return {
        "setup": row["setup"],
        "originRelease": row["origin_release"],
        "kind": row["kind"],
        "side": row["side"],
        "executionOrderType": row["execution_order_type"],
        "triggerPrice": text(row["trigger_price"]),
        "positionEntryPrice": text(row["position_entry_price"]),
        "fillPrice": text(row["fill_price"]),
        "fillVolume": text(row["fill_volume"]),
        "volumeScale": text(row["volume_scale"]),
        "tickSize": text(row["tick_size"]),
        "occurredAt": instant(row["occurred_at"]),
        "receivedAt": instant(row["received_at"]),
        "brokerAcceptedAt": instant(row["broker_accepted_at"]),
        "closingOrderType": row["closing_order_type"],
        "externalIntervention": row["external_intervention"],
        "brokerStopLoss": text(row["broker_sl"]),
        "brokerTakeProfit": text(row["broker_tp"]),
        "protectionObservedAt": instant(row["protection_observed_at"]),
    }


def export(
    connection: psycopg.Connection[dict[str, Any]],
    account: str,
    symbol: str,
    start: datetime,
    until: datetime,
) -> dict[str, Any]:
    if (
        not re.fullmatch(r"[a-f0-9]{64}", account)
        or not re.fullmatch(r"[A-Z0-9._-]{1,32}", symbol)
        or not start < until <= datetime.now(UTC)
        or until - start > timedelta(days=31)
    ):
        raise ValueError("FILL_EXPORT_SCOPE_INVALID")
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        rows = connection.execute(
            FILLS_SQL, {"account": account, "symbol": symbol, "start": start, "until": until}
        ).fetchall()
    if len(rows) > MAX_FILLS:
        raise ValueError("FILL_EXPORT_LIMIT")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "from": start.isoformat(),
        "until": until.isoformat(),
        "exportedAt": datetime.now(UTC).isoformat(),
        "snapshotScope": "SINGLE_REPEATABLE_READ",
        "fills": [project(row) for row in rows],
        "brokerAuthority": False,
        "counterfactualNet": None,
    }


def main() -> None:
    import psycopg
    from psycopg.rows import dict_row

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=15000",
    ) as connection:
        result = export(
            connection,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            timestamp(args.start),
            timestamp(args.until),
        )
    write_new(args.output, result)


if __name__ == "__main__":
    main()
