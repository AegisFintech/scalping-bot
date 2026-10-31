"""Trusted contract/oracle for descriptive holding-time research, never exit advice."""

from __future__ import annotations

import json
import re
import secrets
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Final, Literal

from pydantic import Field, TypeAdapter, ValidationError

from python.research import candidate_attestation as payoff
from python.research.candidate_generation import generate as generate_task
from python.research.codex_loop import StrictModel, timestamp
from python.research.learning_archive import bounded, parse
from python.research.learning_evidence import MAX_BYTES, MAX_RECORDS, Digest, Number
from python.research.publisher_policy import GitId, folded
from python.research.source_verifier import GitObjects, MirrorTrust

TASK: Final = "recorded-holding-payoff-1.0"
MODULE = "python/research/experiments/recorded_holding_payoff.py"
NOTE = "docs/research/proposals/recorded_holding_payoff.md"
BUCKETS = ("under_5s", "5_to_15s", "15_to_60s", "60_to_300s", "300s_plus", "unknown")
LIMITS = (5_000_000, 15_000_000, 60_000_000, 300_000_000)
INPUT_VERSION = "recorded-holding-input-1.0"
MAX_ROWS = MAX_RECORDS * 10


class HoldingRow(StrictModel):
    holdingMicros: Annotated[str, Field(pattern=r"^[0-9]{1,20}$", max_length=20)] | None
    net: Number | None
    signedFees: Number | None


ROWS: TypeAdapter[list[HoldingRow]] = TypeAdapter(
    Annotated[list[HoldingRow], Field(max_length=MAX_ROWS)]
)
INPUT_RULES = (
    "Supported input domain " + INPUT_VERSION + ": the trusted caller validates this JSON schema "
    "before invoking report. Only values in this bounded domain are supported. "
    "The archived envelope is independently limited to " + str(MAX_BYTES) + " bytes. "
    "Report must preserve every supported row, including nulls. "
    "Do not broaden the input domain or infer missing values. Schema="
    + json.dumps(ROWS.json_schema(), sort_keys=True, separators=(",", ":"))
)


def validate_rows(rows: list[dict[str, str | None]]) -> None:
    try:
        ROWS.validate_python(rows, strict=True)
    except ValidationError:
        raise ValueError("HOLDING_INPUT_INVALID") from None


PROMPT = (
    """Implement standalone Python report(rows) for recorded-holding-payoff-1.0.
Each row has holdingMicros (nonnegative integer string or null), net and signedFees
(plain signed decimal strings or null). Holding time is from recorded closure-row
open/close clocks; it is not evidence of an executable earlier profitable exit.
Return exactly rows (integer), buckets (six ordered objects), counterfactualNet:null,
economicQualification:false. Bucket objects have bucket and payoff. In order use
under_5s (<5000000), 5_to_15s (<15000000), 15_to_60s (<60000000),
60_to_300s (<300000000), 300s_plus (>=300000000), unknown (holdingMicros null).
Include empty buckets. Each payoff object implements this exact contract:
rows, knownNet, unknownNet, wins, losses, flat, knownFees, unknownFees (integer counts);
net, signedFees, winningNet, losingNet (plain decimal strings, strip fractional
trailing zeros, zero is "0"); lossPerAverageWin (absolute total losses divided by
average positive net, HALF_EVEN exactly six decimals, or null without wins);
counterfactualNet:null, economicQualification:false. Net includes fees already:
never subtract them twice. Unknown values remain counted. Preserve every row,
including unknown holding clocks. No causal exit classification or trading advice.
Only these imports are permitted: from decimal import Decimal, localcontext,
ROUND_HALF_EVEN; from typing import Any, Dict, List, Optional, Tuple;
from __future__ import annotations. No other imported symbols: TypedDict is not
permitted. Built-in list/dict annotations or Any can express nested results.
No project dependencies, tools, reflection, network or files.
Use explicit parameter and return annotations
for every function; the source must pass mypy --strict and Ruff check/format on
Python3.13. Return structured code and a short rationale.
"""
    + "\n"
    + INPUT_RULES
)


class Draft(StrictModel):
    task: Literal["recorded-holding-payoff-1.0"]
    baseCommit: GitId
    resultSha256: Digest
    findingSha256: Digest
    code: Annotated[str, Field(min_length=1, max_length=6000)]
    rationale: Annotated[str, Field(min_length=1, max_length=700)]


def evidence(job: Path) -> tuple[dict[str, Any], list[dict[str, str | None]]]:
    facts, original = payoff.evidence(job)
    packet = parse(bounded(job / "input.json", MAX_BYTES), facts["packetSha256"])
    rows = []
    for group in packet.setups:
        for trade in group.closedTrades:
            if not timestamp(packet.start) <= timestamp(trade.closedAt) < timestamp(packet.until):
                continue
            delta = timestamp(trade.closedAt) - timestamp(trade.openedAt)
            micros = (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
            rows.append(
                {
                    "holdingMicros": str(micros) if micros >= 0 else None,
                    "net": trade.realizedNet,
                    "signedFees": trade.signedFees,
                }
            )
    if [{k: r[k] for k in ("net", "signedFees")} for r in rows] != original:
        raise ValueError("HOLDING_EVIDENCE_ROWS_CHANGED")
    validate_rows(rows)
    return {**facts, "rows": rows}, rows


def candidate_files(draft: Draft, facts: dict[str, Any], base: str) -> dict[str, bytes]:
    if (
        draft.baseCommit != base
        or draft.resultSha256 != facts["resultSha256"]
        or draft.findingSha256 != facts["findingSha256"]
    ):
        raise ValueError("HOLDING_BASE_OR_RESULT_CHANGED")
    code = draft.code.encode()
    payoff.dependencies(code)
    note = (
        f"# Recorded holding-time payoff\n\nTask: `{TASK}`. Base: `{base}`.\n"
        f"Trial: `{facts['trialId']}`. Result: `{draft.resultSha256}`.\n"
        f"Finding: `{draft.findingSha256}`.\n\n"
        "Recorded closure rows only; clock-unknown rows remain counted.\n"
        "Duration and net outcomes do not identify exit cause or available earlier profit.\n"
        "Retrospective descriptive research; no economic or broker authority.\n"
        "Original responses and all attempted variants remain archived.\n"
    ).encode()
    return {MODULE: code, NOTE: note}


def bucket(row: dict[str, str | None]) -> str:
    value = row["holdingMicros"]
    if value is None:
        return "unknown"
    if not value.isascii() or not value.isdigit() or len(value) > 20:
        raise ValueError("HOLDING_DURATION_INVALID")
    micros = int(value)
    return BUCKETS[next((i for i, limit in enumerate(LIMITS) if micros < limit), 4)]


def expected(rows: list[dict[str, str | None]]) -> dict[str, Any]:
    validate_rows(rows)
    classified = [(bucket(row), row) for row in rows]
    return {
        "rows": len(rows),
        "buckets": [
            {
                "bucket": name,
                "payoff": payoff.expected(
                    [row for category, row in classified if category == name]
                ),
            }
            for name in BUCKETS
        ],
        "counterfactualNet": None,
        "economicQualification": False,
    }


def challenges(rows: list[dict[str, str | None]]) -> list[list[dict[str, str | None]]]:
    validate_rows(rows)
    boundaries = [0, *[n - 1 for n in LIMITS], *LIMITS, 900_000_000]
    cases: list[list[dict[str, str | None]]] = [
        rows,
        [],
        [{"holdingMicros": None, "net": None, "signedFees": None}],
        [{"holdingMicros": str(n), "net": "0", "signedFees": "-7"} for n in boundaries],
    ]
    largest = "9" * 20 + "." + "9" * 10
    cases[3].extend(
        [
            {"holdingMicros": "9" * 20, "net": largest, "signedFees": "-" + largest},
            {"holdingMicros": "0", "net": "-" + largest, "signedFees": largest},
            {"holdingMicros": "0", "net": "0.0000000001", "signedFees": None},
        ]
    )
    for source in payoff.challenges([])[4:]:
        cases.append(
            [
                {
                    **row,
                    "holdingMicros": None
                    if secrets.randbelow(7) == 0
                    else str(secrets.randbelow(900_000_001)),
                }
                for row in source
            ]
        )
    cases[-1] = [
        {"holdingMicros": "0", "net": largest, "signedFees": "-" + largest},
        {"holdingMicros": "9" * 20, "net": "-" + largest, "signedFees": None},
    ] * (MAX_ROWS // 2)
    return cases


def generate(
    root: Path, experiment: Path, base: str, invoke: Callable[[str, Path], bytes]
) -> dict[str, Any]:
    return generate_task(
        root,
        experiment,
        base,
        invoke,
        task=TASK,
        prompt_text=PROMPT,
        measure=evidence,
        draft_model=Draft,
        files=candidate_files,
    )


def admission(trust: MirrorTrust) -> dict[str, str]:
    """Check the protected base before a model call; delivered tasks are never recreated."""
    trust.verify()
    objects = GitObjects(trust)
    base = objects.main()
    first = objects.read(base, "commit").split(b"\n", 1)[0]
    if not re.fullmatch(rb"tree [a-f0-9]{40}", first):
        raise ValueError("HOLDING_BASE_COMMIT_INVALID")
    snapshot, _ = objects.snapshot(first[5:].decode())
    objects.main()
    present = {name for name in (MODULE, NOTE) if name in snapshot.entries}
    if present == {MODULE, NOTE}:
        return {"status": "TASK_ALREADY_PRESENT", "baseCommit": base}
    conflicts = any(
        a == b or a.startswith(b + "/") or b.startswith(a + "/")
        for target in (MODULE, NOTE)
        for path in snapshot.entries
        for a, b in [(folded(target), folded(path))]
    )
    shadow = any(
        path.endswith(".py")
        and folded(PurePosixPath(path).stem) == folded(PurePosixPath(MODULE).stem)
        for path in snapshot.entries
    )
    if present or conflicts or shadow:
        return {"status": "TASK_PATH_CONFLICT", "baseCommit": base}
    return {"status": "ELIGIBLE", "baseCommit": base}
