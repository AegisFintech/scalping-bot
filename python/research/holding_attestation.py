"""Independent holding-time checks with a protected composite host-oracle pin."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from python.research import candidate_attestation as payoff
from python.research import holding_task as task
from python.research import isolated_worker as worker
from python.research.experiment_registry import Registry, read
from python.research.learning_archive import bounded, immutable, unique
from python.research.learning_evidence import MAX_BYTES, encoded
from python.research.observation_cycle import sha
from python.research.source_verifier import VerifiedCandidate


def oracle_pin() -> str:
    files = {"scorer": Path(__file__), "task": Path(task.__file__), "payoff": Path(payoff.__file__)}
    for path in files.values():
        worker.trusted_path(path.resolve(strict=True))
    return sha(encoded({name: sha(path.read_bytes()) for name, path in files.items()}))


def attest(
    verified: VerifiedCandidate,
    facts: dict[str, Any],
    rows: list[dict[str, str | None]],
    trust: worker.WorkerTrust,
    destination: Path,
    oracle_sha256: str,
    execute: Callable[..., worker.WorkerResult] = worker.run,
) -> dict[str, Any]:
    with Registry(destination).locked():
        if oracle_pin() != oracle_sha256:
            raise ValueError("HOLDING_ORACLE_CHANGED")
        if set(verified.files) != {task.MODULE, task.NOTE}:
            raise ValueError("HOLDING_FILE_SET")
        draft = task.Draft(
            task=task.TASK,
            baseCommit=verified.receipt.baseCommit,
            resultSha256=facts["resultSha256"],
            findingSha256=facts["findingSha256"],
            code=verified.files[task.MODULE].decode(),
            rationale="Independent binding check",
        )
        if (
            rows != facts["rows"]
            or task.candidate_files(draft, facts, draft.baseCommit) != verified.files
        ):
            raise ValueError("HOLDING_FACTS_CHANGED")
        if worker.bundle_digest(verified.files) != verified.receipt.bundleSha256:
            raise ValueError("HOLDING_SOURCE_BUNDLE_CHANGED")
        binding = {
            "task": task.TASK,
            "source": verified.receipt.model_dump(),
            "resultSha256": facts["resultSha256"],
            "findingSha256": facts["findingSha256"],
            "runtimeSha256": trust.runtime_sha256,
            "verifierSha256": trust.verifier_sha256,
            "oracleSha256": oracle_sha256,
            "rowsSha256": sha(encoded(rows)),
        }
        immutable(destination / "binding.json", binding)
        if (destination / "attestation.json").exists():
            return dict(read(destination / "attestation.json"))
        if (destination / "claim.json").exists():
            return {"status": "OUTCOME_UNKNOWN", "publishAuthority": False}
        if not (destination / "input.json").exists():
            immutable(
                destination / "input.json", {"module": task.MODULE, "cases": task.challenges(rows)}
            )
        data = bounded(destination / "input.json", MAX_BYTES)
        challenge = json.loads(data, object_pairs_hook=unique)
        cases = challenge["cases"]
        if challenge["module"] != task.MODULE or len(cases) != 28 or cases[0] != rows:
            raise ValueError("HOLDING_CHALLENGE_CHANGED")
        immutable(
            destination / "claim.json",
            {
                "bindingSha256": sha(encoded(binding)),
                "inputSha256": sha(data),
                "claimedAt": datetime.now(UTC).isoformat(),
            },
        )
        result = execute(
            verified.files,
            verified.receipt.bundleSha256,
            trust,
            data=data,
            expected_input=sha(data),
        )
        if oracle_pin() != oracle_sha256:
            raise ValueError("HOLDING_ORACLE_CHANGED")
        if (
            result.bundle_sha256 != verified.receipt.bundleSha256
            or result.runtime_sha256 != trust.runtime_sha256
            or result.verifier_sha256 != trust.verifier_sha256
            or result.input_sha256 != sha(data)
            or len(result.output) > worker.MAX_OUTPUT
        ):
            raise ValueError("HOLDING_WORKER_BINDING")
        try:
            observed = json.loads(result.output, object_pairs_hook=unique)
        except ValueError:
            observed = None
        wanted = [task.expected(case) for case in cases]
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
