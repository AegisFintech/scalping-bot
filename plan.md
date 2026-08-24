# Implementation Plan

## Scope

Build a Debian/systemd-compatible, AI-assisted cTrader analysis and execution platform for a configurable symbol (initially XAUUSD), delivered in strict progression: architecture/contracts, replay/backtest, paper, demo, shadow, then dormant live-compatible interfaces. Live order submission remains disabled unless every independent safety gate passes.

## Assumptions

- Node.js 22 LTS and Python 3.13 are deployment baselines.
- Neon provides PostgreSQL 16-compatible TLS connections.
- cTrader demo/live Open API applications, account authorization, symbol capabilities, and credentials are operator-supplied.
- Broker metadata is authoritative; no XAUUSD symbol IDs, precision, tick values, or volume bounds are hard-coded.
- UTC is the storage timezone; daily risk timezone is explicit and defaults to UTC.
- Streamlit binds to localhost and control actions additionally require a control token.

## Unresolved questions

- Which separately authorized cTrader live account will be used? The supplied authorization exposes one demo account and no live account.
- Does that broker expose reliable real volume or only tick volume for XAUUSD?
- What production rate limits, retention policy, and availability guarantees apply to the configured OpenAI-compatible endpoint? Its Responses and strict JSON Schema paths have passed a bounded probe.
- What broker-reviewed spread, slippage, session, margin, and order-distance limits should replace conservative defaults?
- Which Cloudflare Access identities/policies and audit retention will be
  approved for long-term dashboard operation? The current hostname redirects
  unauthenticated requests to Access.

## Architecture

Node services own broker connectivity, orchestration, AI calls, deterministic validation/risk, execution, reconciliation, APIs, scheduling, logging, and metrics. A FastAPI Python analytics service owns candle normalization, indicators, compact features, data-quality checks, statistics, replay, and backtest. Streamlit reads PostgreSQL and calls protected localhost control endpoints. PostgreSQL is the durable audit/state store; process memory is never the sole source of execution truth.

## Repository layout

```text
apps/{execution-service,market-data-service,ai-orchestrator,dashboard}/
python/{analytics,indicators,features,replay,backtest}/
packages/{contracts,database,logging,risk-engine,ctrader-client}/
migrations/  schemas/  prompts/  scripts/  systemd/  tests/  docs/
```

## Components and ownership

| Component           | Runtime      | Owns                                                                                |
| ------------------- | ------------ | ----------------------------------------------------------------------------------- |
| market-data-service | Node         | quotes, completed bars, depth, timestamps, symbol/account metadata                  |
| analytics API       | Python       | normalization, deterministic features, replay/backtest, data-quality                |
| ai-orchestrator     | Node         | bounded payload, prompt/schema versions, endpoint circuit breaker, local validation |
| risk-engine         | Node library | Decimal eligibility, sizing, daily loss, margin, spread/slippage checks             |
| execution-service   | Node         | cycle state machine, OCO lifecycle, broker/paper gateway, reconciliation            |
| cTrader client      | Node library | auth/refresh, protocol transport, subscriptions, broker commands/events             |
| dashboard           | Streamlit    | read views, explicit authenticated controls and acknowledgements                    |
| logging/database    | shared       | redaction, structured audit, migrations, metrics, runtime controls                  |

## Message and data flows

The authoritative server timestamp anchors a candle/depth snapshot. Persisted raw inputs go through the analytics HTTP contract; features and bounded performance context form a versioned AI request. Schema and semantic validation precede deterministic risk. A transactional intent/idempotency record precedes gateway calls. Broker events are deduplicated and reconciled before state advances.

## Database model

Normalized tables cover accounts, symbols, raw snapshots, candles, indicators, depth, analyses, AI requests/responses, validation, risk, OCO groups, orders, fills, positions, trades, statistics, daily risk, health/metrics, audit events, runtime controls, and strategy versions. Foreign keys, check constraints, unique idempotency keys, JSON size checks, and UTC timestamps enforce invariants. Sensitive payloads are redacted before persistence.

## State machines

- Analysis: `PENDING -> COLLECTING -> FEATURED -> MODEL_PENDING -> VALIDATING -> ACCEPTED|REJECTED|EXPIRED`.
- OCO group: `INTENT_RECORDED -> SUBMITTING -> ACTIVE -> ONE_FILLED -> CANCELLING_PEER -> POSITION_OPEN|RECONCILIATION_REQUIRED -> CLOSED|EXPIRED|FAILED`.
- Unknown, partial fill, cancellation pending, or reconciliation pending always block replacement.
- Connection: `DISCONNECTED -> AUTHENTICATING -> SYNCHRONIZING -> READY`; only `READY` can support an eligible cycle.

## Model contract

Schema `1.0` accepts only bounded JSON with decimal strings, strict enums, timestamps, scenarios, confidence, evidence/risk codes, and performance adjustment. It contains no size, credentials, executable content, or broker IDs. Structured output is requested where supported and always validated locally. See `docs/model-contract.md`.

## Risk controls

Base risk defaults to 1%; configured risk cannot exceed 5%. Position sizing is deterministic and rounds down to broker volume steps. Daily loss, equity floor, exposure, margin, R:R, stop distance, precision, freshness, spread, slippage, duplicate, and reconciliation checks are mandatory. AI confidence can only reduce eligibility/risk context, never raise configured risk.

## Security model

Secrets enter only through protected environment files/secret managers. Logs/persistence are recursively redacted. Network listeners default to loopback. Dashboard mutations require a control token and database audit. Live submission requires environment mode, boolean enable, exact runtime acknowledgement, manually created sentinel, startup checks, current dashboard acknowledgement, no emergency/DB lockout, and per-order checks.

## Observability

JSON logs carry request/trace/analysis/order correlation without raw account IDs. Local rotation and optional Better Stack transport are non-blocking for reconciliation; live placement requires working critical audit persistence. Health/readiness/liveness, Prometheus metrics, heartbeats, service/server metrics, and alert-producing audit events cover disconnects, staleness, invalid AI, reconciliation, risk lockout, emergency stop, dependency failures, resource pressure, and rejection bursts.

## Test strategy

Unit tests cover indicators, Decimal handling, schemas, semantics, sizing, daily boundaries, OCO, redaction, and performance adjustment. Integration tests cover typed Node/Python, PostgreSQL, AI/cTrader/Better Stack mocks, restart/reconnect/reconciliation, and lifecycle. Failure and property-oriented tests prove fail-closed defaults and idempotency.

## Backtest methodology

Use completed candles only; align 1m/5m/15m without look-ahead; apply configurable latency, spread, and slippage; use conservative same-bar SL/TP ordering; version data/features/model/prompt/schema; report sample size, drawdown, costs, and rejected-data rate. Candle-only results do not reproduce tick paths or broker execution.

## Replay methodology

Replay emits events by authoritative timestamps into the same analysis/paper interfaces. Missing historical depth is rejected by default or explicitly marked as synthetic in a non-comparable experiment. Deterministic seeds and fixtures make runs repeatable.

## Demo rollout

Validate auth renewal, symbol discovery, completed bars, depth, reconciliation, labels, pending-order creation/cancellation, OCO races, partial fills, restart recovery, and conservative broker-specific risk limits on demo only. Complete multiple supervised sessions before shadow/live review.

## Shadow-mode rollout

Consume live data and account state, run real model/validation/risk paths, and persist hypothetical intents, but use a non-submitting gateway. Compare decisions to observable outcomes without calling broker order endpoints.

## Live-readiness criteria

All quality gates pass; demo/shadow evidence is reviewed; credentials and service permissions are protected; broker constraints are confirmed; alerts/runbooks/recovery are exercised; dashboard is authenticated; database backups are tested; all independent live gates are inspected at startup and per order. Readiness never enables trading automatically.

## Deployment

Install pinned Node/Python dependencies, build as an unprivileged service user, run migrations separately, keep environment secrets under `/etc/ctrader-ai-scalper`, install hardened systemd units, bind APIs locally, configure health monitoring and log rotation, then start analytics, market data, orchestration/execution, and dashboard in dependency order.

## Recovery and reconciliation

On startup/reconnect, stop new analyses; load unresolved intents; fetch broker positions/orders; match idempotency labels; classify unknowns; safely cancel obsolete strategy-owned pending orders when permitted; persist reconciliation; resume only when account state is certain. Open positions are not auto-closed by daily lockout or process shutdown without an explicit separately reviewed policy.

## Milestones

- [x] Inspect and summarize repository.
- [x] Phase 1: documentation, architecture, interfaces, schemas, migrations.
- [x] Phase 2: deterministic analytics, replay, backtest, and limitations.
- [x] Phase 3: paper gateway, fills, OCO, reconciliation.
- [x] Phase 4a: cTrader demo transport, disabled-by-default adapter, and mocks.
- [ ] Phase 4b: credentialed demo data/reconciliation passed; supervised demo order lifecycle remains.
- [x] Isolate paper and broker account identities and implement audited,
      fail-closed late demo baseline initialization.
- [x] Run credentialed emergency-stopped demo preflight with stable account and
      cash-flow evidence, empty deal/order/position state, and no analysis/order.
- [x] Phase 5a: structurally non-submitting shadow gateway and live-data path.
- [ ] Phase 5b: credentialed supervised shadow sessions.
- [x] Phase 6: dormant live-compatible interface; production live gateway remains unwired.
- [x] Dashboard, baseline observability, and Debian/systemd artifacts.
- [x] Production migrations through `0006` are applied.
- [ ] Debian Node 22, supervised demo, shadow, Neon backup/restore, and alert drills.

## Development issue backlog

Remote issue links are added as each bounded issue starts. These identifiers
remain stable. Mandatory phase ordering applies: supervised demo and shadow
evidence precede any broker-capable live implementation.

| ID        | Status      | Issue                                                                                                                           | Acceptance summary                                                                                            |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ISSUE-001 | in progress | [Supervised cTrader demo order lifecycle](https://github.com/AegisFintech/scalping-bot/issues/11)                               | Bounded manual session; place/cancel minimum demo OCO; verify fill, peer cancel, expiry, restart, and audit   |
| ISSUE-002 | in progress | [Complete durable demo fill, position, and trade event mapping](https://github.com/AegisFintech/scalping-bot/issues/3)          | Callback journal/order/fill/position recovery implemented; closed-trade mapping awaits supervised evidence    |
| ISSUE-003 | pending     | Credentialed live-data shadow rollout                                                                                           | Non-submitting gateway proven; supervised sessions; outcomes distinctly labelled                              |
| ISSUE-004 | pending     | Broker-specific XAUUSD risk and execution parameter review                                                                      | Precision, volume, margin, spread, slippage, stop, session limits documented                                  |
| ISSUE-005 | pending     | Neon backup, restore, outage, and least-privilege role drill                                                                    | Encrypted backup and isolated restore evidence; outage remains fail-closed                                    |
| ISSUE-006 | pending     | Debian Node 22 least-privilege systemd release validation                                                                       | Non-root services, restart/rollback/graceful shutdown, hardened paths verified                                |
| ISSUE-007 | pending     | Cross-service structured logging, metrics, heartbeats, and alert drills                                                         | Better Stack delivery/redaction and required failure alerts exercised                                         |
| ISSUE-008 | pending     | Cloudflare Access policy, session, CSRF, and audit-retention review                                                             | Authorized identities only; controls protected; access/audit evidence retained                                |
| ISSUE-009 | blocked     | Broker-capable live execution composition and independent safety review                                                         | Blocked by ISSUE-001 through ISSUE-008 and every live-readiness checklist item                                |
| ISSUE-010 | blocked     | Supervised live canary authorization                                                                                            | Separate operator approval; all gates; minimal exposure; rollback/incident drill                              |
| ISSUE-011 | complete    | [Require commit, push, and automatic merge after completed updates](https://github.com/AegisFintech/scalping-bot/issues/1)      | Rule documented, verified, and delivered through [PR #2](https://github.com/AegisFintech/scalping-bot/pull/2) |
| ISSUE-012 | complete    | [Restore migration provenance and apply demo journal migration](https://github.com/AegisFintech/scalping-bot/issues/5)          | Exact historical bytes/checksums restored; `0006` applied stopped; journal and fail-closed runtime clean      |
| ISSUE-013 | complete    | [Add read-only operational charts to Streamlit](https://github.com/AegisFintech/scalping-bot/issues/6)                          | Bounded mode-labelled charts; completed candles; safe empty/error states; transformation tests                |
| ISSUE-014 | complete    | [Make cTrader snapshots session-aware and time-consistent](https://github.com/AegisFintech/scalping-bot/issues/15)              | Exact weekly schedule; trusted closure gaps; broker-time depth; strict analytics and credentialed validation  |
| ISSUE-015 | complete    | [Canonicalize analytics feature decimals before deterministic risk](https://github.com/AegisFintech/scalping-bot/issues/18)     | Ten-place deterministic boundary; conservative truncation; rejection tests; stopped credentialed validation   |
| ISSUE-016 | complete    | [Collect stopped read-only spread observations for adaptive protection](https://github.com/AegisFintech/scalping-bot/issues/20) | Durable minute samples; strict freshness/idempotency; 30 genuine observations; no execution authority         |
| ISSUE-017 | complete    | [Persist model request IDs with unambiguous PostgreSQL types](https://github.com/AegisFintech/scalping-bot/issues/24)           | Distinct typed binds; atomic model trail; real PostgreSQL regression and rollback test                        |
| ISSUE-018 | complete    | [Export correlated decision-trail events to Better Stack](https://github.com/AegisFintech/scalping-bot/issues/29)               | Durable redacted outbox; stable correlation, retries, delivery status, and stopped deployment                 |
| ISSUE-019 | complete    | [Refresh and revalidate market state after model latency](https://github.com/AegisFintech/scalping-bot/issues/32)               | Immutable candle context; refreshed quote/depth; final spread, semantic, risk, and freshness checks           |
| ISSUE-020 | complete    | [Coordinate execution and AI orchestrator timeout budgets](https://github.com/AegisFintech/scalping-bot/issues/35)              | Full retry budget; bounded startup validation; stable timeout/transport reasons and circuit behavior          |
| ISSUE-021 | complete    | [Add a correlated AI decision inspector to Streamlit](https://github.com/AegisFintech/scalping-bot/issues/40)                   | Bounded redacted AI input/output, market, validation, risk, order, audit, and delivery drill-down             |

Each issue is implemented on a dedicated branch with tests and documentation.
Push meaningful checkpoints periodically; merge only after acceptance criteria,
required checks, reviews, and safety sequencing pass. Contribution-count targets
never justify empty, noisy, unsafe, or misleading commits.

### ISSUE-001 delivery details

- Acceptance criteria: the first cTrader demo order session is manual,
  authenticated, capped at one daily OCO group and a reviewed per-position
  notional, and followed immediately by emergency stop, strategy-owned pending
  cancellation, reconciliation, and redacted event review. Uncertain evidence
  blocks another placement.
- Dependencies: [issue #3](https://github.com/AegisFintech/scalping-bot/issues/3),
  configured demo services, clean migration/journal state, current symbol/risk
  evidence, and the operator's exact demo acknowledgement.
- Current status: automatic analysis now defaults off independently of
  reconciliation/maintenance. Demo-enabled startup requires the exact
  acknowledgement, a positive daily order-group limit, and a positive
  per-position notional cap. Status and Streamlit expose the automatic-analysis
  state. The guardrails were merged in
  [PR #12](https://github.com/AegisFintech/scalping-bot/pull/12). Deployment then
  failed closed on the expected strategy-version immutability check after the
  cap/config hash changed. The new immutable
  `0.1.0-demo-guardrails.1` release identity was merged in
  [PR #13](https://github.com/AegisFintech/scalping-bot/pull/13); no provenance
  row was rewritten. The deployed process now reports startup recovery passed,
  automatic analysis off, demo trading disabled, and environment emergency stop
  active. The operator supplied the exact demo acknowledgement for two separate
  bounded windows. The first cycle rejected before AI/risk/intent on
  broker-session candle gaps and an order-book timestamp ordering error. After
  ISSUE-014 was deployed, the second cycle passed strict analytics but rejected
  before model/intent/placement with `SPREAD_INPUT_INVALID`: M1 ATR crossed the
  service boundary with 27 fractional digits while deterministic risk permits 10. Both post-cycle cleanup calls reconciled, acknowledgements were cleared,
  both emergency stops were restored, and execution-event/group/order/active-
  position/fill counts remained zero. ISSUE-015 addresses the decimal contract.
  After ISSUE-016 supplied genuine spread history, a third exact acknowledgement
  authorized one more bounded window. A malformed empty-body HTTP request was
  rejected before the coordinator and did not consume the cycle; its cleanup
  restored the database stop. The subsequent single real cycle reached
  `MODEL_PENDING` and rejected on PostgreSQL's
  `inconsistent types deduced for parameter $1`, with analysis
  `ca2c49d7-f133-4a5f-a4e2-b36c5465b8a7` and no placement. The trail reused one
  bind for UUID `model_requests.id` and text `request_id`; its transaction
  rolled back. Demo enablement and acknowledgement were cleared, both stops were
  restored, reconciliation was certain, and execution-event/group/order/active-
  position/fill counts remained zero. ISSUE-017's fix merged in
  [PR #25](https://github.com/AegisFintech/scalping-bot/pull/25). A fourth exact
  acknowledgement then authorized one post-fix cycle. Its stopped preflight
  accepted 600/500/300 completed candles, complete continuous depth, strict
  analytics, and a 5-point spread at percentile `33.9622641509`; the minimum
  notional was `4648.29` against a `5500` cap, daily loss was zero, and durable
  execution state was empty. The decision snapshot widened to 11 points at the
  100th percentile, so deterministic spread validation rejected analysis
  `199c679e-abd5-43d5-9e39-1a161254c3ed` before model, risk sizing, intent, or
  placement. Mandatory stop/cancel/reconciliation succeeded. Demo enablement
  and acknowledgement were cleared, both stops were restored, and execution-
  event/group/order/active-position/fill counts remained zero. A later
  order-capable cycle requires another fresh exact acknowledgement. The
  documentation checkpoint passed formatting, ESLint, TypeScript
  typecheck/build, 103 Node tests, 10 schema tests, 3 migration tests, all 3
  configured PostgreSQL integration tests, Ruff format/lint, mypy, 30 Python
  tests, replay/backtest smoke tests, both dependency audits, secret and shell
  checks, and all five offline systemd security parses at 2.8 (`OK`).
  A fifth exact acknowledgement requested automatic demo scheduling. Continuous
  scheduling remained off because the first supervised order lifecycle is not
  yet proven. The bounded attempt's stopped preflight again passed at 5 points
  and percentile `35`; the immediate final quote was 7 points at percentile
  `49.1803278688`. Analysis `4ae9126d-d324-4b8a-8965-f689b7b479cb` persisted
  600/500/300 completed candles, accepted analytics and spread validation, and
  completed an AI request/response. The model returned `NO_TRADE` with
  `SESSION_GAPS_PRESENT` and `MULTI_TIMEFRAME_DIRECTION_CONFLICT`; semantic
  validation then rejected `MODEL_DATA_QUALITY_REJECTED` and `QUOTE_STALE`
  before risk sizing, intent, or placement. Cleanup reconciled successfully,
  demo enablement and acknowledgement were cleared, both stops were restored,
  and execution-event/group/order/active-position/fill counts stayed zero. The
  documentation checkpoint passed formatting, ESLint, TypeScript
  typecheck/build, 103 Node tests, 10 schema tests, 3 migration tests, all 3
  configured PostgreSQL integration tests, Ruff format/lint, mypy, 30 Python
  tests, replay/backtest smoke tests, both dependency audits, secret and shell
  checks, and all five offline systemd security parses at 2.8 (`OK`).
  After ISSUE-020 merged and deployed, another fresh acknowledgement authorized
  one capped post-fix cycle. The stopped preflight accepted complete
  600/500/300 candles, continuous depth, strict analytics, current daily risk
  and caps, empty durable execution state, and a 9-point spread at percentile
  `66.4`. Analysis `4033a032-19d7-449d-b9c2-4a949004b091` then captured an
  11-point spread; absolute and adaptive percentile protection rejected it
  before any model request, risk decision, intent, or broker command. The stop
  trap fired, cancellation/reconciliation was certain, demo enablement and the
  acknowledgement were cleared, both stops were restored, and orders, fills,
  active positions, and unresolved events remained zero. All six correlated
  audit events reached Better Stack on their first attempt. Automatic analysis
  remains off because no supervised broker order lifecycle has yet occurred.
  The documentation checkpoint passed the complete 123-Node-test, configured
  integration, schema/migration, 30-Python-test, replay/backtest, dependency,
  secret, shell, and offline-systemd gate suite. Evidence is recorded in
  [PR #38](https://github.com/AegisFintech/scalping-bot/pull/38).
  The operator then explicitly scoped one exact acknowledgement as continuing
  authorization for bounded broker-demo attempts during the current demo-
  readiness campaign; it does not authorize real-money live trading or
  unattended automatic analysis. Three further supervised windows retained
  the one-group/notional caps and mandatory stop/cancel/reconciliation. Analyses
  `6310314b-6a5f-41b1-9585-6517cd7ca92e` and
  `f9fbb9b4-3835-40d7-ad07-796d43a6dfa6` each completed a model request but
  crossed a completed M1 rollover, so the immutable decision-context check
  rejected `DECISION_CANDLE_CONTEXT_CHANGED` before risk intent or placement.
  A third attempt was timed inside one completed-candle window: analysis
  `09b34e95-0900-4273-8acf-8d370e2a073c` accepted strict analytics, both spread
  checks, and the refreshed market context. The model returned `NO_TRADE` with
  unacceptable data quality because M1 direction conflicted with M5/M15, trend
  strength/volume were low, session gaps were present, and no validated edge
  existed. Semantic validation rejected `MODEL_DATA_QUALITY_REJECTED`; no risk
  decision, order group, broker command, fill, position, or unresolved event
  was created. Each cleanup was certain and restored both emergency stops plus
  disabled demo/automatic scheduling. Automatic analysis remains off until a
  supervised broker order lifecycle passes without weakening market or model
  validation. The evidence checkpoint passed Prettier, ESLint, TypeScript
  typecheck/build, 123 Node tests, 10 schema tests, 3 migration tests, all 3
  configured PostgreSQL integration tests, Ruff format/lint, mypy, 30 Python
  tests, replay/backtest, both dependency audits, secret and shell checks, and
  all five offline systemd security parses at 2.8 (`OK`). Evidence is tracked
  in [PR #39](https://github.com/AegisFintech/scalping-bot/pull/39).

### ISSUE-002 delivery details

- Acceptance criteria: every strategy-owned cTrader execution callback is
  normalized without account credentials, durably deduplicated with its state
  transition, and recovered from bounded order/deal history after startup or
  reconnect; missing, conflicting, paginated, partial, unknown, or unmatched
  evidence blocks further placement. Versioned positive and rejection fixtures,
  OCO peer-cancel tests, and both fresh/upgrade migration tests are required.
- Dependencies: official cTrader execution/order/deal/position contracts, the
  existing disabled-by-default demo gateway, migration `0006`, and supervised
  broker evidence for closing-deal commission/P&L signs.
- Current status: callback journal plus order/fill/position mapping and restart/
  reconnect recovery are implemented on `feat/issue-002-demo-event-lifecycle`.
  This checkpoint is under review in
  [PR #4](https://github.com/AegisFintech/scalping-bot/pull/4).
  Closing events are intentionally reason-coded
  `DEMO_TRADE_OUTCOME_MAPPING_PENDING` until supervised demo evidence confirms
  broker-specific money fields. Migration `0006` passed fresh and `0005` upgrade
  tests but is not yet applied to the configured database.

### ISSUE-011 delivery details

- Acceptance criteria: `AGENTS.md` requires diff review, secret scanning,
  applicable quality gates, a coherent commit, and a push after every completed
  user-requested tracked-file update; remote failures must be reported rather
  than bypassed.
- Dependencies: a GitHub identity/token authorized for Issues, Contents, and
  Pull Requests write on `AegisFintech/scalping-bot`, plus an available remote
  and compliant branch protection.
- Current status: authenticated remote delivery is available; implementation is
  tracked by [GitHub issue #1](https://github.com/AegisFintech/scalping-bot/issues/1)
  and [pull request #2](https://github.com/AegisFintech/scalping-bot/pull/2).
- Verification on 2026-08-24: Prettier, ESLint, TypeScript typecheck/build, 63
  Node unit tests, 10 schema tests, 2 static migration tests, both configured
  integration tests (including isolated-schema migration), npm audit, Ruff
  format/lint, mypy, 13 Python tests, pip-audit, replay, conservative backtest,
  secret scan, and `git diff --check` passed.

### ISSUE-012 delivery details

- Acceptance criteria: restore the exact historically applied bytes for
  migrations `0001` and `0002` without changing SQL semantics, prove their
  SHA-256 values match the configured migration ledger, keep unknown checksum
  drift rejected, apply `0006` transactionally under emergency stop, and verify
  a clean execution journal/recovery state without submitting an order.
- Dependencies: [PR #4](https://github.com/AegisFintech/scalping-bot/pull/4),
  recovered Git blobs, configured database access, and migration `0006` rollback
  notes.
- Current status: complete. Exact historical blobs were recovered from Git. Both files
  differ from `main` only by one trailing blank line; their content hashes match
  the database ledger. No checksum row has been or will be rewritten. Delivery
  was merged in [PR #7](https://github.com/AegisFintech/scalping-bot/pull/7).
  Migration `0006` was then applied with execution stopped. After restart,
  startup recovery was certain, the execution journal/order/position/fill counts
  were zero, and emergency stop plus disabled demo submission still blocked all
  trading. The deployment record is delivered in
  [PR #8](https://github.com/AegisFintech/scalping-bot/pull/8).

### ISSUE-013 delivery details

- Acceptance criteria: add bounded, mode-labelled, read-only Plotly charts for
  completed candles/indicators, spread/depth freshness, daily risk/equity,
  execution lifecycle, and rejection/health trends. Empty, stale, malformed, or
  unavailable data must render an explicit safe state; transformations require
  positive and rejection-path tests.
- Dependencies: existing PostgreSQL tables/views, the pandas/Plotly/Streamlit
  lockfile, and the dashboard's loopback/read-only security boundary.
- Current status: complete. Pure chart builders, bounded account/symbol queries,
  completed-candle enforcement, explicit empty/error states, and six positive/
  rejection-path tests were merged in
  [PR #9](https://github.com/AegisFintech/scalping-bot/pull/9). The dashboard was
  restarted from `main`; its health endpoint returned `ok`, and a configured
  AppTest rendered four charts with no exception. Execution remained in demo
  mode with submission disabled and emergency stop active throughout.

### ISSUE-014 delivery details

- Acceptance criteria: parse and validate the broker's exact weekly symbol
  schedule/timezone; mark only gaps wholly outside a session; reject open-session
  missing bars, overlaps, unknown/misplaced markers, stale/incomplete depth, and
  future source timestamps; use broker time for depth; expose per-timeframe gap
  counts; and prove the configured demo snapshot through analytics without
  enabling execution.
- Dependencies: cTrader `ProtoOASymbol.schedule`/`scheduleTimeZone`, trendbar and
  spot/depth timestamp semantics, the typed market/analytics boundary, and the
  existing stopped demo account.
- Current status: complete in
  [PR #16](https://github.com/AegisFintech/scalping-bot/pull/16), merge commit
  `a81cfb2`. All required local quality/security gates passed. The merged build
  was deployed to PM2; analytics, market data, execution, and Streamlit health
  checks passed. A stopped production-loopback probe returned 600 M1, 500 M5,
  and 300 M15 completed candles; the adapter marked 1, 2, and 3 broker-session
  gaps and strict analytics accepted the snapshot. Execution remained in demo
  mode with automatic analysis and trading disabled plus database/environment
  emergency stops active. Demo execution-event/order/active-position/fill
  counts remained zero.

### ISSUE-015 delivery details

- Acceptance criteria: every analytics feature decimal is finite, canonical,
  and bounded to at most ten fractional places; positive values truncate toward
  zero so ATR-based risk checks cannot become less conservative; invalid and
  non-finite values fail; typed HTTP and deterministic spread tests cover the
  boundary; the configured stopped demo snapshot crosses analytics into spread
  validation without `SPREAD_INPUT_INVALID`.
- Dependencies: Python `Decimal` features, the typed analytics response, and the
  risk engine's canonical decimal parser.
- Current status: complete in
  [PR #19](https://github.com/AegisFintech/scalping-bot/pull/19), merge commit
  `38e8b77`. All required local gates passed. The merged analytics service was
  deployed with both demo emergency stops active. A production-loopback snapshot
  emitted canonical ten-place M1 ATR `2.7244341586`; strict analytics accepted
  it and deterministic absolute/ATR spread validation approved the five-point
  observation. Execution remained disabled and broker/local execution counts
  stayed zero.

### ISSUE-016 delivery details

- Acceptance criteria: persist only fresh, non-crossed, broker-time-consistent
  typed quote observations; enforce one idempotent sample per UTC minute; collect
  while analysis/trading are stopped without any execution authority; require
  at least 30 distinct recent observations before percentile approval; cover
  migrations, restart, failures, and rollback documentation; deploy stopped and
  accumulate genuine timed observations rather than synthesizing history.
- Dependencies: [issue #20](https://github.com/AegisFintech/scalping-bot/issues/20),
  the typed market quote endpoint, PostgreSQL, and existing adaptive spread logic.
- Current status: complete in
  [PR #22](https://github.com/AegisFintech/scalping-bot/pull/22), merge commit
  `3b0fd4d`. Migration `0007` was applied with both emergency stops active and
  execution restarted ready but with trading and automatic analysis disabled.
  The sampler accumulated 30 genuine consecutive broker-source minute buckets
  without seeding or threshold changes. A final stopped preflight had 32 recent
  samples, accepted strict analytics, a 9-point spread at percentile `71.875`,
  no session abnormality, and deterministic spread approval. Execution events,
  groups, orders, active positions, and fills all remained zero; no cycle was
  invoked and a later order-capable cycle still requires fresh acknowledgement.

### ISSUE-017 delivery details

- Acceptance criteria: use distinct, unambiguous PostgreSQL parameters for the
  UUID model-request primary key and text provider request ID while preserving
  the same generated identifier value; atomically persist model request,
  response, redacted payloads, and validity; prove successful persistence and
  transaction rollback with configured PostgreSQL integration tests; retain all
  redaction, validation, risk, idempotency, and execution gates.
- Dependencies: [issue #24](https://github.com/AegisFintech/scalping-bot/issues/24),
  the existing append-only decision trail, and configured isolated-schema tests.
- Current status: complete in
  [PR #25](https://github.com/AegisFintech/scalping-bot/pull/25), merge commit
  `eae91f6`. The configured PostgreSQL commit/rollback regression and complete
  gate suite passed. The merged execution service was rebuilt and restarted
  with demo submission disabled, automatic analysis off, and both emergency
  stops active. Startup recovery is certain and execution events, groups,
  orders, active positions, and fills remain zero. The failed supervised
  analysis correctly retains zero partial model rows. No deployment cycle was
  invoked; another order-capable cycle requires fresh exact acknowledgement.

### ISSUE-018 delivery details

- Acceptance criteria: atomically enqueue each new PostgreSQL audit event once;
  deliver bounded redacted summaries to Better Stack with stable event IDs,
  leases, at-least-once retry, and bounded backoff; exclude credentials, raw
  account/broker identifiers, full candle arrays, and full model payloads;
  expose backlog/delivery state in Streamlit; retain PostgreSQL as authority and
  keep remote logging outside trading authority.
- Dependencies: [issue #29](https://github.com/AegisFintech/scalping-bot/issues/29),
  migration `0008`, the existing append-only audit stream, configured Better
  Stack HTTPS source, and redaction tests.
- Current status: complete in
  [PR #30](https://github.com/AegisFintech/scalping-bot/pull/30), merge commit
  `81ee7bb`. The configured source accepted a redacted transport probe;
  migration `0008` was then applied with both emergency stops active and the
  updated execution/dashboard processes were restarted. A startup
  `reconciliation_completed` event entered `RETRY` after its first HTTPS
  attempt and recovered to `DELIVERED` on attempt two with its stable event ID.
  Streamlit health passed and its configured AppTest rendered seven charts,
  zero exceptions, and the Better Stack delivery section. Execution startup is
  ready but trading is false; demo submission and automatic analysis are off;
  broker execution events, order groups, orders, active positions, and fills
  remain zero. No analysis cycle or broker command was run. Post-deployment
  evidence is recorded in
  [PR #31](https://github.com/AegisFintech/scalping-bot/pull/31).

### ISSUE-019 delivery details

- Acceptance criteria: reacquire a complete broker snapshot after every model
  response; fail closed if retrieval fails, broker time regresses, execution
  metadata changes, or any completed candle differs from the model context;
  persist bounded refreshed quote/depth evidence; and run final spread,
  semantic, deterministic risk, and placement-freshness checks only against the
  refreshed execution state. Positive and rejection tests plus configured
  PostgreSQL persistence evidence are required.
- Dependencies: [issue #32](https://github.com/AegisFintech/scalping-bot/issues/32),
  the immutable initial snapshot, typed market adapter, deterministic spread and
  semantic validators, and append-only decision trail.
- Current status: a later exact acknowledgement authorized one bounded manual
  cycle. Analysis `70e71671-6052-4ad4-b497-255eb13cb5d8` completed its model
  call, which returned `NO_TRADE` with unacceptable data quality, session gaps,
  multi-timeframe conflict, low ADX, elevated M15 volatility, and insufficient
  setup history. Semantic validation also rejected the pre-model quote as stale
  after inference. No risk decision, intent, order group, order, fill, or broker
  command was created; Better Stack delivery completed, cleanup reconciled, the
  acknowledgement was cleared, demo/automatic analysis were disabled, and both
  stops were restored. Implementation now reacquires and validates execution
  state without widening the three-second freshness limits. Formatting, ESLint,
  TypeScript typecheck/build, 114 Node tests, 10 schema tests, 3 migration tests,
  all 3 configured integration tests, Ruff format/lint, mypy, 30 Python tests,
  replay/backtest smoke tests, both dependency audits, secret and shell checks,
  and all five offline systemd security parses at 2.8 (`OK`) pass. The change
  merged in [PR #33](https://github.com/AegisFintech/scalping-bot/pull/33) as
  `21312cb`. The merged execution build was restarted with explicit safe
  overrides under immutable strategy/code identity
  `0.1.0-decision-refresh.1`. Startup recovery and readiness passed; demo and
  automatic analysis remained disabled with both emergency stops active. The
  new provenance row exists, demo order groups/orders/active positions/fills
  and unresolved broker events are zero, and the startup audit recovered from
  two rejected Better Stack attempts to `DELIVERED` on attempt three with zero
  backlog. No cycle or broker command was invoked after deployment. Another
  order-capable supervised cycle still requires a fresh exact acknowledgement.
  Deployment evidence is recorded in
  [PR #34](https://github.com/AegisFintech/scalping-bot/pull/34).

### ISSUE-020 delivery details

- Acceptance criteria: derive the execution-to-orchestrator HTTP timeout from
  all configured provider attempts plus bounded grace; reject nonpositive,
  fractional, unsafe, or timer-overflowing budgets at startup; normalize local
  timeout/transport failures to stable reason codes and open the caller circuit;
  and prove positive, timeout, failure, and invalid-budget paths without
  weakening market refresh, risk, reconciliation, audit, or idempotency gates.
- Dependencies: [issue #35](https://github.com/AegisFintech/scalping-bot/issues/35),
  the provider client's per-attempt timeout/retry policy, the local typed HTTP
  boundary, and immutable release provenance.
- Current status: a fresh exact acknowledgement authorized one capped manual
  window after a stopped preflight accepted complete 600/500/300 candles,
  continuous depth, analytics, a 9-point spread at percentile
  `63.5514018691`, configured caps, daily risk, and empty durable execution
  state. Analysis `672f21d7-d7dd-462b-8ec0-9854602dd4a1` then rejected in
  `MODEL_PENDING` because execution allowed only 35 seconds while the local AI
  service was configured for as many as three 30-second provider attempts. The
  database stop trap fired, cancellation/reconciliation was certain, the
  acknowledgement and enablement were cleared, and both stops were restored.
  The analysis retained its snapshot, analytics, validation, and transitions;
  model requests, risk decisions, groups, orders, fills, active positions, and
  unresolved events remained zero, while all eight correlated audit events
  reached Better Stack. The full retry budget, startup bounds, stable transport
  reasons, and circuit behavior are implemented under immutable identity
  `0.1.0-ai-timeout-budget.1`. Formatting, ESLint, TypeScript typecheck/build,
  123 Node tests, 10 schema tests, 3 migration tests, all 3 configured
  integration tests, Ruff format/lint, mypy, 30 Python tests, replay/backtest,
  both dependency audits, secret and shell checks, and all five offline systemd
  security parses at 2.8 (`OK`) pass. The fix merged in
  [PR #36](https://github.com/AegisFintech/scalping-bot/pull/36) as `eae2aff`.
  The merged execution build was restarted under immutable strategy/code
  identity `0.1.0-ai-timeout-budget.1`; production identity, startup recovery,
  and readiness passed. Demo and automatic analysis remain disabled with both
  emergency stops active. The new provenance row exists; demo groups, orders,
  fills, active positions, and unresolved events remain zero. The most delayed
  startup reconciliation audit recovered through bounded backoff to
  `DELIVERED` on attempt five, leaving zero Better Stack backlog. No cycle or
  broker command was invoked after deployment. Another supervised cycle
  requires a fresh exact acknowledgement. Deployment evidence is recorded in
  [PR #37](https://github.com/AegisFintech/scalping-bot/pull/37).

### ISSUE-021 delivery details

- Acceptance criteria: select a recent analysis within the current account and
  symbol scope; clearly separate deterministic market/indicator context, the
  bounded parsed AI response, post-model refresh, local validation/risk, and
  broker outcome; show the correlated chronological PostgreSQL audit trail and
  Better Stack delivery state; render absent stages as not reached; exclude
  secrets, account/broker identifiers, authorization headers, full candle
  arrays, full model payloads, and unbounded raw response text; and cover valid,
  malformed, sensitive-key, and oversized inputs with tests.
- Dependencies: the existing append-only decision trail, redacted model
  request/response persistence, current account/symbol scoping, Streamlit, and
  the Better Stack outbox.
- Current status: complete. [PR #41](https://github.com/AegisFintech/scalping-bot/pull/41)
  merged as `d64114a`; the dashboard restarted from `main`, its health check and
  configured model/pre-model renders passed, and execution remained demo with
  trading/automatic analysis disabled and the emergency stop active. No
  analysis cycle, broker command, execution behavior, or database contract was
  changed. The deployment evidence documentation pull request is pending.

## Acceptance criteria

- Default configuration cannot place live or demo orders and starts emergency-stopped.
- Invalid, stale, duplicate, uncertain, unpriced, or unreconciled inputs create no orders.
- Model output cannot select volume or override risk/daily loss/live gates.
- OCO peer cancellation and expiry are idempotent and reconciled.
- Services run headlessly on Debian without Docker; dashboard labels every result mode.
- Logs and persisted audit data exclude secrets.

## Current implementation limitations

- Production live composition is deliberately non-submitting; startup readiness
  stays false and `DisabledLiveGateway` is used.
- cTrader demo authentication/renewal, XAUUSD metadata, 300/500/600 completed
  candles, four-level-per-side depth, and empty-state reconciliation passed.
  This broker feed did not supply the configured default 20 depth levels, so
  the protected local configuration uses four. Capital-flow classifications,
  order event fields, fills, and demo OCO races still need supervised validation.
- Weekly broker sessions are authoritative for closure-gap markers. Broker
  holiday overrides are not yet modeled; a holiday that falls inside an
  otherwise open weekly session therefore remains unmarked and fails closed.
- A quote/deposit currency conversion provider is not configured; mismatched
  currencies fail closed.
- Only the execution service currently emits rotating/Better Stack logs and
  persists host/process metrics. The other APIs expose health endpoints and
  systemd journals; OTLP export and Better Stack heartbeat-URL delivery remain
  unimplemented.
- Paper fills/positions/trades are durable. Demo callbacks now have a durable,
  deduplicated event journal with order/fill/position mapping and bounded restart
  recovery. Closed-trade P/L remains blocked pending supervised validation of
  the broker's commission, swap, and conversion-fee signs.
- PostgreSQL TLS connectivity and isolated-schema tests through migration `0007`
  passed; the configured Neon schema is now at `0007`, with a clean empty event
  journal and certain startup recovery. Backup/restore and
  Node 22 Debian deployment have not been exercised. The remote dashboard
  hostname returns a Cloudflare Access redirect, but its long-term policy and
  audit retention still require operator review.

## Known risks

Broker differences, incomplete depth, token/connection failures, race conditions, candle backtest ambiguity, model nondeterminism, vendor schema variance, database/network partitions, clock skew, symbol metadata drift, and operational misconfiguration. Financial loss remains possible even after all technical controls.

## Operations checklist

- [ ] Verify system clock, disk, memory, database and dependency health.
- [ ] Verify mode banners, emergency stop, runtime controls, and no unexpected sentinels.
- [x] Emergency-stopped demo preflight: distinct broker identity, empty broker
      state/deal history, audited baseline, and disabled demo/live submission.
- [ ] Reconcile account/symbol orders and positions before analysis.
- [x] Confirm candle/depth freshness and metadata revision for the stopped
      ISSUE-014 deployment; repeat immediately before every supervised cycle.
- [ ] Confirm log redaction, alert delivery, audit persistence, and backups.
- [ ] For demo only, supervise order lifecycle and OCO cancellation.
- [ ] For shadow, confirm gateway cannot submit.
- [ ] For live review, complete `docs/demo-to-live-checklist.md`; do not enable automatically.

## Quality-gate record

Local gates run on 2026-08-24 with Node 24.18.0/npm 11.16.0, Python
3.13.5, Ruff 0.16.4, mypy 2.3.1, pytest 9.1.1, and systemd 257. Deployment
remains pinned to Node 22; the newer local Node result is not evidence for that
runtime.

- [x] `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- [x] `npm test`: 28 files, 123 tests passed.
- [x] `npm run test:integration`: 3 passed, including fresh and `0005`-through-`0008` upgrade paths in isolated Neon schemas that were dropped afterward.
- [x] `npm run test:schemas`: 10 passed; `npm run test:migrations`: 3 static migration tests passed.
- [x] `npm audit --audit-level=high`: 0 vulnerabilities.
- [x] Ruff format/check, mypy, and pytest: 30 Python tests passed.
- [x] Checked-in replay and conservative backtest CLI smoke commands completed successfully.
- [x] `pip-audit -r requirements.lock`: no known vulnerabilities.
- [x] Secret scan and shell syntax checks passed.
- [x] `systemd-analyze security --offline=yes` parsed all five services; common sandbox score is 2.8 (`OK`) on systemd 257.
- [x] Apply reviewed migrations `0001` through `0006` to the configured Neon schema.
- [x] Apply reviewed migration `0007` under both emergency stops after PR merge.
- [x] Apply reviewed migration `0008` under both emergency stops after PR merge;
      verify durable Better Stack retry/recovery and the Streamlit delivery view.
- [ ] Prove encrypted backup and isolated restore for the configured Neon database.
- [ ] Install a release under `/opt/ctrader-ai-scalper/current` and verify systemd units on Debian/Node 22.
- [ ] Run supervised cTrader demo-order/shadow, Better Stack delivery/alert, and recovery drills.
- [x] Validate the PM2 ecosystem, individual restart, and systemd boot
      resurrection on this VPS; all listeners remain on loopback. The current PM2
      daemon runs as root because the repository is under `/root`; migrate to the
      least-privilege release layout before any live-readiness review.
