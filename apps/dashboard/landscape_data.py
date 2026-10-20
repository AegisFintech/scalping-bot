"""Bounded, scoped lifecycle reads. No commands or raw broker/provider payloads."""

from collections.abc import Callable
from typing import Any


def landscape_events(
    rows: Callable[..., list[dict[str, Any]]], scope: tuple[Any, ...]
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for kind, sql in [
        (
            "context",
            """SELECT id,requested_at,available_at,completed_at,state,reason
            FROM scenario_contexts WHERE account_id=%s AND symbol_id=%s AND mode=%s
            ORDER BY requested_at DESC,id DESC LIMIT 12""",
        ),
        (
            "analysis",
            """SELECT id,updated_at,state,rejection_reasons,deferral_reason
            FROM analysis_runs WHERE account_id=%s AND symbol_id=%s AND mode=%s
            ORDER BY updated_at DESC,id DESC LIMIT 24""",
        ),
        (
            "broker",
            """SELECT be.id,be.received_at,be.occurred_at,be.mapping_state,
              be.normalized_payload->'order'->>'state' AS order_state,
              be.normalized_payload->'position'->>'state' AS position_state
            FROM broker_execution_events be JOIN order_groups og ON og.id=be.order_group_id
            WHERE be.account_id=%s AND be.symbol_id=%s AND og.mode=%s
            ORDER BY be.received_at DESC,be.id DESC LIMIT 32""",
        ),
        (
            "close",
            """SELECT t.id,t.closed_at,t.realized_pnl
            FROM trades t JOIN order_groups og ON og.id=t.order_group_id
            JOIN analysis_runs ar ON ar.id=og.analysis_id
            WHERE ar.account_id=%s AND ar.symbol_id=%s AND t.mode=%s
            ORDER BY t.closed_at DESC,t.id DESC LIMIT 16""",
        ),
    ]:
        output.extend(dict(row, kind=kind) for row in rows(sql, scope))
    return output
