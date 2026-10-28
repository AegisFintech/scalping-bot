"""Bounded SELECT-only current journal/Flight observations. No execution authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from itertools import islice
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from python.codex_entry.service import PayloadScalp
from python.operations.entry_context import timestamp
from python.research import learning_evidence as contract

if TYPE_CHECKING:
    import psycopg

MAX_RELATED = 500
MAX_INPUT_BYTES = 128_000
BROKER_FIELDS = """id,payload_hash,execution_type,mapping_state,closing_order,broker_order_type,
order_id,position_id,occurred_at,received_at,persisted_at,resolved_at,reason_codes"""


def instant(value: Any) -> str | None:
    return None if value is None else timestamp(value).isoformat()


def number(value: Any) -> str | None:
    return (
        None if value is None else format(value, "f") if isinstance(value, Decimal) else str(value)
    )


def opaque(value: Any) -> str | None:
    return None if value is None else contract.identity(value)


def recorded_hash(value: Any) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) else None


def reasons(values: Any) -> list[str]:
    if not isinstance(values, list) or len(values) > 100:
        raise ValueError("LEARNING_REASON_LIMIT")
    return sorted(
        {
            v
            if isinstance(v, str) and re.fullmatch(r"[A-Z][A-Z0-9_:.-]{0,159}", v)
            else "UNSTRUCTURED_REASON_WITHHELD"
            for v in values
        }
    )


def role(row: dict[str, Any], start: datetime, until: datetime, *, active: bool = False) -> str:
    if any(start <= timestamp(row[k]) < until for k in ("created_at", "updated_at") if row.get(k)):
        return "OBSERVED_WINDOW"
    return "CARRY_IN" if active else "LINKED_REFERENCE"


def broker(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": opaque(row["id"]),
        "payloadSha256": row["payload_hash"],
        "executionType": row["execution_type"],
        "mappingState": row["mapping_state"],
        "closingOrder": row["closing_order"],
        "orderType": row["broker_order_type"],
        "orderId": opaque(row["order_id"]),
        "positionId": opaque(row["position_id"]),
        "occurredAt": instant(row["occurred_at"]),
        "receivedAt": instant(row["received_at"]),
        "persistedAt": instant(row["persisted_at"]),
        "resolvedAt": instant(row["resolved_at"]),
        "reasonCodes": reasons(row["reason_codes"]),
        "clockStatus": contract.clock_status(
            instant(row["occurred_at"]), instant(row["received_at"]), instant(row["persisted_at"])
        ),
    }


def context(row: dict[str, Any], cohort_role: str) -> dict[str, Any]:
    plan = row["plan"] if isinstance(row["plan"], dict) else {}
    schema = plan.get("schema_version")
    ready = row["state"] == "READY"
    selected = plan.get("entry_side") if ready and schema == "entry-scalp-1.0" else None
    decision = "WAIT" if ready and schema == "entry-wait-1.0" else selected or "UNKNOWN"
    unavailable: list[str] = []
    market = None
    if row.get("provider_input") is not None:
        try:
            market = PayloadScalp.model_validate_json(row["provider_input"]).model_dump()
            if timestamp(market["captured_at"]) != timestamp(row["captured_at"]):
                market = None
                unavailable.append("MARKET_CAPTURE_MISMATCH")
        except (ValidationError, ValueError, TypeError):
            unavailable.append("MARKET_INPUT_UNSUPPORTED_OR_INVALID")
    else:
        unavailable.append("MARKET_INPUT_MISSING_OR_OVERSIZED")
    narrative = plan.get("reason")
    return contract.revised(
        {
            "id": opaque(row["id"]),
            "originRelease": row["origin_release"],
            "recordedCodeHash": recorded_hash(row.get("recorded_code_hash")),
            "recordedConfigHash": recorded_hash(row.get("recorded_config_hash")),
            "cohortRole": cohort_role,
            "sourceAnalysisId": opaque(row["source_analysis_id"]),
            "refreshAfterContextId": opaque(row.get("refresh_after_context_id")),
            "refreshAfterEntryContextId": opaque(row.get("refresh_after_entry_context_id")),
            "refreshAfterWaitContextId": opaque(row.get("refresh_after_wait_context_id")),
            "consumedBySetupId": opaque(row.get("consumed_by_setup_id")),
            "retiredAt": instant(row.get("retired_at")),
            "retirementReasonCodes": reasons(row.get("retirement_reasons") or []),
            "state": row["state"],
            "requestedAt": instant(row["requested_at"]),
            "capturedAt": instant(row["captured_at"]),
            "availableAt": instant(row["available_at"]),
            "completedAt": instant(row["completed_at"]),
            "validUntil": instant(row["valid_until"]),
            "clockStatus": contract.context_clock(
                timestamp(row["captured_at"]).isoformat(),
                timestamp(row["requested_at"]).isoformat(),
                instant(row["available_at"]),
                instant(row["completed_at"]),
                timestamp(row["valid_until"]).isoformat(),
            ),
            "decision": decision,
            "requestedModel": row["requested_model"],
            "returnedModel": None,
            "providerCost": None,
            "failureCode": reasons([row["reason"]])[0] if row["reason"] is not None else None,
            "narrativeSha256": hashlib.sha256(narrative.encode()).hexdigest()
            if isinstance(narrative, str)
            else None,
            "promptVersion": row["prompt_version"],
            "promptSha256": row["prompt_sha256"],
            "requestSha256": row["request_sha256"],
            "responseSha256": row["response_sha256"],
            "planSchema": schema,
            "entryPrice": plan.get("buy_stop" if selected == "BUY" else "sell_stop")
            if selected
            else None,
            "takeProfit": plan.get("take_profit") if selected else None,
            "stopLoss": plan.get("stop_loss") if selected else None,
            "pendingSeconds": plan.get("pending_seconds") if selected else None,
            "market": market,
            "unavailableReasons": unavailable,
        }
    )


def export(
    connection: psycopg.Connection[dict[str, Any]],
    account: str,
    symbol: str,
    source: str,
    start: datetime,
    until: datetime,
    *,
    flight_directory: Path | None = None,
) -> contract.LearningEvidence:
    if (
        not re.fullmatch(r"[a-f0-9]{64}", account)
        or not re.fullmatch(r"[A-Z0-9._-]{1,32}", symbol)
        or not re.fullmatch(r"[a-zA-Z0-9._-]{1,80}", source)
        or start.tzinfo is None
        or until.tzinfo is None
        or not start < until <= datetime.now(UTC)
        or until - start > timedelta(hours=1)
    ):
        raise ValueError("LEARNING_EXPORT_SCOPE_INVALID")
    deadline = time.monotonic() + 40

    def read(query: str, args: Any, limit: int = MAX_RELATED) -> list[dict[str, Any]]:
        if time.monotonic() > deadline:
            raise ValueError("LEARNING_EXPORT_DEADLINE")
        rows = connection.execute(query + f" LIMIT {limit + 1}", args).fetchall()
        if len(rows) > limit:
            raise ValueError("LEARNING_EXPORT_ROW_LIMIT")
        return rows

    setups, analyses, contexts = [], [], []
    warnings = [
        "JOURNAL_NOT_ALL_MARKET_OPPORTUNITIES",
        "SAMPLED_QUOTES_NOT_COMPLETE_TICK_TAPE",
        "RECORDED_MODEL_QUOTES_NOT_PER_SIDE_FRESHNESS_EVIDENCE",
        "PROVIDER_IDENTITY_AND_BILLING_UNATTESTED_OR_NOT_EXPORTED",
    ]
    with connection.transaction():
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        connection.execute("SET LOCAL statement_timeout='10s'")
        snapshot_row = connection.execute("SELECT clock_timestamp() at").fetchone()
        if snapshot_row is None:
            raise ValueError("LEARNING_SNAPSHOT_UNAVAILABLE")
        snapshot = snapshot_row["at"]
        scopes = read(
            """SELECT a.id account_id,s.id symbol_id,a.currency,s.volume_scale,s.metadata_at
            FROM accounts a JOIN symbols s ON s.account_id=a.id
            WHERE a.provider='ctrader' AND a.provider_account_key_hash=%s
              AND a.environment='demo' AND a.account_type='demo' AND s.name=%s""",
            (account, symbol),
            1,
        )
        if len(scopes) != 1:
            raise ValueError("LEARNING_EXPORT_SCOPE_UNAVAILABLE")
        scope = scopes[0]
        aid, sid = scope["account_id"], scope["symbol_id"]
        groups = read(
            """SELECT g.*,sv.version origin_release,
            sv.code_hash recorded_code_hash,sv.config_hash recorded_config_hash FROM order_groups g
            JOIN analysis_runs a ON a.id=g.analysis_id
            JOIN strategy_versions sv ON sv.id=a.strategy_version_id
            WHERE a.account_id=%s AND a.symbol_id=%s AND a.mode='demo' AND g.mode='demo'
              AND ((g.created_at >= %s AND g.created_at < %s)
                OR (g.updated_at >= %s AND g.updated_at < %s)
                OR g.state NOT IN ('CLOSED','FAILED','EXPIRED')
                OR EXISTS(SELECT 1 FROM broker_execution_events e WHERE e.order_group_id=g.id
                  AND e.persisted_at >= %s AND e.persisted_at < %s))
            ORDER BY g.created_at,g.id""",
            (aid, sid, start, until, start, until, start, until),
            100,
        )
        group_analysis = [g["analysis_id"] for g in groups]
        analysis_rows = read(
            """SELECT a.*,sv.version origin_release,
            sv.code_hash recorded_code_hash,sv.config_hash recorded_config_hash FROM analysis_runs a
            JOIN strategy_versions sv ON sv.id=a.strategy_version_id
            WHERE a.account_id=%s AND a.symbol_id=%s AND a.mode='demo'
              AND ((a.created_at >= %s AND a.created_at < %s)
                OR (a.updated_at >= %s AND a.updated_at < %s) OR a.id=ANY(%s::uuid[]))
            ORDER BY a.created_at,a.id""",
            (aid, sid, start, until, start, until, group_analysis),
            1000,
        )
        analysis_ids = [a["id"] for a in analysis_rows]
        context_rows = read(
            """SELECT c.*,sv.version origin_release,pa.version prompt_version,
              sv.code_hash recorded_code_hash,sv.config_hash recorded_config_hash,
              e.prompt_sha256,e.request_sha256,e.response_sha256,g.id consumed_by_setup_id,
              r.recorded_at retired_at,r.evidence->'reasonCodes' retirement_reasons,
              CASE WHEN octet_length(e.request_text)<=128000 THEN e.request_text END provider_input
            FROM scenario_contexts c JOIN analysis_runs a ON a.id=c.source_analysis_id
            JOIN strategy_versions sv ON sv.id=a.strategy_version_id
            LEFT JOIN context_provider_evidence e ON e.context_id=c.id
            LEFT JOIN provider_prompt_artifacts pa ON pa.content_sha256=e.prompt_sha256
            LEFT JOIN context_entry_retirements r ON r.context_id=c.id
            LEFT JOIN order_groups g ON g.context_plan_id=c.id
            WHERE c.account_id=%s AND c.symbol_id=%s AND c.mode='demo'
              AND ((c.requested_at >= %s AND c.requested_at < %s)
                OR (c.completed_at >= %s AND c.completed_at < %s)
                OR (r.recorded_at >= %s AND r.recorded_at < %s)
                OR c.state='REQUESTING' OR c.source_analysis_id=ANY(%s::uuid[])
                OR c.id IN (SELECT context_plan_id FROM order_groups
                  WHERE analysis_id=ANY(%s::uuid[]))
                OR c.id IN (SELECT context_plan_id FROM model_requests
                  WHERE analysis_id=ANY(%s::uuid[])))
            ORDER BY c.requested_at,c.id""",
            (
                aid,
                sid,
                start,
                until,
                start,
                until,
                start,
                until,
                analysis_ids,
                analysis_ids,
                analysis_ids,
            ),
            100,
        )
        for c in context_rows:
            observed = (
                start <= c["requested_at"] < until
                or (c["completed_at"] is not None and start <= c["completed_at"] < until)
                or (c["retired_at"] is not None and start <= c["retired_at"] < until)
            )
            contexts.append(context(c, "OBSERVED_WINDOW" if observed else "LINKED_REFERENCE"))
        for a in analysis_rows:
            risk_rows = read(
                "SELECT * FROM risk_decisions WHERE analysis_id=%s ORDER BY side", (a["id"],), 2
            )
            links = read(
                """SELECT id FROM scenario_contexts WHERE source_analysis_id=%s
                UNION SELECT context_plan_id id FROM model_requests
                WHERE analysis_id=%s AND context_plan_id IS NOT NULL""",
                (a["id"], a["id"]),
                20,
            )
            analyses.append(
                contract.revised(
                    {
                        "id": opaque(a["id"]),
                        "originRelease": a["origin_release"],
                        "recordedCodeHash": recorded_hash(a.get("recorded_code_hash")),
                        "recordedConfigHash": recorded_hash(a.get("recorded_config_hash")),
                        "cohortRole": role(a, start, until),
                        "state": a["state"],
                        "analysisAt": instant(a["analysis_time"]),
                        "persistedAt": instant(a["created_at"]),
                        "updatedAt": instant(a["updated_at"]),
                        "contextIds": sorted(opaque(r["id"]) for r in links),
                        "reasonCodes": reasons(
                            a["eligibility_reasons"]
                            + a["rejection_reasons"]
                            + ([a["deferral_reason"]] if a["deferral_reason"] else [])
                        ),
                        "risk": [
                            {
                                "side": r["side"],
                                "approved": r["approved"],
                                "equity": number(r["equity"]),
                                "riskPercent": number(r["risk_percent"]),
                                "approvedBudget": number(r["risk_budget"]),
                                "entryPrice": number(r["entry_price"]),
                                "stopLoss": number(r["stop_loss"]),
                                "stopDistance": number(r["stop_distance"]),
                                "normalizedVolume": number(r["normalized_volume"]),
                                "estimatedMargin": number(r["estimated_margin"]),
                                "decidedAt": instant(r["decided_at"]),
                                "reasonCodes": reasons(r["reason_codes"]),
                                "actualFilledStopRisk": None,
                            }
                            for r in risk_rows
                        ],
                    }
                )
            )
        for g in groups:
            setups.append(setup(g, scope, start, until, read))
        unscoped = read(
            f"""SELECT {BROKER_FIELDS} FROM broker_execution_events
            WHERE account_id=%s AND symbol_id=%s
            AND order_group_id IS NULL AND ((persisted_at >= %s AND persisted_at < %s)
              OR (mapping_state IN ('UNMATCHED','CONFLICT') AND resolved_at IS NULL))
            ORDER BY persisted_at,id""",
            (aid, sid, start, until),
        )
    flight = recorder_summaries(flight_directory, setups) if flight_directory else []
    public_analyses = {a["id"] for a in analyses}
    public_contexts = {c["id"] for c in contexts}
    if any(c["sourceAnalysisId"] not in public_analyses for c in contexts) or any(
        link not in public_contexts for a in analyses for link in a["contextIds"]
    ):
        warnings.append("LINKED_RECORDS_OUTSIDE_OBSERVED_COHORT")
    if not flight_directory:
        warnings.append("RECORDER_SNAPSHOTS_NOT_REQUESTED")
    return contract.LearningEvidence.model_validate(
        {
            "schemaVersion": "scalper-learning-evidence-1.0",
            "sourceId": source,
            "mode": "demo",
            "symbol": symbol,
            "exporterSourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "start": instant(start),
            "until": instant(until),
            "journalSnapshotAt": instant(snapshot),
            "exportedAt": datetime.now(UTC).isoformat(),
            "snapshotScope": "ONE_REPEATABLE_READ_JOURNAL",
            "cohortBasis": "OBSERVED_OR_CHANGED_IN_WINDOW_PLUS_ACTIVE_AND_LINKED",
            "dataUse": "EXTERNAL_OBSERVATIONS_NOT_A_DATASET_PARTITION",
            "contexts": contexts,
            "analyses": analyses,
            "setups": setups,
            "flight": flight,
            "unscopedBrokerEvents": [broker(r) for r in unscoped],
            "coverageWarnings": warnings,
            "scopeComplete": True,
            "brokerAuthority": False,
            "promotionAuthority": False,
            "autonomousFinding": False,
            "completeTickTape": False,
            "counterfactualNet": None,
        }
    )


def setup(
    g: dict[str, Any],
    scope: dict[str, Any],
    start: datetime,
    until: datetime,
    read: Callable[..., list[dict[str, Any]]],
) -> dict[str, Any]:
    orders = read(
        """SELECT id,side,state,execution_order_type,time_in_force,entry_price,
        stop_loss,take_profit,normalized_volume,filled_volume,expires_at,submission_valid_until,
        submitted_at,updated_at FROM orders WHERE order_group_id=%s
        AND strategy_owned ORDER BY side""",
        (g["id"],),
        2,
    )
    fills = read(
        """SELECT f.id,f.order_id,f.position_id,f.price,f.volume,f.commission,
        f.occurred_at,f.received_at FROM fills f LEFT JOIN orders o ON o.id=f.order_id
        LEFT JOIN positions p ON p.id=f.position_id
        WHERE o.order_group_id=%s OR p.order_group_id=%s ORDER BY f.occurred_at,f.id""",
        (g["id"], g["id"]),
    )
    events = read(
        f"SELECT {BROKER_FIELDS} FROM broker_execution_events "
        "WHERE order_group_id=%s ORDER BY persisted_at,id",
        (g["id"],),
    )
    protection = read(
        """SELECT p.id,p.side,p.state,p.volume,p.entry_price,
        pp.stop_loss,pp.take_profit,pp.status,pp.observed_at FROM positions p
        LEFT JOIN position_protection pp ON pp.position_id=p.id
        WHERE p.order_group_id=%s AND p.strategy_owned ORDER BY p.id""",
        (g["id"],),
        10,
    )
    history = read(
        """WITH scoped AS MATERIALIZED (
          SELECT e.*,max(e.created_at) FILTER(WHERE e.created_at < %s)
            OVER(PARTITION BY e.position_id,e.kind) prior_at
          FROM position_protection_events e JOIN positions p ON p.id=e.position_id
          WHERE p.order_group_id=%s)
        SELECT id,position_id,kind,created_at,
        details->>'status' status,details->>'stopLoss' stop_loss,
        details->>'takeProfit' take_profit,details->>'observedAt' observed_at,
        encode(sha256(convert_to(details::text,'UTF8')),'hex') details_sha256
        FROM scoped WHERE created_at >= %s OR created_at=prior_at
        ORDER BY created_at,id""",
        (start, g["id"], start),
        2000,
    )
    variants = read(
        """SELECT v.id,v.event_id,v.payload_hash,v.evidence_source,v.original_mapping_state,
        v.original_resolved_at,v.received_at,v.persisted_at
        FROM broker_execution_event_variants v JOIN broker_execution_events e ON e.id=v.event_id
        WHERE e.order_group_id=%s ORDER BY v.persisted_at,v.id""",
        (g["id"],),
    )
    closes = read(
        """SELECT d.position_id,d.broker_deal_id,d.closed_volume,d.entry_price,
        d.gross_profit,d.commission,d.swap,d.conversion_fee,d.occurred_at,d.recorded_at,
        d.external_intervention,d.evidence_hash FROM position_close_deals d
        JOIN positions p ON p.id=d.position_id WHERE p.order_group_id=%s
          AND d.account_id=%s AND d.symbol_id=%s ORDER BY d.recorded_at,d.broker_deal_id""",
        (g["id"], scope["account_id"], scope["symbol_id"]),
    )
    trades = read(
        """SELECT id,direction,realized_pnl,fees,opened_at,closed_at
        FROM trades WHERE order_group_id=%s ORDER BY closed_at,id""",
        (g["id"],),
        10,
    )
    return contract.revised(
        {
            "id": opaque(g["id"]),
            "originRelease": g["origin_release"],
            "recordedCodeHash": recorded_hash(g.get("recorded_code_hash")),
            "recordedConfigHash": recorded_hash(g.get("recorded_config_hash")),
            "cohortRole": role(
                g, start, until, active=g["state"] not in {"CLOSED", "FAILED", "EXPIRED"}
            ),
            "analysisId": opaque(g["analysis_id"]),
            "contextId": opaque(g["context_plan_id"]),
            "state": g["state"],
            "executionMode": g["execution_mode"],
            "timeInForce": g["time_in_force"],
            "createdAt": instant(g["created_at"]),
            "updatedAt": instant(g["updated_at"]),
            "expiresAt": instant(g["expires_at"]),
            "submissionValidUntil": instant(g["submission_valid_until"]),
            "accountCurrency": scope["currency"],
            "volumeScaleAsOfExport": number(scope["volume_scale"]),
            "metadataObservedAt": instant(scope["metadata_at"]),
            "orders": [
                {
                    "id": opaque(r["id"]),
                    "side": r["side"],
                    "state": r["state"],
                    "orderType": r["execution_order_type"],
                    "timeInForce": r["time_in_force"],
                    "entryPrice": number(r["entry_price"]),
                    "stopLoss": number(r["stop_loss"]),
                    "takeProfit": number(r["take_profit"]),
                    "approvedVolume": number(r["normalized_volume"]),
                    "filledVolume": number(r["filled_volume"]),
                    "expiresAt": instant(r["expires_at"]),
                    "submissionValidUntil": instant(r["submission_valid_until"]),
                    "placementResultPersistedAt": instant(r["submitted_at"]),
                    "updatedAt": instant(r["updated_at"]),
                }
                for r in orders
            ],
            "fills": [
                {
                    "id": opaque(r["id"]),
                    "orderId": opaque(r["order_id"]),
                    "positionId": opaque(r["position_id"]),
                    "price": number(r["price"]),
                    "volume": number(r["volume"]),
                    "commission": number(r["commission"]),
                    "occurredAt": instant(r["occurred_at"]),
                    "receivedAt": instant(r["received_at"]),
                    "clockStatus": contract.clock_status(
                        instant(r["occurred_at"]), instant(r["received_at"])
                    ),
                }
                for r in fills
            ],
            "brokerEvents": [broker(r) for r in events],
            "currentProtection": [
                {
                    "positionId": opaque(r["id"]),
                    "side": r["side"],
                    "positionState": r["state"],
                    "volume": number(r["volume"]),
                    "entryPrice": number(r["entry_price"]),
                    "brokerStopLoss": number(r["stop_loss"]),
                    "brokerTakeProfit": number(r["take_profit"]),
                    "status": r["status"],
                    "observedAt": instant(r["observed_at"]),
                    "basis": "CURRENT_OBSERVATION_NOT_HISTORICAL_FILL_ATTRIBUTION",
                }
                for r in protection
            ],
            "protectionHistory": [
                {
                    "id": opaque(r["id"]),
                    "positionId": opaque(r["position_id"]),
                    "kind": r["kind"],
                    "status": r["status"],
                    "stopLoss": r["stop_loss"],
                    "takeProfit": r["take_profit"],
                    "observedAt": instant(r["observed_at"]),
                    "persistedAt": instant(r["created_at"]),
                    "detailsSha256": r["details_sha256"],
                }
                for r in history
            ],
            "protectionHistoryStart": instant(start),
            "protectionHistoryComplete": g["created_at"] >= start,
            "brokerVariants": [
                {
                    "id": opaque(r["id"]),
                    "eventId": opaque(r["event_id"]),
                    "payloadSha256": r["payload_hash"],
                    "source": r["evidence_source"],
                    "originalMappingState": r["original_mapping_state"],
                    "originalResolvedAt": instant(r["original_resolved_at"]),
                    "receivedAt": instant(r["received_at"]),
                    "persistedAt": instant(r["persisted_at"]),
                }
                for r in variants
            ],
            "variantCoverage": "RETAINED_ONLY_MISSING_LEGACY_VARIANTS_NOT_RECONSTRUCTED",
            "closeDeals": [
                {
                    "id": contract.identity(str(r["position_id"]) + ":" + r["broker_deal_id"]),
                    "positionId": opaque(r["position_id"]),
                    "closedVolume": number(r["closed_volume"]),
                    "entryPrice": number(r["entry_price"]),
                    "gross": number(r["gross_profit"]),
                    "commission": number(r["commission"]),
                    "swap": number(r["swap"]),
                    "conversionFee": number(r["conversion_fee"]),
                    "occurredAt": instant(r["occurred_at"]),
                    "recordedAt": instant(r["recorded_at"]),
                    "externalIntervention": r["external_intervention"],
                    "evidenceSha256": r["evidence_hash"],
                    "exitCause": None,
                }
                for r in closes
            ],
            "closedTrades": [
                {
                    "id": opaque(r["id"]),
                    "direction": r["direction"],
                    "realizedNet": number(r["realized_pnl"]),
                    "signedFees": number(r["fees"]),
                    "openedAt": instant(r["opened_at"]),
                    "closedAt": instant(r["closed_at"]),
                }
                for r in trades
            ],
        }
    )


def recorder_summaries(directory: Path, setups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not directory.is_dir() or any(p.is_symlink() for p in (directory, *directory.parents)):
        raise ValueError("LEARNING_RECORDER_DIRECTORY_INVALID")
    results = []
    for g in setups:
        paths = sorted(islice(directory.glob(f"flight-{g['id']}-*.summary.json"), 17))
        if len(paths) > 16:
            raise ValueError("LEARNING_RECORDER_SESSION_LIMIT")
        if not paths:
            paths = [directory / f"flight-{g['id']}-missing.summary.json"]
        for path in paths:
            value = {
                "id": contract.identity(path.name),
                "setupId": g["id"],
                "originRelease": g["originRelease"],
                "recordedCodeHash": g["recordedCodeHash"],
                "recordedConfigHash": g["recordedConfigHash"],
                "cohortRole": g["cohortRole"],
                "observedAt": datetime.now(UTC).isoformat(),
                "checkedAt": None,
                "coverageStart": None,
                "quoteAt": None,
                "final": None,
                "gaps": None,
                "records": None,
                "snapshotSha256": None,
                "metrics": [],
                "unavailableReason": "RECORDER_SUMMARY_MISSING",
                "basis": "RECORDER_SUMMARY_NOT_VERIFIED_TICK_PATH",
                "chainVerified": False,
                "counterfactualNet": None,
            }
            if path.exists():
                try:
                    if path.is_symlink() or not path.is_file() or path.stat().st_size > 128_000:
                        raise ValueError("RECORDER_UNSAFE_FILE")
                    with path.open("rb") as f:
                        raw = f.read(128_001)
                    value["observedAt"] = datetime.now(UTC).isoformat()
                    if len(raw) > 128_000:
                        raise ValueError("RECORDER_OVERSIZED")
                    value["snapshotSha256"] = hashlib.sha256(raw).hexdigest()
                    data = json.loads(raw)
                    if (
                        not isinstance(data, dict)
                        or data.get("setup") != g["id"]
                        or data.get("originRelease") != g["originRelease"]
                        or data.get("schemaVersion") != "1.0"
                        or data.get("completeTickTape") is not False
                        or timestamp(data["checkedAt"]) > timestamp(value["observedAt"])
                    ):
                        raise ValueError("RECORDER_SCOPE_OR_CLOCK_INVALID")
                    projected = {
                        **value,
                        **{
                            k: data[k]
                            for k in (
                                "checkedAt",
                                "coverageStart",
                                "quoteAt",
                                "final",
                                "gaps",
                                "records",
                            )
                        },
                        "unavailableReason": None,
                        "metrics": [
                            {k: leg[k] for k in contract.FlightMetric.model_fields}
                            for leg in data["legs"]
                        ],
                    }
                    value = contract.FlightObservation.model_validate(
                        contract.revised(projected)
                    ).model_dump(exclude={"revisionSha256"})
                except (OSError, ValueError, TypeError, KeyError):
                    value["unavailableReason"] = "RECORDER_SUMMARY_INVALID"
            results.append(contract.revised(value))
    return results


def main() -> None:
    import psycopg
    from psycopg.rows import dict_row

    from python.backtest.breakout_entry_review import write_new

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--until", required=True)
    parser.add_argument("--flight-directory", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with psycopg.connect(
        os.environ["DATABASE_URL"],
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=10000",
    ) as connection:
        result = export(
            connection,
            os.environ["ACCOUNT_KEY_HASH"],
            os.environ.get("TRADING_SYMBOL", "XAUUSD"),
            args.source,
            timestamp(args.start),
            timestamp(args.until),
            flight_directory=args.flight_directory,
        )
    write_new(args.output, result.model_dump())


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("LEARNING_EXPORT_FAILED", file=sys.stderr)
        raise SystemExit(1) from None
