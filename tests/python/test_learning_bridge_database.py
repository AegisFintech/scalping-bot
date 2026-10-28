from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

from python.operations.export_learning_evidence import export
from tests.python.test_storage_database import database as database


def scope(database: psycopg.Connection[dict[str, Any]]) -> tuple[str, str, str]:
    account, symbol, strategy = (str(uuid4()) for _ in range(3))
    database.execute(
        """INSERT INTO accounts(id,provider_account_key_hash,environment,account_type,currency)
        VALUES(%s,%s,'demo','demo','USD')""",
        (account, "a" * 64),
    )
    database.execute(
        """INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,
        metadata_revision,metadata_at,volume_scale)
        VALUES(%s,%s,'fixture','XAUUSD',2,0.01,'fixture',now(),0.01)""",
        (symbol, account),
    )
    database.execute(
        """INSERT INTO strategy_versions(id,version,code_hash,config_hash,prompt_version,
        schema_version,feature_version) VALUES(%s,'bridge-fixture','f','f','f','f','f')""",
        (strategy,),
    )
    return account, symbol, strategy


def analysis(
    database: psycopg.Connection[dict[str, Any]],
    ids: tuple[str, str, str],
    at: datetime,
    state: str = "DEFERRED",
) -> str:
    value = str(uuid4())
    database.execute(
        """INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,
        mode,state,analysis_time,created_at,updated_at) VALUES(%s,%s,%s,%s,'demo',%s,%s,%s,%s)""",
        (value, *ids, state, at, at, at),
    )
    return value


def test_wait_failure_and_rejected_without_orders_are_all_counted(
    database: psycopg.Connection[dict[str, Any]],
) -> None:
    ids = scope(database)
    now = datetime.now(UTC)
    at = now - timedelta(minutes=20)
    wait, failed, rejected = (
        analysis(database, ids, at, s) for s in ("DEFERRED", "DEFERRED", "REJECTED")
    )
    for aid, state in [(wait, "READY"), (failed, "FAILED")]:
        ready = state == "READY"
        database.execute(
            """INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,
            mode,requested_at,captured_at,valid_until,available_at,completed_at,state,requested_model,
            tick_size,plan,reason)
            VALUES(%s,%s,%s,%s,'demo',%s,%s,%s,%s,%s,%s,'gpt-6.1-sol','0.01',%s,%s)""",
            (
                str(uuid4()),
                ids[0],
                ids[1],
                aid,
                at,
                at,
                at + timedelta(minutes=5),
                at + timedelta(seconds=1) if ready else None,
                at + timedelta(seconds=1),
                state,
                Jsonb({"schema_version": "entry-wait-1.0", "reason": "untrusted narrative omitted"})
                if ready
                else None,
                None if ready else "SCENARIO_PROVIDER_FAILED",
            ),
        )
    database.execute(
        "UPDATE analysis_runs SET rejection_reasons='[\"QUOTE_STALE\"]' WHERE id=%s", (rejected,)
    )
    database.commit()
    result = export(database, "a" * 64, "XAUUSD", "fixture-demo", at - timedelta(minutes=1), now)
    assert len(result.contexts) == 2 and len(result.analyses) == 3 and result.setups == []
    assert {c.decision for c in result.contexts} == {"WAIT", "UNKNOWN"}
    assert {c.state for c in result.contexts} == {"READY", "FAILED"}
    assert next(a for a in result.analyses if a.state == "REJECTED").reasonCodes == ["QUOTE_STALE"]
    raw = result.model_dump_json()
    assert all(
        value not in raw for value in [*ids, wait, failed, rejected, "untrusted narrative omitted"]
    )
    assert all(c.market is None for c in result.contexts)


def test_active_legacy_carryin_keeps_partial_close_and_late_broker_clocks(
    database: psycopg.Connection[dict[str, Any]],
) -> None:
    ids = scope(database)
    now = datetime.now(UTC)
    at = now - timedelta(hours=2)
    aid = analysis(database, ids, at, "ACCEPTED")
    group, buy, sell, position = (str(uuid4()) for _ in range(4))
    database.execute(
        """INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,
        time_in_force,expires_at,submission_valid_until,created_at,updated_at)
        VALUES(%s,%s,%s,'demo','POSITION_OPEN','GTC',NULL,%s,%s,%s)""",
        (group, aid, group, at + timedelta(minutes=3), at, at),
    )
    for oid, side, state, entry, sl, tp, filled in [
        (buy, "BUY", "FILLED", "4000", "3993", "4000.4", "20"),
        (sell, "SELL", "CANCELLED", "3999", "4006", "3998.6", "0"),
    ]:
        database.execute(
            """INSERT INTO orders(id,order_group_id,side,order_type,state,client_order_id,
            strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,
            normalized_volume,filled_volume,account_id,execution_order_type,time_in_force,
            expires_at,submission_valid_until) VALUES(%s,%s,%s,'STOP',%s,%s,'fixture',%s,%s,%s,%s,
            20,20,%s,%s,'STOP_LIMIT','GTC',NULL,%s)""",
            (
                oid,
                group,
                side,
                state,
                oid,
                oid,
                entry,
                sl,
                tp,
                filled,
                ids[0],
                at + timedelta(minutes=3),
            ),
        )
    database.execute(
        """INSERT INTO positions(id,account_id,symbol_id,order_group_id,broker_position_id,
        side,state,strategy_owned,volume,entry_price,opened_at)
        VALUES(%s,%s,%s,%s,'999888777111','BUY','OPEN',true,10,4000.05,%s)""",
        (position, ids[0], ids[1], group, at + timedelta(seconds=1)),
    )
    database.execute(
        """INSERT INTO fills(id,order_id,position_id,broker_event_key,price,volume,
        commission,occurred_at,received_at)
        VALUES(%s,%s,%s,'fixture-entry',4000.05,20,-0.1,%s,%s)""",
        (str(uuid4()), buy, position, at + timedelta(seconds=1), at + timedelta(seconds=2)),
    )
    occurred, received, persisted = (now - timedelta(seconds=s) for s in (20, 19, 10))
    database.execute(
        """INSERT INTO broker_execution_events(id,account_id,symbol_id,order_group_id,
        position_id,broker_event_key,payload_hash,schema_version,execution_type,mapping_state,
        normalized_payload,occurred_at,received_at,persisted_at,broker_order_type,closing_order)
        VALUES(%s,%s,%s,%s,%s,'fixture-close',%s,'1.1',3,'MAPPED',%s,%s,%s,%s,4,true)""",
        (
            str(uuid4()),
            ids[0],
            ids[1],
            group,
            position,
            "1" * 64,
            Jsonb({"rawPrivatePayload": "private-sentinel-never-export"}),
            occurred,
            received,
            persisted,
        ),
    )
    database.execute(
        """INSERT INTO position_close_deals(account_id,symbol_id,position_id,
        broker_deal_id,broker_order_id,closed_volume,entry_price,gross_profit,commission,swap,
        conversion_fee,occurred_at,external_intervention,evidence_hash,recorded_at)
        VALUES(%s,%s,%s,'999888777111','123456789000',10,4000.05,1,-0.1,0,0,%s,true,%s,%s)""",
        (ids[0], ids[1], position, occurred, "2" * 64, persisted),
    )
    # Two equal-clock prior facts both survive; older facts do not replace either.
    for status, offset, kind in [
        ("OLDER", 60, "OBSERVATION"),
        ("PRIOR_A", 40, "OBSERVATION"),
        ("PRIOR_B", 40, "OBSERVATION"),
        ("IN_WINDOW", 10, "OBSERVATION"),
        ("REPAIR", 50, "REPAIR_CLAIM"),
    ]:
        database.execute(
            """INSERT INTO position_protection_events(id,position_id,kind,details,created_at)
            VALUES(%s,%s,%s,%s,%s)""",
            (
                str(uuid4()),
                position,
                kind,
                Jsonb({"status": status}),
                now - timedelta(minutes=offset),
            ),
        )
    database.commit()
    result = export(database, "a" * 64, "XAUUSD", "fixture-demo", now - timedelta(minutes=30), now)
    assert len(result.setups) == 1
    observed = result.setups[0]
    assert observed.cohortRole == "CARRY_IN" and observed.timeInForce == "GTC"
    assert observed.state == "POSITION_OPEN" and observed.closedTrades == []
    assert {p.status for p in observed.protectionHistory} == {
        "PRIOR_A",
        "PRIOR_B",
        "IN_WINDOW",
        "REPAIR",
    }
    assert not observed.protectionHistoryComplete
    assert observed.currentProtection[0].volume == "10.0000000000"
    assert observed.closeDeals[0].closedVolume == "10.0000000000"
    assert observed.closeDeals[0].externalIntervention and observed.closeDeals[0].exitCause is None
    event = observed.brokerEvents[0]
    assert event.occurredAt == occurred.isoformat() and event.receivedAt == received.isoformat()
    assert event.persistedAt == persisted.isoformat()
    raw = json.dumps(result.model_dump())
    assert all(
        v not in raw
        for v in [group, buy, sell, position, "999888777111", "private-sentinel-never-export"]
    )


def test_current_single_gtd_intent_keeps_selected_prices_and_exact_deadline(
    database: psycopg.Connection[dict[str, Any]],
) -> None:
    ids = scope(database)
    now = datetime.now(UTC)
    captured = now - timedelta(seconds=20)
    expires = captured + timedelta(seconds=120)
    aid = analysis(database, ids, captured)
    context_id, group, revision, order = (str(uuid4()) for _ in range(4))
    database.execute(
        "UPDATE strategy_versions SET version=%s WHERE id=%s",
        ("0.8.0-model-scalp.1-codex.1", ids[2]),
    )
    plan = {
        "schema_version": "entry-scalp-1.0",
        "analysis_id": context_id,
        "captured_at": captured.isoformat(),
        "valid_until": expires.isoformat(),
        "entry_side": "BUY",
        "buy_stop": "4000",
        "sell_stop": "3993",
        "take_profit": "4000.4",
        "stop_loss": "3993",
        "pending_seconds": 120,
    }
    database.execute(
        """INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,
        mode,requested_at,captured_at,valid_until,available_at,completed_at,state,requested_model,
        tick_size,plan)
        VALUES(%s,%s,%s,%s,'demo',%s,%s,%s,%s,%s,'READY','gpt-6.1-sol','0.01',%s)""",
        (
            context_id,
            ids[0],
            ids[1],
            aid,
            captured,
            captured,
            expires,
            captured + timedelta(seconds=1),
            captured + timedelta(seconds=1),
            Jsonb(plan),
        ),
    )
    database.execute(
        """INSERT INTO entry_mode_settings(account_id,symbol_id,environment,
        entry_mode,revision,actor,reason)
        VALUES(%s,%s,'demo','SINGLE_STOP_LIMIT',%s,'test','fixture')""",
        (ids[0], ids[1], revision),
    )
    database.execute(
        """INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,
        time_in_force,expires_at,submission_valid_until,context_plan_id,entry_side,execution_mode,
        mode_revision,created_at,updated_at)
        VALUES(%s,%s,%s,'demo','ACTIVE','GTD',%s,%s,%s,'BUY','SINGLE_STOP_LIMIT',%s,%s,%s)""",
        (group, aid, group, expires, expires, context_id, revision, captured, captured),
    )
    database.execute(
        """INSERT INTO orders(id,order_group_id,side,order_type,state,client_order_id,
        strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,
        normalized_volume,filled_volume,account_id,execution_order_type,time_in_force,
        expires_at,submission_valid_until) VALUES(%s,%s,'BUY','STOP','PENDING',%s,'fixture',%s,
        4000,3993,4000.4,20,20,0,%s,'STOP_LIMIT','GTD',%s,%s)""",
        (order, group, order, order, ids[0], expires, expires),
    )
    database.commit()
    result = export(
        database, "a" * 64, "XAUUSD", "fixture-demo", captured - timedelta(seconds=1), now
    )
    assert len(result.setups) == 1 and len(result.setups[0].orders) == 1
    setup = result.setups[0]
    assert setup.executionMode == "SINGLE_STOP_LIMIT" and setup.timeInForce == "GTD"
    assert setup.expiresAt == expires.isoformat() and setup.closedTrades == []
    assert setup.orders[0].expiresAt == expires.isoformat()
    assert result.contexts[0].entryPrice == "4000" and result.contexts[0].pendingSeconds == 120
    assert result.contexts[0].takeProfit == "4000.4" and result.contexts[0].stopLoss == "3993"
