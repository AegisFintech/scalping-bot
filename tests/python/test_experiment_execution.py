from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from python.research import experiment_execution as x
from python.research import isolated_worker as w
from python.research.experiment_registry import Registry
from python.research.experiments.cohort_audit import audit
from python.research.learning_evidence import encoded
from tests.python.test_learning_bridge import packet
from tests.python.test_observation_cycle import job, run


@pytest.fixture
def setup(tmp_path):
    review = tmp_path / "reviews"
    run(review, packet())
    trust = w.WorkerTrust(tmp_path, "a" * 64, tmp_path / "verify.py", "b" * 64, "c" * 64, "d" * 64)
    approved = x.ApprovedMethod("e" * 40, Path(x.SOURCE).read_bytes(), trust)
    registry = Registry(tmp_path / "registry")
    reg = registry.register(job(review), approved.method(), approved.files, datetime.now(UTC))
    registry.claim(reg.questionId, reg.trialId, datetime.now(UTC))
    mailbox = x.Mailbox(tmp_path / "mailbox")
    request = x.request(registry, reg, approved)
    return registry, reg, mailbox, approved, request


def execute(files, bundle, trust, *, data, expected_input):
    return w.WorkerResult(
        bundle,
        trust.runtime_sha256,
        trust.verifier_sha256,
        0,
        encoded(audit(json.loads(data))),
        input_sha256=expected_input,
    )


def test_complete_real_registration_to_independent_finding_and_idempotent_close(setup):
    registry, reg, mailbox, approved, request = setup
    assert mailbox.submit(encoded(request), approved)["status"] == "QUEUED"
    receipt = mailbox.execute_one(approved, execute)
    assert x.reconcile(registry, reg, approved, receipt) == "CLOSED_INCONCLUSIVE"
    assert x.reconcile(registry, reg, approved, receipt) == "CLOSED_INCONCLUSIVE"
    assert mailbox.submit(encoded(request), approved) == receipt
    assert mailbox.execute_one(approved, execute) == {"status": "IDLE"}
    path, _ = registry.load(reg.questionId, reg.trialId)
    finding = x.read(path / "experiment-finding.json")
    assert finding["measurementValidated"] is True
    assert finding["originalQuestionAnswered"] is False
    assert finding["promotionAuthority"] is False
    assert finding["measurement"]["decisions"] == {"WAIT": 1}
    assert finding["measurement"]["closedInWindow"] == 0


def test_lost_submit_response_reconciles_without_second_execution(setup):
    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)  # Reply lost; local claim already durable.
    assert registry.claim(reg.questionId, reg.trialId, datetime.now(UTC)) is None
    assert x.reconcile(registry, reg, approved, mailbox.query(reg.trialId)) == "QUEUED"
    mailbox.execute_one(approved, execute)
    assert x.reconcile(registry, reg, approved, mailbox.query(reg.trialId)).startswith("CLOSED_")


def test_restart_after_execution_claim_never_replays(setup):
    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)

    def crash(*args, **kwargs):
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        mailbox.execute_one(approved, crash)
    reopened = x.Mailbox(mailbox.root)
    assert reopened.execute_one(approved, execute)["status"] == "IDLE"
    assert x.reconcile(registry, reg, approved, reopened.query(reg.trialId)) == "RUNNING_OR_UNKNOWN"
    assert registry.status(reg.questionId, reg.trialId)["status"] == "CLAIMED_OUTCOME_UNKNOWN"


def test_unknown_unreceived_does_not_grant_replay(setup):
    registry, reg, mailbox, approved, _ = setup
    assert x.reconcile(registry, reg, approved, mailbox.query(reg.trialId)) == "NOT_RECEIVED"
    assert registry.claim(reg.questionId, reg.trialId, datetime.now(UTC)) is None


@pytest.mark.parametrize(
    "change", ["packet", "sourceCommit", "verifierSha256", "claim", "registration"]
)
def test_changed_admission_rejected_without_execution_claim(setup, change):
    _, reg, mailbox, approved, request = setup
    request[change] = {} if change in {"claim", "registration"} else "bad"
    with pytest.raises((ValueError, KeyError, TypeError)):
        mailbox.submit(encoded(request), approved)
    assert mailbox.query(reg.trialId)["status"] == "NOT_RECEIVED"


@pytest.mark.parametrize(
    "behavior,expected", [("false_pass", "REJECTED"), ("failed", "FAILED"), ("timeout", "FAILED")]
)
def test_worker_claims_and_failures_are_not_qualification(setup, behavior, expected):
    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)

    def worker(*args, **kwargs):
        if behavior == "timeout":
            raise ValueError("WORKER_TIMEOUT")
        result = execute(*args, **kwargs)
        from dataclasses import replace

        return replace(result, output=b'{"PASS":true}', exit_code=7 if behavior == "failed" else 0)

    result = mailbox.execute_one(approved, worker)
    if behavior == "timeout":
        assert result["error"] == "WORKER_TIMEOUT"
    assert x.reconcile(registry, reg, approved, result) == "CLOSED_" + expected
    assert mailbox.execute_one(approved, execute)["status"] == "IDLE"


@pytest.mark.parametrize(
    "field",
    [
        "trialId",
        "packetSha256",
        "claimSha256",
        "sourceCommit",
        "runtimeSha256",
        "verifierSha256",
        "codeBundleSha256",
        "registrationSha256",
        "requestSha256",
        "promotionAuthority",
    ],
)
def test_forged_remote_receipt_cannot_close_plan(setup, field):
    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)
    receipt = mailbox.execute_one(approved, execute)
    receipt[field] = "forged"
    with pytest.raises(ValueError):
        x.reconcile(registry, reg, approved, receipt)
    path, _ = registry.load(reg.questionId, reg.trialId)
    assert not (path / "experiment-closed.json").exists()


def test_resume_after_retained_result_before_closure(setup, monkeypatch):
    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)
    receipt = mailbox.execute_one(approved, execute)
    original = x.immutable

    def interrupted(path, value):
        if path.name == "experiment-closed.json":
            raise OSError("interrupted")
        original(path, value)

    monkeypatch.setattr(x, "immutable", interrupted)
    with pytest.raises(OSError):
        x.reconcile(registry, reg, approved, receipt)
    monkeypatch.setattr(x, "immutable", original)
    assert x.reconcile(registry, reg, approved, receipt) == "CLOSED_INCONCLUSIVE"


def test_mailbox_conflicting_duplicate_and_traversal(setup):
    _, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)
    request["claim"]["claimedAt"] = datetime.now(UTC).isoformat()
    with pytest.raises(ValueError, match="CONFLICT"):
        mailbox.submit(encoded(request), approved)
    with pytest.raises(ValueError, match="ID_INVALID"):
        mailbox.query("../escape")
    assert mailbox.query(reg.trialId)["status"] == "QUEUED"


def test_independent_measurement_matches_known_complete_cohort():
    from tests.python.test_scalp_replay import fixture

    p = fixture()
    raw = encoded(p)
    expected = x.independently_measure(raw)
    assert audit(p) == expected
    assert expected["acceptanceClocks"][0]["availabilityToAcceptanceMicros"] == "2000000"


def test_data_mount_is_read_only_and_bound(monkeypatch, tmp_path):
    from tests.python.test_isolated_worker import FILES, launch_fixture

    trust = launch_fixture(monkeypatch, tmp_path, "print('done')")
    launch = w.subprocess.Popen

    def checked(command, **kwargs):
        position = command.index("/input.json")
        assert command[position - 2] == "--ro-bind"
        assert Path(command[position - 1]).read_bytes() == b"{}"
        return launch(command, **kwargs)

    monkeypatch.setattr(w.subprocess, "Popen", checked)
    assert w.run(
        FILES, w.bundle_digest(FILES), trust, data=b"{}", expected_input=w.digest(b"{}")
    ).input_sha256 == w.digest(b"{}")


@pytest.mark.parametrize(
    "data,expected",
    [(b"x", None), (None, "a" * 64), (b"x", "a" * 64), (b"x" * (8 * 1024**2 + 1), "a" * 64)],
)
def test_unbound_data_never_starts(monkeypatch, tmp_path, data, expected):
    from tests.python.test_isolated_worker import FILES, trust

    monkeypatch.setattr(w.os, "geteuid", lambda: 1001)
    monkeypatch.setattr(w.subprocess, "Popen", lambda *a, **kw: pytest.fail("started"))
    with pytest.raises(ValueError, match="INPUT_CHANGED"):
        w.run(FILES, w.bundle_digest(FILES), trust(tmp_path), data=data, expected_input=expected)


def test_signed_net_not_double_deducted_and_window_excludes_carry_in_closes():
    from python.research.learning_evidence import identity
    from tests.python.test_scalp_replay import at, fill, fixture, model

    p = fixture()
    fill(p, "10")
    p["setups"][0]["cohortRole"] = "CARRY_IN"
    p["setups"][0]["closedTrades"] = [
        {
            "id": identity(str(i)),
            "direction": "LONG",
            "realizedNet": net,
            "signedFees": "-7",
            "openedAt": at(-100),
            "closedAt": at(t),
        }
        for i, (net, t) in enumerate([("100.00", 40), ("-1600.00", 50), ("9000", -70)])
    ]
    p = model(p).model_dump()
    expected = x.independently_measure(encoded(p))
    assert audit(p) == expected
    assert expected["net"] == "-1500.00"
    assert expected["signedFees"] == "-14"
    assert expected["closedRowsInPacket"] == 3 and expected["closedInWindow"] == 2
    assert expected["recordedPartialOrders"] == 1 and expected["recordedOpenPositions"] == 1
    assert expected["roles"]["setups"] == {"CARRY_IN": 1}


def test_missing_acceptance_does_not_use_placement_result_clock():
    from tests.python.test_scalp_replay import fixture, model

    p = fixture()
    p["setups"][0]["brokerEvents"] = []
    p = model(p).model_dump()
    expected = x.independently_measure(encoded(p))
    assert audit(p) == expected
    assert expected["acceptanceClocks"][0]["availabilityToAcceptanceMicros"] is None


def test_receipt_json_schema_matches_model():
    schema = json.loads(Path("schemas/research-experiment-receipt-1.0.json").read_text())
    assert schema == x.Receipt.model_json_schema()


def test_worker_does_not_block_intake_and_query(setup):
    _registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)

    def during_execution(*args, **kwargs):
        # Acquiring the intake lock proves receiver and worker do not serialize long jobs.
        assert mailbox.submit(encoded(request), approved)["status"] == "RUNNING_OR_UNKNOWN"
        assert mailbox.query(reg.trialId)["status"] == "RUNNING_OR_UNKNOWN"
        return execute(*args, **kwargs)

    assert mailbox.execute_one(approved, during_execution)["status"] == "RETURNED"


def test_coordinator_queries_claimed_jobs_despite_registration_failure(
    setup, monkeypatch, tmp_path
):
    from python.operations import experiment_jobs as cli

    registry, reg, mailbox, approved, request = setup
    mailbox.submit(encoded(request), approved)
    mailbox.execute_one(approved, execute)
    agenda = tmp_path / "agenda"
    agenda.mkdir()
    x.immutable(
        agenda / "status.json",
        {
            "planId": "f" * 64,
            "status": "CLOSED",
            "lastCompletedWindow": datetime.now(UTC).isoformat(),
        },
    )
    config = tmp_path / "config.json"
    x.immutable(
        config,
        {
            "mirror": {
                "directory": "/approved",
                "expected_main": "e" * 40,
                "git_sha256": "g",
                "prlimit_sha256": "p",
            }
        },
    )
    monkeypatch.setattr(cli, "provisioned", lambda _: approved)
    monkeypatch.setattr(cli, "verify_source", lambda *args: None)

    def budget(*args, **kwargs):
        raise ValueError("RESEARCH_REGISTRY_TRIAL_BUDGET")

    monkeypatch.setattr(Registry, "register", budget)
    calls = []

    def transfer(payload):
        calls.append(payload)
        return mailbox.query(payload["trialId"])

    monkeypatch.setattr(cli, "transfer", transfer)
    result = cli.cycle(registry.root, agenda, config)
    assert calls == [{"action": "query", "trialId": reg.trialId}]
    assert result["admissionBlocker"] == "RESEARCH_NEW_REGISTRATION_FAILED"
    assert result["recent"][0]["status"] == "CLOSED_INCONCLUSIVE"


def test_ssh_transfer_uses_only_fixed_alias_and_bounded_protocol(monkeypatch, tmp_path):
    from python.operations import experiment_jobs as cli

    def run(command, **kwargs):
        assert command == [
            "ssh",
            "-F",
            str(Path.home() / ".ssh/experiments.conf"),
            "scalper-experiments",
        ]
        assert kwargs["timeout"] == 20 and kwargs["close_fds"]
        assert json.loads(kwargs["input"])["action"] == "query"
        kwargs["stdout"].write(encoded({"trialId": "a" * 64, "status": "NOT_RECEIVED"}))

    monkeypatch.setattr(cli.subprocess, "run", run)
    assert cli.transfer({"action": "query", "trialId": "a" * 64})["status"] == "NOT_RECEIVED"


def test_unordered_context_censors_acceptance_delta():
    from tests.python.test_scalp_replay import at, fixture, model

    p = fixture()
    p["contexts"][0]["requestedAt"] = at(10)
    p["contexts"][0]["clockStatus"] = "UNORDERED"
    p = model(p).model_dump()
    result = audit(p)
    assert result == x.independently_measure(encoded(p))
    assert result["acceptanceClocks"][0]["availabilityToAcceptanceMicros"] is None


def test_coordinator_rotates_all_pending_jobs_without_newest_preference(
    setup, monkeypatch, tmp_path
):
    from python.operations import experiment_jobs as cli

    _registry, reg, _, approved, _ = setup
    regs = [reg.model_copy(update={"trialId": f"{i:064x}"}) for i in range(8)]
    roots = tmp_path / "rotation"
    roots.mkdir()
    for r in regs:
        folder = roots / r.questionId / r.trialId
        folder.mkdir(parents=True)
        (folder / "registration.json").write_text("{}")
    agenda = tmp_path / "rot-agenda"
    agenda.mkdir()
    x.immutable(
        agenda / "status.json",
        {
            "planId": "f" * 64,
            "status": "CLOSED",
            "lastCompletedWindow": datetime.now(UTC).isoformat(),
        },
    )
    config = tmp_path / "rot-config.json"
    x.immutable(
        config,
        {
            "mirror": {
                "directory": "/approved",
                "expected_main": "e" * 40,
                "git_sha256": "g",
                "prlimit_sha256": "p",
            }
        },
    )
    monkeypatch.setattr(cli, "provisioned", lambda _: approved)
    monkeypatch.setattr(cli, "verify_source", lambda *args: None)
    monkeypatch.setattr(Registry, "register", lambda *args: regs[-1])
    monkeypatch.setattr(Registry, "load", lambda self, q, t: (roots / q / t, regs[int(t, 16)]))
    monkeypatch.setattr(Registry, "claim", lambda *args: None)
    monkeypatch.setattr(cli, "reconcile", lambda *args: "RUNNING_OR_UNKNOWN")
    called = []

    def transfer(payload):
        called.append(payload["trialId"])
        return payload

    monkeypatch.setattr(cli, "transfer", transfer)
    cli.cycle(roots, agenda, config)
    cli.cycle(roots, agenda, config)
    assert called == [r.trialId for r in regs]
