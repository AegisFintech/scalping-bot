# ISSUE-089: Broker exits and continuous OCO cycles

Status: implemented, validated and deployed to demo; new broker-held GTC STOP pair confirmed. [Issue #209](https://github.com/AegisFintech/scalping-bot/issues/209). Release `0.2.5-market-stop.3`, policy `market-stop-v1`.

## Problem and change

At 2026-09-09 07:13:58 UTC, the demo buy filled at 4407.05 and the opposite order was cancelled. Repeated broker snapshots verified SL 4405.99 and TP 4407.58. At 07:14:15, ISSUE-088's sampled-price fallback claimed a market close and set an indefinite `PAUSE_NEW_ANALYSES`. The market close executed at 4406.96. There were zero repair attempts. The closed group reconciled successfully, but the pause prevented the next model request.

The operator requested removal of these fallbacks. Position maintenance now has only observation and amendment authority. Both the sampled-price exit and exhausted-repair exit are removed, together with their global pause, close-dispatch client API and redundant monitor entry lock. A verified broker SL/TP snapshot returns immediately; a sampled quote outage or crossed price cannot override it. The broker handles SL/TP exits. Confirmed closure remains eligible for the existing fresh-context cycle.

Missing/wider protection still receives at most two durable amendment attempts, spaced five seconds apart. Approved distances remain anchored to actual fill, rounded inward, preserving tighter existing protection. A crossed repair price waits for a valid amendment opportunity without consuming an attempt. Failed/exhausted repair remains visible as unavailable/repair-required and does not force a market close or persist an analysis pause. This means unsuccessful repair can leave protection missing; broker observations must continue to display that state honestly. Existing open-position and reconciliation gates prevent adding exposure while a position remains.

Historical ISSUE-088 close claims and closing deals remain readable and reconcilable. Migration 0022 and append-only history are unchanged; there is no schema, contract or environment migration. The worker cannot initiate a new market close. Historical unknown dispatch still requires broker proof, with no duplicate command.

## Remaining interruption audit

| Condition                                                                  | Current behavior                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Normal broker SL/TP close                                                  | Reconcile terminal deal/P&L, then admit one fresh context. No protection pause.                             |
| Accepted pending STOPs                                                     | GTC, preserved across ordinary restarts; no timer cancellation.                                             |
| Campaign or daily order counts                                             | Fixed zero/disabled in production. No added count limit or loss cooldown.                                   |
| Failed/unknown provider request                                            | Existing durable failure backoff and circuit retry remain; they do not pause a successful post-close cycle. |
| Operator pause/emergency stop                                              | Explicit controls remain; only the identified legacy protection pause is cleared during rollout.            |
| Database, audit storage, ownership, reconciliation or account-data failure | Existing integrity checks remain. An unknown order/fill is reconciled before another setup.                 |
| Daily/drawdown, margin and shared OCO risk                                 | Existing limits remain; no new risk filter.                                                                 |
| Protection monitor error                                                   | Record unavailable state and continue independent maintenance; no extra global entry flag survives it.      |

DeepSeek remains `deepseek-v4-pro/u5W`, with structured market input and readable entry-pair parsing. Local fee-buffered TP, twice-TP SL, 30-point modeled slippage reserve, shared 1% setup budget and 5% daily loss budget are unchanged. No new filter, fallback, pause, timer or environment key was added.

## Validation and rollout

All 22 required release commands passed: 608 Node tests, 141 Python tests, 35 schema tests, 3 migration tests and 4 configured TLS integration tests. Formatting, linting, TypeScript/build, Ruff/mypy, policy and startup checks for both sample/populated environments, replay/fail-closed fixtures, secret scanning and both dependency audits passed. No initial failures or waived checks. [Exact commands/results](evidence/broker-exit-loop-validation.json). Focused tests cover verified long/short SL/TP crossings, unavailable quotes, rejected/exhausted repairs across restarts, crossed repair prices, closure, historical close claims, ownership, precision and stale/changed reconciliation. Isolated database integration preserves both historical market closes and normal broker protective closes.

The existing fallback pause was preserved during preparation. Paired database/chart backups were verified readable; the build and mode-0600 populated environment were backed up. A direct broker check at 08:34:36 UTC confirmed zero positions/orders with complete account evidence. The new release restarted at 08:35:40 UTC and passed startup with the environment and daily/drawdown state unchanged. At 08:35:58 UTC, the authenticated control cleared the identified `position-protection` pause. Demo automation was enabled, operationally ready and reported no blockers. No live execution was enabled.

DeepSeek requested `deepseek-v4-pro/u5W` at 08:36:12 UTC and returned `deepseek-v4-pro` after 5,560 ms. The fresh pair was submitted at 08:36:32–33: BUY 4404.85 and SELL 4399.65, both GTC STOP. A separate read-only broker query at 08:36:55 confirmed two accepted, unfilled orders with relative SL 1.06 and TP 0.53, and zero positions. At 08:37:06 the only admission reasons were the expected active-group/pending-order protections. A transient pre-placement recovery snapshot cleared automatically; no cancellation or manual reset was needed. [Timestamped rollout](evidence/broker-exit-loop-rollout.json).

The environment remains 24 keys, mode 0600; the template remains 20 keys. PM2 reports all five processes online with no cached model/policy overrides. AST-only graph update passed. Light/dark browser regression checks passed: navigation, input/focus/caret, four metric cards and history charts survived timed updates without page errors. Screenshots were inspected locally and remain untracked. The new pair has not yet completed a natural fill → SL/TP → next-cycle observation; terminal deal recovery and exactly-once fresh-context admission are covered by isolated integration tests.

Rollback: restore the previous build only under an operator pause. It contains the removed market-close/pause fallback and must not be resumed as though it had ISSUE-089 behavior. Preserve all database history, risk state and broker-held GTC orders/protection. No destructive rollback migration is required.
