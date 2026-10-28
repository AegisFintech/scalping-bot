from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import psycopg
import pytest

from python.backtest import fill_gap_review as g
from python.operations.export_fill_evidence import export
from tests.python.test_storage_database import database as database


def test_entry_and_native_close_deals_export_scoped_without_identifiers(
    database: psycopg.Connection[dict[str, Any]],
) -> None:
    account, symbol, strategy, analysis, group = (str(uuid4()) for _ in range(5))
    order, position = str(uuid4()), str(uuid4())
    now = datetime.now(UTC).replace(microsecond=0)
    at = now - timedelta(minutes=20)
    filled, closed = at + timedelta(minutes=1), at + timedelta(minutes=16)
    database.execute(
        """INSERT INTO accounts(id,provider_account_key_hash,environment,account_type,currency)
        VALUES(%s,%s,'demo','demo','USD')""",
        (account, "a" * 64),
    )
    database.execute(
        """INSERT INTO symbols(id,account_id,provider_symbol_id,name,digits,tick_size,
        metadata_revision,metadata_at,volume_scale)
        VALUES(%s,%s,'fixture','XAUUSD',2,0.01,'fixture',%s,0.01)""",
        (symbol, account, at),
    )
    database.execute(
        """INSERT INTO strategy_versions(id,version,code_hash,config_hash,
        prompt_version,schema_version,feature_version)
        VALUES(%s,'fill-fixture','f','f','f','f','f')""",
        (strategy,),
    )
    database.execute(
        """INSERT INTO analysis_runs(id,account_id,symbol_id,strategy_version_id,
        mode,state,analysis_time) VALUES(%s,%s,%s,%s,'demo','REJECTED',%s)""",
        (analysis, account, symbol, strategy, at),
    )
    database.execute(
        """INSERT INTO order_groups(id,analysis_id,idempotency_key,mode,state,expires_at,created_at)
        VALUES(%s,%s,%s,'demo','CLOSED',%s,%s)""",
        (group, analysis, group, at + timedelta(minutes=5), at),
    )
    database.execute(
        """INSERT INTO orders(id,order_group_id,side,order_type,state,client_order_id,
        strategy_label,idempotency_key,entry_price,stop_loss,take_profit,requested_volume,
        normalized_volume,filled_volume,account_id,execution_order_type,time_in_force,
        expires_at,submission_valid_until,strategy_owned)
        VALUES(%s,%s,'BUY','STOP','FILLED','c1','s',%s,4008.45,4001.45,4008.85,24600,24600,
        24600,%s,'STOP_LIMIT','GTC',NULL,%s,true)""",
        (order, group, order, account, at + timedelta(minutes=3)),
    )
    database.execute(
        """INSERT INTO positions(id,account_id,symbol_id,order_group_id,broker_position_id,side,
        state,strategy_owned,volume,entry_price,opened_at,closed_at)
        VALUES(%s,%s,%s,%s,'1','BUY','CLOSED',true,0,4008.70,%s,%s)""",
        (position, account, symbol, group, filled, closed),
    )
    database.execute(
        """INSERT INTO fills(id,order_id,position_id,broker_event_key,broker_fill_id,price,
        volume,commission,occurred_at,received_at)
        VALUES(%s,%s,%s,'k1','101',4008.70,24600,-29.55,%s,%s),
        (%s,NULL,%s,'k2','102',4001.49,24600,-29.56,%s,%s)""",
        (str(uuid4()), order, position, filled, filled, str(uuid4()), position, closed, closed),
    )
    database.execute(
        """INSERT INTO broker_execution_events(id,account_id,symbol_id,order_group_id,order_id,
        position_id,broker_event_key,payload_hash,schema_version,execution_type,broker_fill_id,
        mapping_state,normalized_payload,occurred_at,received_at,broker_order_type,closing_order)
        VALUES(%s,%s,%s,%s,%s,%s,'e1',%s,'1.1',2,NULL,'MAPPED','{}',%s,%s,6,false),
        (%s,%s,%s,%s,NULL,%s,'e2',%s,'1.1',3,'102','MAPPED','{}',%s,%s,4,true)""",
        (
            str(uuid4()),
            account,
            symbol,
            group,
            order,
            position,
            "1" * 64,
            at,
            at,
            str(uuid4()),
            account,
            symbol,
            group,
            position,
            "2" * 64,
            closed,
            closed,
        ),
    )
    database.execute(
        """INSERT INTO position_close_deals(account_id,symbol_id,position_id,broker_deal_id,
        broker_order_id,closed_volume,entry_price,gross_profit,commission,swap,conversion_fee,
        occurred_at,external_intervention,evidence_hash)
        VALUES(%s,%s,%s,'102','900',24600,4008.70,-1773.66,-29.56,0,0,%s,false,%s)""",
        (account, symbol, position, closed, "2" * 64),
    )
    database.execute(
        """INSERT INTO position_protection(position_id,status,stop_loss,take_profit,
        observed_at,reason_code) VALUES(%s,'VERIFIED',4001.70,4009.10,%s,'VERIFIED')""",
        (position, closed - timedelta(seconds=1)),
    )
    database.execute(
        """INSERT INTO position_protection_events(id,position_id,kind,details,created_at)
        VALUES(%s,%s,'OBSERVATION',%s,%s)""",
        (
            str(uuid4()),
            position,
            psycopg.types.json.Jsonb(
                {
                    "status": "VERIFIED",
                    "stopLoss": "4001.70",
                    "takeProfit": "4009.10",
                    "observedAt": (closed - timedelta(seconds=1)).isoformat(),
                }
            ),
            closed - timedelta(seconds=0.5),
        ),
    )
    database.commit()
    result = export(database, "a" * 64, "XAUUSD", at, now)
    entry, close = result["fills"]
    assert entry["kind"] == "ENTRY" and entry["brokerAcceptedAt"] == at.isoformat()
    assert close["kind"] == "CLOSE" and close["closingOrderType"] == 4
    assert close["externalIntervention"] is False and close["brokerTakeProfit"]
    # A later current observation and immutable later event cannot rewrite an old close.
    database.execute(
        "UPDATE position_protection SET take_profit=5000,observed_at=%s WHERE position_id=%s",
        (now, position),
    )
    database.execute(
        """INSERT INTO position_protection_events(id,position_id,kind,details,created_at)
        VALUES(%s,%s,'OBSERVATION',%s,%s)""",
        (
            str(uuid4()),
            position,
            psycopg.types.json.Jsonb(
                {
                    "status": "VERIFIED",
                    "stopLoss": "3000",
                    "takeProfit": "5000",
                    "observedAt": now.isoformat(),
                }
            ),
            now,
        ),
    )
    database.commit()
    assert export(database, "a" * 64, "XAUUSD", at, now)["fills"] == result["fills"]
    text = repr(result)
    assert group not in text and position not in text and order not in text
    assert not {"brokerFillId", "brokerDealId", "brokerPositionId"} & set(close)
    reviewed = g.review(result, None, [])
    assert [r.get("closeClass") for r in reviewed["fills"]] == [None, "NATIVE_AT_OR_BEYOND_SL"]
    assert reviewed["fills"][0]["triggerGap"] == "0.25"
    assert reviewed["fills"][1]["levelSlippage"] == "0.21"
    database.execute(
        """INSERT INTO position_protection_events(id,position_id,kind,details,created_at)
        VALUES(%s,%s,'OBSERVATION',%s,%s)""",
        (
            str(uuid4()),
            position,
            psycopg.types.json.Jsonb(
                {
                    "status": "UNCERTAIN",
                    "stopLoss": None,
                    "takeProfit": None,
                    "observedAt": None,
                }
            ),
            closed - timedelta(seconds=0.1),
        ),
    )
    database.commit()
    uncertain = export(database, "a" * 64, "XAUUSD", at, now)["fills"][1]
    assert uncertain["brokerTakeProfit"] is None and uncertain["brokerStopLoss"] is None
    assert (
        g.review(export(database, "a" * 64, "XAUUSD", at, now), None, [])["fills"][1]["closeClass"]
        == "NATIVE_LEVEL_UNKNOWN"
    )
    assert not export(database, "b" * 64, "XAUUSD", at, now)["fills"]
    assert not export(database, "a" * 64, "OTHER", at, now)["fills"]
    with database.transaction():
        database.execute("SET TRANSACTION READ ONLY")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            database.execute("DELETE FROM fills")
