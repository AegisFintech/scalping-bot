# ISSUE-331 — Final pair reconciliation

Issue: https://github.com/AegisFintech/scalping-bot/issues/331.

## Behavior

The coordinator already reconciles account/capital and refreshes market evidence
before placement. The demo gateway now additionally refreshes broker exposure and
checks scoped durable execution-journal certainty immediately before the first
order dispatch, after its initial session check. Production flushes the durable execution recorder, including pending callbacks
and failure latches, then reads its scoped store readiness; the dependency is optional only for
standalone adapter/test consumers. Session admission, callback uncertainty,
authority and submission deadlines are rechecked after asynchronous preflight.

New/manual exposure, unresolved close evidence, journal failures or expired
submission authority withhold both entries locally. Both are `REJECTED` with
`DEMO_PREFLIGHT_RECONCILIATION_WITHHELD`, null broker identity and zero filled
volume. Placement auditing retains `locally_unsent`, leaves `submitted_at` null
and never fabricates a broker execution event. Idempotent repeats cannot retry
the withheld pair; fresh setup admission still uses existing scope/cooldown rules.
Session denials retain their existing explicit reason codes.

No flat snapshot proves a trade close. Partial/manual closes with insufficient
closing deal/P&L/protective-child evidence remain blocked. This does not implement
#323's separate locally-unsent-peer terminal attestation or guarantee unattended
recovery after every discretionary broker action. No historical evidence, risk
baseline, gate or runtime control is reset. Checks and broker receipt cannot be
atomic; already dispatched commands retain unknown-outcome handling.

## Tests and delivery

Gateway regression tests cover flat broker plus uncertain/unavailable durable
proof, exposure appearing between reads, successful placement and idempotent
repeats. Existing first-fill/second-dispatch races remain exercised after the
additional preflight reads. Isolated PostgreSQL tests cover the new reason through
placement replay, null submission identity and absence of fabricated broker events.
No schema/migration/HTTP contract change: the existing gateway options gain a
scoped internal callback and the existing unsent audit category gains a reason.

Full qualification results are recorded below before delivery. Rollback is a
normal reviewed source rollback while preserving the database and existing GTC
orders. This change is not deployed by this PR; no broker command/provider call
or active-trade modification was performed for verification.

Validation: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed at
`/tmp/scalper-qualification-5AEQc5/checks/results.json`: 905 Node tests,
92 isolated PostgreSQL integration tests and 376 Python tests. Formatting, ESLint,
TypeScript/build, Ruff/mypy, JSON Schema/migration/fail-closed tests, secret scan,
`npm audit --audit-level=high` and `pip_audit -r requirements.lock` all passed.
The existing Starlette/httpx deprecation warning remains. Focused gateway: 46 tests.
Initial checks caught mock async lint and session-call timing fixtures; corrected
without weakening race assertions. One intermediate run was stopped to add recorder
flushing. Graphify updated AST-only; known zero-node pyproject warning. Hosted
qualification on the final PR head remains required before merge.
