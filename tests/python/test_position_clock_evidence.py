from python.backtest.current_scalp import reconstruct
from tests.python.test_current_scalp import closed_current
from tests.python.test_scalp_replay import at, model


def test_closed_position_clock_is_distinct_from_native_protection_clock():
    from python.research.position_clock_evidence import PositionClockEvidence, reconstruct_current

    raw = closed_current()
    raw["setups"][0]["currentProtection"][0]["observedAt"] = at(20)
    p = model(raw)
    position = p.setups[0].currentProtection[0]
    assert reconstruct(p)[0].reasons == ["POSITION_OBSERVATION_PRECEDES_LEDGER"]
    evidence = PositionClockEvidence.bind(p, {position.positionId: at(30)})
    result = reconstruct_current(evidence)[0]
    assert result.status == "CLOSED"
    assert result.recordedClosedNet == "1"
    assert position.observedAt == at(20)


def evidence():
    from python.research.position_clock_evidence import PositionClockEvidence

    p = model(closed_current())
    return PositionClockEvidence.bind(p, {p.setups[0].currentProtection[0].positionId: at(30)})


def test_binding_and_cutoff_fail_closed():
    import pytest

    from python.research.position_clock_evidence import PositionClockEvidence, reconstruct_current

    e = evidence()
    key = next(iter(e.positionUpdatedAt))
    for clocks in [{}, {key: at(1000)}, {"f" * 24: at(30)}]:
        with pytest.raises(ValueError, match="BINDING"):
            PositionClockEvidence.bind(e.packet, clocks)
    raw = e.model_dump()
    raw["packetSha256"] = "f" * 64
    with pytest.raises(ValueError, match="BINDING"):
        PositionClockEvidence.model_validate(raw)
    for at_time in [at(29), at(601)]:
        p = e.packet.model_copy(deep=True)
        p.journalSnapshotAt = p.exportedAt = at(700)
        altered = PositionClockEvidence.bind(p, {key: at_time})
        assert reconstruct_current(altered)[0].status == "UNKNOWN"
    raw = closed_current()
    raw["setups"][0]["closeDeals"][0]["recordedAt"] = at(601)
    p = model(raw)
    p.journalSnapshotAt = p.exportedAt = at(700)
    assert reconstruct_current(PositionClockEvidence.bind(p, {key: at(30)}))[0].status == "UNKNOWN"


def test_rr_keeps_stops_and_all_rows_without_cost_or_trade_claim():
    from python.backtest.rr_screen import report

    e = evidence()
    before = e.model_dump()
    r = report(e)
    assert len(r.rrScreens) == 2 * len(e.packet.contexts)
    assert [x["target"] for x in r.rrScreens] == ["4009", "4012.5"]
    assert all(x["stop"] == "3995" for x in r.rrScreens)
    assert r.netRewardToRisk is None and r.counterfactualNet is None
    assert e.model_dump() == before


def test_new_feed_preserves_legacy_packet_and_binds_sidecar(tmp_path, monkeypatch):
    import json
    from contextlib import nullcontext

    import psycopg

    from python.operations import export_learning_evidence as exporter
    from python.operations import observation_review as operation
    from python.research.codex_loop import timestamp
    from python.research.position_clock_evidence import PositionClockEvidence

    e = evidence()
    monkeypatch.setenv("DATABASE_URL", "fixture")
    monkeypatch.setenv("ACCOUNT_KEY_HASH", "fixture")

    def export(*args, **kwargs):
        kwargs["position_clocks"].update(e.positionUpdatedAt)
        return e.packet

    monkeypatch.setattr(exporter, "export", export)
    monkeypatch.setattr(psycopg, "connect", lambda *args, **kwargs: nullcontext(object()))
    target = tmp_path / "current.json"
    operation.feed(target, timestamp(at(700)), with_position_clocks=True)
    sidecar = PositionClockEvidence.model_validate_json(
        (tmp_path / "position-clocks.json").read_bytes()
    )
    assert sidecar.packet.model_dump() == json.loads(target.read_bytes())
    assert target.stat().st_mode & 0o777 == 0o640


def test_future_v11_registration_and_replay_preserve_clock_envelope(tmp_path, monkeypatch):
    from datetime import timedelta

    from python.operations import loss_control_study as study
    from python.research.learning_evidence import encoded

    e = evidence()
    start = study.timestamp(e.packet.start).replace(minute=0) + timedelta(hours=1)
    e.packet.start = start.isoformat()
    e.packet.until = (start + timedelta(minutes=30)).isoformat()
    e.packet.journalSnapshotAt = e.packet.exportedAt = e.packet.until
    e = type(e).bind(e.packet, e.positionUpdatedAt)
    monkeypatch.setattr(study, "fingerprint", lambda: "a" * 64)
    root = tmp_path / "study"
    feed = tmp_path / "feed.json"
    study.register(root, start, start - timedelta(minutes=1), e.packet.sourceId, protocol="1.1")
    feed.write_bytes(encoded(e.model_dump()))
    now = start + timedelta(minutes=31)
    assert study.run(root, feed, now)["state"] == "REPORT_WRITTEN"
    assert study.run(root, feed, now)["state"] == "ALREADY_RECORDED"
    saved = study.read(root / "window-0000.json")
    assert saved["report"]["schemaVersion"] == "loss-control-screen-1.1"
    assert "positionUpdatedAt" in study.read(root / "window-0000.input.json")


def test_new_schemas_match_without_modifying_old_schemas():
    import json
    from pathlib import Path

    from python.backtest.rr_screen import RRReport
    from python.operations.loss_control_study import RegistrationV11
    from python.research.position_clock_evidence import PositionClockEvidence

    for name, cls in [
        ("position-clock-evidence-1.0", PositionClockEvidence),
        ("loss-control-registration-1.1", RegistrationV11),
        ("loss-control-screen-1.1", RRReport),
    ]:
        assert json.loads(Path("schemas", name + ".json").read_bytes()) == cls.model_json_schema()


def test_position_clock_selection_uses_actual_postgres_snapshot():
    import os
    from datetime import UTC, datetime
    from uuid import uuid4

    import psycopg
    import pytest
    from psycopg.rows import dict_row

    from python.operations.export_learning_evidence import export, setup
    from python.research.learning_evidence import identity

    dsn = os.environ.get("TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("requires isolated PostgreSQL")
    schema = "clock_" + uuid4().hex
    position, group, other = uuid4(), uuid4(), uuid4()
    old = datetime(2026, 1, 1, 0, 0, 30, tzinfo=UTC)
    native = datetime(2026, 1, 1, 0, 0, 20, tzinfo=UTC)
    later = datetime(2026, 1, 1, 0, 0, 40, tzinfo=UTC)
    with psycopg.connect(dsn, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
        try:
            with psycopg.connect(
                dsn, autocommit=True, row_factory=dict_row, options=f"-c search_path={schema}"
            ) as c:
                c.execute(
                    "CREATE TABLE positions(id uuid,order_group_id uuid,strategy_owned boolean,"
                    "side text,state text,volume numeric,entry_price numeric,"
                    "updated_at timestamptz)"
                )
                c.execute(
                    "CREATE TABLE position_protection(position_id uuid,stop_loss numeric,"
                    "take_profit numeric,status text,observed_at timestamptz)"
                )
                c.execute(
                    "INSERT INTO positions VALUES(%s,%s,true,'BUY','CLOSED',0,4000,%s),"
                    "(%s,%s,false,'BUY','OPEN',1,4000,%s)",
                    (position, group, old, other, group, old),
                )
                c.execute(
                    "INSERT INTO position_protection VALUES(%s,3999,4001,'PROTECTED',%s)",
                    (position, native),
                )
                g = dict(
                    id=group,
                    analysis_id=uuid4(),
                    context_plan_id=None,
                    origin_release="0.10.0-demo-trials.1-codex.1",
                    state="CLOSED",
                    execution_mode="SINGLE_STOP_LIMIT",
                    time_in_force="GTD",
                    created_at=native,
                    updated_at=old,
                    expires_at=later,
                    submission_valid_until=later,
                )
                scope = dict(
                    account_id=uuid4(),
                    symbol_id=uuid4(),
                    currency="USD",
                    volume_scale=1,
                    metadata_at=native,
                )

                def read(sql, args, limit=500):
                    if "SELECT p.id,p.side" in sql:
                        return c.execute(sql + f" LIMIT {limit}", args).fetchall()
                    return []

                clocks = {}
                with c.transaction():
                    c.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                    c.execute("SELECT * FROM positions").fetchall()
                    admin.execute(
                        f'UPDATE "{schema}".positions SET updated_at=%s WHERE id=%s',
                        (later, position),
                    )
                    legacy = setup(g, scope, native, later, read)
                    observed = setup(g, scope, native, later, read, clocks)
                    assert observed == legacy
                    assert clocks == {identity(position): old.isoformat()}
                    assert observed["currentProtection"][0]["observedAt"] == native.isoformat()
                    with pytest.raises(ValueError, match="DUPLICATE"):
                        setup(g, scope, native, later, read, clocks)
                assert (
                    c.execute(
                        "SELECT updated_at FROM positions WHERE id=%s", (position,)
                    ).fetchone()["updated_at"]
                    == later
                )
                with pytest.raises(ValueError, match="SCOPE_INVALID"):
                    export(c, "a" * 64, "XAUUSD", "fixture", native, later, position_clocks=clocks)
        finally:
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_rr_rounding_distinguishes_requested_from_rounded_ratio():
    from decimal import Decimal

    from python.backtest.rr_screen import report
    from python.research.learning_evidence import LearningEvidence, revised
    from python.research.position_clock_evidence import PositionClockEvidence

    for side, stop, target, expected in [
        ("BUY", "4001.99", "4003", "4002.01"),
        ("SELL", "4002.01", "4001", "4001.99"),
    ]:
        raw = evidence().packet.model_dump()
        c = raw["contexts"][0]
        c.update(decision=side, entryPrice="4002", stopLoss=stop, takeProfit=target)
        c.pop("revisionSha256")
        raw["contexts"][0] = revised(c)
        packet = LearningEvidence.model_validate(raw)
        e = PositionClockEvidence.bind(packet, evidence().positionUpdatedAt)
        row = report(e).rrScreens[1]
        assert row["requestedGrossReward"] == "1.5"
        assert Decimal(row["roundedGrossRewardToRisk"]) == 1
        assert Decimal(row["target"]) == Decimal(expected)
