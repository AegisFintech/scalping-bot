# October 5 upgrade delivery and qualification

The six operator-requested upgrade batches are recorded in GitHub issues and
implemented in an isolated worktree. Nine dedicated stacked PRs contain the
six batches and three focused follow-ups. All commits are pushed. The original
`/root/scalping-bot` checkout, active build, private environment, database, trading
processes and frozen #255 observer remain unchanged. No strategy promotion,
accounting reset, order replay, live enablement or service deployment occurred.

| Batch                  | Issue                                                           | Source PR                                                                                                                    | Result                                                                                                          |
| ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Broker transport       | [#257](https://github.com/AegisFintech/scalping-bot/issues/257) | [#263](https://github.com/AegisFintech/scalping-bot/pull/263), [#266](https://github.com/AegisFintech/scalping-bot/pull/266) | Generation-bound queued requests, bounded connection attempts, obsolete retry timer recovery                    |
| Market readiness       | [#258](https://github.com/AegisFintech/scalping-bot/issues/258) | [#264](https://github.com/AegisFintech/scalping-bot/pull/264)                                                                | Independent session/quote/snapshot health with stale-completion rejection                                       |
| Qualification/security | [#259](https://github.com/AegisFintech/scalping-bot/issues/259) | [#265](https://github.com/AegisFintech/scalping-bot/pull/265), [#269](https://github.com/AegisFintech/scalping-bot/pull/269) | Patched locks, effective scanner, formatting repair, disposable TLS PostgreSQL, pinned CI and portable fixtures |
| Releases               | [#260](https://github.com/AegisFintech/scalping-bot/issues/260) | [#267](https://github.com/AegisFintech/scalping-bot/pull/267), [#271](https://github.com/AegisFintech/scalping-bot/pull/271) | Exclusive qualified bundles and verified explicit supervisor paths; rollout still pending                       |
| Diagnostics            | [#261](https://github.com/AegisFintech/scalping-bot/issues/261) | [#268](https://github.com/AegisFintech/scalping-bot/pull/268)                                                                | Owned fill/protection/cost evidence and per-trade pre-intent equity ratios                                      |
| Research               | [#262](https://github.com/AegisFintech/scalping-bot/issues/262) | [#270](https://github.com/AegisFintech/scalping-bot/pull/270)                                                                | Integrity-checked immutable summary of every retained window; ongoing collection remains HOLD                   |

Detailed reports: [transport](upgrade-batch-257-report.md),
[health](upgrade-batch-258-report.md), [qualification](upgrade-batch-259-report.md),
[releases](upgrade-batch-260-report.md), [diagnostics](upgrade-batch-261-report.md),
[research/recovery](upgrade-batch-262-report.md).

## Economic review

The fixed release cohort, September 21 00:00 through October 5 02:00 UTC,
contains 159 observed demo trades: 87 wins (54.7%), gross 1,227.45, signed costs
-3,456.07, net **-2,228.62**, profit factor **0.9257**. Closed-trade cumulative P/L
drawdown is 4,766.03; it is not account-equity drawdown. Removing the largest
winner leaves net -5,179.18, a sensitivity observation rather than a selection
rule. All 159 have matched pre-intent reconciled equity, complete owned entry-fill
volume, historical protection samples and exact close-cost evidence. Exact SL/TP
reason, actual filled stop risk and provider costs remain unavailable. This cohort
does not establish profitability or authorize economic changes.

Prospective evidence at October 5 03:26 UTC contains two immutable windows, one
with 12 closed trades (net -813.10) and one empty. No due missing window at that
cutoff. All open/gap/censored paths and entry/TP denominators remain visible;
counterfactual net P/L stays null and the recommendation remains HOLD. Thirty
calendar days is a collection batch, not strategy qualification.

## Final combined qualification

Pinned Node **22.23.2** / Python **3.13.5**, source commit `9d5db54`, code
fingerprint `21f8dfea84f57c7d9da43e2bb348ba96874f4260ba9a20cddc33543708d1c5b9`.
`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` completed with
`qualified=true` and every phase passing. Private logs:
`/tmp/scalper-qualification-RIjzCc/checks`. Sanitized durable results:
[qualification summary](evidence/upgrade-qualification-20261005.json).

- Full Prettier, ESLint, TypeScript, isolated TypeScript build: passed.
- `vitest run --exclude '**/*.integration.test.ts' --maxWorkers=1`:
  **812 passed, 106 files**, including JSON Schema, migration and fail-closed
  replay tests.
- Ruff format/check and mypy for Python/dashboard: passed.
- Secret scanner: passed; `npm audit --audit-level=high`: **0 vulnerabilities**;
  `python -m pip_audit -r requirements.lock`: **0 vulnerabilities**.
- Disposable TLS PostgreSQL lifecycle suite: **70 passed, no skips**. No
  production database URL is passed to tests; only the owned cluster is stopped
  and removed. Python tests: **261 passed, no skips**, including storage DB tests.
- Read-only policy and `--startup` configuration checks against the original
  private file: both valid, policy `0.3.0-fade-limit.3`, 20 normal settings,
  requested model `grok-4.5`. PM2-cached environment was not reloaded or changed;
  file validation does not claim an operational restart.

Hosted runs for the same source both passed:
[push qualification](https://github.com/AegisFintech/scalping-bot/actions/runs/37260441361)
and [PR qualification](https://github.com/AegisFintech/scalping-bot/actions/runs/37260445219).
These validate source/test behavior, not broker execution or economic superiority.
Documentation-only delivery updates preserve the qualified code fingerprint and
receive their own formatting/diff/secret checks.

The first real release preparation correctly refused `RELEASE_EXTERNAL_LINK`:
Node cp had rewritten relative dependency links to absolute paths in the old
checkout. The follow-up preserves verbatim symlink targets and keeps external
links rejected. The regression covers the actual copy helper, and the real
exclusive-bundle smoke passed after final requalification. Failed partial
bundles are retained, never silently overwritten or launched.

The initial interrupted local run was stopped for a new hosted-fixture correction;
its signal-induced type phase failure is not a completed qualification result.
Earlier CI revealed two test assumptions: JavaScript millisecond evidence could
precede PostgreSQL microsecond availability, and an unprivileged runner cannot
inspect every process descriptor. Fixtures now preserve causal ordering and use
a controlled inventory with a real open descriptor. A separate failure test
proves permission uncertainty preserves logs. Production gates are unchanged.

Actual private diagnostics and retained research summaries also pass their JSON
Schemas. Graphify AST update completed: 5,134 nodes / 10,048 edges. The known empty
`pyproject.toml` warning remains; no semantic-document refresh is claimed.

The real qualified bundle was prepared into a fresh disposable directory with
empty isolated state/log directories. Its bundled verifier and protected-environment
supervisor definitions passed. Node 24 was rejected with
`RELEASE_RUNTIME_MISMATCH`; reusing an existing destination was refused without
changing its manifest. Stale qualification evidence was refused before creating
an output directory. No PM2/systemd service was started. The retained failed
partial bundle was not overwritten. These are preparation/integrity checks;
operational restart/failure drills remain pending rollout.

## Delivery and recovery limits

All nine upgrade PRs are ready for review after final qualification. They remain
stacked on the existing research/recovery PR chain; older individual heads retain
their own historical checks. The passing final combined source is not a claim
that obsolete standalone head checks have been rewritten. Review/requalify each
integrated target in dependency order before merging; no failed check or protection
was bypassed.

The repository reports `allow_auto_merge=false`. The explicit GraphQL
`enablePullRequestAutoMerge` attempt was rejected: **“Auto merge is not allowed
for this repository.”** An owner must enable repository auto-merge before it can
be armed; upstream reviews/checks must still pass. Repository settings, branch
protections and existing upstream drafts were not changed. No PR was merged or
runtime deployed.

GitHub preserves this backlog, implementation and sanitized validation results.
Private database/chart/tape/study evidence and credentials still require verified,
encrypted off-host backups. None were uploaded to GitHub and no off-host backup
is claimed. The recovery procedure is in the research report. Deployment and
supervisor restart/failure drills are a separate #260 milestone; prospective
collection and independent economic qualification remain separate #262 milestones.
