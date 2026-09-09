# ISSUE-088: Broker-confirmed position protection

Status: implemented, validated and deployed to demo as `0.2.5-market-stop.2`. [Issue #207](https://github.com/AegisFintech/scalping-bot/issues/207).

The local market-close fallbacks and persistent pause described below are superseded by [ISSUE-089](broker-exit-loop-report.md). This report records the historical ISSUE-088 behavior and rollout.

## Observed incident

The demo sell filled at 4397.89. Its first fill event supplied no absolute SL/TP, and the local position retained null values. The broker later executed its TP child order with limit 4397.36 at 4397.21 on 2026-09-09 at 06:28:01 UTC (14:28:01 SGT). The peer entry was cancelled approximately 257 ms after the entry fill. Broker and database are now flat. The available evidence establishes a protection-display gap; it does not establish that the broker lacked an SL. The entry suffered 103 points of adverse slippage, exceeding the 30-point sizing reserve, and the existing slippage latch operated.

A green unrealized P/L does not mean TP was reached. Exit checks use the executable side of a fresh quote: bid for a long, ask for a short. Fees can also affect displayed net P/L. No profit-above-zero exit is introduced.

## Implementation

Independent maintenance reads exact owned broker positions, persists actual protection with observation time, and restore missing or wider protection using the approved entry-order distances anchored to actual fill. Existing tighter protection is preserved. Attempts are durable and bounded; failed protection or a crossed boundary leads to a durable analysis pause and one position-specific close request. Unknown close dispatch is never blindly retried. Closure and P/L still require broker deal evidence.

The broker protocol supports absolute position SL/TP amendments and position-specific volume closes; see [cTrader message definitions](https://help.ctrader.com/open-api/messages/#protooaamendpositionsltpreq) and [position fields](https://help.ctrader.com/open-api/model-messages/#protooaposition).

## Rollout and rollback

The update is additive. Pause analysis, back up the database and protected chart archive together, preserve the populated environment and daily/drawdown locks, apply migration, and restart the demo processes. Retain the new audit tables on rollback. No prior model records, migration checksums, execution events or chart bytes are rewritten. Do not restore a database snapshot over later trading activity. Unknown close dispatch requires reconciliation before operator intervention.

## Validation

All required quality gates passed after correcting test-only async lint, AJV import typing, the new migration-list expectation and Python line lengths. Exact commands/results and initial failures are retained in [validation evidence](evidence/position-protection-validation.json): 603 Node tests, 141 Python tests, 35 schema tests, 3 migration tests and 4 TLS integration tests. The integration suite exercises both normal SL/TP closes and durably claimed market closes through the complete lifecycle, including terminal proof and restart idempotency. Focused post-fix verification passed 25 tests.

Formatting, ESLint, TypeScript, production build, Ruff format/lint, mypy, replay/backtest/fail-closed fixtures, both sample/populated configuration checks (policy and startup), secret scan, npm audit and pip-audit passed. The isolated PostgreSQL 18 instance uses its own TLS certificate and TEST_DATABASE_URL; no production database is used by tests. Initial failures were corrected, not waived. AST-only graph update completed without provider calls; pyproject.toml has no AST nodes and community names may use hub fallbacks.

Amendment acceptance is not confirmation: a subsequent fresh broker reconciliation must verify both levels. At most two repairs are attempted per position, separated by five seconds. One close claim is persisted before dispatch and bound to its returned/recovered broker order. Closing evidence must match account, symbol, position, volume and a two-minute dispatch window. A timeout, partial close, missing deal, unsupported ownership or failed close remains paused for review; no automatic resend is allowed. Paper protection remains explicitly simulated. Dashboard demo values older than ten seconds are withheld.

The backup archive is readable (database 48,712,565 bytes; protected charts 254,740,147 bytes). The populated environment remains 24 keys with mode 0600; the normal template remains 20 keys. Exact DeepSeek pin is retained. PM2 has no cached model or policy overrides. Runtime confirmation is recorded in [rollout evidence](evidence/position-protection-rollout.json).

## Demo rollout

Migration 0022 was applied at 06:40:51 UTC; AI, execution and dashboard processes restarted at 06:41:20. Release `0.2.5-market-stop.2` passed startup and operational checks with the environment and daily/drawdown state preserved. A direct read-only broker check confirmed zero open positions and pending orders before resuming. Automatic demo analysis resumed at 06:43:18 UTC with no safety blockers. Light/dark browser checks passed: navigation, control input/focus/caret, four metric cards and history charts survived timed updates without page errors. Screenshots were inspected locally and remain untracked.

The original trade was already closed. No unprotected broker trade was deliberately created to test repair; the amendment, rejection and fallback-close paths were verified with mocks and isolated database integration. A future ordinary demo fill will provide further broker protection observations. No live mode was enabled.

After resumption the normal cycle placed two accepted GTC STOP orders, buy 4406.09 and sell 4395.29. Read-only broker verification confirmed both pending, no open position, and relative SL/TP distances 1.06/0.53. Protection repair has not been deliberately forced at the broker.
