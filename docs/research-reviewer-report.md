# Independent local source review and guarded research delivery

Issue [#465](https://github.com/AegisFintech/scalping-bot/issues/465), after the
[#464 handoff](holding-pipeline-report.md). There is one demo executor; this code
has no broker, strategy promotion or economic authority. Publishing remains local,
and required hosted qualification remains enforced.

## Trust and source

The main protected parent relays only the already signed public envelope through
its existing restricted tc01 connection. The receiver authenticates it, caches it
by payload digest and acknowledges durable storage. This data-only relay is safe
to repeat byte-for-byte after a lost acknowledgement; it never calls a model or API.
The reviewer independently authenticates that cache on every process attempt.
No extra inbound service or credentials are needed in a model/code worker.

The fixed reviewer adapter uses the existing separate aloycwl GitHub identity on
tc01. It reconstructs the exact signed commit without checking out/executing model
code, requires the publisher identity/repository/main branch and signed branch name,
and compares current main. Protected workflow and CODEOWNERS bytes are pinned;
branch rules must enforce trusted exact-head CI, independent codeowner review,
last-push/stale dismissal, strict current base, administrator enforcement and no
force-push/deletion. Missing, failed or ambiguous CI/reviews wait or block.

## Independent model contexts

Standards and Spec use separate protected prompts/daily memory pins through the
existing tool-disabled research transport. They are independent of source-generation
context, not independently trained models or human reviews. The existing unprivileged
Codex identity is reused without copying OAuth credentials. Its subprocess environment
contains no GitHub/signing/broker credentials; the fixed root adapter alone holds
aloycwl's API credential and validates the actual identity every cycle.

Each model decision binds publication digest, exact head and axis. Both must approve
without findings before any GitHub transition. Negative/invalid/unknown decisions
remain archived and cannot advance. Eight model attempts bound the reviewed source
set. Memory is context, not training or fresh execution evidence. Python safe-path
mode and a protected working directory prevent writable-home package shadowing.

## Transitions and recovery

The adapter rechecks source, rules, CI and current reviews after the models. Draft
ready, approval and merge each have a durable intent before dispatch. Approvals
explicitly say automated and bind commit_id; merges bind sha and rely on GitHub's
enforced protection. Current mergeability and another fresh guard precede merging.
Checks are observations, not an atomic remote lock. A publisher cannot approve itself.

Model claims without output query saved worker state, never launch a new request.
Saved raw output can finish after restart. Unknown API outcomes query actual PR/
review state; they never blindly repeat approval/merge. Pending human work blocks,
and dismissal/change requests cannot be silently replaced by automatic approval.
A later explicit valid exact-head approval can satisfy the current review predicate.
Changed heads inherit no model/approval result. Terminal contexts remain recorded;
closed/merged PRs are reconciled even after leaving the open list, and reopening a
closed recorded publication grants no automatic authority.

Root-owned policy/ledger and protected artifacts stay separate from model-owned
scratch/memory. The reviewer runs locally under a bounded systemd unit; it never
runs a root Codex process. It drops to the unprivileged identity for model calls.
The signing key stays on the main protected parent, outside publisher-owned state.

## Validation and activation

All2,474 tests pass (1,275 Node,147 PostgreSQL,1,052 Python), along with complete
format/lint/types/build/schema/replay/fail-closed, secrets and dependency audits.
Four sample/deployment configuration checks pass. Commands: `npm run qualify` and
`npm run config:check -- .env.sample [--startup]`, repeated against the existing
running deployment file. [Full receipt](evidence/research-reviewer-validation.json).
Thirty-two focused review/handoff tests pass. Both independent reviews approve after
fixing the final mergeability Boolean recheck. Graphify AST:15,014 nodes/25,366 edges/
903 communities; existing pyproject zero-node warning; no paid semantic extraction.

An actual tc01 systemd probe with the planned capabilities, filesystem restrictions
and loaded reviewer credential dropped to the unprivileged model UID, retained its
existing Codex access and proved the reviewer credential unreadable. It made no
provider call. Live API checks confirmed actual current branch rules and GraphQL
ready input fields. [Preflight/cleanup receipt](evidence/research-reviewer-preflight.json).

The first full run exposed14 forward-study test failures from the existing15% disk
reserve, not reviewer logic. An intermediate rerun was stopped while reserve was
still insufficient and is not counted as passing. Cleanup removed reproducible
inactive caches/build environments while preserving source and locks. Three retired,
unreferenced virtual environments were losslessly archived after full restoration
verified file bytes, permissions, ownership and symlink targets. Source, credentials,
current/rollback runtimes, frozen research and broker records remain preserved;
archives plus SHA/restore index are under `/opt/ctrader-ai-scalper/retired-runtime-archives`.
Available space recovered to8.32GiB versus7.35GiB required reserve. Final passing
qualification has the exact same source hash as the initial failing run; no disk
gate or original forward test was weakened.

Reviewed pushed delivery, matching artifacts and real scheduled readback remain
required before completion. Keep the new generators disabled until this
controller is installed, so the first candidate captures the completed installation.
#466 separately owns natural full-cycle, negative/restart/remote-failure and dashboard
lineage proof. Software delivery does not establish improved returns.

Rollback: stop only the new reviewer timer and restore compatible protected code;
preserve model/API claims, signatures, source, reviews and merge history. Do not
replay unknown outcomes, reset budgets or change the demo deployment.
