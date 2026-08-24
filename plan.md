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

| ID        | Status      | Issue                                                                                                                      | Acceptance summary                                                                                            |
| --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ISSUE-001 | in progress | [Supervised cTrader demo order lifecycle](https://github.com/AegisFintech/scalping-bot/issues/11)                          | Bounded manual session; place/cancel minimum demo OCO; verify fill, peer cancel, expiry, restart, and audit   |
| ISSUE-002 | in progress | [Complete durable demo fill, position, and trade event mapping](https://github.com/AegisFintech/scalping-bot/issues/3)     | Callback journal/order/fill/position recovery implemented; closed-trade mapping awaits supervised evidence    |
| ISSUE-003 | pending     | Credentialed live-data shadow rollout                                                                                      | Non-submitting gateway proven; supervised sessions; outcomes distinctly labelled                              |
| ISSUE-004 | pending     | Broker-specific XAUUSD risk and execution parameter review                                                                 | Precision, volume, margin, spread, slippage, stop, session limits documented                                  |
| ISSUE-005 | pending     | Neon backup, restore, outage, and least-privilege role drill                                                               | Encrypted backup and isolated restore evidence; outage remains fail-closed                                    |
| ISSUE-006 | pending     | Debian Node 22 least-privilege systemd release validation                                                                  | Non-root services, restart/rollback/graceful shutdown, hardened paths verified                                |
| ISSUE-007 | pending     | Cross-service structured logging, metrics, heartbeats, and alert drills                                                    | Better Stack delivery/redaction and required failure alerts exercised                                         |
| ISSUE-008 | pending     | Cloudflare Access policy, session, CSRF, and audit-retention review                                                        | Authorized identities only; controls protected; access/audit evidence retained                                |
| ISSUE-009 | blocked     | Broker-capable live execution composition and independent safety review                                                    | Blocked by ISSUE-001 through ISSUE-008 and every live-readiness checklist item                                |
| ISSUE-010 | blocked     | Supervised live canary authorization                                                                                       | Separate operator approval; all gates; minimal exposure; rollback/incident drill                              |
| ISSUE-011 | complete    | [Require commit, push, and automatic merge after completed updates](https://github.com/AegisFintech/scalping-bot/issues/1) | Rule documented, verified, and delivered through [PR #2](https://github.com/AegisFintech/scalping-bot/pull/2) |
| ISSUE-012 | complete    | [Restore migration provenance and apply demo journal migration](https://github.com/AegisFintech/scalping-bot/issues/5)     | Exact historical bytes/checksums restored; `0006` applied stopped; journal and fail-closed runtime clean      |
| ISSUE-013 | complete    | [Add read-only operational charts to Streamlit](https://github.com/AegisFintech/scalping-bot/issues/6)                     | Bounded mode-labelled charts; completed candles; safe empty/error states; transformation tests                |

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
  state. These guardrails are in progress on
  `feat/issue-001-supervised-demo-guardrails` and proposed in
  [PR #12](https://github.com/AegisFintech/scalping-bot/pull/12); submission and
  emergency stop remain unchanged. Deployment then failed closed on the
  expected strategy-version immutability check after the cap/config hash
  changed. A new immutable `0.1.0-demo-guardrails.1` release identity is being
  delivered in
  [PR #13](https://github.com/AegisFintech/scalping-bot/pull/13); no provenance
  row is rewritten.

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
- PostgreSQL TLS connectivity and isolated-schema tests through migration `0006`
  passed; the configured Neon schema is now at `0006`, with a clean empty event
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
- [ ] Confirm candle/depth freshness and metadata revision.
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
- [x] `npm test`: 25 files, 82 tests passed.
- [x] `npm run test:integration`: 3 passed, including fresh and `0005`-to-`0006` upgrade paths in isolated Neon schemas that were dropped afterward.
- [x] `npm run test:schemas`: 10 passed; `npm run test:migrations`: 3 static migration tests passed.
- [x] `npm audit --audit-level=high`: 0 vulnerabilities.
- [x] Ruff format/check, mypy, and pytest: 19 Python tests passed.
- [x] Checked-in replay and conservative backtest CLI smoke commands completed successfully.
- [x] `pip-audit -r requirements.lock`: no known vulnerabilities.
- [x] Secret scan and shell syntax checks passed.
- [x] `systemd-analyze security --offline=yes` parsed all five services; common sandbox score is 2.8 (`OK`) on systemd 257.
- [x] Apply reviewed migrations `0001` through `0006` to the configured Neon schema.
- [ ] Prove encrypted backup and isolated restore for the configured Neon database.
- [ ] Install a release under `/opt/ctrader-ai-scalper/current` and verify systemd units on Debian/Node 22.
- [ ] Run supervised cTrader demo-order/shadow, Better Stack delivery/alert, and recovery drills.
- [x] Validate the PM2 ecosystem, individual restart, and systemd boot
      resurrection on this VPS; all listeners remain on loopback. The current PM2
      daemon runs as root because the repository is under `/root`; migrate to the
      least-privilege release layout before any live-readiness review.
