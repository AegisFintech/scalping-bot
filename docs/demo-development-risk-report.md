# ISSUE-094: Demo development with current-equity risk

Status: implemented, validated and deployed to demo.
[Issue #219](https://github.com/AegisFintech/scalping-bot/issues/219).
Release `0.2.5-market-stop.7`; policy `market-stop-v2`.

## Authorization and resulting behavior

On September 10 the operator requested unlocking the demo for extensive trading
development while keeping 1% of current equity. Before this change, both daily
and high-water locks blocked admission after 6.37586490% loss. A read-only broker
check at 17:24:50 SGT confirmed no positions or pending orders.

`capitalAdmission` now separates accounting from admission. DailyRiskStore and
CapitalRiskStore still reconcile and persist equity, cash flows, losses, original
baselines, sticky locks and reductions. Only after both succeed does the explicit
demo policy use effective multiplier 1 and a 1% current-equity setup cap. The
stored zero multiplier/locks remain evidence; they do not veto this demo policy.
Other modes retain daily remaining capacity, loss locks and reductions. Live
execution remains disabled and demo requires its existing explicit authorization.

The existing OcoRiskEvaluator sizes each new setup from current equity. Both
race-exposed legs share the 1% cost-inclusive budget, at most 0.5% each. Actual
size can be smaller because of fees, slippage reserve, broker steps/limits and
available margin. No fixed lots, upward rounding, risk escalation, model-selected
volume or automatic account reset is introduced. The user request is interpreted
as retaining the established combined setup ceiling, not doubling it per leg.

Missing, stale, ambiguous, invalid or unavailable accounting still blocks demo;
errors retain zero admission capacity. Fresh market data, exact account evidence,
ownership, one active group, durable commands, OCO peer cancellation and missing-SL
repair/close behavior remain unchanged. No new filters or cooldowns are added.

## Contracts and accounting

The reported RiskPolicy shared type and `risk-policy-1.0.json` explicitly carry
mode/enforcement for the new policy version; false is valid only in demo. Legacy
policy projections remain supported. The full policy is included in safety and
immutable strategy hashes, and the release identity changes with its economics.

The dashboard displays the effective demo setup budget and "loss locks off";
daily remaining capacity is "Not applied (demo)". Measured losses/drawdown remain
visible. Missing policy, stale readings and invalid mode/enforcement combinations
show unavailable. A zero current cap still displays zero available setup budget.

No SQL migration is needed: this release changes admission policy and an HTTP
projection, not database shape or financial history. Existing daily/capital rows,
trade/model evidence, provider dispatch claims and historical migrations remain.
No populated environment key changes or recurring unlock/reset endpoint are added.

## Validation and rollout

All 22 required commands passed: 644 Node tests, 162 Python tests, 38 schema
cases, three migration cases and five PostgreSQL/TLS integration tests, plus
formatting, lint, types, build, four configuration checks, replay/fail-closed
fixtures, secret scanning and both dependency audits. Node totals include schema
and migration cases also run separately. Both audits found no known vulnerabilities.
Focused tests covered locked/reduced/restarted accounting, invalid evidence,
other-mode enforcement, decreasing equity, combined two-leg cost risk, unavailable
margin and existing exposure. The PostgreSQL test preserves actual locked rows
and their baseline while demo admission succeeds and live admission remains locked.

A verified paired backup preceded deployment. The populated environment is
byte-identical; all five services run with no cached risk/model/database overrides.
Startup briefly waited for restarted dependencies, then became ready. By 17:30:25
SGT, the new version reported demo loss enforcement off, cap 1%, trading enabled,
no safety reasons and all original accounting references/locks intact.

The automatic provider request completed in 5,861 ms. At 17:30:43 the first pair
was recorded with equity 892,135.77 and combined budget 8,921.3577: exactly 1%,
split between two legs. The broker independently confirmed two STOP/GTC orders
at 17:30:59, with relative SL 1.06 and TP 0.53. The SELL filled at 4391.11 at
17:31:10; fresh maintenance verified SL 4392.17 and TP 4390.58. It closed at
17:31:16 and the group fully reconciled. Existing excess-slippage uncertainty
cleared through normal terminal recovery; no limit or failure latch was bypassed.

Another provider context began at 17:31:34 and completed in 5,383 ms. At 17:32:04,
trading remained enabled without loss-lock reasons, despite recorded loss 6.92%.
Current equity was 886,906.81, so the new monetary ceiling was 8,869.0681. The
following context's SELL entry was temporarily too close to market; the existing
executable-price check remains. This release removes loss-threshold restrictions,
not broker validity, fresh-data or reconciliation requirements.

Both dashboard themes display the demo policy, preserved loss measurements and
current-equity budget. Navigation, control text/focus/caret and history/diagnostics
survived timed refreshes with no browser errors and no submitted controls. Screenshots
were inspected after full rendering. Graphify was refreshed with the new admission
relationship plus preserved prompt/protection concepts: 3,611 nodes, 7,364 edges,
255 communities and zero dangling edges. No provider API call was used for Graphify;
its existing pyproject zero-node and community-label warnings remain informational.

Exact commands and sanitized observations are in the
[validation evidence](evidence/demo-development-risk-validation.json). Synthetic
checks and this short demo observation do not establish profitability, model
training or improved expectancy. Repository secret scanning emits warnings for
seven pre-existing screenshot deletions; an additional all-index scan checks
actual deployment/database secrets before each commit.

## Rollback

Take a paired current database/artifact backup and protected release/environment
copy before activation. Deploy matching services through the existing supervisor
and independently verify demo mode, broker exposure, reconciliation and effective
risk policy. Do not manually launch analyses or reset locks to manufacture success.

To roll back, reconcile and pause new risk, then restore the previous reviewed
build while retaining all newer database/broker evidence. Its daily/high-water
locks immediately govern admission again, including retained locks from before
this release. Never restore an old database over newer trades or erase loss rows.
Existing broker SL/TP and protection maintenance remain active during normal
operation. The modeled 1% ceiling cannot guarantee a realized-loss ceiling during
slippage, gaps, outages or broker failures.
