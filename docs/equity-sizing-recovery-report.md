# ISSUE-079 — Equity sizing and blocked execution recovery

This report records the earlier paused revision `.2` checkpoint. The operator's
subsequent cap-removal request and completed storage recovery are documented in
[the revision `.3` report](risk-budget-recovery-report.md). Intermediate limits
and pending-review statements below are historical, not the current policy.

Date: 2026-09-08. [Issue #188](https://github.com/AegisFintech/scalping-bot/issues/188).
Branch `issue-079-equity-sized-execution`; source `0.2.3-equity-risk.2`, policy
`fixed-risk-v3`. Implementation is validated and deployed under a maintenance pause. Database recovery awaits operator review. No profitability claim.

## Why there were few trades

Read-only broker reconciliation at **09:10 SGT** found demo equity, balance and
free margin all **USD 999,832.16**, with certain state, no positions and no pending
orders. Repeated reconciliation at 09:20 agreed. One percent is **USD 9,998.3216**;
each race-exposed OCO leg receives at most **USD 4,999.1608**.
The previous risk journal already calculated these budgets correctly, but a
legacy **USD 5,500 per-position notional limit** capped each gold leg at native
volume **100**, or **0.01 lot**. Last submitted prices around USD 4,413–4,414 and
stop distances around USD 1.06 confirm that this cap, not computation speed,
caused the tiny trades.

New cycles encountered `DATABASE_STORAGE_LIMIT_EXCEEDED` from **01:50 SGT**.
At inspection, database size was 512,876,544 bytes. The chart relation occupied
265,699,328 bytes, including 252,895,795 bytes of PNG content in 3,914 rows.
Repeated five-second decisions generated new PNGs even when candles were unchanged,
because the image contained the changing analysis timestamp. The scheduler only
logged persistence exceptions; its status could show healthy with no last cycle.

A separate market-data error was reproducible: the broker declared a **US Labor
Day early close** on September 7. M1 candles jumped from **18:29 UTC to 22:02 UTC**;
M5/M15 jumped from **18:30 to 22:00 UTC**. The broker holiday uses Europe/Minsk,
while its weekly schedule uses America/New_York. The client ignored the holiday
list and marked these gaps as missing open-market data. These were legitimate
closures, not permission to waive candle freshness or ignore unexplained gaps.
The protocol exposes both schedules and timezone/recurrence-aware holiday fields.
[Official cTrader model definitions](https://help.ctrader.com/open-api/model-messages/).

The previous pending-order repair did enable execution: six closed demo trades
under release `.4` total **-1.14** in account currency, ending at 00:16 SGT.
That is evidence of fills, not evidence of a profitable strategy. Older release
results are not pooled with the new sizing policy.

## Implemented changes

- Use current reconciled equity and the existing Decimal risk engine. Replace the
  fixed-dollar cap with gross notional bounded to **5 × equity per leg**, at most
  10 × equity for both legs. Keep **1% combined stop/cost risk**, **1% combined
  margin**, the **5% daily loss budget**, high-water drawdown locks and reductions.
  Broker leverage is unchanged; the exposure ceiling is not a target. The tighter
  of risk, cost, broker grid, notional and margin determines the size.
- Allocate half the remaining shared margin before sizing. Search on the volume
  grid for affordable stop-plus-cost loss and margin instead of rejecting a larger
  unaffordable candidate. Confirm exact-volume broker margin; at most two further
  downward recalculations accommodate tiering. Nonpositive/unavailable margin or
  an unaffordable minimum still rejects. Recurring margin rates round upward to
  ten decimal places; shared budgets round downward, preserving strict decimal
  boundaries. Account state is reconciled again before
  placement; a changed fingerprint blocks stale sizing.
- Interpret only validated broker-declared holidays. Explicit date, recurrence,
  timezone and time bounds are required. Session-edge tests prevent a brief open
  interval from being hidden inside a closed-minute assumption. Missing bars in an
  open session, unknown holidays, malformed metadata and stale data still block.
- Persist a redacted operational-failure latch across restarts. Status exposes
  the block; readiness and manual cycles return HTTP 503. Analysis and spread
  writes back off for a minute. A successful durably completed cycle is required
  to clear it. The independent protective path still runs every two seconds.
- Store new exact chart PNGs in protected content-addressed files, flushing and
  verifying before the database reference commits. Dashboard reads verify the
  PNG dimensions and hash and reject unavailable/corrupt/symlinked images. Stable
  completed-candle inputs deduplicate across capture times; the exact capture time
  remains in the analysis journal. Migration 0018 retains all old database bytes.

The requested model remains **`gpt-5.6-sol/u40`**, with no provider substitution.
The existing five-minute context refresh and model-independent execution path
remain. These fixes remove operational blockers; they do not force price triggers,
remove cost/spread gates, or promise a fill every cycle.

## Configuration and migration

Normal template **21 → 20** entries, versus the original 176 (**88.6% reduction**).
The actual populated file changed **25 → 24**: only `MAX_POSITION_NOTIONAL` was
removed. Every other parsed value, including credentials, endpoints, exact model
and prior demo authorization, was compared and preserved. A mode-0600 backup is
retained locally. A populated obsolete key fails with an actionable key-only
migration error; recreate supervisor processes to remove cached copies.

Run `npm run config:check -- .env.sample --startup` and
`npm run config:check -- .env --startup`. No risk-percentage or exposure-multiplier
knobs are added. Paper/stopped/automation-off remains the default; live execution
remains structurally disabled. The account-size floor is not reintroduced.

## Chart storage transition and rollback

The default `npx tsx scripts/archive-charts.ts prepare` is **read-only in
PostgreSQL**. It copies exact bytes to `.runtime/analysis-charts/<sha256>.png`,
checks every SHA-256, and writes an exclusive protected manifest. Preparing a
later rollback manifest also includes rows already in local storage. Preserve an
existing manifest under a new backup name before preparing a later one.

For this incident, preparation verified **3,914 files / 252,895,795 bytes**.
A second compressed copy in `.runtime/backups/issue-079/charts.tar.gz` was streamed
back and every member's size/hash checked against the manifest. No database bytes
have been removed by preparation. The manifest SHA-256 is
`810334e36a1ce8ed362b34766092cb4e50b2e4beee6700f5e653ac992c2ed0bb`.

After migration 0018 and **operator review**, the concrete transition is:

```sh
npx tsx scripts/archive-charts.ts relocate --operator-reviewed
```

It verifies the entire archive before changing anything, then conditionally changes
only matching chart rows from database bytes to local references. IDs, hashes,
provenance and all financial/model/order/fill/trade journals remain intact.
Interrupted execution can resume safely. Ordinary `VACUUM (ANALYZE)` can reclaim
unused database pages afterward; inspect actual space reclaimed. Do not use a
truncate or delete financial history. The historical bulk-candle cleanup procedure
is not authorization for a different data transition.

Rollback under an authenticated analysis pause:

1. Verify both archive copies and available database capacity. If necessary,
   increase database capacity before restoring bytes; do not overwrite missing
   data with nulls.
2. Run `npx tsx scripts/archive-charts.ts restore --operator-reviewed` against a
   freshly prepared complete manifest. Verify exact restored hashes/counts and
   no remaining local references before reverting to an old dashboard reader.
   Retain migration 0018; its additive schema is backward compatible after restore.
3. Restore the reviewed code/environment backup through the supervisor, retaining
   daily/capital locks, consumed context maps and reconciliation history. The old
   release again requires its fixed-dollar cap. Reconcile before restoring only
   the previously authorized demo operation.

Back up PostgreSQL **and** the chart directory together. The two verified local
copies protect this transition but are not proof of an off-host disaster recovery
backup. Disk loss can make image drill-down unavailable; it cannot authorize orders.
Monitor both local disk and database capacity. Non-image journals continue to grow;
a larger durable database or a separately reviewed retention policy is still needed
for indefinite operation.

## Validation and economic evidence

The same-input read-only comparison at **09:23 SGT** used the last submitted
entry/stop prices, current broker contract/cost metadata and exact-volume broker
margin estimates. No order was submitted. The old-cap control matches the prior
recorded 0.01-lot orders. Both calculations use a full available risk multiplier;
production also applies durable remaining daily capacity and drawdown reductions.

| Measure                                        | Old fixed-dollar cap | Revised bounded equity sizing |
| ---------------------------------------------- | -------------------: | ----------------------------: |
| Size per leg                                   |             0.01 lot |                    11.25 lots |
| Combined modeled loss, including costs/reserve |        USD 2.8496872 |                USD 3,205.8981 |
| Combined confirmed broker margin               |             USD 8.88 |                  USD 9,979.57 |
| Combined loss ceiling                          |       USD 9,998.3216 |                USD 9,998.3216 |
| Full sizing check, one observation each        |            515.48 ms |                     517.30 ms |
| Orders submitted by comparison                 |                    0 |                             0 |

The revised size uses about **0.321%** of equity in modeled loss; the retained 1%
margin ceiling binds before the 1% loss ceiling. The calculation must not lift that
ceiling to force exactly 1% loss risk. The pure arithmetic benchmark over 1,000
repetitions measured **0.771 ms median, 1.183 ms p95, 3.752 ms p99**. These are local
calculation timings, not order/fill latency percentiles. The two end-to-end checks
are too small a sample to estimate broker tail latency. Prices are historical
comparison inputs; they are not current executable proposals.
[Machine-readable comparison](evidence/equity-sizing-comparison.json).

Current release checks passed **465 Node tests**, **121 Python tests**, 22 schema
tests, three migration tests and all three integration tests using isolated
PostgreSQL 17 with verified TLS. The integration run exercised migration 0018,
exact-byte restore/relocation, repeat execution and rejected verification. Both
dependency audits reported no known vulnerabilities. Formatting, linting, TypeScript build, Ruff/mypy, configuration checks, replay/fail-closed fixtures and secret scanning are included in the final gate record.

The hosted database remains at capacity; ordinary vacuum did not free it
(512,876,544 → 513,089,536 bytes at observation). Existing-blob relocation is pending
operator review. The bot is under an authenticated maintenance pause from
**09:21:48 SGT**; protective maintenance remains active. No financial baseline or
risk lock was reset, and no live execution was enabled.

No chronological out-of-sample profitability improvement is established by this
repair. Post-change expectancy, P&L, profit factor, drawdown, fill/rejection rate
and exposure require new separately labeled demo observations and suitable quote
replay data. Scaling the old tiny-trade P&L by the volume increase would be invalid:
slippage, available liquidity and fill quality can change with size. The old/new
comparison above proves sizing and operational latency only.

## Paused deployment evidence

Migration 0018 was applied at **09:25:37 SGT**; all 3,914 original database PNGs
and their 252,895,795 bytes remained unchanged. All five services were recreated
from the preserved demo environment under the durable pause. The intermediate
`.1` preflight reported `operationalReady=false`, `tradingEnabled=false`, HTTP 503
readiness and `DATABASE_STORAGE_LIMIT_EXCEEDED` alongside the pause. The known
storage incident was explicitly carried into the new durable failure latch.

A fresh read-only request through the restarted market-data and analytics services
returned `acceptable=true` with no candle-gap reasons. Broker holiday gaps on
M1/M5/M15 now carry the trusted closure marker. No provider request or broker order
was issued by that check. Final revision `.2` additionally covers recurring broker
margin-rate precision, found during preflight review.

The dashboard keeps the storage cause visible even under the maintenance pause.
Both light and dark browser checks preserved the title, navigation, focused input,
caret, all four financial metrics and trade-history chart nodes across background
updates; neither theme reported browser page errors. Screenshots:
[light overview](images/equity-sizing-overview-light.png),
[dark overview](images/equity-sizing-overview-dark.png),
[light history](images/equity-sizing-history-light.png),
[dark history](images/equity-sizing-history-dark.png).

Final revision `.2` passed all required checks. Its paused rollout retains the
storage failure across restart and has submitted zero orders. The 3,914 original
database images remain intact pending approval. [Exact validation](evidence/equity-sizing-validation.json)
and [paused runtime evidence](evidence/equity-sizing-paused-rollout.json). The code
checkpoint can be reviewed independently of the pending data transition; merging
and restoring automated operation await the issue's remaining acceptance step.

## Delivery and remaining acceptance

Implementation checkpoint **`19b9153`** is pushed. [Draft PR #189](https://github.com/AegisFintech/scalping-bot/pull/189)
contains the source, migration, tests, documentation and screenshots. It remains
draft because restoring normal demo operation depends on the operator-reviewed
archive transition. GitHub rejected the queued auto-merge request with **“Auto
merge is not allowed for this repository.”** No setting or protection was bypassed.

A final read-only broker check at **09:33:23 SGT** still showed certain reconciliation,
USD 999,832.16 equity/free margin, **zero positions and zero pending orders**. The
maintenance pause remains active; the archive-relocation approval question is
pending. After approval: verify the unchanged manifest, perform the conditional
transition, reclaim/check database capacity, restore only the prior demo pause
state, observe a successful durable cycle and broker order lifecycle, update the
report, then complete review/delivery under the repository rules. Do not reset
capital history or clear the operational latch merely to obtain a healthy badge.
The latch clears only after a successfully persisted cycle.
