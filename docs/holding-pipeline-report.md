# Scheduled research source, independent checks and protected signing

Issue [#464](https://github.com/AegisFintech/scalping-bot/issues/464), extending
[the holding-time contract](holding-research-report.md). Software delivery only;
no execution, risk, strategy promotion, economic qualification or training authority.

## Roles and data flow

The main machine's protected parent captures remote main and a root-owned bare
mirror, checks whether this task is already present, then asks tc01 for its newest
complete closed-row experiment. Selection uses window time and a stable trial tie
breaker, never net/win sign; the whole selected archive remains in every later step.
Empty archives wait, malformed archives remain counted, and the delivered payoff
module is never selected for generation. Holding-time bins answer the operator's
fast-exit question descriptively; they do not establish an executable earlier exit.

The tc01 generation mailbox uses the existing unprivileged Codex identity and
reviewed tool-disabled research-code transport. It retains the exact six-file
experiment archive, request, pre-provider claim, raw response and validated draft.
The protected parent independently validates that archive and response, preserves
original source, and applies only static Ruff formatting before freezing the new
exact Git tree. Raw-object verification uses the existing scope policy without
checkout, hooks or candidate execution.

The protected parent freezes fresh challenge inputs after source verification;
the returned input bytes must match exactly, including all27 extra cases.
The separate tc02 scoring mailbox executes that exact source under the pinned
credential-free namespace and aggregate cgroup limits. Its independently protected
oracle checks28 cases. The main parent receives every input/output/claim/binding,
recomputes all28 expected outputs, checks every source/result/row/runtime/oracle
binding, and only then signs a version1.1 draft envelope into the existing local
publisher queue. The signing key remains root-only outside publisher-owned state.
Workers receive neither GitHub, reviewer, broker nor signing credentials.

## Retry and source rules

Both mailboxes and the parent use durable hash identities and a four-attempt task
cap. Intake repeats are idempotent. Provider response recovery finishes saved
responses without calling again; a pre-provider claim without response stays unknown.
Scorer claims without completed output stay unknown. Parent transport intent is
persisted before dispatch, and its active pointer precedes that intent. Lost replies
query the same identity, including NOT_RECEIVED; they never blindly resubmit or
redispatch. These uncertain states can require operator investigation rather than
inventing a completed outcome.

Already signed work waits for publication without generating redundant candidates.
Main drift prevents signing/queue delivery and affects research only. Already claimed
work remains query-only if the task becomes present or conflicting. Every queue
write rechecks current main after signing. These are observations rather than an
atomic remote lock; the publisher independently rechecks before GitHub writes. Existing immutable source/response/output
files must compare exactly on restart; no source rewriting or result cherry-picking.
No timer forces provider calls or orders, and none restarts the demo.

## Deployment and completion

The checked-in tc01 generator, tc02 scorer and main protected-parent units run every
one/two minutes after the previous run ends. SSH is provisioned with forced fixed
receivers and dedicated keys; callers cannot select shell commands, paths, runtime
or scorer. Protected policy files contain deployment paths/pins; private host/key
configuration stays untracked. The parent has a fixed read-only GitHub main query;
the separate existing publisher alone creates draft PRs. Required CI and independent
review remain enforced, with review scheduling tracked in #465.

All2,449 tests pass (1,275 Node,147 PostgreSQL,1,027 Python), along with full
format/lint/types/build/schema/replay/fail-closed, secret scanning and both dependency
audits. Four sample/actual-deployment configuration checks pass. Commands: `npm run
qualify`, plus `npm run config:check -- .env.sample [--startup]` and the same checks
against the existing running deployment file. [Exact receipt](evidence/holding-pipeline-validation.json).
The first scheduled-batch full run was intentionally stopped before clarifying the
new research prompt's existing strict typing/style requirements; its interrupted
Node step is not counted as a pass. The replacement complete run is the receipt above.

Both independent reviews pass after correcting parent-owned challenge input and
malformed-archive denominator retention; original provider prompt/payload/time
binding is also verified. An adversarial case replacing27 challenges and rehashing
all reported evidence now rejects. Fifty-five focused foundation/handoff tests
pass, including actual Git-object construction and SSH signature/queue idempotence.
Graphify AST:14,944 nodes/25,081 edges/901 communities, existing pyproject zero-node
warning, no paid semantic extraction.

The units are not yet activated. Reviewed pushed source, matching protected artifacts,
real scheduled generation/tc02 checks and signed queue receipt remain required.
Activate the first paid generation after #465's reviewer installation commits, so
the candidate captures the finished source instead of becoming stale during setup. #466 separately requires natural review-to-merge, negative,
restart/remote-failure and dashboard lineage proof. Software PASS proves no return.

Rollback: stop only these three new timers, preserve mailbox/claim/response/queue
archives, and restore compatible protected artifacts. Never reset research budgets,
replay unknown requests, change frozen #450 worker/runtime artifacts or restart trading.
