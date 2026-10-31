# Recorded holding-time research

Part of [#464](https://github.com/AegisFintech/scalping-bot/issues/464). This batch
adds the next useful bounded task after the delivered payoff audit; it does not
regenerate that task or enable recurring generation. Scheduling and remote receipt
handling remain required before #464 can close. There is no economic activation.

`recorded-holding-payoff-1.0` asks for a standalone descriptive report grouping all
recorded closed rows into predefined holding-duration bins: under5s,5–15s,15–60s,
60–300s,300s-plus and unknown. It preserves empty bins, losses, fee/net unknowns and
reversed-clock rows. Exact microsecond differences use recorded open/close clocks;
closing timestamps select the same half-open experiment window as the original
payoff task. Net already includes signed fees, which are never subtracted twice.
Recorded duration does not establish an available earlier profitable exit, a
TP/SL cause, a recommended target, or counterfactual performance.

The shared generation transport retains durable pre-dispatch claims, original raw
responses, rejected attempts, response-first recovery and the four-attempt cap.
Unknown provider outcomes cannot redispatch. Trusted task definitions select the
contract; generated output cannot choose scope or task. A protected Git-object
admission check detects existing or conflicting task paths before a future caller
makes a paid request. Both paths present means TASK_ALREADY_PRESENT, not proof of
successful qualification. The scheduler still has to invoke this check.

The independent scorer binds exact source, result, finding and rows plus a protected
composite hash of scorer/task/payoff oracle. Twenty-eight cases include actual rows,
empty/unknown data, every duration boundary and fresh mixed-sign decimal challenges.
Only the isolated candidate sees inputs; host expected answers remain outside it.
The completed receipt retains output, all cases and null counterfactual economics.
A claimed interrupted scorer returns unknown instead of executing again.

Signed publication1.1 admits only this module and its trusted note, then the same
protected README/AGENTS metadata. It validates ordered bins and full row totals,
keeps software checks distinct from review, and has draft-only authority. Existing
publication1.0 schema, signatures, commit metadata and recovery remain compatible.
Static style/type checks use the actual task module. Neither contract grants
approval, merge, deployment or broker authority.

Validation: all2,423 tests pass (1,275 Node,147 PostgreSQL,1,001 Python), along with
format/lint/types/build/schema/replay/fail-closed, secret scan and both dependency
audits. Sample and actual running deployment configurations each pass policy and
startup validation. The initial private check used a nonexistent worktree .env and
correctly rejected CONFIG_FILE_UNAVAILABLE; the deployment path was then resolved
from the actual execution process, with no configuration edits. Commands: `npm run
qualify`, `npm run config:check -- .env.sample [--startup]`, and the same checks
against the existing deployment file. [Exact full receipt](evidence/holding-research-validation.json).

Both independent Standards and Spec reviews approve. Spec caught a pre-dispatch
path-admission gap, corrected before the passing full run: folded collisions,
existing ancestors/descendants and Python module shadowing now reject, with seven
real-Git regressions. Graphify AST update:14,860 nodes/24,701 edges/879 communities;
existing pyproject zero-node warning; no paid semantic extraction.

Real archived trial0b3bdf3ec98c7fa6a0aa99773123e43720bbfa538353b01f3b7b2b1a79c27f2f
passed independent evidence binding, retaining both rows in the60–300s bucket and
all other empty buckets. Row digest386981f8332515b14e0fe224b8f163d50d20712b33753bb4c9b06088946186c5.
This previously used software-probe archive was selected for compatibility, not
strategy fitting or a representative economic cohort. The actual existing signed
1.0 envelope still authenticates and computes exact commita9437ada1f803d45d9a0b6b64dd4274c151c52ab.
These checks do not establish a new live tc02 run, scheduled generation or
unattended delivery; #464 remains open until its remaining acceptance is met.

Rollback: restore the previous publisher artifact before any new-version queue
request is accepted. Preserve all queued envelopes, source/response archives and
claims; never rewrite delivered1.0 records or frozen runtime/oracle artifacts.
