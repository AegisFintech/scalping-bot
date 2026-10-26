# ISSUE-380 — Small TP and early-profit demo trial

Operator explicitly approved smaller TP plus cost-aware profit capture, establishing
more profitable closes before considering larger lots. This implements a bounded
DEMO experiment, not a proven improvement in expectancy. Issue: https://github.com/AegisFintech/scalping-bot/issues/380.

## Evidence and interpretation

The inclusive current-source Flight snapshot contains six setups: three canonical
wins, one loss, one still-open position and one failed setup without a fill. Each
filled setup had a recorded positive modeled net window. Every path has gaps;
the open path is censored. Do not call those simulated wins, infer guaranteed
manual exits, or report a complete profitable subset as a qualified strategy.
The losing SELL4004.19 saw ask4003.87 about61 seconds after fill and ask4003.79
about69 seconds after fill. Its best observed ask4003.56 was still above native
TP4003.19. A smaller0.40 target was observed crossed; future counterfactual fees,
market-close slippage, latency and fills remain unknown. The actual loss was
−1818.03 including signed fees. Descriptive snapshot:
[evidence](evidence/small-tp-flight-review.json). This is not a rerun/promotion of
#253 paired replay or a modification to any frozen #255 registration/report.

## Exact new policy and unchanged sizing

Source0.7.2-quick-oco.1-codex.1/policy0.7.2-quick-oco.1 keeps Codex range entries,
BUYupper/SELLlower STOP_LIMIT/GTC/OCO, WAIT, session/reconciliation/account/risk
admission and original direction. New gross native TP is0.40 price units upward
rounded to whole broker pips. Native SL stays7.00 price units independently; it
is deliberately NOT recomputed as7× the smaller TP, so unchanged economic inputs
do not enlarge size by shortening the stop. At current0.01 pip this is40 TPpips
and700 SLpips. Risk remains shared5% total demo/at most2.5% each race-exposed leg;
other modes1%, dynamic reconciled equity/costs/margin/grid sizing and65-tick stop
execution reserve remain. No fixed lots/multiplier or real-money activation.

The former65-tick TP allowance made0.40 mathematically unaffordable. This release
explicitly changes only profit economics to a5-tick exit allowance; actual fills
can exceed it. Entry30-tick native range and65-tick loss-sizing reserve are
unchanged. Both minimum-volume proposal and actual-volume placement checks still
require verified broker fees/conversion plus allowance and modeled minimum net.
Reject incompatible/unaffordable TP; never widen it or hide an extra fee charge.
A smaller native TP applies only to new groups. Existing GTC orders/positions
keep their quantities, protection and original source; no activation cancellation
or old-level shift is authorized.

## Early capture and failure handling

Independent existing2-second protection maintenance may close only this new
source's owned DEMO position once modeled net exceeds0.05 price units times its
actual per-price account-currency value AFTER conservative opening/closing
commission, known nonpositive accrued swap, conversion and5-tick execution reserve.
It takes the qualifying opportunity directly instead of waiting for a retracement.
At the observed commission near0.24 price units, gross move around0.34 is needed;
exact threshold varies with broker costs/quantity. No positive swap is used to
manufacture a trigger. Missing swap/money precision, fees, metadata or quote means
no optional close; existing native protection still operates.

Use BUYbid/SELLask, quote source/receipt age≤1 second and metadata age≤30 seconds;
no midpoint/gross-green trigger, extra spread charge or duplicate entry reserve.
Reconcile exact broker identity, symbol, label, side, actual entry and remaining
volume; confirm broker-native SL/TP before profit authority. Re-read position and
quote just before claim; changed/missing/partial/manual-close state cannot close.
SQL claim requires exact new source, OPENowned DEMO, matching quantity/entry,
full entry, zero-fill CANCELLED peer, no partial closing ledger and no unresolved
scoped broker events. Missing-SL close authority is unchanged and separate.

A scoped advisory lock and existing durable position-close claim persist before
one market-close command. Store quote/cost/volume/threshold evidence in the
existing append-only command event. Unknown dispatch, rejection, partial fill or
restart cannot resend. Native SL/TP is never removed. Normal broker journal and
complete close-deal reconciliation prove results; acceptance is not a trade close,
flat snapshot/time does not clear uncertainty, and no new setup starts during
uncertain exposure. There is no new migration/table/env key or model-call timer.
The Flight observer remains read-only, not an execution source.

## Contracts, validation and review

New immutable prompt entry-quick-oco-v3, execution-v3, transport1.9 and risk1.8
are separate from historicalv2/1.8/1.7 bytes. Matching Node/Python schema and
actual transport validation are required. Persistent memory is not training;
new prompt pin isolates context without deleting earlier threads. Future collection
requires a new prospective source freeze; older freezes/reports are unchanged.

Tests cover BUY/SELL executable sides, fee-green distinction, swap/conversion,
stale/future/invalid quotes, historical source, second-read reversal/manual close,
changed volume, missing costs, native preservation, failed claim, timeout/restart,
SQL scope/source/quantity/peer/partial/event gates and one durable claim. Run all
repository qualification gates plus config checks, secret/dependency audits and
AST Graphify before commit/PR delivery and matching single-demo rollout. Operational
receipt belongs on #380. Fixture success does not prove economic improvement.

Monitor all fills/outcomes, net after costs, open exposure, profitable-window
capture, hold times, slippage, unresolved closes and recorder gaps. More wins alone
do not justify increasing lots: unchanged7.00 SL with smaller wins can still have
negative expectancy. No automatic quantity increase, failed-breakout/time exit,
strategy promotion, historical rewrite or accounting reset is part of this change.

Rollback: hold only new admission using existing authenticated controls, retain
native protection and durable close claims, and reconcile all new groups terminal
before deploying a compatible forward policy. Never delete a close claim to retry,
downgrade an active uncertain close, reset accounting or overwrite frozen evidence.

## Qualified checkpoint

Full Node22 `node scripts/qualify.mjs` passed: 1,117 Node,124 isolated PostgreSQL
and459 Python tests,1,700 total. All formatting/lint/types/build, schema/migration/
replay/fail-closed checks, secret scan and dependency audits passed. Both populated
configuration checks passed. Initial test typing/lint and scratch SQL fixture
failures were corrected; failed receipts remain private and do not qualify the
release. Read-only broker inspection confirmed accrued swap/money precision and
native protection fields are available. AST Graphify refreshed without semantic
regeneration or API cost. Detailed commands/fingerprint/results:
[validation](evidence/small-tp-profit-exit-validation.json). Reviewed matching main
activation and browser/transport/native geometry receipts will be posted on #380.
