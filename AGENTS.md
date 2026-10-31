# Agent instructions

## Operator directives

- Own the whole XAUUSD scalping bot and research harness: diagnose root causes,
  inspect related failures, finish fixes, tests, commit/push, reviewed merge,
  safe deployment and post-deployment verification without repeated prompts.
- Use the time and tokens needed. Be proactive and bold within verified demo
  authority; reliable operation comes before tuning returns. Prefer small,
  complete changes and remove only proven unused code/services.
- Own the research agenda: investigate costs, execution, entries, exits and external
  data proactively; retain negative findings and finish result-to-plan closure.
  Research breadth needs no repeated permission; economic activation still needs
  versioned evidence and independent review. See `docs/central-research-report.md`.
- Do not guess missing facts. Inspect available evidence first; ask the operator
  when information, external data or a decision is genuinely missing. Existing
  authorization covers safe recovery/restarts; it does not waive safeguards.
- Keep replies very short: result or blocker first, detailed evidence linked.
  Report unresolved work honestly; never promise background work without a
  verified persistent service. Monitor its health, not merely its process status.
- Develop in `/root/scalping-bot-terminal` or an isolated issue worktree. One
  existing demo deployment on tested main; tc01/tc02 are research only. Preserve
  remote dirty work, rollback artifacts, credentials and frozen research.

## Before changing an area

Read `plan.md`, the relevant report, and the matching section of
[the detailed operating rules](docs/agent-contract-20261029.md). That document
preserves the previous contract; read its Decisions, Session, Orders, Protection,
Money, Research or Storage section when touching that subsystem. Older directives
remain in [issue history](docs/agents-history.md); historical release numbers never
supersede the current versioned policy or explicit operator instructions.

- Current scalping/provider/risk: `packages/config/src/policy.ts`,
  `docs/model-scalp-report.md`, `docs/configuration.md`; verify deployed source
  separately. Preserve the existing reviewed economic policy in operational fixes.
- Recovery/session/manual interventions: `docs/unattended-recovery-report.md`,
  `docs/session-recurrence-report.md`, `docs/manual-intervention-report.md`.
- Missing protection: `docs/missing-stop-recovery-report.md`.
- This historical pre-dispatch incident: `docs/predispatch-incident-recovery-report.md`.
  Recovery is an exact, root-only audited operation, not automatic unlock authority;
  verify qualification and activation separately. This incident is recovered;
  never repeat its recovery. Compare fixed mode/revision separately from changing
  workflow status during deployment checks.
- Research, exports, autonomous publishing or tc01/tc02 integration:
  `docs/harness-integration-plan.md`, `docs/learning-evidence-bridge-report.md`,
  `docs/publisher-policy-report.md`, `docs/research-failure-guidance-report.md`.
  Current observation reviews: `docs/current-observation-review-report.md`; verify
  fresh completed windows and findings, not only a running timer. No implicit promotion.
  Continue the dependency queue in `docs/autonomous-harness-delivery-plan.md`; a
  prerequisite is not whole-harness completion. Source verification: `docs/source-verifier-report.md`.
  Freeze exploratory jobs using `docs/experiment-registration-report.md`; unknown
  claims never authorize redispatch and recorded output is not independent validation.
  Distributed fixed-method jobs: `docs/experiment-execution-report.md`; query unknown
  jobs without redispatch, preserve the source/runtime pins, and verify fresh closure
  receipts rather than equating timer success with strategy improvement.
  Result-derived candidates: `docs/candidate-attestation-report.md`; generated code
  stays isolated and software PASS still awaits independently authenticated review.
  Signed draft publishing: `docs/trusted-publisher-report.md`; require protected-parent
  attestation, exact source, CI and independent `aloycwl` review. Workers never get
  signing/GitHub credentials. Run publishing locally under its dedicated service,
  preserve required CI/review, and keep the signing key outside publisher-owned state.
  Check final generated documentation with the real formatter; preserve existing
  publication heads when repairing templates. The recorded-payoff task is delivered;
  do not regenerate it. Recurring generation/review remains separate pending work.
  Holding-time research: `docs/holding-research-report.md`; preserve unknown clocks,
  full cohorts and separate version1.1; elapsed holding time proves no earlier exit.
  Review admission: `docs/review-admission-report.md`; missing/failed CI and stale
  approvals never authorize advancement. Drafts grant no merge/deploy authority.
  Current pipeline visibility: `docs/harness-health-report.md`; stale/missing status
  is unavailable, and monitor receipts never authorize recovery or promotion.
  Candidate execution requires the pinned, unprivileged namespace and aggregate
  resource limits in `docs/isolated-worker-report.md`; process exit is not qualification.
- Economic/entry research: `docs/quantitative-review-426.md`,
  `docs/paired-replay-report.md`, `docs/forward-observer-report.md`,
  `docs/entry-evidence-review-report.md`, `docs/fill-evidence-integrity-report.md`.
- Storage/cleanup: `docs/lean-storage-report.md`, `docs/legacy-cleanup-report.md`;
  weekly log rotation and seven-day closed-log retention. Never replace `.env`.

## Execution invariants

- Controlled DEMO only; credentials never authorize live trading. Keep scalping:
  completed OHLC/quotes/DOM → local context → Codex → deterministic validation,
  dynamic sizing and one trend-direction STOP_LIMIT/GTD → native TP/SL →
  reconciliation → repeat. WAIT has no order authority. Old groups keep their
  immutable order type, lifetime, cardinality and protection.
- Session, freshness, accounting, ownership, affordability, cooldown, active-group
  and reconciliation gates fail closed. Continuous operation does not force trades.
  Memory is not training or fresh evidence; inference never delays protection.
- Decimal prices/money/volume, actual broker costs, current reconciled equity,
  margin and volume steps stay authoritative. No economic/risk/polarity change,
  fixed lots, loss chasing, accounting reset or automatic research promotion.
- Preserve durable claims, unknown outcomes and idempotency across restarts.
  Broker responses must match the authenticated account. Neither elapsed time nor
  a flat snapshot clears uncertainty. Never replay an unknown command, fabricate
  broker events, cancel manual orders or alter history.
- Read-only Flight/research cannot trade or promote. Keep causal clocks, missing
  evidence, null counterfactual economics and complete cohort denominators. Freeze
  prospective studies before outcomes; source drift halts research only.
- Never expose credentials, account IDs, raw broker payloads or private endpoints.
  Distinguish sampled marks from fills, software checks from economic evidence,
  source delivery from activation, and demo results from live. No profit claims.

## Delivery

- Track bounded issues, acceptance, dependencies and status in `plan.md`. Update
  README and this file concisely in every non-merge commit; close completed issues
  only after their actual acceptance criteria are met.
- Test behavior changes and failure paths at their actual boundary; synchronize
  schemas/types/docs and forward migrations. Destructive transitions require
  documented evidence, rollback limits and operator authority. App/observer roles
  never get DDL; immutable proof also rejects truncation.
- Inspect working/staged diffs and scan secrets before committing. Run the full
  `npm run qualify` gates (Node/Python/types/lint/format/schema/migrations/replay,
  isolated database lifecycle, secret scans and audits), both configuration checks,
  and record exact results, including corrected failures. Update Graphify AST
  after code changes.
- Push coherent issue branches and create/update PRs; independent review and
  passing exact-head hosted checks precede authorized merge/deploy. Respect branch
  protection, hooks and failed checks; see `docs/exact-head-checks-report.md`.
  Verify deployed artifact, actual process cwd/arguments, broker/account state and
  background services afterward; PM2 restart can retain an old cwd.
  Report exact blockers; never leave completed work unpushed without explaining why.
- For codebase questions, query an existing Graphify graph first; use its wiki for
  navigation and query/path/explain for relationships. Dirty graph output is expected.

<!-- research-publication -->

Research-only delivery `ddaba508ad0cb363994bebbdcb0265262c14dd8edff266084eb53fa21a40a199`; no execution or promotion authority.
