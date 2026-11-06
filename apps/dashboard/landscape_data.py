"""Bounded, scoped lifecycle reads. No commands or raw broker/provider payloads."""

import json
from collections.abc import Callable
from typing import Any

from apps.dashboard.command_data import provider_candles


def history_note(value: object) -> str | None:
    """Recorded tail flags/counts only; never execution qualification or model reasoning."""
    if not isinstance(value, str) or len(value.encode("utf-8")) > 128000:
        return None
    try:
        candles = provider_candles(json.loads(value))
        notes = []
        for frame, required in [("M1", 6), ("M5", 12), ("M15", 12)]:
            tail = [row for row in candles if row["timeframe"] == frame][-required:]
            flags = [row["quality_flags"] for row in tail]
            if any(
                not isinstance(f, list) or any(not isinstance(v, str) for v in f) for f in flags
            ):
                return None
            if len(tail) < required:
                notes.append(f"{frame} {len(tail)}/{required} completed bars")
            if any(flags):
                label = (
                    "session gap"
                    if any("BROKER_SESSION_GAP_BEFORE" in f for f in flags)
                    else "quality flags"
                )
                notes.append(f"{frame} recorded {label}")
        return "; ".join(notes)
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
        return None


def landscape_events(
    rows: Callable[..., list[dict[str, Any]]], scope: tuple[Any, ...]
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for kind, sql in [
        (
            "mode",
            """SELECT revision AS id,recorded_at,entry_mode FROM entry_mode_changes
            WHERE account_id=%s AND symbol_id=%s AND environment=%s
            ORDER BY recorded_at DESC,revision DESC LIMIT 12""",
        ),
        (
            "context",
            """SELECT sc.id,sc.requested_at,sc.available_at,sc.completed_at,
              sc.state,sc.reason,sc.requested_model,
              sc.plan->>'schema_version' AS plan_schema, sc.plan->>'entry_side' AS entry_side,
              CASE WHEN sc.plan->>'schema_version' IN
                ('entry-wait-1.0','entry-direction-1.0','entry-modes-1.0','entry-scalp-1.0')
                THEN left(sc.plan->>'reason',1200) END AS wait_reason,
              sv.version='0.11.0-trend-retest.1-codex.1' AS trend_context,
              CASE WHEN sv.version='0.11.0-trend-retest.1-codex.1'
                AND octet_length(ce.request_text)<=128000
                THEN ce.request_text END AS provider_input
            FROM (SELECT id,requested_at,available_at,completed_at,state,reason,
              requested_model,plan,source_analysis_id FROM scenario_contexts
              WHERE account_id=%s AND symbol_id=%s AND mode=%s
              ORDER BY requested_at DESC,id DESC LIMIT 12) sc
            JOIN analysis_runs ar ON ar.id=sc.source_analysis_id
            JOIN strategy_versions sv ON sv.id=ar.strategy_version_id
            LEFT JOIN context_provider_evidence ce ON ce.context_id=sc.id
            ORDER BY sc.requested_at DESC,sc.id DESC""",
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
              be.normalized_payload->'position'->>'state' AS position_state,
              (be.closing_order AND be.broker_order_type=1
                AND COALESCE(be.client_order_id,'') NOT LIKE 'cas-%%') AS external_close
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
        for row in rows(sql, scope):
            event = dict(row, kind=kind)
            raw_input = event.pop("provider_input", None)
            if kind == "context" and event.get("trend_context") is True:
                event["history_note"] = history_note(raw_input)
            output.append(event)
    return output
