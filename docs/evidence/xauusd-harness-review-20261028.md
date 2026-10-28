# tc01 Aurum/XAUUSD harness: integration research

Inspected read-only on 2026-10-28, approximately05:06–05:10 UTC. No provider calls,
research executions, trading commands, service changes, dependency installs, pulls,
resets or remote edits were performed. Existing remote dirty state preserved.

## Source and runtime scope

- Remote checkout `/root/xauusd`, HEAD `35854ce652eb6541760c553f9176fbf5bae223fa`,
  matches GitHub main ([commit](https://github.com/AegisFintech/xauusd/commit/35854ce652eb6541760c553f9176fbf5bae223fa)).
- Dirty tracked state: deletion of old `.opencode/` configuration/plugin/skills;
  changed generated Graphify files. Untracked data, deployment/cleanup notes,
  `docs/superpowers/` and generated research reports exist. Do not pull/merge or
  `git add -A` indiscriminately. No modified tracked application file appeared in
  status, but runtime/workspace/generated artifacts remain distinct from GitHub.
- `graphify query` ran first against3918-node graph; source paths/lines below
  were checked directly because the broad graph query truncated.
- Running units: `xauusd-agent.service`, `xauusd-engine.service`,
  `xauusd-data-feed.service`; agent cwd `/root/xauusd`. Engine process being
  active is not evidence engine is unhalted. `xauusd-release-verify.service` is
  inactive between verification work; not itself a fault.
- API `/api/health` and `/api/lab` at loopback8100 were queried read-only.
  No private environment/config values or account identities were read or returned.

## Important measured result: capable framework, stalled learning

At approximately05:06 UTC, `/api/lab` and health reported:

| Observation                                          | Value / scope                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Retained learning cycles                             | 120, all autonomous                                                   |
| Autonomous cycles with supported autonomous findings | 0                                                                     |
| Retained findings                                    | 28, all legacy origin unknown                                         |
| Verified software repairs                            | 2; not evidence of profitable or autonomous trading discovery         |
| Qualified / probation candidates                     | 0 /0                                                                  |
| Stagnation count                                     | 211 cycles; health degraded for unchanged experimental evidence       |
| Recent tool failure rate                             | 0.75 across last20 calls                                              |
| Historical unknown executions                        | 13 parked; pending investigation0; never replay                       |
| Outstanding completion bottleneck                    | 1 running plan with completed results but no finding                  |
| Current recent call failures                         | `invalid_plan_shape`, `unknown_tool`, `unchanged_research_read_limit` |

Recent autonomous calls attempted `research_execution`, `research_recovery` and
`tool_results` as tools, receiving `unknown_tool`. Those names are structured
brief fields, not registered tool names. It also sent invalid `research_plan`
shapes. This is observed evidence of a completion/interface problem, not proof
that changing model or adding tokens alone solves it. Runtime attribution checks
server-assigned provenance, not narrative claims:
[`learning_audit.py:27–45`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/learning_audit.py#L27).
The existing deployment plan explicitly leaves unattended outcome observation
unchecked: [`learning-loop-plan:32`](https://github.com/AegisFintech/xauusd/blob/35854ce/docs/learning-loop-plan-2026-10-27.md#L32).

The paper main account was flat/unchanged at inspection; four exploratory paper
accounts had prospective close counts5,14,0,10, all below the descriptive30-close
threshold. They are unvalidated and not broker fills. Avoid porting their P/L
as broker economic evidence.

## Best capabilities to reuse

1. **Durable research agenda, preregistration and evidence-linked lessons.**
   `research_program` freezes question/baseline/costs/dataset/budget before compute;
   reserved variants are transactional and deduplicated. Public-source leads are
   distinct from fetched evidence with URL/time/digest; historical availability
   remains unverified until separately established.
   [`research_program.py:62–104,108–165`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/research_program.py#L108).
2. **Persistent specialist research memory.** Codex thread reused across turns,
   restarts and days, pinned Luna/low with80k auto-compaction. State and fresh
   evidence outrank memory; not model-weight training. Keep it separate from the
   scalper decision thread/model/prompt so long research does not serialize entry
   decisions or pollute operational context.
   [`agent_advisor.py:246–280`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/agent_advisor.py#L246),
   [`lab_codex.py:150–159`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/lab_codex.py#L150).
3. **Explicit result→finding→plan-close cycle.** Stage selector chooses interpret
   result, due review, measured repair or experiment. It carries exact metrics and
   plan identity; paper-slot capacity never blocks independent research.
   [`research_execution.py:6–30`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/research_execution.py#L6).
4. **Prospective cost attribution.** Non-replayed fills, spread versus other costs,
   midpoint gross/net where entry quotes exist, unmatched legacy entries, best-two
   concentration and evidence-digest-based continue/retire reviews. Seven days/
   thirty closes are descriptive review cadence, not statistical qualification.
   [`experiment_learning.py:22–85`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/experiment_learning.py#L22).
5. **Real independent compute seam.** Heavy jobs go to tc02 via SSH with compression,
   durable job identity, bounded uploads/results, timeout and sandbox work dirs.
   tc01 reports a last-observed worker capability of16 CPUs/Python3.13.5/~16GB
   scratch free. That is retained capability evidence, not a new independent tc02
   probe or utilization measurement. Do not start another ad hoc executor.
   [`agent_tools.py:343–401`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/agent_tools.py#L343).
6. **Unknown-side-effect discipline.** Park missing historical jobs after bounded
   investigation; keep dependent plans blocked, allow independent work. New
   matching completed evidence is required, and no automatic resubmission.
   [`research_recovery.py:6–61`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/research_recovery.py#L6).
7. **Tested engineering proposals.** Snapshot excludes credentials/data/state/.git;
   immutable original tests and protected dependency closure, isolated full-suite
   verification, optimistic source hashes, durable before-images and independent
   health/rollback verification are useful designs. They need adaptation to the
   scalper immutable release/GitHub pipeline rather than in-place file deployment.
   [`agent_engineering.py:33–106,166–188,290–380`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/agent_engineering.py#L290).
8. **Useful long OHLC archive.** API reported2,417,118 M1 rows from2019-12-01 through
   current completed minute, volume classified tick count; frozen100k-row dataset
   ending2026-10-21 has60/20/20 chronological partitions,256-bar embargo,20-attempt
   budget and unconsumed protected holdout. Only eligible training splits may be
   exported into new research. Do not bulk-copy hidden validation/holdout into
   scalper prompts or silently reconstruct partitions.
   [`lab_strategy.py:117–138`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/lab_strategy.py#L117).

## Compatibility and authority gaps

- **Keep one broker execution authority.** Aurum is currently paper lab; no broker
  adapter is constructed on that path. Its demo adapter has unresolved history
  recovery issue[#19](https://github.com/AegisFintech/xauusd/issues/19). Do not
  enable it alongside scalper. Account/broker/symbol overlap across servers was
  not checked; names alone do not prove identical pricing/account scope.
- **Execution models differ materially.** Aurum's expression engine uses
  next-open target-position research, fixed paper ounce units/floats and modeled
  spread0.30/slippage0.05. It explicitly does not simulate intrabar native TP/SL.
  It cannot establish second-scale STOP_LIMIT/GTD fills, queue position, fast
  profit capture, broker partial fills, or the scalper's dynamic decimal sizing.
  Import research ideas and registries, not its executor/cost arithmetic as truth.
  [`lab_strategy.py:141–154`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/lab_strategy.py#L141).
- **Promotion differs.** Aurum auto-promotes only qualified paper programs after
  chronological gates plus fixed seven-day observed forward window, >=99%
  expected observations, >=30 closes, flat state and no stop. Those settings are
  not a certification for a new broker-scalping contract; preserve old frozen
  windows and define a separate forward protocol using actual scalper lifecycle.
  [`lab.py:120–143,390–423`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/lab.py#L120).
- **Root/full-access is not protection.** Active agent service has no `User=`;
  Codex launches `--yolo`. EngineeringManager protects critical files within its
  tool workflow, but root's native shell can still read/write host files and
  credentials. Do not describe that as enforced isolation. Current explicit
  operator authorization permits this on tc01; changing the permission model
  requires the new integration design to be approved, not a silent edit now.
  [`deploy/systemd/xauusd-agent.service:6–20`](https://github.com/AegisFintech/xauusd/blob/35854ce/deploy/systemd/xauusd-agent.service#L6),
  [`lab_codex.py:150–157`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/lab_codex.py#L150).
- **Self-deployment is not self-committing.** Active `EngineeringManager.deploy`
  tests and writes working-tree files; no git commit/push exists there. Legacy
  `self_improve.apply_proposal` commits with `git add -A` and `--no-verify`, and
  source search found no production callers (tests only). It should NOT become
  the integration publisher: it could include unrelated dirty state, skips hooks,
  lacks normal PR/check protections and does not push. A new minimal publisher
  should create isolated issue worktrees and exact-path commits/PRs with required
  checks and separate release authority.
  [`self_improve.py:188–234`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/self_improve.py#L188).
- **API vocabulary drift already causes waste.** Tool catalog mostly descriptions
  rather than per-tool machine schemas; stage names look like callable tools.
  `create_plan` requires an exact14-key shape, but malformed shapes return a
  generic code. Improve typed catalog/examples and bounded correction diagnostics
  before expanding research scope. Never repair unknown side effects by replay.
  [`agent_advisor.py:466–503`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/agent_advisor.py#L466),
  [`research_program.py:108–120`](https://github.com/AegisFintech/xauusd/blob/35854ce/xauusd/research_program.py#L108).
- **No database merge or shared root credentials.** Aurum local SQLite/Cockroach
  authority and scalper PostgreSQL should retain schemas/identities. Exchange
  bounded versioned read-only evidence references/cursors, not mutable balances,
  OAuth token pairs, journal table writes or raw environment files.
- **No account reset, halt clear, strategy promotion or risk change is implied**
  by combining knowledge. Historical unknown actions, stops, registrations and
  reports remain immutable. Current root model selection/Luna may be re-evaluated
  separately; an upgraded subscription or more tokens is not an edge guarantee.

## Recommended sequence

1. Inventory and source-pin both systems; document account/symbol scope, exact
   current authority, data clocks, protection, model budgets, active jobs/dirty
   source and immutable research windows. Acceptance: two executions cannot gain
   authority over one account from integration configuration.
2. Repair tc01 research completion first: typed tool catalog, unambiguous brief
   data vs tools, exact research-plan examples, actionable validation errors,
   one deterministic completed-result interpretation/close path, bounded retries.
   Acceptance: complete a genuinely autonomous evidence-backed finding; observe
   improved failed-tool share and result-to-finding latency on fresh cycles.
3. Build one versioned read-only scalper evidence export consumed by Aurum:
   proposals/WAIT/rejections/no-fills, causal candles/DOM/quotes, exact request/
   acceptance/fill/expiry/protection times, fees and Flight excursions/coverage.
   Acceptance: both sides agree on denominators; gaps/unknowns/partial exposure
   are censored and no export exposes credentials or enables execution.
4. Feed targeted failure taxonomy into preregistered single-change research on
   tc02; use scalper paired replay for lifecycle-sensitive work. Preserve Aurum
   holdout and scalper frozen registrations. Reject naive OHLC intrabar winners.
5. Add autonomous issue→isolated-worktree→tested exact-path commit→push→PR path.
   Automatic safe software PRs may follow existing approved merge rules after
   green exact-head checks; strategy/risk/authority changes need independent
   evidence and versioned review. No direct working-tree deployment on scalper.
6. Run separate preregistered forward observation for a qualified challenger;
   promote only through the one execution authority after old group terminal
   reconciliation, matched immutable artifacts and audited policy selection.
   Software health rollback must not invalidate newer broker command authority.
7. Present one dashboard separating actual broker demo, paper exploration,
   learning completion, evidence gaps, jobs, current hypothesis and release
   status. Market closed/operational idle can run research, but monitoring and
   protective maintenance always get independent CPU/time priority.

A unified repository is a later packaging decision, not prerequisite. The smallest
useful first combination is one broker runtime + one research brain + one bounded
read-only evidence contract, retaining existing remote compute. No claim of
profitability, complete bug freedom, full DOM coverage, model-weight training or
successful unattended discovery is made by this inspection.

## Existing GitHub work to reuse

- [Issue22](https://github.com/AegisFintech/xauusd/issues/22) remains OPEN for
  research continuity, no-trade explanations, evidence-backed decision state,
  cadence and deployment adoption. Its September incident sections are historical;
  preserve them, append the October28 measured completion/tool-contract findings
  as a new milestone rather than open a duplicate generic no-trade issue.
- [Issue19](https://github.com/AegisFintech/xauusd/issues/19) remains OPEN for
  history-backed uncertain demo order recovery; it explicitly grants no broker
  calls or activation. Keep it separate from paper-research completion and do not
  enable the remote demo adapter as a way to merge the harnesses.
- GitHub currently returned only these two open issues. No distinct currently open
  engineering-release, learning-loop or safe self-commit publisher issue was found.
  Recent learning work is in main35854ce and its checked-in learning-loop plan;
  implementation milestones should link that baseline and separate software,
  research and trading acceptance rather than claim an existing issue covers all.

Parent-side source inspection additionally identifies the scalper legacy replay
as incompatible with current0.8: `python/research/feed.py:20` pins old fade release;
`python/backtest/paired.py:88,101,132–135` accepts old entry-pair/two LIMIT GTC legs/
shared1% assumptions. Therefore phase4 requires a NEW versioned single STOP_LIMIT/
GTD replay path; reuse causal evidence discipline but do not feed the new contract
through the frozen legacy implementation or rewrite frozen registrations.
