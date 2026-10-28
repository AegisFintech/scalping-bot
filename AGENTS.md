# Agent contract

ISSUE-393: provider version/prompt routing derives from existing Pydantic request
metadata. Execution bounds live in `model-execution-bounds.ts`; the coordinator
retains compatible exports. Preserve validators and lifecycle authority; see
`docs/execution-seams-report.md`.

ISSUE-392: fill review/export v1.1 requires symbol scope, causal receipt/capture
times and immutable pre-fill protection observations. Market samples lack per-side
freshness and cannot price fills. Preserve bounded readers, unknown evidence and
frozen v1.0 reports; see `docs/fill-evidence-integrity-report.md`.

Read this file, `plan.md` and the report for the area you change before editing
code. This is the short current contract. The full per-issue directive history
(ISSUE-075 … ISSUE-387) is preserved verbatim in
[docs/agents-history.md](docs/agents-history.md). Where the two differ, this file
and the newest linked issue report win: archived release names, prompts, risk
numbers and dashboard/provider instructions describe immutable past behavior
only. Archived invariants that are not superseded here still apply; read the
matching history section and report before changing that area.

## Communication preference

Keep replies very short. Lead with the result or current blocker; put detailed evidence
in linked reports. Give longer explanations only when explicitly requested.

## Current release (controlled DEMO only)

- **Source / policy:** `0.8.0-model-scalp.1-codex.1` / `0.8.0-model-scalp.1`,
  defined in `packages/config/src/policy.ts`; read `docs/model-scalp-report.md`.
- **Provider:** isolated subscription Codex worker, requested `gpt-6.1-sol`, no API
  fallback. Unattested returned identity, usage and cost stay null.
- **Provider contract:** prompt `entry-scalp-v1`, request1.12, response1.3
  (BUY/SELL/WAIT plus one entry, TP, SL and pending seconds). Local execution
  `entry-scalp-execution-v1`, context `entry-scalp-1.0`, risk schema2.0.
- **Model context:** completed M15/M5/M1 candles, `causal-smc-1.1` technical context
  (the unchanged 1.0 evidence plus the deterministic level map, analytics `/v3`,
  request 1.2 / response 1.1), broker DOM summary, entry boundaries and execution
  costs. Missing, stale or mismatched context blocks dispatch; there is no fallback.
- **Orders:** one model-selected trend-direction STOP_LIMIT/GTD,30-tick entry
  range, capture-relative60–300s expiry with exact broker acknowledgement.
  Expiry never closes filled exposure; exact zero-fill terminal proof precedes one
  durable refresh. Older GTC/OCO groups retain immutable authority.
- **Protection and exits:** validated model distances, gross TP<=0.40 price units,
  SL<=7.00 and RR>=0.0571428571, whole broker pips. Native protection stays
  fill-relative and independent. No local sampled-profit market-close authority.
- **Money management:** dynamic sizing from reconciled equity, actual metadata
  costs, margin and volume steps. Demo retains at most5% setup ceiling and at most
  2.5% for the single order (former leg ceiling); other modes1%. 65-tick stop-risk reserve; the 5-tick native
  exit allowance is a declared model, not a validated tail bound. The 0.08 broker
  pip is the modeled net objective, never the gross TP.
- **Live:** disabled by default and never inferred from credentials or configuration.
- **Dashboard:** landscape-only, read-only FastAPI/Uvicorn desk with bounded shared
  polling, separate modes and explicit stale/unavailable values. Authenticated
  backend emergency/pause controls remain operational. It never infers a human
  identity or claims protection from a partial-close event alone.
- **Configuration:** `.env.sample` holds 16 identity/credential/authorization keys.
  Model, risk and strategy policy are versioned code, never environment tuning.
- **Deployment:** tested `main` on the ONE existing demo account with its matching
  Codex worker and SELECT-only Flight recorder. Rollback artifacts and observers
  are evidence, never extra bots.

Changing any item needs explicit operator authorization, a new additive version
and its own issue report. Without it: no fixed lots or lot multipliers, size or
risk increase, wider TP, reversal, martingale, loss chasing, forced provider calls
or trades, accounting reset or automatic research promotion. No profitability claim.

## Operating contract (authoritative)

This repository implements an AI-assisted XAUUSD short-term trading system for
controlled demo evaluation. It continuously observes completed candles, quotes,
order-book/account/risk state and broker session status. The model proposes a
direction or WAIT, one entry, TP, SL and pending lifetime; deterministic code owns
validation, order type, native protection, dynamic sizing, broker precision, margin, ownership,
reconciliation and all execution authority. The complete decision and broker
lifecycle is recorded for later analysis.

When the broker session is open the scheduler keeps the demo continuously ready
and resumes automatically after normal temporary failures or scheduled closures.
“Trading all the time” means continuous market-open operation, not forced order
flow: wait without a provider call or order whenever an active group, request
cooldown, stale/invalid data, closed/unavailable session, unreconciled
account/order/position state, protection/recovery fault, affordability failure or
any other fail-closed gate applies. Accepted GTC orders and protective maintenance
stay active while waiting. No prompt, timer or operator request may bypass these
gates, manufacture a trade or increase risk to maintain frequency.

## Non-negotiable safety rules

- Preserve fail-closed behavior. Missing, stale, ambiguous, unavailable, partially reconciled, or invalid state must block analysis or placement as documented.
- Never enable live execution by default or infer live authority from configured credentials.
- Preserve the current explicitly authorized contract: minimal entry parsing in production and unchanged historical schemas; retain broker precision, freshness, reconciliation and deterministic risk integrity.
- Never let model output bypass the risk engine or select position size, broker volume, precision, exposure, or mode.
- Never commit or log secrets, tokens, account IDs, authorization headers, database credentials, private URLs, cookies, or private certificates.
- Use completed candles unless a test explicitly targets forming candles and labels them as such.
- Preserve decimal strings at service boundaries and decimal arithmetic for price, money, volume, and risk calculations.
- Maintain idempotency across analysis runs, order groups, broker commands, callbacks, restarts, and reconciliation.
- Do not claim profitability. Label replay, backtest, paper, demo, shadow, and live results distinctly.

## Still-binding invariants

### Decisions, provider and memory

- WAIT has no order authority, including at the database boundary.
- Provider dispatch is durably claimed before inference; no request starts with an
  active group. A completed WAIT retries only 60 seconds after availability and on a
  new completed M1. Failed/unknown/timeout dispatch keeps the full durable cooldown;
  only FAILED / `AI_CIRCUIT_OPEN` emitted before dispatch may use the one-minute
  local recheck. One fresh request may follow a fully reconciled setup close or a
  proven zero-fill cancellation (exact ownership, terminal events, no fills,
  positions or unresolved events, unique durable claim). Never rearm an old map.
  Derived local proposals are not paid provider requests.
- Daily Codex threads are isolated and pinned to model/prompt/day with serialized
  durable claims and bounded compaction. Memory never replaces fresh evidence or
  changes risk; summaries never replace the immutable journal. A new prompt/hash/day
  uses a new thread; never resume an old prompt's thread as current authority or
  silently replace a thread after corrupt state or resume failure.
- Prompt/request/response/schema versions are additive. Old prompt bytes, schemas,
  registrations and migration checksums stay immutable; a previous model or prompt
  never authorizes new execution. Exact provider inputs, prompts and available
  response text are journaled.
- The model anchors every price to a supplied `causal-smc-1.1` value plus whole ticks
  and cites it. The second internal reference is invalidation, never another entry
  or an AI holding box. Level definitions are frozen descriptive code, never fitted thresholds or entry filters;
  changing them needs a new definitions version (`docs/smc-level-prompt-report.md`).
- Inference runs outside the execution path. Each execution decision needs fresh
  completed-candle context; crossed entries wait and are never shifted to chase.
  Deterministic entry boundaries bind; the spread/tick movement buffer is guidance,
  never an extra gate. Do not add entry filters, price clamping, timed reviews,
  pending-order repricing, automatic pauses or exit fallbacks without operator
  approval.

### Session, data and reconciliation

- A freshly verified open broker schedule is required before analysis, dispatch and
  each new demo order (`docs/market-session-report.md`). Closed/unavailable sessions
  wait without provider calls, never set a global pause or erase history; session
  metadata caches for 30 seconds. Session checks are not atomic with broker/provider
  receipt; dispatched work keeps unknown-outcome handling and cooldowns.
- Session dependency failures retry with bounded backoff inside startup, never a
  supervisor restart storm. Reconnects need fresh subscriptions and quotes; rejected
  commands are never replayed; broker requests are paced serially
  (`docs/session-recurrence-report.md`). Do not blame a new outage on an old error.
- Market data refreshes after full account/capital checks with the late
  authorization re-read, strict quote/book ages and the union of newer/placement
  exposure blockers. Never overwrite reconciliation uncertainty or newer open-order
  counts with an earlier empty snapshot. Missing account P/L evidence or other-symbol
  exposure blocks new risk; P/L matching follows
  `docs/pending-order-reconciliation-report.md`.
- Preserve operational fault latches across restarts; only a successful durable
  cycle clears an analysis/storage failure.

### Orders, OCO and recovery

- Historical GTC orders retain no timer expiry. New scalp entries use the exact
  acknowledged GTD deadline; pending expiry never closes filled positions. Normal
  shutdown preserves broker-held orders/protection; emergency stop cancels only
  owned pending orders. See `docs/model-scalp-report.md` and the historical
  `docs/persistent-order-loop-report.md`.
- After a confirmed fill or zero-fill terminal peer outcome, cancel the surviving
  owned peer only with exact pair ownership, event evidence, no-fill/no-position
  checks and reconciliation; durable peer-cancel retries include partial fills.
  Unfilled cleanup is never a trade close. If a session closes between legs,
  withhold the unsent leg and cancel the owned pending peer. A locally unsent order
  is journaled distinctly from broker rejection.
- Excess entry slippage records the fill, cancels the peer and blocks new risk until
  terminal recovery; only the incident's own group may release it.
- Terminal recovery uses exact per-position full-fill or zero-fill cancellation
  evidence and complete group proof (`docs/unattended-recovery-report.md`). Never
  clear uncertainty from elapsed time or a flat broker snapshot.
- Unsubmitted entry contexts follow `docs/entry-recovery-report.md`: retire only a
  proven never-submitted context; at most one immediate replacement per original.
- Every group keeps its immutable profile/revision, cardinality, original prices and
  native type; NULL historical markers keep legacy proof requirements and a missing
  peer never becomes single-entry authority. Persisted alternative modes fail closed.
  Deployment uses an audited scoped selection CAS: never overwrite selection at
  startup or cancel/reprice an old group to accelerate activation. Rollback to older
  code needs every newer group terminal/proven first; never downgrade the database.
- Use strategy ownership labels. Never cancel a manual order unless explicit
  configuration permits it.

### Protection and exits

- Protective maintenance is model-independent and never awaits inference or normal
  placement gates. Keep fresh broker SL/TP separate from intent, fill-relative
  distances, inward rounding and tighter existing protection.
- Missing-SL recovery (`docs/missing-stop-recovery-report.md`): two durable amendment
  attempts five seconds apart; only a freshly confirmed exact owned demo position with
  no SL may enter the close path. Re-read ownership, volume and missing SL before one
  durable close claim; unknown/timeout dispatch, partial fills and restarts never
  resend. An existing SL always prevents this path. Never close protected or manual
  positions from sampled SL/TP crossings.
- Old 0.7.2 profit-close claims wait for terminal broker evidence and are never
  replayed; the pinned historical evaluator is not production authority.
- External/manual closes (`docs/manual-intervention-report.md`): non-bot client IDs
  are not authority. Match exact owned position/order/deal, side, entry, open/close
  times, original fills, cumulative closes and remaining volume/costs. Closes are
  observed, never commanded. Final net counts closing-detail fees once. Partial
  exposure stays protected and monitored; no new setup until fully reconciled.
  Missing/ambiguous/oversized history stays blocked; never inject trade rows.

### Money management and accounting

- Size from current reconciled equity, actual broker metadata commissions (never the
  old $7/lot estimate), conversion, margin and volume increments. Never understate
  costs, round volume upward, change leverage or reintroduce an equity floor or
  notional cap. Reserve one setup loss in free margin. Native TP must cover costs at
  minimum and actual quantity; reject rather than widen.
- Demo records but does not enforce daily/high-water locks and reductions
  (`docs/demo-development-risk-report.md`); other modes enforce the 5% UTC daily
  budget and drawdown reductions. Never reset, delete or rewrite baselines, locks or
  trade history. Missing daily baselines are accounting failures that need the
  audited evidence procedure. The October 19 fresh epoch (ISSUE-314) was one-time;
  pre-epoch records were permanently removed (ISSUE-316) and must not be restored.
- Keep automation authorization in the full safety audit hash, separate from the
  immutable strategy-definition hash. Economic changes require a new release.

### Research and observers

- Research is a read-only observer with no broker, provider, order, control or
  promotion authority (`docs/forward-observer-report.md`,
  `docs/paired-replay-report.md`, `docs/entry-evidence-review-report.md`). Register
  future windows and freeze code before outcomes; never edit registrations, overwrite
  reports or select complete winners. Source drift halts research only. 30 calendar
  days is a collection batch, not qualification; fixture success is not economic
  validation.
- Use actual provider availability and broker acceptance, never
  `orders.submitted_at`; inference cannot backdate eligibility. Preserve GTC
  lifetime, gaps, open/daily cutoffs, OCO ambiguity and partial-fill censoring.
  Unknown counterfactual fills, fees, swap, FX and margin stay null. Quote crossings
  are not fills; sampled quotes are not a complete tick tape. Keep model levels
  separate from computed envelopes and round-number hypotheses.
- Do not claim prompt-only entry improvement, label a leg budget as actual stop risk
  or infer an exact SL/TP cause from P/L.
- The Flight recorder is a separately unprivileged SELECT-only observer without
  provider, order or control credentials. Storage failure halts only recording.
  Bounded lossless learning records are distinct from seven-day diagnostic logs.
- Fill evidence (`docs/fill-evidence-report.md`) is descriptive: gaps are
  adverse-positive against the latest fresh executable quote at or before the broker
  fill time; close class uses closing order type and price against the last observed
  protection, never P/L; a visible-ladder walk is not a predicted fill. Export only
  hashed setup keys, never broker identifiers, and send nothing to the broker.

### Storage, server and deployment

- Local PostgreSQL; migrations run through the local administrator and the
  application never gets CREATE/DDL. Managed recording needs its maintenance/backup
  timers; chart bytes use protected SHA-256 storage backed up with the database.
  Never delete audit rows or activate a historical recovery database.
- Telemetry receipt pruning needs the exact scoped operator approval marker and
  follows `docs/lean-storage-report.md`; keep PGLZ. Logs roll weekly with size caps
  and seven-day closed-log retention. Never overwrite secrets or point maintenance
  at old recovery state.
- Never migrate a populated `.env` by replacement: back up private values, never
  copy the sample over them, and run both policy and `--startup` configuration checks.
- The Codex worker keeps LimitFSIZE 512MiB, MemoryMax 512MiB, TasksMax 64, swap 0
  and isolation (`docs/codex-file-cap-report.md`). Never delete worker history or
  replay an unknown request.
- Develop in `/root/scalping-bot-terminal`; the original checkout and immutable
  deployment/research artifacts are not disposable. Claude and OpenCode were removed
  by the operator; do not reinstall them or delete Codex auth or in-use versions.
  Cleanup never runs automatically and follows `docs/server-cleanup-report.md`.

## Change discipline

- Add or update tests for every behavior change, including a rejection/failure path.
- Update documentation, JSON Schemas, shared types, and SQL migrations together when a contract changes.
- Do not make destructive database changes without a forward migration, data transition, rollback notes, and operator review.
- Document assumptions and unresolved broker-specific behavior.
- Keep every service compatible with headless Debian and systemd; avoid Docker-specific assumptions.
- Use the typed HTTP analytics contract for Node/Python communication, not shell pipelines.
- Keep broker adapters behind interfaces and test with mocks before demo integration.
- Before each repository update, review newly unused files, dependencies and
  service references; remove only confirmed unused items and record retained
  evidence/deployment dependencies in the issue report.

## Required completion checks

Run formatting, linting, TypeScript type checks, Node tests, Python formatting/lint/type checks/tests, JSON Schema tests, migration tests, replay/fail-closed tests, secret scanning, and dependency audits. Record commands and results in `plan.md` or the implementation report. Keep the database lifecycle permutation/failure suite in unattended qualification.

## GitHub delivery discipline

- Every new non-merge commit updates README.md with the user-facing change and this
  file with the matching contract change, concisely. `npm run hooks:install` enables
  the tracked pre-push gate (per-commit README/AGENTS, clean tracked state,
  `graphify update .`). Do not bypass a failed gate, overwrite existing hooks or
  auto-generate commits. Hooks never replace full qualification, secret scanning,
  reviewed issue branches and passing hosted checks.
- After every completed user-requested repository update that changes tracked
  files, inspect the diff and staged diff, run the secret scan and applicable
  quality gates, create a coherent commit on the issue branch, and push it
  before handoff. This applies to documentation-only updates too.
- If authentication, authorization, network availability, branch protection,
  or another remote failure prevents the required commit or push, preserve the
  local work, do not claim successful delivery, and report the exact blocker
  and required operator action. Never bypass review or expose credentials.
- Represent planned development as bounded issues in `plan.md` with an identifier,
  acceptance criteria, dependencies, and current status. Add the GitHub issue or
  pull-request link after it exists remotely.
- Use a dedicated branch and pull request for each coherent issue unless the
  operator explicitly requests otherwise. Respect branch protections and required
  reviews. Commit coherent, reviewable checkpoints only.
- After each successful push, open or update the issue pull request and enable
  automatic merge (authorized by the operator for qualifying updates). Merge only
  after acceptance criteria, quality gates, branch protection and all required
  checks/reviews pass; never bypass a protection or failed check.
- Never place a PAT in a remote URL, command argument, issue, pull request, log,
  or tracked file. Keep a rotated least-privilege token only in the ignored,
  mode-`0600` local environment or an approved credential store.
- Before merge, run the full required completion checks and update `plan.md` plus
  the implementation report with exact results.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Issue history

Newest first. The full original directives are in
[docs/agents-history.md](docs/agents-history.md).

- ISSUE-390 agent contract consolidation (this file); fill evidence and #388 pack — `docs/fill-evidence-report.md`; `causal-smc-1.1` level map and prompt v5 — `docs/smc-level-prompt-report.md`
- ISSUE-387 read-only entry evidence and native TP audit — `docs/entry-evidence-review-report.md`
- ISSUE-384 broker-native profit exits — `docs/native-profit-exit-report.md`
- ISSUE-382 Codex worker file cap — `docs/codex-file-cap-report.md`
- ISSUE-380 TP 0.40 and the since-removed local profit capture — `docs/small-tp-profit-exit-report.md`
- ISSUE-378 external-close recovery — `docs/manual-intervention-report.md`
- ISSUE-376 quick-TP dual OCO and Flight recorder — `docs/quick-oco-flight-report.md`
- ISSUE-374 lean storage — `docs/lean-storage-report.md`
- ISSUE-372/370/368 entry modes and single direction (historical) — `docs/fixed-stop-limit-report.md`, `docs/entry-modes-report.md`, `docs/directional-entry-report.md`
- ISSUE-366/364/362 M1-first, evidence-first and daily Codex context — `docs/m1-range-release-report.md`, `docs/evidence-demo-rollout-report.md`, `docs/evidence-first-codex-report.md`
- ISSUE-360 server cleanup and per-push maintenance — `docs/server-cleanup-report.md`
- ISSUE-358/351 compression and SMC/DOM demo trials — `docs/compression-demo-release-report.md`, `docs/smc-demo-release-report.md`
- ISSUE-346 landscape dashboard and lean configuration — `docs/lean-dashboard-report.md`
- ISSUE-316/314/303 record removal, fresh epoch, Codex provider — `docs/fresh-demo-epoch-314-report.md`, `docs/codex-production-report.md`
- ISSUE-255/253/249/245 observers, paired replay, learning review, session retry
- ISSUE-075 … ISSUE-098 earlier demo, risk, GTC, recovery, session and storage contracts
