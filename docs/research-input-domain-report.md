# Bounded research input domain

Issue [#480](https://github.com/AegisFintech/scalping-bot/issues/480), following the
[actual scheduled review veto](research-pipeline-activation-report.md). The existing
candidate, review and four-attempt ledger remain intact. No corrective generation
allowance is activated by this source change.

The generated code in #479 passed its28 software cases but used int conversions
and decimal-scale powers on a supplied contract that did not state input limits.
The independent reviewer requested changes. A4301-digit integer reproduces Python's
integer-string limit; the actual archive Number type already rejects it. The prompt
and review therefore lacked important trusted caller context, while direct oracle
calls did not consistently enforce that context before decimal work.

A shared Pydantic schema now names `recorded-holding-input-1.0`. It reuses the archive
Number grammar: at most20 integer digits and10 fractional digits/32 characters,
without exponent/plus/NaN/Infinity syntax; duration is an ASCII nonnegative integer
of at most20 digits or null. All three fields are required, extra keys reject,
and rows are bounded to2,000 setup records ×10 closed trades =20,000. Unknown values
and every supported row remain counted. The independently bounded archive envelope
stays8MiB. Provider and transport limits remain independent, unchanged and fail closed.

Evidence extraction, oracle and challenge generation use that validator. Every frozen
case is validated before a namespace execution claim. Generated guidance and both
source-review contexts receive the exact schema, rather than independently maintained
prose limits. Candidate report() is called only within this validated domain. No
unsupported row is truncated, silently dropped or converted into a zero/unknown.

The28-case set retains actual/empty/unknown data and all duration boundaries, adding
maximum-size numeric values and a full20,000-row case. Unsupported inputs are tested
at the trusted boundary before execution. The composite oracle pin also includes
the imported input-domain source; future boundary changes require a matching pin.
Existing runtime/verifier files and historical28-case inputs/receipts are untouched.

Eight red regressions reproduced uncontrolled handling/acceptance before the fix.
The focused task/scorer/reviewer/publisher suite passed135 tests before the final
oracle-pin regression; that additional regression passes. Both independent Standards
and Spec reviews approve; Spec independently verified61 focused tests. Full qualification
passes all2,509 tests (1,275 Node,147 PostgreSQL,1,087 Python) and all format/lint/types/
build/schema/replay/fail-closed, secret and dependency audit gates. Four sample/
deployment policy/startup configuration checks pass. [Exact qualification receipt](evidence/research-input-domain-validation.json).
Graphify AST:15,104 nodes/25,618 edges/876 communities; existing pyproject zero-node
warning remains; no paid semantic extraction. Hosted exact-head checks, separate
GitHub approval and matching research-only activation remain required.
Historical signed1.0/1.1 payloads still authenticate and compute their original exact
commits. [Compatibility receipt](evidence/research-input-signed-compatibility.json).
No archived review is rerun or relabelled APPROVE by this code.

A future batch needs separately registered scope/allowance, fresh source freeze,
matching oracle/scorer artifacts, independent attestation, both model approvals,
exact-head CI and separate GitHub approval. The existing batch remains exhausted.
The pending operator question concerns that new allowance only; ordinary code repair,
qualification, delivery and verified issue closure continue within existing authority.

Rollback preserves all root/worker claims and original supported-domain provenance.
Retain the old protected artifacts/oracle for reading historical jobs; never point a
new oracle at an old claimed registration or rewrite its input/results. Trading and
frozen economic studies are unaffected.

Commands: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`,
`npm run config:check -- .env.sample [--startup]` repeated against the existing
deployment file, focused `.venv/bin/pytest -q tests/python/test_holding*` plus source
review/publisher/boundary suites, Ruff/mypy and `graphify update .`. Final qualified
source fingerprint: `a029263a3efebc7d9b2fdf0d84a772db7587ccfd3c36eecd4aab46931b245304`.

## Reviewed activation

[PR #481](https://github.com/AegisFintech/scalping-bot/pull/481) merged
`7ba0c3b84306a54d03f60f2b15c70d8ff04bf0b9` after both hosted qualification runs
[push](https://github.com/AegisFintech/scalping-bot/actions/runs/41175824377) /
[PR](https://github.com/AegisFintech/scalping-bot/actions/runs/41175834632), exact
head `4a4086aff54ea7ca8271400f0f2109423e4792fb` and separate aloycwl approval.
The merge tree equals the reviewed head. Research parent, tc01 generation/reviewer/
health and tc02 scoring now use that reviewed source. All334 deployed runtime files,
root ownership/permissions and inventory hash match across the three machines.
The scorer's matching composite pin is
`5c960f183a861fed6047710256658904baecc3ba75d7e1ab3360e88a7d993a78`.

A separate unprivileged tc02 software probe actually passed all28 cases, including
maximum numeric values and20,000 rows, under the configured512MiB/no-swap/32-task/
50% CPU service limits. Oversized input rejects. It used the unchanged frozen
runtime/verifier, made zero provider calls, had no publication authority and did
not override the old source review. Its unused unit is retired; code, input, claim,
output and receipt remain preserved. [Probe/activation receipt](evidence/research-input-domain-activation.json).

The first full tc02 artifact transfer was incomplete and failed its import check
before changing the scorer alias. Only that proven unused partial copy was removed;
a compact runtime bundle was installed, its334 files verified, then the new pin/
alias applied. All paused timers resumed. The four original trading processes,
credentials, accounting/history and risk/strategy remain untouched.

#479 was closed as a rejected exhausted-batch draft after main changed. Its signed
bytes, exact head, model veto and all publication phase hashes are retained in a
protected terminal archive; no approval/merge occurred. Generation remains exactly
four claims/four responses. The parent explicitly reports
`HOLDING_AUTHORITY_TASK_BUDGET`; this is the batch allowance gate, not a provider
quota or trading-content refusal. No new corrective batch is activated. Its separate
allowance decision remains pending under #466; #480's code/activation acceptance is met.
