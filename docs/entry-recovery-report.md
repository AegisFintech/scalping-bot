# ISSUE-097: Unsubmitted entry recovery

Status: implemented; completion checks passed; demo rollout pending. [Issue #224](https://github.com/AegisFintech/scalping-bot/issues/224).
Release `0.2.5-market-stop.9`, unchanged money policy `market-stop-v2`; demo only.

## Observed problem

On September 11 at 14:02:33 SGT, the provider received ask 4355.32 and returned
buy 4351.00 / sell 4349.44. The buy was already below the supplied ask. At
14:07:39 a later response gave buy 4356.13 against captured ask 4355.94, but the
first local decision saw ask 4356.96. Both were rejected before broker submission.
The provider completed in about four seconds; fixed prices were repeatedly reused
while the five-minute refresh was unavailable. These are demo operational facts,
not an economic comparison or a broker rejection.

## Implementation

Provider prompt `entry-pair-v3` adds explicit, locally computed buy minimum and
sell maximum. The effective minimum is the maximum of broker distance, one tick
and any already configured minimum points. Prices are rounded outward on the tick
grid. A preferred buffer of max(two ticks, current spread) is guidance only. The
latest completed M1 structure/order-block guidance and the two-price reply remain;
the model does not control SL, TP or size. Historical prompt files are unchanged.

`checkEntryPrices` uses decimal arithmetic and fresh source/receive/server times,
valid metadata, symbol, tick and original map lifetime. It checks immediately
after a successful provider response using a new market read, before reuse, and
through the coordinator's existing post-model and final-placement semantic gates.
Only pure BUY/SELL entry-distance failures can retire a pair. Mixed/stale/invalid
evidence still blocks without granting an exception. A return-read failure leaves
the successful provider record intact; the next execution check requires fresh
data. A readable provider `READY` result alone never authorizes an order.

Migration 0024 stores versioned retirement evidence separately from the provider
record. Exact plan prices/tick, ownership scope, completed response and timestamps
must agree. Duplicate retirement preserves the first evidence. Retired prices are
never rearmed even if market price later returns.

One original retired context may parent one immediate fresh request. Its unique
`refresh_after_entry_context_id` and the existing account/symbol/mode advisory lock
deduplicate processes and restarts. A replacement cannot parent another replacement.
If it is also unusable, it is retired and the ordinary five-minute request backoff
applies; the engine no longer repeatedly constructs the known-invalid proposal.
Failed/unknown recent requests across the scope and any active group still block.
The existing post-close/zero-fill exceptions and local circuit rule are preserved.

Retirement and order intent acquire the same context row lock. Database triggers
reject retirement after any intent and intent after retirement. This covers an
older worker during rollback as well as the normal coordinator. Provider dispatch
still requires all current market/account/ownership gates before the durable claim.
No broker cancellation, market-entry fallback, price clamping or accounting reset
is introduced. GTC orders, independent maintenance and shared 1% current-equity
risk remain unchanged. The dashboard identifies retired entries awaiting recovery.

## Validation and rollout

All 22 required check categories passed: 681 Node tests, 163 Python tests,
47 schema tests, three migration tests and 65 PostgreSQL integration tests,
including 22 new entry-recovery cases. Both dependency audits are clean. Initial
fixture/lint/type and migration-list findings were corrected and rerun. Exact
commands, initial failures and reruns are recorded in
[validation evidence](evidence/entry-recovery-validation.json). Light/dark browser
checks preserved navigation, control value/focus/caret and trade history across
updates, with no submitted controls or browser errors. Graphify was updated with
six explicit report links and zero provider calls. Its existing pyproject.toml
zero-node and community-label warnings remain informational.

The paired current backup restored with all 45 table fingerprints matching.

The dedicated tests
cover response movement, stale/invalid data, retirement storage failure, bounded
replacement, provider failures, restart, concurrency and intent/retirement races.
Synthetic tests establish software behavior, not improved win rate or guaranteed
continuous order coverage. Broker sessions/outages and uncertain account evidence
can still prevent new risk.

## Migration and rollback

Take a verified paired current database/artifact backup and preserve the existing
environment and source release. Pause new analysis through the existing control;
independent protective maintenance continues and accepted GTC orders remain.
Apply additive migration 0024 with the migration role, build/restart matching AI
and execution services and verify policy, readiness and current reconciliation.
Resume the previously authorized demo, without a manual analysis/order cycle.
Observe new prompt evidence, retirement/replacement claims and protected cycles.

The migration adds one evidence table, one nullable unique parent column and
integrity triggers. Existing rows are unchanged and need no backfill. Retain these
objects on rollback; do not drop evidence or restore an older database over trades.
An older worker cannot submit a retired context because the trigger still rejects
it. Wait until the last original/replacement map expires before resuming an older
release; preserve all newer dispatch cooldowns and active GTC setup ownership.
The prior build restores the repeated-price wait behavior. No environment or risk
baseline migration is required.
