# ISSUE-098: Broker-session gate

Status: implemented and deployed to demo; retained shutdown warning described below.
[Issue #226](https://github.com/AegisFintech/scalping-bot/issues/226).
Release `0.2.5-market-stop.10`, unchanged `market-stop-v2` money policy; demo only.

## Behavior

Previously, an idle bot detected closure indirectly when quotes became stale.
A just-closed trade could initiate a provider request while the last quote still
passed freshness checks. The operator approved explicit broker-session admission.

The independent `/v1/session` market endpoint returns validated symbol metadata
and the broker's weekly intervals, timezone and holiday overrides. It does not
request quotes, order-book updates or candles. `BrokerSessionGate` caches this
evidence for at most 30 seconds and reevaluates the calendar at every check,
including the exact exclusive closing boundary. Concurrent reads share one
refresh; unavailable, stale, future, mismatched or invalid evidence blocks new
analysis/orders and is rechecked locally after 30 seconds. There is no EPR call
in a session refresh and no new operator setting.

The existing schedule implementation follows the broker's Sunday-based seconds,
inclusive opening/exclusive closing intervals, declared timezone and independently
dated recurring/nonrecurring holiday overrides. DST follows the IANA timezone.
The native adapter still rejects disabled/unsupported symbol trading modes.
These semantics are documented in the [cTrader model contract](https://help.ctrader.com/open-api/model-messages/#protooainterval).

The scheduler checks the session before collecting new market data. The execution
coordinator checks again before model work and before order intent. The AI service
checks at the actual transport boundary on all configured inference routes;
local session denial does not count as a provider circuit failure. An already
claimed context still records the denial and retains the existing request cooldown.
The demo gateway checks immediately before each new leg, after reconciliation.
If the first leg was accepted and the session closes before its peer, the peer
is withheld and the already accepted owned remainder is cancelled. Existing
positions and uncertain cancellations retain their normal protective/recovery path.
No accepted GTC pair is cancelled merely because the market is closed.

The application records a known unsent order with null broker identity and null
submission time, a local session reason and no fabricated broker event. Persistence
rejects contradictory fill/identity evidence and cannot overwrite an existing
acknowledgement with a local denial. A fully cancelled/unsent pair is terminal;
an unconfirmed cancellation or any filled exposure remains managed. The original
context stays consumed at intent, including this case; there is no duplicate retry.

Startup uses the separate validated metadata/session response instead of requiring
live quotes before initialization. Market and execution metadata must still agree.
This permits a normal restart during a scheduled closure. It does not make old
quotes, candles or plans usable. On reopening, all existing completed-data,
reconciliation, storage, provider-backoff, affordability and risk gates still apply.
Stored failure latches clear only through the existing successful durable cycle.

Status exposes OPEN/CLOSED/UNAVAILABLE with evaluation and metadata timestamps.
The dashboard explains session waiting while preserving emergency, uncertainty,
position and GTC-order precedence. A closed session is expected waiting, not a
scheduler stall. Independent two-second protection and existing controls do not
consult the session gate. Shared 1% current-equity risk, broker SL/TP, model pin,
prompt, map lifetime, GTC policy and all historical evidence remain unchanged.

## Contracts and verification

Shared types and strict `market-session-1.0.json` cover the new HTTP response;
the published schema is checked against the runtime parser. Historical snapshot,
analytics, model and SQL contracts are unchanged. Existing order/audit fields
store local-denial evidence, so no database migration or backfill is needed.

Tests cover close/reopen, weekend startup without quote calls, timezone/DST,
holidays, concurrent refresh, stale/future/missing/invalid evidence, actual provider
transport suppression without circuit strikes, close during inference, both
order-leg boundaries, cancellation failure, idempotent replay and PostgreSQL
terminal evidence across restart. These are software tests, not profitability
evidence or a completed unattended-production qualification.

Verification used Node 22 and an isolated TLS PostgreSQL test database. The full
suite passed 712 Node tests, 70 PostgreSQL integration tests (including five new
session persistence cases), 164 Python tests, 55 schema tests and three migration
tests. Python formatting/lint/types, sample and populated startup configuration,
replay/fail-closed fixtures and both dependency audits passed. Initial TypeScript,
SQL-fixture and lint/format findings were corrected; exact commands and final
reruns are recorded in the linked validation evidence below. The staged secret
check scanned all 490 index blobs with zero credential matches, including the
seven pre-existing screenshot deletions excluded from this change.

Browser checks passed in light/dark themes: navigation, unsent form value, focus,
caret, history and diagnostics survived timed updates without submitting controls.
Graphify AST update plus explicit report links produced 3,962 nodes / 7,966 edges,
with zero dangling endpoints and zero external API calls. Its existing TOML parser
warning leaves `pyproject.toml` without AST nodes; community names were refreshed
locally. The session report has a direct verified path to `BrokerSessionGate`.

Prospective unattended qualification remains tracked in ISSUE-096 / issue #222.
Closed-market waiting and fixture success do not establish market-open reliability.

## Deployment and rollback

Take a verified paired database/artifact backup and preserve the current source
and environment. Pause new analyses through the existing authenticated control;
independent maintenance continues and existing GTC orders remain. Deploy the
market service first, then matching AI/execution services, verify the independent
session endpoint and startup during closure, and resume the authorized demo.
Do not force a provider request or cancel orders for verification. Preserve the
previous observer checkpoint and start a release-specific bounded observation
long enough to include reopening and the required market-open evidence.

Rollback must preserve the database, environment, accepted orders, provider
claims and financial baselines. The new session endpoint is additive and can
remain available to an older execution service. An older execution release still
needs fresh quotes at startup, so reverting during closure may leave it unable
to start; restoring that old behavior is not a remedy for a closed session.

The calendar check cannot be atomic with provider or broker receipt. A request
already sent before closure can finish and consume tokens; no cancellation or
refund is inferred. An unscheduled halt or calendar change can lag the bounded
metadata cache. Existing fresh-data and broker checks remain necessary. Local
clock accuracy remains an operational dependency. No guaranteed continuous
trading, zero closing-boundary cost, improved win rate or live readiness is claimed.

## Observed demo rollout

All software completion gates passed. The paired backup
`backup-20260912T023737Z-68d2618f` restored successfully into a disposable local
database and verified all 46 tables. The prior source and byte-identical environment
were preserved privately. No migration was required.

New analyses were paused at **2026-09-12 02:39:57 UTC (10:39:57 Singapore)**.
The market service restarted first; its independent session endpoint returned
`CLOSED` using the broker's `America/New_York` schedule (five weekly intervals,
one holiday override). AI, execution and dashboard then restarted. Execution
passed startup without fresh closed-market quotes. Automatic demo operation resumed
at **02:41:15 UTC**. Five services and the read-only observer are online; PM2 state
was saved with private permissions and no cached model/database/policy overrides.

Independent broker checks before and after deployment confirmed the same two
GTC STOP orders, **BUY 4353.76 / SELL 4344.24**, zero open positions, and unchanged
broker SL/TP instructions (relative SL 1.06 / TP 0.53). Order identities, prices,
financial accounting and populated environment were preserved. No analysis,
provider request, order cancellation or trade was forced for verification.
The provider claim count remained **441**, latest **2026-09-11 20:01:20 UTC**,
across the whole account/symbol scope. This observation includes an existing
pending pair; flat-session suppression is demonstrated by the automated tests.

**Retained warning:** the previous execution process recorded
`ORDER_MAINTENANCE_RECONCILIATION_REQUIRED` during shutdown at **02:40:12 UTC**,
after its broker transport closed. The new process reconciled the intact pending
pair with certain broker state, but preserved the durable fault as required.
Consequently `operationalReady` remains false until a subsequent successful durable
cycle clears it. Its one-minute retry deadline elapsed at **02:41:12 UTC**; it
does not disable independent protection, cancel these orders, set pause, or prevent
the scheduler retrying when the session reopens and normal eligibility passes.
No fault file was deleted or reset. Closed-market monitoring may briefly report
`UNAVAILABLE` when the 30-second evidence lifetime expires before the next bounded
refresh; new requests always perform a fresh admission check.

The previous release's observation checkpoint is retained. A new **72-hour**
read-only observation runs **2026-09-12 02:41:20 through September 15 02:41:20 UTC**,
covering the expected reopening. It records the retained warning honestly.
Reopening and market-open reliability have not yet been observed for this release;
production qualification remains open under ISSUE-096 / #222.

Exact commands, corrected findings and sanitized deployment evidence:
[validation record](evidence/market-session-validation.json).
