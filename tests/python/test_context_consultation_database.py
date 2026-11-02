from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from python.operations.export_learning_evidence import export
from python.research.learning_evidence import identity
from tests.python.test_learning_bridge_database import analysis, scope
from tests.python.test_storage_database import database as database


def test_exact_wait_link_exports_old_context_without_clock_inference(database):
    ids = scope(database)
    now = datetime.now(UTC)
    old = now - timedelta(hours=1)
    source = analysis(database, ids, old)
    current = analysis(database, ids, now - timedelta(minutes=2))
    context = str(uuid4())
    database.execute(
        """INSERT INTO scenario_contexts(id,account_id,symbol_id,source_analysis_id,mode,
        requested_at,captured_at,valid_until,available_at,completed_at,state,requested_model,
        tick_size,plan) VALUES(%s,%s,%s,%s,'demo',%s,%s,%s,%s,%s,'READY','gpt-6.1-sol',0.01,%s)""",
        (
            context,
            ids[0],
            ids[1],
            source,
            old,
            old,
            old + timedelta(minutes=5),
            old + timedelta(seconds=1),
            old + timedelta(seconds=1),
            Jsonb({"schema_version": "entry-wait-1.0"}),
        ),
    )
    database.execute(
        """INSERT INTO analysis_context_consultations(analysis_id,context_id,account_id,
        symbol_id,mode,reason,observed_at)
            VALUES(%s,%s,%s,%s,'demo','SCENARIO_CODEX_WAIT',%s)""",
        (current, context, ids[0], ids[1], now - timedelta(minutes=1)),
    )
    database.execute(
        "UPDATE analysis_runs SET deferral_reason='SCENARIO_CODEX_WAIT' WHERE id=%s", (current,)
    )
    database.commit()
    result = export(database, "a" * 64, "XAUUSD", "fixture-demo", now - timedelta(minutes=30), now)
    check = next(a for a in result.analyses if a.id == identity(current))
    assert check.contextIds == [identity(context)]
    assert result.contexts[0].id == identity(context)
    assert result.contexts[0].cohortRole == "LINKED_REFERENCE"
    assert result.contexts[0].sourceAnalysisId == identity(source) != check.id
    for statement in (
        "UPDATE analysis_context_consultations SET reason='SCENARIO_CODEX_WAIT'",
        "DELETE FROM analysis_context_consultations",
        "TRUNCATE analysis_context_consultations",
    ):
        database.execute("SAVEPOINT mutation")
        with pytest.raises(Exception, match="CONTEXT_CONSULTATION_IMMUTABLE"):
            database.execute(statement)
        database.execute("ROLLBACK TO SAVEPOINT mutation")
    database.execute("SAVEPOINT invalid_clock")
    another = analysis(database, ids, now - timedelta(seconds=30))
    with pytest.raises(Exception, match="CONTEXT_CONSULTATION_SCOPE_INVALID"):
        database.execute(
            """INSERT INTO analysis_context_consultations(analysis_id,context_id,account_id,
            symbol_id,mode,reason,observed_at)
            VALUES(%s,%s,%s,%s,'demo','SCENARIO_CODEX_WAIT',%s)""",
            (another, context, ids[0], ids[1], old),
        )
    database.execute("ROLLBACK TO SAVEPOINT invalid_clock")
