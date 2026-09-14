# ISSUE-099 — Balanced exit trial

The deterministic commission-aware transform now uses equal distances for new
setups: **SL = TP**. The current model payload reports a stop-to-target ratio of
`1` and an effective reward-to-risk ratio of `1`. Position sizing remains based on
current reconciled equity, broker costs, margin and volume increments, with the
shared 1% setup ceiling unchanged.

Existing accepted orders are not amended. Their original broker-held protection
remains authoritative. The changed geometry applies only when a new model result
is transformed and placed.

Historical audit records using the previous ratio `2` / `0.5` remain readable;
the dashboard accepts both versions. The existing audit code name is retained for
compatibility even though the current ratio is now equal-distance.

This is a demo trial, not evidence of profitability. At the previously observed
fee level, equal 0.53 distances require approximately 75% wins to break even
after fees. The trial should therefore be evaluated by net expectancy, profit
factor, average win/loss, slippage and time-to-exit, rather than win rate alone.

The smallest implementation changed the shared ratio constants, their typed
payload/audit contract, dashboard compatibility validation, release identity and
affected deterministic tests. No order, account, daily-risk or capital history was
reset.

Verification passed: focused exit/payload/coordinator tests (66 tests), TypeScript,
ESLint, Prettier, schema/migration tests and dashboard tests (58 tests). The full
Node run reached 708/712 tests; four existing temporary-environment configuration
tests fail because their spawned config process returns empty output under the
current host runtime. The full Python run reached 160/161; its sole failure is the
pre-existing GPG encrypted-export fixture. These failures do not exercise exit
geometry. The release was subsequently restarted on the demo host.

## Demo observation

Two `.11` order groups were recorded before the broker session became
unavailable. Both filled on the SELL side and closed about two seconds later;
both were net losses: **−$1,919.59** with order SL/TP **0.52 / 0.52**, and
**−$2,261.25** with order SL/TP **0.53 / 0.53**. The 0.01 difference is broker
tick/fee-aware rounding, not a code-side reversal error. The combined result was
**2 losses / 2 trades** and **−$4,180.84 net**, far too small a sample to judge
the new geometry. The fast exits show that equal distances do not by themselves
solve entry timing, slippage or adverse short-term movement. At the final check
there were no open positions and no pending orders; no existing order was amended.
