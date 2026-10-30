"""Independent software checks for result-derived payoff research, never strategy promotion.

Generated code executes only through the isolated worker. Expected answers remain
outside its namespace; the mounted verifier is a transport, not the test oracle.
"""

from __future__ import annotations

import ast
import json
import re
import secrets
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from pathlib import Path
from typing import Annotated, Any, Final, Literal

from pydantic import Field

from python.research import isolated_worker as worker
from python.research.codex_loop import StrictModel, timestamp
from python.research.experiment_execution import independently_measure
from python.research.experiment_registry import Registration, Registry, read
from python.research.learning_archive import bounded, immutable, parse, unique
from python.research.learning_evidence import MAX_BYTES, Digest, encoded
from python.research.observation_cycle import sha
from python.research.publisher_policy import GitId
from python.research.source_verifier import VerifiedCandidate

TASK: Final = "recorded-payoff-audit-1.0"
MODULE = "python/research/experiments/recorded_payoff.py"
NOTE = "docs/research/proposals/recorded_payoff.md"
PROMPT = """Implement standalone Python report(rows) for recorded-payoff-audit-1.0.
rows is a list of objects with net and signedFees decimal strings or null. Return
exactly: rows, knownNet, unknownNet, wins, losses, flat, knownFees, unknownFees
(integer counts); net, signedFees, winningNet, losingNet (plain decimal strings,
no exponent, strip fractional trailing zeros, represent zero as "0");
lossPerAverageWin (absolute total losses / average positive net,
rounded HALF_EVEN to exactly six decimal places, or null without positive wins).
Net already includes fees: never subtract fees again. Sum known amounts only;
unknown amounts remain counted. losingNet is negative or zero. Empty sums are 0.
Include counterfactualNet:null and economicQualification:false. No trading advice.
Use only from decimal/from typing/from __future__ imports, no module imports,
reflection, external/project dependencies or tools.
Output structured code and a short evidence-grounded rationale. Only this module
is eligible; infrastructure, instructions, tests and execution policy are fixed.
This is retrospective descriptive software, not evidence a strategy is profitable.
"""


class Draft(StrictModel):
    task: Literal["recorded-payoff-audit-1.0"]
    baseCommit: GitId
    resultSha256: Digest
    findingSha256: Digest
    code: Annotated[str, Field(min_length=1, max_length=6000)]
    rationale: Annotated[str, Field(min_length=1, max_length=700)]


def evidence(job: Path) -> tuple[dict[str, Any], list[dict[str, str | None]]]:
    """Admit only a closed independently measured experiment and its exact packet."""
    reg = Registration.model_validate(read(job / "registration.json"))
    raw = bounded(job / "input.json", MAX_BYTES)
    packet = parse(raw, reg.packetSha256)
    result = bounded(job / "result.bin", 65536)
    finding = read(job / "experiment-finding.json")
    receipt = read(job / "remote-receipt.json", 160000)
    closure = read(job / "experiment-closed.json")
    measured = independently_measure(raw)
    if (
        finding["trialId"] != reg.trialId
        or finding["registrationSha256"] != sha(encoded(reg.model_dump()))
        or finding["resultSha256"] != sha(result)
        or finding["receiptSha256"] != sha(encoded(receipt))
        or finding["measurementValidated"] is not True
        or finding["measurement"] != measured
        or json.loads(result, object_pairs_hook=unique) != measured
        or receipt["outputHex"] != result.hex()
        or receipt["packetSha256"] != reg.packetSha256
        or closure
        != {"trialId": reg.trialId, "findingSha256": sha(encoded(finding)), "status": "CLOSED"}
    ):
        raise ValueError("CANDIDATE_EXPERIMENT_BINDING")
    rows: list[dict[str, str | None]] = [
        {"net": t.realizedNet, "signedFees": t.signedFees}
        for g in packet.setups
        for t in g.closedTrades
        if timestamp(packet.start) <= timestamp(t.closedAt) < timestamp(packet.until)
    ]
    return {
        "trialId": reg.trialId,
        "resultSha256": sha(result),
        "findingSha256": sha(encoded(finding)),
        "packetSha256": reg.packetSha256,
        "measurement": measured,
        "question": reg.question,
        "rows": rows,
    }, rows


def dependencies(code: bytes) -> None:
    """Conservative import closure, not a substitute for OS isolation."""
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            raise ValueError("CANDIDATE_DEPENDENCY_FORBIDDEN")
        if isinstance(node, ast.ImportFrom):
            exports = {
                "decimal": {"Decimal", "localcontext", "ROUND_HALF_EVEN"},
                "typing": {"Any", "Dict", "List", "Optional", "Tuple"},
                "__future__": {"annotations"},
            }
            if node.level or any(
                n.name not in exports.get(node.module or "", set()) for n in node.names
            ):
                raise ValueError("CANDIDATE_DEPENDENCY_FORBIDDEN")
        if isinstance(node, ast.Name) and (
            node.id.startswith("__")
            or node.id
            in {
                "__import__",
                "eval",
                "exec",
                "compile",
                "globals",
                "locals",
                "getattr",
                "setattr",
                "__builtins__",
                "vars",
            }
        ):
            raise ValueError("CANDIDATE_DYNAMIC_DEPENDENCY")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("CANDIDATE_DYNAMIC_DEPENDENCY")
    if not any(isinstance(n, ast.FunctionDef) and n.name == "report" for n in tree.body):
        raise ValueError("CANDIDATE_ENTRYPOINT_MISSING")


def candidate_files(draft: Draft, facts: dict[str, Any], base: str) -> dict[str, bytes]:
    if (
        draft.baseCommit != base
        or draft.resultSha256 != facts["resultSha256"]
        or draft.findingSha256 != facts["findingSha256"]
    ):
        raise ValueError("CANDIDATE_BASE_OR_RESULT_CHANGED")
    code = draft.code.encode()
    dependencies(code)
    # Provenance comes from the trusted coordinator; model prose is not executable metadata.
    note = (
        f"# Recorded payoff audit\n\nTask: `{TASK}`. Base: `{base}`.\n"
        f"Trial: `{facts['trialId']}`. Result: `{draft.resultSha256}`.\n"
        f"Finding: `{draft.findingSha256}`.\n\n"
        "Retrospective descriptive research; no trading or economic promotion authority.\n"
        "Generated rationale and all attempted variants remain in the candidate archive.\n"
    ).encode()
    return {MODULE: code, NOTE: note}


def expected(rows: list[dict[str, str | None]]) -> dict[str, Any]:
    nets = [Decimal(r["net"]) for r in rows if r["net"] is not None]
    fees = [Decimal(r["signedFees"]) for r in rows if r["signedFees"] is not None]
    with localcontext() as ctx:
        ctx.prec = 100
        ctx.rounding = ROUND_HALF_EVEN
        wins = [n for n in nets if n > 0]
        losses = [n for n in nets if n < 0]
        winning, losing = sum(wins, Decimal(0)), sum(losses, Decimal(0))
        ratio = ((-losing * len(wins)) / winning).quantize(Decimal("0.000001")) if wins else None
        return {
            "rows": len(rows),
            "knownNet": len(nets),
            "unknownNet": len(rows) - len(nets),
            "wins": len(wins),
            "losses": len(losses),
            "flat": nets.count(Decimal(0)),
            "knownFees": len(fees),
            "unknownFees": len(rows) - len(fees),
            "net": plain(sum(nets, Decimal(0))),
            "signedFees": plain(sum(fees, Decimal(0))),
            "winningNet": plain(winning),
            "losingNet": plain(losing),
            "lossPerAverageWin": format(ratio, "f") if ratio is not None else None,
            "counterfactualNet": None,
            "economicQualification": False,
        }


def plain(amount: Decimal) -> str:
    if amount == 0:
        return "0"
    value = format(amount, "f")
    return value.rstrip("0").rstrip(".") if "." in value else value


def challenges(rows: list[dict[str, str | None]]) -> list[list[dict[str, str | None]]]:
    cases: list[list[dict[str, str | None]]] = [
        rows,
        [],
        [{"net": None, "signedFees": None}],
        [{"net": "0", "signedFees": "-7"}],
    ]
    # Fresh inputs prevent a candidate satisfying qualification with one memorized result.
    for _ in range(24):
        cases.append(
            [
                {
                    "net": None
                    if secrets.randbelow(7) == 0
                    else str(Decimal(secrets.randbelow(400001) - 200000) / 100),
                    "signedFees": None
                    if secrets.randbelow(7) == 0
                    else str(Decimal(secrets.randbelow(20001) - 18000) / 100),
                }
                for _ in range(secrets.randbelow(20) + 1)
            ]
        )
    return cases


def attest(
    verified: VerifiedCandidate,
    facts: dict[str, Any],
    rows: list[dict[str, str | None]],
    trust: worker.WorkerTrust,
    destination: Path,
    oracle_sha256: str,
    execute: Callable[..., worker.WorkerResult] = worker.run,
) -> dict[str, Any]:
    """Freeze tests before execution; never rerun a claimed job after unknown failure."""
    with Registry(destination).locked():
        oracle = Path(__file__).resolve(strict=True)
        worker.trusted_path(oracle)
        if sha(oracle.read_bytes()) != oracle_sha256:
            raise ValueError("CANDIDATE_ORACLE_CHANGED")
        return _attest(verified, facts, rows, trust, destination, oracle_sha256, execute)


def _attest(
    verified: VerifiedCandidate,
    facts: dict[str, Any],
    rows: list[dict[str, str | None]],
    trust: worker.WorkerTrust,
    destination: Path,
    oracle_sha256: str,
    execute: Callable[..., worker.WorkerResult],
) -> dict[str, Any]:
    if set(verified.files) != {MODULE, NOTE}:
        raise ValueError("CANDIDATE_FILE_SET")
    bound_draft = Draft(
        task=TASK,
        baseCommit=verified.receipt.baseCommit,
        resultSha256=facts["resultSha256"],
        findingSha256=facts["findingSha256"],
        code=verified.files[MODULE].decode(),
        rationale="Independent binding check",
    )
    if (
        rows != facts["rows"]
        or candidate_files(bound_draft, facts, verified.receipt.baseCommit) != verified.files
    ):
        raise ValueError("CANDIDATE_FACTS_CHANGED")
    dependencies(verified.files[MODULE])
    if worker.bundle_digest(verified.files) != verified.receipt.bundleSha256:
        raise ValueError("CANDIDATE_SOURCE_BUNDLE_CHANGED")
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    binding = {
        "task": TASK,
        "source": verified.receipt.model_dump(),
        "resultSha256": facts["resultSha256"],
        "findingSha256": facts["findingSha256"],
        "runtimeSha256": trust.runtime_sha256,
        "verifierSha256": trust.verifier_sha256,
        "oracleSha256": oracle_sha256,
    }
    immutable(destination / "binding.json", binding)
    if (destination / "attestation.json").exists():
        return dict(read(destination / "attestation.json"))
    if (destination / "claim.json").exists():
        return {"status": "OUTCOME_UNKNOWN", "publishAuthority": False}
    if not (destination / "input.json").exists():
        immutable(destination / "input.json", {"module": MODULE, "cases": challenges(rows)})
    data = bounded(destination / "input.json", MAX_BYTES)
    cases = json.loads(data, object_pairs_hook=unique)["cases"]
    immutable(
        destination / "claim.json",
        {
            "bindingSha256": sha(encoded(binding)),
            "inputSha256": sha(data),
            "claimedAt": datetime.now(UTC).isoformat(),
        },
    )
    result = execute(
        verified.files, verified.receipt.bundleSha256, trust, data=data, expected_input=sha(data)
    )
    if sha(Path(__file__).read_bytes()) != oracle_sha256:
        raise ValueError("CANDIDATE_ORACLE_CHANGED")
    if (
        result.bundle_sha256 != verified.receipt.bundleSha256
        or result.runtime_sha256 != trust.runtime_sha256
        or result.verifier_sha256 != trust.verifier_sha256
        or result.input_sha256 != sha(data)
        or len(result.output) > worker.MAX_OUTPUT
    ):
        raise ValueError("CANDIDATE_WORKER_BINDING")
    try:
        observed = json.loads(result.output, object_pairs_hook=unique)
    except ValueError:
        observed = None
    # Canonical bytes also distinguish true/1 and false/0 at the JSON boundary.
    wanted = [expected(case) for case in cases]
    passed = result.exit_code == 0 and encoded(observed) == encoded(wanted)
    receipt = {
        **binding,
        "inputSha256": sha(data),
        "outputSha256": sha(result.output),
        "expectedSha256": sha(encoded(wanted)),
        "caseCount": len(cases),
        "completedAt": datetime.now(UTC).isoformat(),
        "status": "AWAITING_INDEPENDENT_REVIEW" if passed else "REJECTED",
        "softwareTestsPassed": passed,
        "independentReview": None,
        "actualReport": wanted[0] if passed else None,
        "economicQualification": False,
        "publishAuthority": False,
        "brokerAuthority": False,
    }
    immutable(
        destination / "output.json",
        {"exitCode": result.exit_code, "outputHex": result.output.hex()},
    )
    immutable(destination / "attestation.json", receipt)
    return receipt


def generate(
    root: Path,
    experiment: Path,
    base: str,
    invoke: Callable[[str, Path], bytes],
) -> dict[str, Any]:
    """One durable provider claim for this task/base/finding, never a checkout or tool call."""
    if not re.fullmatch(r"[a-f0-9]{40}", base):
        raise ValueError("CANDIDATE_BASE_INVALID")
    facts, _ = evidence(experiment)
    key = sha(encoded([TASK, base, facts["findingSha256"]]))
    registry = Registry(root)
    with registry.locked():
        job = registry.directory(key)
        if (
            not job.exists()
            and len(
                [p for p in root.iterdir() if p.is_dir() and re.fullmatch(r"[a-f0-9]{64}", p.name)]
            )
            >= 4
        ):
            return {"status": "CANDIDATE_TASK_TRIAL_BUDGET", "publishAuthority": False}
        job.mkdir(mode=0o700, exist_ok=True)
        binding = {"task": TASK, "baseCommit": base, **facts}
        prompt = PROMPT + "\nINPUT=" + encoded(binding).decode()
        if len(prompt.encode()) > 64000:
            raise ValueError("CANDIDATE_INPUT_OVERSIZED")
        immutable(job / "binding.json", binding)
        if (job / "draft.json").exists():
            draft = Draft.model_validate(read(job / "draft.json", 32768))
            candidate_files(draft, facts, base)
            return {"status": "GENERATED_UNVERIFIED", "job": key}
        if (job / "rejected.json").exists():
            return {"status": "REJECTED", "job": key}
        if (job / "claim.json").exists() and not (job / "response.json").exists():
            return {"status": "OUTCOME_UNKNOWN", "job": key}
        if not (job / "response.json").exists():
            immutable(
                job / "request.json",
                {
                    "promptSha256": sha(PROMPT.encode()),
                    "payload": {"captured_at": datetime.now(UTC).isoformat(), **binding},
                },
            )
            immutable(
                job / "claim.json",
                {
                    "bindingSha256": sha(encoded(binding)),
                    "claimedAt": datetime.now(UTC).isoformat(),
                },
            )
            raw = invoke(prompt, job)
            if len(raw) > 8192:
                raise ValueError("CANDIDATE_OUTPUT_OVERSIZED")
            immutable(job / "response.json", {"raw": raw.decode()})
        try:
            response = read(job / "response.json", 32768)["raw"]
            draft = Draft.model_validate(json.loads(response, object_pairs_hook=unique))
            candidate_files(draft, facts, base)
        except (ValueError, SyntaxError):
            immutable(
                job / "rejected.json", {"status": "REJECTED", "reason": "CANDIDATE_DRAFT_INVALID"}
            )
            return {"status": "REJECTED", "job": key}
        immutable(job / "draft.json", draft.model_dump())
        return {"status": "GENERATED_UNVERIFIED", "job": key}
