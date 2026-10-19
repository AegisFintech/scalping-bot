# ISSUE-301 — Read-only legacy terminal audit

PR: https://github.com/AegisFintech/scalping-bot/pull/313.

This audit does not authorize recovery. On October 19, a fresh bounded broker
history read and flat account snapshot still produced **HOLD** with
`DEMO_TERMINAL_ADDITIONAL_UNCERTAINTY`. The group contains an older entry event
marked CONFLICT (already resolved), in addition to the unresolved closing-event
conflict. The verifier does not ignore contradictory original facts merely
because a resolution marker exists. No conflicting callback variants survive in
this pre-migration journal. Full-group financial completeness is **not proven**.

The local journal contains two entry orders, one closed position and one trade:
net P/L **-432.65**, signed fees **-30.89**. These are recorded demo values, not an
independent financial reconciliation result. The fresh broker snapshot contains
zero open orders and positions; that is necessary evidence, never sufficient
recovery proof. No exact SL/TP exit attribution or profitability claim is made.

## Reproducible, isolated evidence

`scripts/audit-legacy-terminal.ts --output NEW_PRIVATE_FILE` runs from the current
runtime working directory with its protected dotenv configuration. It requires
explicit demo mode, a scoped account key, database access and an existing fresh
secured token. Broker selection follows the normal client contract: a configured
demo account, or exactly one demo account when no ID is configured. Ambiguity
rejects. No token is refreshed or rewritten. Broker order commands are disabled.

Database snapshots use repeatable-read read-only transactions and bounded statement
timeouts. Order history, deal history and reconciliation are fetched serially;
the seven-day window, pagination, row/size caps and proof freshness remain enforced.
A second read must exactly match the first local snapshot. The exclusive mode-0600
report retains private original evidence, hashes and HOLD result, with file and
directory fsync. Console output contains only bounded aggregate results and safe
failure codes. Private evidence and account/order identifiers are not committed.

The helper can inspect pre-0027 snapshots without the variant table. Its separate
legacy audit can continue past a missing closing variant only to assess remaining
financial checks. It always returns HOLD and no broker authority. Production
`proveTerminalGroup` still rejects the missing variant and creates no recovery
hashes. Entry conflicts, retained contradictory variants, altered costs and all
other uncertainty remain rejected. No migration, resolution, trading restart,
accounting reset or recovery command has been performed.

Initial audit preflight rejected an unnecessarily required ACCOUNT_ID. The normal
broker client already supports exactly one verified demo account; aligning the
read-only driver with that contract allowed the successful history retrieval.
The final report remains private; the aggregate result above is its publication
receipt. The missing callbacks cannot be reconstructed by relabelling the retained
original payload or by a flat account snapshot.

## Remaining recovery boundary

The automatic recovery implementation from PR #310 cannot clear this incident.
A separate legacy recovery design must account for **both** historical conflicts,
prove every remaining financial/ownership fact and explicitly preserve the unknown
callback contents. Any eventual exceptional transition needs concrete review; this
audit provides neither a mutator nor permission to bypass the current gate. Do not
reset baselines, delete conflicts, re-import old orders or activate historical data.
Codex trading activation remains dependent on certain recovery and its separate
provider policy integration. The isolated research intake continues independently.

## Validation

The preceding isolated run passed the two new audit/snapshot regression cases
with the existing PostgreSQL lifecycle and Python suites at
`/tmp/scalper-qualification-VTvdYY/checks`. Final validation also covers the observed
resolved entry conflict, altered fees, strict automatic recovery rejection and CLI
preflight redaction/preservation. Full final-head qualification gates merge.

Final local checks: `npm run qualify -- --database-only` passes **89 PostgreSQL and 288 Python tests**, with no skips, at
`/tmp/scalper-qualification-IVPDwN/checks`; `npm run typecheck`, focused ESLint,
three CLI rejection tests, formatting and secret scanning pass. Graphify was
refreshed with AST-only extraction. The frozen observer checkout remains clean
at `984f479`. Full hosted qualification remains the exact-head merge gate.
