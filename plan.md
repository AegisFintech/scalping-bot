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

Schema `2.0` accepts only a bounded mandatory two-leg conditional OCO proposal
with decimal strings, strict enums, timestamps, confidence, evidence/risk codes,
warnings, and performance adjustment. It has no `NO_TRADE` or leg-enable switch
and contains no size, credentials, executable content, or broker IDs. Historical
schema `1.0` remains immutable for audit. Structured output is requested where
supported and always validated locally. See `docs/model-contract.md`.

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

| ID        | Status      | Issue                                                                                                                             | Acceptance summary                                                                                            |
| --------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ISSUE-001 | in progress | [Supervised cTrader demo order lifecycle](https://github.com/AegisFintech/scalping-bot/issues/11)                                 | Bounded manual session; place/cancel minimum demo OCO; verify fill, peer cancel, expiry, restart, and audit   |
| ISSUE-002 | in progress | [Complete durable demo fill, position, and trade event mapping](https://github.com/AegisFintech/scalping-bot/issues/3)            | Callback journal/order/fill/position/trade mapping implemented; supervised broker evidence remains            |
| ISSUE-003 | pending     | Credentialed live-data shadow rollout                                                                                             | Non-submitting gateway proven; supervised sessions; outcomes distinctly labelled                              |
| ISSUE-004 | pending     | Broker-specific XAUUSD risk and execution parameter review                                                                        | Precision, volume, margin, spread, slippage, stop, session limits documented                                  |
| ISSUE-005 | pending     | Neon backup, restore, outage, and least-privilege role drill                                                                      | Encrypted backup and isolated restore evidence; outage remains fail-closed                                    |
| ISSUE-006 | pending     | Debian Node 22 least-privilege systemd release validation                                                                         | Non-root services, restart/rollback/graceful shutdown, hardened paths verified                                |
| ISSUE-007 | pending     | Cross-service structured logging, metrics, heartbeats, and alert drills                                                           | Better Stack delivery/redaction and required failure alerts exercised                                         |
| ISSUE-008 | pending     | Cloudflare Access policy, session, CSRF, and audit-retention review                                                               | Authorized identities only; controls protected; access/audit evidence retained                                |
| ISSUE-009 | blocked     | Broker-capable live execution composition and independent safety review                                                           | Blocked by ISSUE-001 through ISSUE-008 and every live-readiness checklist item                                |
| ISSUE-010 | blocked     | Supervised live canary authorization                                                                                              | Separate operator approval; all gates; minimal exposure; rollback/incident drill                              |
| ISSUE-011 | complete    | [Require commit, push, and automatic merge after completed updates](https://github.com/AegisFintech/scalping-bot/issues/1)        | Rule documented, verified, and delivered through [PR #2](https://github.com/AegisFintech/scalping-bot/pull/2) |
| ISSUE-012 | complete    | [Restore migration provenance and apply demo journal migration](https://github.com/AegisFintech/scalping-bot/issues/5)            | Exact historical bytes/checksums restored; `0006` applied stopped; journal and fail-closed runtime clean      |
| ISSUE-013 | complete    | [Add read-only operational charts to Streamlit](https://github.com/AegisFintech/scalping-bot/issues/6)                            | Bounded mode-labelled charts; completed candles; safe empty/error states; transformation tests                |
| ISSUE-014 | complete    | [Make cTrader snapshots session-aware and time-consistent](https://github.com/AegisFintech/scalping-bot/issues/15)                | Exact weekly schedule; trusted closure gaps; broker-time depth; strict analytics and credentialed validation  |
| ISSUE-015 | complete    | [Canonicalize analytics feature decimals before deterministic risk](https://github.com/AegisFintech/scalping-bot/issues/18)       | Ten-place deterministic boundary; conservative truncation; rejection tests; stopped credentialed validation   |
| ISSUE-016 | complete    | [Collect stopped read-only spread observations for adaptive protection](https://github.com/AegisFintech/scalping-bot/issues/20)   | Durable minute samples; strict freshness/idempotency; 30 genuine observations; no execution authority         |
| ISSUE-017 | complete    | [Persist model request IDs with unambiguous PostgreSQL types](https://github.com/AegisFintech/scalping-bot/issues/24)             | Distinct typed binds; atomic model trail; real PostgreSQL regression and rollback test                        |
| ISSUE-018 | complete    | [Export correlated decision-trail events to Better Stack](https://github.com/AegisFintech/scalping-bot/issues/29)                 | Durable redacted outbox; stable correlation, retries, delivery status, and stopped deployment                 |
| ISSUE-019 | complete    | [Refresh and revalidate market state after model latency](https://github.com/AegisFintech/scalping-bot/issues/32)                 | Immutable candle context; refreshed quote/depth; final spread, semantic, risk, and freshness checks           |
| ISSUE-020 | complete    | [Coordinate execution and AI orchestrator timeout budgets](https://github.com/AegisFintech/scalping-bot/issues/35)                | Full retry budget; bounded startup validation; stable timeout/transport reasons and circuit behavior          |
| ISSUE-021 | complete    | [Add a correlated AI decision inspector to Streamlit](https://github.com/AegisFintech/scalping-bot/issues/40)                     | Bounded redacted AI input/output, market, validation, risk, order, audit, and delivery drill-down             |
| ISSUE-022 | complete    | [Require actionable two-leg AI proposals and expose prompt history](https://github.com/AegisFintech/scalping-bot/issues/43)       | Versioned mandatory OCO proposal contract plus exact prompt/request/response history                          |
| ISSUE-023 | complete    | [Register immutable release identity for automated demo analysis](https://github.com/AegisFintech/scalping-bot/issues/47)         | New immutable identity; staged stopped restart; scoped demo automation enablement and verification            |
| ISSUE-024 | complete    | [Align automatic demo analysis with broker M1 boundaries](https://github.com/AegisFintech/scalping-bot/issues/49)                 | Durable broker-M1 claims; one provider attempt; unchanged post-model context check; deployed terminal cycle   |
| ISSUE-025 | complete    | [Complete terminal cTrader demo trade lifecycle and automatic repeat](https://github.com/AegisFintech/scalping-bot/issues/51)     | Persist full-close outcomes; release terminal analyses; display scheduler/trade history; repeat under caps    |
| ISSUE-026 | complete    | [Register corrected immutable identity for bounded repeated demo cap](https://github.com/AegisFintech/scalping-bot/issues/53)     | Preserve `.3`; register `.4` with cap 20 before first execution startup; stopped deployment evidence          |
| ISSUE-027 | complete    | [Normalize risk volume downward to the configured notional cap](https://github.com/AegisFintech/scalping-bot/issues/55)           | Cap down to broker step; never exceed loss/notional/margin; reject cap below broker minimum; deploy stopped   |
| ISSUE-028 | in progress | [Persist cTrader placement callbacks after local broker IDs commit](https://github.com/AegisFintech/scalping-bot/issues/57)       | Queue placement callbacks; broker-ID fallback; durable readiness clears resolved evidence without restart     |
| ISSUE-029 | in progress | [Handle broker demo callbacks that omit strategy identity](https://github.com/AegisFintech/scalping-bot/issues/59)                | Sanitized callback failure evidence; observed-shape fix; terminal same-PID automatic repeat                   |
| ISSUE-030 | complete    | [Make execution AI circuit recover without restart](https://github.com/AegisFintech/scalping-bot/issues/61)                       | Configured caller cooldown; exact half-open boundary; same-PID scheduler recovery                             |
| ISSUE-032 | complete    | [Make demo automation state and AI prompt trail operator-readable](https://github.com/AegisFintech/scalping-bot/issues/67)        | Plain-language state/retry timing; prominent exact AI messages; local/UTC cycle history                       |
| ISSUE-033 | complete    | [Apply endpoint TP midpoint to continuous demo OCO loop](https://github.com/AegisFintech/scalping-bot/issues/70)                  | Preserve AI entry/SL; halve TP distance; validate/risk effective OCO; show proposal versus broker intent      |
| ISSUE-034 | complete    | [Constrain endpoint stops to broker-minimum risk affordability](https://github.com/AegisFintech/scalping-bot/issues/72)           | Derive non-sizing max stop; endpoint honors it; retain deterministic risk and every existing gate             |
| ISSUE-035 | complete    | [Refresh and revalidate market immediately before demo intent](https://github.com/AegisFintech/scalping-bot/issues/74)            | Final market/account refresh; repeat spread/semantics; preserve freshness without raising limits              |
| ISSUE-036 | complete    | [Reduce compact AI payload latency without reducing analytics history](https://github.com/AegisFintech/scalping-bot/issues/76)    | Retain full analytics; bound raw endpoint tails; measure request size/latency                                 |
| ISSUE-037 | complete    | [Deduplicate repeated cTrader fill callbacks before strict normalization](https://github.com/AegisFintech/scalping-bot/issues/78) | Skip only certainly persisted duplicate deal IDs; keep new malformed deals fail-closed                        |
| ISSUE-038 | complete    | [Recover missed cTrader terminal deals automatically without restart](https://github.com/AegisFintech/scalping-bot/issues/80)     | Throttled serialized history recovery; exact terminal evidence releases next cycle                            |

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
  broker evidence for closing-deal event sequencing.
- Current status: callback journal plus order/fill/position mapping and restart/
  reconnect recovery are implemented on `feat/issue-002-demo-event-lifecycle`.
  This checkpoint is under review in
  [PR #4](https://github.com/AegisFintech/scalping-bot/pull/4).
  ISSUE-025 adds fully closed, single-deal demo trade persistence using the
  protocol-defined signed gross-profit, swap, commission, and conversion-fee
  fields. Missing detail, partial/multiple closing outcomes, conflicts, and
  uncertain sequencing remain fail closed pending supervised broker evidence.

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
  changed. Deployment evidence is recorded in
  [PR #42](https://github.com/AegisFintech/scalping-bot/pull/42).

### ISSUE-022 delivery details

- Acceptance criteria: after deterministic analysis eligibility succeeds, a
  new versioned model contract requires one buy-stop plus one sell-stop OCO
  proposal and has no decision or leg-enable switch; AI evidence and quality observations remain bounded
  diagnostics rather than a self-veto; malformed, stale, imprecise,
  semantically invalid, unaffordable, unreconciled, or otherwise unsafe output
  still creates no order; historical schema/prompt artifacts remain intact;
  and Streamlit shows the exact hash-verified system prompt, redacted request,
  response, and prior run history without exposing secrets or broker/account
  identifiers.
- Dependencies: the existing deterministic analytics/preflight, schema/prompt
  version registry, immutable strategy provenance, semantic/risk engine,
  redacted model trail, and Streamlit decision inspector.
- Current status: implemented on `feat/issue-022-actionable-oco`. Schema 2.0
  requires both conditional stops and excludes `NO_TRADE`, leg-enable switches,
  and AI-controlled data-quality acceptance. The exact tracked prompt/hash and
  redacted user JSON are persisted for new runs and exposed with scoped history
  in Streamlit. A deterministic incompatibility check prevents an impossible
  stop-distance contract from repeatedly reaching the model. All local gates
  pass: format/lint/typecheck/build, 130 Node tests across 28 files, 12 schema
  tests, 3 migration tests, all 3 configured PostgreSQL integration tests, Ruff,
  mypy, 41 Python tests, replay/backtest, both dependency audits, secret and
  shell checks, and five offline systemd parses at 2.8 (`OK`). A configured,
  read-only/no-broker AI probe returned schema 2.0 with both legs, no legacy
  switches, matching system-v2 prompt hash, and passed deterministic semantics
  with no reason codes. One preliminary probe produced
  `SEMANTIC_DECIMAL_INVALID` because its ad-hoc harness failed to normalize an
  empty optional environment value to the production `null`; the corrected
  production-equivalent probe passed. No analysis run, database mutation,
  execution-state change, or broker command occurred. PR
  [#44](https://github.com/AegisFintech/scalping-bot/pull/44) merged as
  `0d2f6cf`. Migration `0009` was applied under the environment and database
  emergency stops; AI, execution, and dashboard restarted healthy with the new
  immutable release identity. Execution remains in demo mode with demo trading
  and automatic analysis disabled, startup checks passed, and trading false.
  All order groups, orders, fills, active positions, and broker execution-event
  counts remain zero. The deployed orchestrator returned both mandatory legs
  with a matching prompt hash and passed deterministic semantics without a
  database write or broker call. Configured Streamlit AppTest rendered 11
  historical runs, the exact prompt/input controls, and zero exceptions. Its
  verification identified and corrected a display-only ambiguity so an old
  schema 1.0 self-veto is explicitly historical rather than labelled as a
  current two-leg proposal. Follow-up review:
  [PR #45](https://github.com/AegisFintech/scalping-bot/pull/45), merged as
  `1fec8fe`. The dashboard-only reload remained healthy. Final configured
  AppTest showed the historical notice, exact prompt/input controls, 11 history
  options, and zero exceptions. Execution stayed healthy and stopped; all
  order/fill/active-position/execution-event counts remained zero. Final
  deployment evidence: [PR #46](https://github.com/AegisFintech/scalping-bot/pull/46).

### ISSUE-023 delivery details

- Acceptance criteria: register a new immutable strategy/code identity for the
  operator-authorized automated-demo configuration; retain demo-only connection,
  exact acknowledgement, positive daily-order and notional caps, live submission
  disabled, and every deterministic validation/risk/reconciliation gate; restart
  first under the active database emergency stop; release only that scoped stop
  after readiness succeeds; then verify schema 2.0 prompt history and bounded
  durable execution state.
- Dependencies: [issue #47](https://github.com/AegisFintech/scalping-bot/issues/47),
  completed ISSUE-022 deployment, configured demo acknowledgement/caps, empty
  reconciled execution state, and active database emergency stop.
- Current status: complete. Enabling
  automatic analysis changed the protected configuration hash, so startup
  correctly rejected reuse of `0.1.0-actionable-oco.1` with
  `STRATEGY_VERSION_IMMUTABILITY_VIOLATION`. The database stop was not released,
  no analysis/order ran, and the restart loop was stopped. The new candidate
  identity is `0.1.0-actionable-oco-auto-demo.1`. Pre-merge gates passed:
  format/lint/typecheck/build, 130 Node tests, 12 schema tests, 3 migration
  tests, all 3 configured PostgreSQL integration tests, Ruff, mypy, 41 Python
  tests, replay/backtest, dependency audits, secret/shell checks, and five
  offline systemd security parses at 2.8 (`OK`).
  [PR #48](https://github.com/AegisFintech/scalping-bot/pull/48) merged and the
  identity started successfully under the database stop. After release, two
  system-v2 automatic responses persisted exact prompt/request/response history
  but crossed the next M1 boundary after 62.2 and 32.7 seconds. Unchanged
  decision-context validation rejected both before intent or placement. New
  analyses are paused while ISSUE-024 corrects automatic start timing.

### ISSUE-024 delivery details

- Acceptance criteria: automatic cycles start only in a bounded broker-time M1
  opening window; one durable account/symbol/interval claim survives restarts;
  provider retries wait for a later fresh interval; manual cycles and the
  post-model candle identity check remain unchanged; invalid time/configuration
  and duplicate claims fail closed; migration, positive, boundary, rejection,
  and configured deployment evidence are required.
- Dependencies: [issue #49](https://github.com/AegisFintech/scalping-bot/issues/49),
  typed broker quote time, completed-candle snapshots, ISSUE-023's demo release,
  PostgreSQL availability, and the active pause on new analyses.
- Current status: complete and deployed through
  [PR #50](https://github.com/AegisFintech/scalping-bot/pull/50). Migration `0010` provides the durable
  interval ledger, automatic starts use the first configured broker-M1 seconds,
  AI defaults to one provider attempt per interval, and immutable candidate
  identity is `0.1.0-actionable-oco-auto-demo.2`. No freshness, spread,
  semantic, risk, cap, reconciliation, mode, or emergency rule is changed. The
  complete gate suite passed: format/lint/typecheck/build, 136 Node tests
  across 29 files, 12 schema tests, 3 migration tests, all 3 configured
  PostgreSQL integration tests, Ruff, mypy, 41 Python tests, replay/backtest,
  dependency audits, secret/shell checks, and five offline systemd parses at
  2.8 (`OK`). Credentialed broker-minute cycles were claimed at the opening
  window. One reached a schema-2 response and post-model refresh in the same M1
  context, proving the scheduler correction; the moved market made that proposal
  non-executable, so semantic validation correctly rejected it before intent.

### ISSUE-025 delivery details

- Acceptance criteria: map one fully closed single-deal cTrader demo position
  to exactly one versioned `trades` row; calculate net realized P/L from signed
  broker money fields with Decimal arithmetic; reject missing, partial,
  conflicting, or ambiguous close evidence; release an accepted analysis only
  after its order group is terminal; show broker-minute claims and terminal
  trade outcome in Streamlit; and deploy a bounded daily group cap that permits
  automatic repetition after rejection, expiry, failure, or full closure.
- Dependencies: [issue #51](https://github.com/AegisFintech/scalping-bot/issues/51),
  migrations through `0010`, official cTrader close-position field semantics,
  ISSUE-024's deployed scheduler, and an empty/certain reconciled demo scope.
- Current status: complete through
  [PR #52](https://github.com/AegisFintech/scalping-bot/pull/52). Immutable
  identity `.3` was preserved, ISSUE-026 registered `.4`, and the merged
  scheduler/trade-history behavior ran repeatedly under the cap of 20. The
  first broker-accepted OCO later expired terminally and released its accepted
  analysis. Partial/multiple closing-deal outcomes remain explicitly
  unsupported and block repetition rather than being guessed.

### ISSUE-026 delivery details

- Acceptance criteria: preserve the immutable `.3` provenance row registered
  with the prior daily cap; issue `.4`; prove the PM2 manifest contains no
  enablement or credentials; inject the intended bounded cap before the first
  `.4` execution startup; keep database pause/emergency controls active until
  startup recovery and runtime configuration are verified.
- Dependencies: [issue #53](https://github.com/AegisFintech/scalping-bot/issues/53),
  merged ISSUE-025 code, the ignored mode-`0600` demo environment, and both
  active database controls.
- Current status: complete through
  [PR #54](https://github.com/AegisFintech/scalping-bot/pull/54). `.3` correctly rejected the later configuration change with
  `STRATEGY_VERSION_IMMUTABILITY_VIOLATION`; no analysis or order ran. Candidate
  identity `.4` started under both database controls with cap 20 already
  present, passed startup recovery, and was released only after the broker and
  database scopes were certain and empty.

### ISSUE-027 delivery details

- Acceptance criteria: when risk-based volume exceeds the positive configured
  notional cap, floor it to the largest broker volume step satisfying both
  ceilings; never round up; recompute loss, margin, and notional; retain the
  existing below-minimum risk rejection; reject a notional cap below broker
  minimum; add observed-XAUUSD, boundary, and rejection tests; deploy stopped
  under a new immutable identity.
- Dependencies: [issue #55](https://github.com/AegisFintech/scalping-bot/issues/55),
  current broker metadata, ISSUE-026 deployment, and both active database controls.
- Current status: complete through
  [PR #56](https://github.com/AegisFintech/scalping-bot/pull/56). Immutable
  identity `0.1.0-actionable-oco-auto-demo.5` deployed under both database
  controls, recovered with an empty/certain broker scope, and was released only
  after verification. It submitted the first valid minimum-volume two-leg demo
  OCO while preserving every configured risk, notional, margin, spread,
  freshness, and reconciliation ceiling.

### ISSUE-028 delivery details

- Acceptance criteria: retain raw cTrader callbacks until both local placement
  broker IDs have committed; match a strategy-labelled callback by broker order
  ID when cTrader omits the client order ID; keep callback persistence
  idempotent; derive readiness from unresolved PostgreSQL journal evidence so a
  later final fill can resolve a partial-fill blocker without process restart;
  keep normalization/persistence failure fail closed; add ordering, recovery,
  PostgreSQL, and rejection coverage; deploy stopped under a new immutable
  identity; and prove a terminal OCO releases readiness and permits a later
  automatic broker-minute claim without restart.
- Dependencies: [issue #57](https://github.com/AegisFintech/scalping-bot/issues/57),
  the deployed `.5` broker evidence, migration `0006`, ISSUE-025 terminal
  release, and active database pause/emergency controls.
- Current status: implementation completed on
  `fix/issue-028-demo-callback-ordering` with candidate immutable identity
  `0.1.0-actionable-oco-auto-demo.6`. It changes callback ordering and readiness
  only; it adds no order authority and weakens no market, model, risk, cap,
  reconciliation, or emergency gate. The pre-merge suite passes: Prettier,
  ESLint, TypeScript typecheck/build, 146 Node tests across 29 files, 12 schema
  tests, 3 migration tests, all 3 configured isolated-PostgreSQL integration
  tests, Ruff format/lint, strict mypy over 19 source files, 43 Python tests,
  replay/backtest smoke tests, npm/pip audits with zero known vulnerabilities,
  secret and shell checks, and all five offline systemd security parses at 2.8
  (`OK`).

### ISSUE-029 delivery details

- Acceptance criteria: expose a stable sanitized recorder reason, processing
  stage, execution type/status, and field-presence booleans in operational logs
  and status without retaining raw callbacks or identifiers; identify and
  normalize the observed strategy-owned broker callback without weakening
  ownership, symbol, state, or reconciliation validation; persist/deduplicate
  accepted callbacks; retain malformed/ambiguous evidence as fail-closed; and
  prove terminal expiry releases readiness plus a later automatic broker-minute
  claim under the same PID.
- Dependencies: [issue #59](https://github.com/AegisFintech/scalping-bot/issues/59),
  ISSUE-028's `.6` broker evidence, active database controls, and a new
  immutable release identity for every protected configuration change.
- Current status: `.6` automatically placed broker-accepted demo OCO group
  `639eefab-6bba-4316-abfa-03595dbb984f` at 10:48:36 UTC. Both pending legs and
  the accepted analysis expired terminally at 10:49 UTC, but PID `2470326`
  retained `OPERATIONAL_RISK_LOCKOUT` and `RECONCILIATION_UNCERTAIN` with zero
  broker journal rows/unresolved rows and only 2 of 20 daily groups. This proves
  a pre-persistence callback exception remains. Both database controls were
  reactivated. Candidate `.7` emits only sanitized structural failure evidence;
  it does not clear or bypass the failure and issue #59 remains open until the
  observed shape is fixed and repeated successfully. The observation release
  passes Prettier, ESLint, TypeScript typecheck/build, 148 Node tests across 29
  files, 12 schema tests, 3 migration tests, all 3 configured
  isolated-PostgreSQL tests, Ruff format/lint, strict mypy over 19 source files,
  43 Python tests, replay/backtest smoke tests, zero-vulnerability npm/pip
  audits, secret/shell checks, and five offline systemd parses at 2.8 (`OK`).
  Deployed `.8` later captured the exact failure as a sanitized
  `ORDER_ACCEPTED`/pending event with an order, client ID, label, and an attached
  position but no deal; normalization failed only because that acceptance-time
  position placeholder omitted optional `price`. Candidate `.9` ignores the
  placeholder only for non-deal ORDER_ACCEPTED while continuing to require a
  priced position for fill and partial-fill executions. Its complete suite
  passes Prettier, ESLint, TypeScript typecheck/build, 156 Node tests across 29
  files, 12 schema tests, 3 migration tests, all 3 configured
  isolated-PostgreSQL tests, Ruff format/lint, strict mypy over 19 source files,
  43 Python tests, replay/backtest smoke tests, zero-vulnerability npm/pip
  audits, secret/shell checks, and five offline systemd parses at 2.8 (`OK`).

### ISSUE-030 delivery details

- Acceptance criteria: replace the execution caller's permanent circuit boolean
  with a deterministic configured cooldown; block every caller request during
  that interval; half-open at the exact expiry boundary; clear after a fully
  validated success; reopen on timeout, unavailability, or HTTP 503; reject
  invalid/fractional/overflowing reset configuration at startup; and prove a
  later broker-minute automatic analysis resumes under the same PID.
- Dependencies: [issue #61](https://github.com/AegisFintech/scalping-bot/issues/61),
  the existing provider-side 300-second breaker, ISSUE-024 broker-minute claims,
  `.7` observation deployment, and active database controls.
- Current status: complete through
  [PR #62](https://github.com/AegisFintech/scalping-bot/pull/62). `.7` broker
  minute 11:01 UTC exposed the restart-only boolean deadlock. `.8` passed the
  complete suite: Prettier, ESLint, TypeScript typecheck/build, 154 Node tests
  across 29 files, 12 schema tests, 3 migration tests, all 3 configured
  isolated-PostgreSQL tests, Ruff format/lint, strict mypy over 19 source files,
  43 Python tests, replay/backtest smoke tests, zero-vulnerability npm/pip
  audits, secret/shell checks, and five offline systemd parses at 2.8 (`OK`).
  Deployed PID `2473046` received a real 503 at 11:10:38 UTC, remained blocked
  through the configured cooldown, half-opened automatically at 11:15:37, and
  claimed broker minute 11:16 without restart. A second 503 reopened it, and it
  again half-opened at 11:21:43 before broker minute 11:22 placed an OCO.

### ISSUE-031 delivery details

- Acceptance criteria: journal cTrader order type and closing-order identity;
  ignore unpriced contextual positions on non-deal lifecycle events while
  retaining their position ID; never overwrite an entry with a broker-created
  SL/TP child that inherits its client ID; hold child acceptance pending exact
  deal evidence; map one complete close atomically to fill, closed position,
  trade, group, and analysis; recover that close from durable local position
  plus broker history when reconciliation no longer returns the position;
  retain ambiguous, missing, partial, or multiple evidence as blocking; add a
  forward migration, contracts, documentation, positive and rejection tests;
  then deploy stopped under a new immutable identity and prove an unattended
  terminal repeat under one PID.
- Dependencies: [issue #64](https://github.com/AegisFintech/scalping-bot/issues/64),
  the credentialed `.9` entry/peer/SL-TP evidence, migration `0011`, and active
  database pause/emergency controls.
- Current status: complete through
  [PR #65](https://github.com/AegisFintech/scalping-bot/pull/65), merged as
  `1f20fffb`. Immutable identity `0.1.0-actionable-oco-auto-demo.10` deployed
  under both database controls after migration `0011`. Startup recovery mapped
  the `.9` lifecycle to entry filled, peer cancelled, position/group closed,
  analysis expired, one demo trade at `-4.83`, and zero unresolved journal
  rows. After release, PID `2476750` automatically claimed 11:47 and 11:53 UTC,
  rejected two external-AI 503s, and half-opened after each configured cooldown
  without restart. It then claimed 11:59, stored a completed AI response, and
  rejected stale refreshed market/book data; it immediately claimed 12:00,
  completed AI/validation/risk, and rejected both legs below broker minimum
  volume. This proves terminal release and unattended repetition; a broker OCO
  will submit automatically only when all deterministic gates pass. The
  pre-merge suite passes
  Prettier, ESLint, TypeScript typecheck/build, 161 Node tests across 29 files,
  12 schema tests, 3 migration tests, all 3 configured isolated-PostgreSQL
  integration tests, Ruff format/lint, strict mypy over 16 source files, 43
  Python tests, replay/backtest smoke tests, zero-vulnerability npm/pip audits,
  secret and shell checks, and five offline systemd security parses.

### ISSUE-032 delivery details

- Acceptance criteria: distinguish automatic scheduling from immediate order
  eligibility; expose the exact caller-circuit retry timestamp; explain current
  and last-cycle reason codes without weakening any gate; default inspection to
  the newest durable AI request; place the exact hash-verified system message
  and exact persisted redacted user JSON together near the top; show UTC and
  Asia/Singapore broker-minute times; retain explicit safe handling for unknown
  reason codes and runs without a durable model request.
- Dependencies: [issue #67](https://github.com/AegisFintech/scalping-bot/issues/67),
  ISSUE-030's deterministic cooldown, ISSUE-022's prompt artifacts, and the
  existing PostgreSQL/Better Stack decision trail.
- Current status: complete through
  [PR #68](https://github.com/AegisFintech/scalping-bot/pull/68), merged as
  `aabeffc2`. The candidate passed the complete required suite:
  Prettier, ESLint, TypeScript typecheck/build, 161 Node tests, 12 schema tests,
  3 migration tests, all 3 configured isolated-PostgreSQL tests, Ruff, strict
  mypy over 19 source files, 49 Python tests, configured Streamlit AppTest,
  replay/backtest, zero-vulnerability npm/pip audits, secret/shell checks, and
  five offline systemd parses. Runtime evidence showed PID `2476750` continued
  claiming automatic intervals after midnight; external-AI 503s caused bounded
  cooldown gaps and later half-open recovery, not a scheduler shutdown.
  Completed post-midnight model requests contain both the hash-verified prompt
  and redacted user JSON. The merged execution/dashboard deployment used an
  audited temporary analysis pause, restarted healthy as PIDs `2487239` and
  `2487252`, rendered both exact request messages with zero Streamlit
  exceptions, and resumed with no emergency stop or reason codes. Broker minute
  01:16 UTC (09:16 Singapore) was claimed automatically and rejected terminally
  on deterministic spread limits before AI or orders, proving same-deployment
  scheduling resumed without weakening the gate.

### ISSUE-033 delivery details

- Acceptance criteria: transform each schema-2.0 take-profit with Decimal
  arithmetic to the midpoint between its entry and proposed TP; preserve the
  endpoint entry and stop loss; require the transformed price to remain
  side-correct, tick-aligned, semantically valid, and deterministically sized;
  persist and display the original proposal beside the effective broker intent;
  retain schema, freshness, spread, daily-loss, exposure, reconciliation,
  idempotency, demo acknowledgement, and live-disabled gates; and prove the
  automatic cycle remains blocked by active/uncertain strategy state and resumes
  only after expiry, failure, or full closure is durably reconciled.
- Dependencies: [issue #70](https://github.com/AegisFintech/scalping-bot/issues/70),
  schema 2.0, the post-model refresh boundary, deterministic risk sizing,
  cTrader OCO lifecycle recovery, and the existing PostgreSQL/Streamlit decision
  trail.
- Current status: complete through
  [PR #71](https://github.com/AegisFintech/scalping-bot/pull/71), merged as
  `8f3364a`. Prompt `system-v3`, the Decimal midpoint
  transform, original/effective validation trail, and Streamlit comparison are
  implemented. Pre-merge gates pass: Prettier, ESLint, TypeScript
  typecheck/build, 165 Node tests across 30 files, 12 schema tests, 3 migration
  tests, all 3 configured isolated-PostgreSQL integration tests, Ruff, strict
  mypy over 19 source files, 51 Python tests, configured Streamlit AppTest,
  replay/backtest, zero-vulnerability npm/pip audits, secret/shell checks, and
  five offline systemd parses at 2.8 (`OK`). The merged `.11` release deployed
  under the audited analysis pause with certain startup reconciliation and then
  resumed automatic demo analysis. The first complete endpoint cycle persisted
  original 4:1 levels, effective midpoint 2:1 levels, unchanged entry/SL, and a
  `DELIVERED` Better Stack validation event. It rejected before intent because
  both endpoint stop distances made broker minimum volume exceed the configured
  per-leg budget; ISSUE-034 addresses that observed input constraint without
  changing the returned SL or bypassing risk. No model-selected volume,
  bypassed risk gate, live execution authority, or default enablement is in
  scope.

### ISSUE-034 delivery details

- Acceptance criteria: derive with Decimal arithmetic the maximum stop distance
  affordable at broker minimum volume under half the configured setup-risk
  budget; floor only to whole ticks; expose only that non-sizing distance to the
  endpoint; validate the returned unchanged SL against it after the market
  refresh; reject before inference if broker/configured minimum distance exceeds
  the affordable maximum; retain all schema, freshness, spread, daily-loss,
  notional, margin, reconciliation, idempotency, mode, and demo authorization
  gates; and prove positive plus rejection paths before a supervised demo cycle.
- Dependencies: [issue #72](https://github.com/AegisFintech/scalping-bot/issues/72),
  ISSUE-033's deployed `system-v3` prompt, current broker symbol metadata,
  reconciled account equity, deterministic OCO sizing, and the protected demo
  environment.
- Current status: complete through
  [PR #73](https://github.com/AegisFintech/scalping-bot/pull/73), merged as
  `b07022a`. Prompt `system-v4`, the whole-tick
  affordability calculation, pre/post-model reconciliation, payload exclusion,
  semantic enforcement, reason guidance, and tests are implemented. New
  affordability calculation deployed as `.12`. The supervised automatic 10:11
  GMT+8 cycle persisted a completed `system-v4` request whose two unchanged SL
  distances were within the supplied `4.99` ceiling. Both proposal and
  effective semantic stages passed at 4:1 and 2:1 respectively, deterministic
  sizing passed, and no below-minimum-volume rejection remained. It later
  rejected on quote freshness after margin work, which is bounded separately by
  ISSUE-035. The full pre-merge suite passed: Prettier, ESLint,
  TypeScript typecheck/build, 171 Node tests across 30 files, 13 schema tests, 3
  migration tests, all 3 configured isolated-PostgreSQL integration tests,
  Ruff, strict mypy over 19 source files, 51 Python tests, configured Streamlit
  AppTest, replay/backtest, zero-vulnerability npm/pip audits, secret/shell
  checks, and five offline systemd parses at 2.8 (`OK`). Existing maintenance
  and reconciliation remained active throughout deployment.

### ISSUE-035 delivery details

- Acceptance criteria: after deterministic sizing/margin work, reconcile the
  account again and reject any changed risk/exposure state; reacquire a final
  broker snapshot; require unchanged completed candles and execution metadata;
  repeat spread and original/effective semantic validation against that final
  quote; use only the final quote/depth timestamps for placement freshness; and
  prove both a slow-risk positive path and fail-closed refresh/state-change
  paths without increasing any freshness threshold.
- Dependencies: [issue #74](https://github.com/AegisFintech/scalping-bot/issues/74),
  ISSUE-034 release `.12`, the typed market-data API, reconciled account state,
  and existing proposal/risk/placement gates.
- Current status: implementation is in progress on
  `issue-035-final-placement-refresh`. The final refresh/account comparison,
  repeated spread/semantics, phase-labelled PostgreSQL trail, dashboard reason
  guidance, release `.13`, documentation, and positive/rejection tests are
  implemented. New automatic analyses are paused after a supervised `.12`
  cycle proved the endpoint response, affordability checks, TP transform, and
  sizing all passed but the post-model quote aged beyond the existing
  three-second placement limit during margin estimation. Pre-merge gates pass:
  Prettier, ESLint, TypeScript typecheck/build, 176 Node tests across 30 files,
  13 schema tests, 3 migration tests, all 3 configured isolated-PostgreSQL
  integration tests, Ruff format/lint, strict mypy over 16 Python source files,
  51 Python tests, configured Streamlit AppTest with zero exceptions and 32
  dataframes, replay/backtest, zero-vulnerability npm/pip audits, tracked-file
  secret scan, shell/PM2 syntax, and all five offline systemd parses at 2.8
  (`OK`). PR [#75](https://github.com/AegisFintech/scalping-bot/pull/75) merged
  as `e8cb49c685094a2ea07d9597b1c23a045d4a3414`; release `.13` deployed.
  The subsequent automatic `.14` cycle at 10:27 Asia/Singapore recorded both
  `POST_MODEL` and `PRE_PLACEMENT`, passed the repeated account, market,
  spread, semantic, and freshness checks, placed and mapped both demo pending
  stops, and finished `ACCEPTED`. ISSUE-035 is complete.

### ISSUE-036 delivery details

- Acceptance criteria: retain deterministic analytics over 600 M1, 500 M5, and
  300 M15 completed candles; reduce only duplicated compact endpoint raw tails
  to 60/36/24; preserve every computed feature and execution constraint; reject
  non-positive, fractional, or history-exceeding overrides at startup; and
  measure the deployed request size/latency before resuming continuous demo.
- Dependencies: [issue #76](https://github.com/AegisFintech/scalping-bot/issues/76),
  ISSUE-035 release `.13`, compact payload mode, and the typed analytics
  contract.
- Current status: implementation is in progress on
  `issue-036-compact-payload-tails`. Automatic analyses are paused after the
  measured `.13` request used 70,953 serialized bytes, of which roughly 61 KB
  was the 180/100/50 raw candle tails, and a subsequent endpoint call exceeded
  the 60-second budget. Applying 60/36/24 to that same durable payload estimates
  31,687 bytes, a 55.3% reduction. Release `.14`, bounded startup configuration,
  tests, and documentation are implemented. Pre-merge gates pass: Prettier,
  ESLint, TypeScript typecheck/build, 179 Node tests across 31 files, 13 schema
  tests, 3 migration tests, all 3 configured isolated-PostgreSQL integration
  tests, Ruff format/lint, strict mypy over 16 Python source files, 51 Python
  tests, configured Streamlit AppTest with zero exceptions and 31 dataframes,
  replay/backtest, zero-vulnerability npm/pip audits, tracked-file secret scan,
  shell/PM2 syntax, and all five offline systemd parses at 2.8 (`OK`). No
  analytics, freshness, risk, reconciliation, or execution gate is reduced.
  PR [#77](https://github.com/AegisFintech/scalping-bot/pull/77) merged as
  `b909be75af526fcf3b017c5958800f0330abe5d6` and release `.14` deployed. The
  first deployed request still used explicit ignored-environment overrides of
  180/100/50; those local overrides were corrected to 60/36/24 and loaded by
  release `.15`. The unattended `.16` 10:56 Asia/Singapore cycle durably
  recorded exactly 60/36/24 raw candles in a 34,714-byte redacted request,
  versus 77,597 bytes for the comparable prior 180/100/50 request: 55.3%
  smaller. Model-pending to model-completed audit timestamps measured 28.9
  seconds. Full analytics remained 600/500/300; the response passed every
  validation and placed both pending demo stops. ISSUE-036 is complete.

### ISSUE-037 delivery details

- Acceptance criteria: remember a fill/deal ID only after its normalized event
  persists with a certain result; skip an exact same-process repeat before
  strict contextual-position normalization; retain fail-closed behavior for a
  new/first malformed deal and uncertain/failed persistence; preserve database
  uniqueness/restart recovery; and deploy only after the current demo position
  reaches a safe terminal boundary.
- Dependencies: [issue #78](https://github.com/AegisFintech/scalping-bot/issues/78),
  the `.14` supervised cTrader callback evidence, durable execution store, and
  existing normalized deal-id idempotency.
- Current status: implementation completed on
  `issue-037-runtime-fill-dedup`. The first sell fill mapped durably, then cTrader
  repeated execution type 3 with order/position/deal present but without the
  open-position price. Normalization failed before database deduplication and
  correctly locked new cycles. The active demo position remains undisturbed
  while the bounded fix and tests are prepared. Release `.15`, the bounded
  recorder change, dashboard guidance, documentation, and positive/failure
  tests are implemented. Pre-merge gates pass: Prettier, ESLint, TypeScript
  typecheck/build, 182 Node tests across 31 files, 13 schema tests, 3 migration
  tests, all 3 configured isolated-PostgreSQL integration tests, Ruff
  format/lint, strict mypy over 16 Python source files, 51 Python tests,
  configured Streamlit AppTest with zero exceptions and 34 dataframes,
  replay/backtest, zero-vulnerability npm/pip audits, tracked-file secret scan,
  shell/PM2 syntax, and all five offline systemd parses at 2.8 (`OK`). PR
  [#79](https://github.com/AegisFintech/scalping-bot/pull/79) merged as
  `8fead83ed2b071653415d8d80abbb2e76fb7b041`. Read-only broker reconciliation
  then proved the position had closed by stop loss with no remaining broker
  position or order. Analyses were durably paused before `.15` deployment;
  startup recovery mapped the exact closing order/deal, closed the local
  position/group, and persisted the demo trade. Startup checks passed and no
  broker state remained. ISSUE-037 is complete.

### ISSUE-038 delivery details

- Acceptance criteria: while the process remains online, run existing bounded
  durable/broker execution recovery on a 5–300-second configurable cadence;
  serialize cadence and broker-synchronization attempts; let only an exact
  single terminal order/deal close local state and release a later cycle; keep
  open, missing, ambiguous, paginated, multiple, invalid, or failed evidence
  blocking; and prove positive, cadence, concurrency, and failure behavior.
- Dependencies: [issue #80](https://github.com/AegisFintech/scalping-bot/issues/80),
  ISSUE-037 release `.15`, existing bounded startup recovery, the durable demo
  journal, and broker order/deal history.
- Current status: implementation completed on
  `issue-038-periodic-demo-recovery`. Release `.16` invokes the existing
  recovery before scheduler safety evaluation at a default 15-second cadence;
  reconnect can force the same serialized runner. Thrown recovery and invalid
  clock/configuration remain fail-closed. Sample configuration,
  operator/dashboard documentation, and positive/throttle/concurrency/failure
  tests are implemented. Pre-merge gates pass: Prettier, ESLint, TypeScript
  typecheck/build, 185 Node tests across 32 files, 13 schema tests, 3 migration
  tests, all 3 configured isolated-PostgreSQL integration tests, Ruff
  format/lint, strict mypy over 19 Python source files, 51 Python tests,
  configured Streamlit AppTest with zero exceptions and 34 dataframes,
  replay/backtest, zero-vulnerability npm/pip audits, tracked-file secret scan,
  shell/PM2 syntax, and all five offline systemd parses at 2.8 (`OK`). PR
  [#81](https://github.com/AegisFintech/scalping-bot/pull/81) merged as
  `087d6f451c70a5c5bce185828c2c385753ed4f0c`. Release `.16` deployed while
  analyses were durably paused; startup checks passed with zero active local
  groups/orders/positions and zero unresolved broker events. After the pause
  was cleared, status reported demo automatic analysis and trading enabled with
  no blocking reason. Minutes 10:48 through 10:55 were claimed automatically
  and ended on explicit spread or transient market-snapshot gates. The 10:56
  cycle reached the endpoint, passed validation, finished `ACCEPTED`, and
  placed/mapped one pending BUY and one pending SELL. ISSUE-038 is complete.

### ISSUE-039 delivery details

- Acceptance criteria: generate a bounded deterministic PNG from the exact
  accepted M15/M5/M1 completed candles and per-candle EMA/ATR analytics; send
  its hash-linked bytes together with compact numeric JSON through both
  supported OpenAI-compatible API styles; fail closed on a missing, malformed,
  oversized, or mismatched chart; version the strict response contract with a
  technical map whose confirmation levels own OCO entries and whose primary
  targets equal the post-transform broker take-profits; persist image bytes and
  provenance in PostgreSQL; expose the exact chart and technical map in the
  correlated Streamlit history; and retain every existing precision,
  freshness, reconciliation, risk, idempotency, mode, and execution gate.
- Dependencies: [issue #83](https://github.com/AegisFintech/scalping-bot/issues/83),
  ISSUE-038 release `.16`, the typed analytics/AI HTTP boundaries, immutable
  `system-v4`/schema 2.0 history, and the protected cTrader demo environment.
- Current status: implementation is in progress on
  `issue-039-hybrid-chart-analysis` through
  [PR #84](https://github.com/AegisFintech/scalping-bot/pull/84). Analytics response 1.1, deterministic
  completed-candle PNG rendering, prompt `system-v5`, strict schema 2.1,
  technical-map semantic linkage, migration `0012`, typed multimodal transport,
  durable chart provenance, Streamlit display, documentation, and positive plus
  rejection tests are implemented. A provider-only request using the durable
  10:56 Asia/Singapore snapshot and newly rendered chart completed in 54.2
  seconds with schema 2.1; both entries matched their confirmation levels and
  both effective midpoint TPs matched their first technical targets. It made no
  database intent or broker call. Pre-merge gates pass: Prettier, ESLint,
  TypeScript typecheck/build, 191 Node tests across 33 files, 14 schema tests, 3
  static migration tests, all 3 configured isolated-PostgreSQL integration
  tests, Ruff format/lint, strict mypy over 20 Python source files, 53 Python
  tests, isolated-schema Streamlit AppTest with zero exceptions and 19
  dataframes, replay/backtest smoke tests, zero-vulnerability npm/pip audits,
  tracked-file secret scan, shell/PM2 syntax, and five offline systemd parses.
  PR #84 merged as `6c6650e`; migration `0012` and release `.17` deployed under
  the audited pause with certain empty startup reconciliation. The provider and
  deployed typed path accept image/schema 2.1, and Streamlit is healthy.
  ISSUE-039 is complete. The observed stale PM2 caller timeout is bounded
  separately by ISSUE-040 rather than mutating `.17` provenance.

### ISSUE-040 delivery details

- Acceptance criteria: preserve the already-registered `.17` provenance;
  register a new immutable release identity for the configured 60-second AI
  provider timeout; restart only under the durable analysis pause; require
  certain empty startup reconciliation; and prove an automatic image-backed
  request can complete and persist schema 2.1/chart evidence within the caller
  budget before normal automation resumes.
- Dependencies: [issue #85](https://github.com/AegisFintech/scalping-bot/issues/85),
  ISSUE-039/PR #84, release `.17`, the configured `AI_TIMEOUT_MS=60000`, and
  migration `0012`.
- Current status: release `.18` is implemented on
  `issue-040-ai-timeout-release` through
  [PR #86](https://github.com/AegisFintech/scalping-bot/pull/86). The direct provider image probe took 54.2
  seconds. The first deployed `.17` image cycle reached AI but the execution
  caller retained stale PM2 `AI_TIMEOUT_MS=30000` and timed out. Attempting to
  change that configuration under `.17` correctly triggered
  `STRATEGY_VERSION_IMMUTABILITY_VIOLATION`; no order was placed. The database
  analysis pause remains active while `.18` versions the corrected timeout.
  Pre-merge gates pass: Prettier, ESLint, TypeScript typecheck/build, 191 Node
  tests across 33 files, 14 schema tests, 3 static migration tests, all 3
  configured isolated-PostgreSQL integration tests, Ruff format/lint, strict
  mypy over 17 Python source files, 53 Python tests, configured Streamlit
  AppTest with zero exceptions and 23 dataframes, replay/backtest smoke tests,
  zero-vulnerability npm/pip audits, tracked-file secret scan, shell/PM2 syntax,
  and five offline systemd parses at 2.8 (`OK`). Deployment and the automatic
  image-backed proof cycle wait for merge. PR #86 merged as `5738787`. The
  stopped execution process was replaced under the durable analysis pause;
  PM2 then reported `.18` and `AI_TIMEOUT_MS=60000`. Startup was ready with
  certain reconciliation and zero active groups, orders, positions, or
  unresolved execution events. After the audited pause release, the 11:45 SGT
  minute safely rejected an excessive spread. The 11:46 SGT automatic minute
  persisted a hash-verified 1600x1200 chart, the exact hash-verified
  `system-v5` prompt, and a completed schema 2.1 response after a measured
  38,819 ms model round trip. All semantic/risk validations and both side risk
  decisions passed. The demo OCO was placed; SELL filled and BUY was cancelled.
  The resulting protected SELL position is awaiting its broker TP/SL deal, so
  the active-position interlock correctly prevents a duplicate cycle. A
  post-run Streamlit AppTest rendered 34 dataframes with zero exceptions.
  Normal automation is enabled, the AI circuit is closed, and ISSUE-040 is
  complete. Deployment evidence is tracked by
  [PR #87](https://github.com/AegisFintech/scalping-bot/pull/87).

### ISSUE-041 delivery details

- Acceptance criteria: count only distinct durable completed external-AI
  analyses for the configured account, symbol, and immutable strategy release;
  show completed and remaining campaign progress; fail closed when progress is
  unavailable; allow analysis 100 to finish normal validation/placement; then
  persist an audited analysis pause before analysis 101 while continuing
  expiry, callback processing, and reconciliation; retain every existing
  schema, semantic, freshness, spread, precision, exposure, daily-loss, and
  deterministic risk gate; and cover positive, boundary, restart-durability,
  invalid-configuration, and database-failure paths.
- Dependencies: [issue #88](https://github.com/AegisFintech/scalping-bot/issues/88),
  ISSUE-040/release `.18`, the durable model-request trail, runtime analysis
  pause control, automatic broker-minute schedule, and protected cTrader demo
  environment.
- Current status: implementation is complete on
  `issue-041-100-analysis-campaign`. The requested campaign is defined as 100
  completed model responses; pre-AI market/data/spread rejection and provider
  failure do not consume a slot. The current 20-group daily ceiling is too low
  for the requested campaign and will be replaced at deployment by the current
  trading-day group count plus 100. Pre-merge gates pass: Prettier, ESLint,
  TypeScript typecheck/build, 198 Node tests across 34 files, 14 schema tests, 3
  static migration tests, all 3 configured isolated-PostgreSQL integration
  tests, Ruff format/lint, strict mypy over 17 Python source files, 55 Python
  tests, configured Streamlit AppTest with zero exceptions and 34 dataframes,
  replay/backtest smoke tests, zero-vulnerability npm/pip audits, tracked-file
  secret scan, shell/PM2 syntax, and five offline systemd parses at 2.8 (`OK`).
  Release `.19` and its exact local campaign configuration await review/merge
  and deployment under a durable analysis pause. No live mode or authority
  changes are in scope.

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
  deduplicated event journal with order/fill/position/trade mapping and bounded
  restart recovery. Fully closed single-deal outcomes use the protocol-defined
  signed gross-profit, swap, commission, and conversion-fee fields; partial or
  multiple closing deals remain a reconciliation blocker pending supervised evidence.
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
- [x] `npm test`: 29 files, 143 tests passed.
- [x] `npm run test:integration`: 3 passed, including fresh and `0005`-through-`0010` upgrade paths in isolated Neon schemas that were dropped afterward.
- [x] `npm run test:schemas`: 12 passed; `npm run test:migrations`: 3 static migration tests passed.
- [x] `npm audit --audit-level=high`: 0 vulnerabilities.
- [x] Ruff format/check, mypy, and pytest: 43 Python tests passed.
- [x] Checked-in replay and conservative backtest CLI smoke commands completed successfully.
- [x] `pip-audit -r requirements.lock`: no known vulnerabilities.
- [x] Secret scan and shell syntax checks passed.
- [x] `systemd-analyze security --offline=yes` parsed all five services; common sandbox score is 2.8 (`OK`) on systemd 257.
- [x] Apply reviewed migrations `0001` through `0006` to the configured Neon schema.
- [x] Apply reviewed migration `0007` under both emergency stops after PR merge.
- [x] Apply reviewed migration `0008` under both emergency stops after PR merge;
      verify durable Better Stack retry/recovery and the Streamlit delivery view.
- [x] Apply reviewed migration `0009` under both emergency stops after ISSUE-022
      merges; restart AI/execution/dashboard and verify the prompt-history view.
- [x] Apply reviewed migration `0010` while automatic analysis is paused; restart
      AI/execution and verify durable broker-M1 claims plus terminal cycles.
- [x] Apply reviewed migration `0011` under both database controls; recover the
      broker-created SL/TP close and verify zero unresolved journal rows before
      releasing automatic demo analysis/trading.
- [ ] Prove encrypted backup and isolated restore for the configured Neon database.
- [ ] Install a release under `/opt/ctrader-ai-scalper/current` and verify systemd units on Debian/Node 22.
- [ ] Run supervised cTrader demo-order/shadow, Better Stack delivery/alert, and recovery drills.
- [x] Validate the PM2 ecosystem, individual restart, and systemd boot
      resurrection on this VPS; all listeners remain on loopback. The current PM2
      daemon runs as root because the repository is under `/root`; migrate to the
      least-privilege release layout before any live-readiness review.
