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
geometry. Demo rollout is pending because the current sandbox cannot access the
running PM2 daemon outside the workspace.
