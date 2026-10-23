"""Read-only dashboard snapshot, loaded off the rendering thread."""

import hashlib
import os
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx
import psycopg
from psycopg.rows import dict_row

from apps.dashboard.command_data import command_data
from apps.dashboard.landscape_data import landscape_events
from apps.dashboard.position_monitor import DecisionViewError, open_position_monitor_view


def api_url() -> str:
    value = os.getenv("EXECUTION_API_URL", "http://127.0.0.1:8080")
    parsed = urlparse(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
    ):
        raise ValueError("CONTROL_ENDPOINT_INVALID")
    return value.rstrip("/")


def api(path: str) -> dict[str, Any]:
    response = httpx.get(api_url() + path, timeout=5)
    response.raise_for_status()
    value = response.json()
    if not isinstance(value, dict):
        raise ValueError("API_SHAPE_INVALID")
    return value


def load_snapshot() -> dict[str, Any]:
    result: dict[str, Any] = {"captured_at": datetime.now(UTC), "warnings": []}
    try:
        status = api("/v1/status")
    except (httpx.HTTPError, ValueError):
        status = {"unavailable": True}
    result["status"] = status
    if not status.get("unavailable"):
        try:
            result["monitor"] = open_position_monitor_view(api("/v1/open-position-monitor"))
        except (httpx.HTTPError, ValueError, DecisionViewError):
            result["monitor"] = {"status": "UNAVAILABLE"}
    mode = str(status.get("mode", "unknown")).lower()
    symbol = str(status.get("symbol", ""))
    account_environment = (
        "paper"
        if mode in {"paper", "backtest", "replay"}
        else str(status.get("accountType", "unknown"))
    )
    account_key = os.getenv("ACCOUNT_KEY", "")
    database = os.getenv("DATABASE_URL", "")
    if not account_key or account_key == "unconfigured" or not database or mode == "unknown":
        result["warnings"].append(
            "Account history is unavailable; its scope could not be verified."
        )
        return result
    try:
        with (
            psycopg.connect(
                database,
                row_factory=dict_row,
                connect_timeout=5,
                options="-c statement_timeout=8000 -c default_transaction_read_only=on",
            ) as connection,
            connection.cursor() as cursor,
        ):

            def rows(sql: str, parameters: tuple[object, ...] = ()) -> list[dict[str, Any]]:
                cursor.execute(sql, parameters)
                return list(cursor.fetchall())

            identities = rows(
                """SELECT s.id AS symbol_id, a.id AS account_id, a.currency
                FROM symbols s JOIN accounts a ON a.id=s.account_id
                WHERE a.provider_account_key_hash=%s AND a.environment=%s AND s.name=%s""",
                (hashlib.sha256(account_key.encode()).hexdigest(), account_environment, symbol),
            )
            if len(identities) != 1:
                raise ValueError("ACCOUNT_SCOPE_AMBIGUOUS")
            identity = identities[0]
            scope = (identity["account_id"], identity["symbol_id"], mode)
            # IDs are only bind parameters; presentation receives currency, not account IDs.
            data: dict[str, Any] = {"currency": identity["currency"]}
            daily = rows(
                "SELECT trading_day, current_equity, baseline_equity, loss_percent, "
                "realized_pnl, "
                "unrealized_pnl, locked_out, reconciled_at FROM daily_risk_state "
                "WHERE account_id=%s "
                "ORDER BY trading_day DESC LIMIT 1",
                (scope[0],),
            )
            data["daily"] = daily[0] if daily else {}
            data["capital"] = {}
            if rows("SELECT to_regclass('capital_risk_state') AS present")[0]["present"]:
                capital = rows(
                    "SELECT risk_multiplier, drawdown_percent, updated_at "
                    "FROM capital_risk_state WHERE account_id=%s",
                    (scope[0],),
                )
                data["capital"] = capital[0] if capital else {}
                data["capital"]["risk_policy"] = status.get("riskPolicy", {})
                if "remainingCapitalRiskPercent" in status:
                    data["capital"]["risk_cap_percent"] = status["remainingCapitalRiskPercent"]
            data["positions"] = rows(
                """SELECT p.side, p.state, p.volume, p.entry_price,
                    CASE WHEN og.mode='paper' THEN p.stop_loss
                      ELSE pp.stop_loss END AS stop_loss,
                    CASE WHEN og.mode='paper' THEN p.take_profit
                      ELSE pp.take_profit END AS take_profit,
                    CASE WHEN og.mode='paper' THEN 'SIMULATED'
                      ELSE pp.status END AS protection_status,
                    pp.observed_at AS protection_observed_at, p.updated_at
                FROM positions p JOIN order_groups og ON og.id=p.order_group_id
                LEFT JOIN position_protection pp ON pp.position_id=p.id
                WHERE p.account_id=%s AND p.symbol_id=%s AND og.mode=%s AND p.state <> 'CLOSED'
                ORDER BY p.updated_at DESC LIMIT 20""",
                scope,
            )
            data["orders"] = rows(
                """SELECT o.side, o.state, o.entry_price, o.stop_loss,
                    o.take_profit, o.normalized_volume AS volume, o.time_in_force, o.expires_at,
                    o.execution_order_type
                FROM orders o JOIN order_groups og ON og.id=o.order_group_id
                JOIN analysis_runs ar ON ar.id=og.analysis_id
                WHERE ar.account_id=%s AND ar.symbol_id=%s AND og.mode=%s
                AND o.state IN
                ('INTENT','SUBMITTING','PENDING','PARTIALLY_FILLED','CANCEL_PENDING','UNKNOWN')
                ORDER BY o.updated_at DESC LIMIT 20""",
                scope,
            )
            data.update(command_data(rows, scope))
            data["events"] = landscape_events(rows, scope)
            result.update(data)
    except (psycopg.Error, ValueError):
        result["warnings"].append(
            "Account data is unavailable; do not assume there is no exposure."
        )
    return result
