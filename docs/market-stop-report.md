# ISSUE-087 — Ordinary stop execution and prompt zero-fill restart

Date: 2026-09-09. Issue: [#204](https://github.com/AegisFintech/scalping-bot/issues/204).
Branch: `issue-087-market-stop-cycle`; baseline `24d1a9b` / ISSUE-086.
Release `0.2.5-market-stop.1`, policy `market-stop-v1`. Demo only.

## Problem and authorization

The operator approved the recommended ordinary STOP trial after two accepted buy
STOP_LIMIT orders cancelled with no fills. Per-order broker details reported
“Market VWAP is worse than Limit price”. At 13:47:56 SGT the 4395.58 trigger had a
4395.63 ceiling while the nearby ASK reached 4395.75. This explains these two
rejections; it does not establish that every historical cancellation had that cause.
New analysis was paused at 14:04:17 SGT, with the old pair already cancelled and
no position. Local environment, controls, build and risk-state backups were taken.

## Resulting behavior

- New OCO commands explicitly use ordinary STOP, GTC and trade-side triggering.
  There is no broker limit-price ceiling; accepted pending orders can become
  market executions. Local fee-buffered TP and SL twice TP remain, encoded as
  relative distances from actual fill. No price is moved to manufacture an entry.
- Production sizes with a 30-point adverse-slippage reserve per leg, previously 10. This conservative demo assumption exceeds the observed 17-point gap; it is
  not a measured tail bound. The shared 1% setup cap, daily/drawdown locks, exact
  broker margin, volume increments and ownership remain. Identical-input tests
  require smaller volumes and unchanged TP/SL. Actual loss can exceed modeled risk.
- Fills beyond 30 points or 2 bps are still recorded and trigger peer cancellation.
  Existing uncertainty/terminal recovery remains; no fill is relabelled rejected.
- After a proven zero-fill cancellation, a single fresh context may be requested
  on the next eligible five-second decision interval. Both owned orders need
  exact matching terminal broker events and zero-fill evidence; any fill,
  position, trade, unresolved event, active group or ambiguous state blocks it.
  A unique request link and scope lock prevent duplicate dispatch across restarts.
- Consumed state is checked locally every five seconds, so cached provider
  cooldown cannot hide newly completed state. Provider failure/unknown backoff
  remains five minutes; a proven pre-dispatch circuit rejection retains its
  existing one-minute recheck. No inference runs while a group is active.

Broker protocol references: [STOP enum](https://help.ctrader.com/open-api/model-messages/#protooaordertype),
[new order request and relative protection](https://help.ctrader.com/open-api/messages/#protooaneworderreq),
[stop-order execution](https://help.ctrader.com/trading-with-ctrader/orders/#stop-order).
STOP can still be rejected for other broker reasons or slip; this change addresses
the observed limit-price rejection, not all possible execution failures.

## Contract, history and rollback

Migration 0021 adds nullable `orders.execution_order_type` and updates the refresh
link comment. Historical generic `order_type='STOP'` rows remain unchanged with
null explicit intent; their broker journals retain observed type. New trusted
commands/audit rows persist STOP or STOP_LIMIT. The new schema describes that
execution field; historical model and pending-lifetime schemas remain immutable.
Unknown/mixed types and conflicting idempotent replay reject before submission.
Legacy STOP_LIMIT transport and restart cancellation for both types remain.

Rollback: pause new analysis, retain model-independent maintenance and broker
protections, restore the saved build, and restart matching services. Keep additive
migration columns and all audit records. Old code can maintain existing STOP/GTC
orders; it must not resubmit them. Resume only after normal reconciliation/config
checks. Never reset risk locks or replace the populated environment.

## Validation and demo observation

All quality gates passed: 590 Node tests, 140 Python tests, 34 schema tests,
three migration tests and three isolated TLS database/analytics integration tests.
Formatting, lint, TypeScript/build, Ruff/mypy, sample and populated configuration
checks including startup, replay/backtest/fail-closed fixtures and npm/pip audits
passed. Exact commands and corrected initial failures are in
[validation evidence](evidence/market-stop-validation.json).

The repository secret scanner reports the seven pre-existing deleted image paths;
an all-index-blob credential/pattern scan supplements it before every commit.
Those user deletions are excluded from this issue. Graphify updated 3,006 nodes /
6,342 edges / 216 communities with no provider calls; pyproject.toml has no AST node.

A readable database archive (48,681,632 bytes) and paired local chart archive
(254,686,016 bytes) were saved privately before migration. Failed initial backup
attempts used an absent binary path and unsupported URI environment handling;
the successful attempt used installed PostgreSQL 18 tools and parsed libpq
environment settings. No secrets or archive bytes are committed.

Migration 0021 applied at 14:12:36 SGT. Matching services passed paused preflight
with unchanged environment and risk state; automation resumed at 14:13:12.
The new DeepSeek context was READY in 5,714 ms. Buy/sell orders were accepted at
14:13:40–41. Independent read-only broker reconciliation at 14:14:11 verified
both are ordinary STOP (enum 3), GTC (enum 2), no execution range, with relative
SL 1.06 and TP 0.53. Buy entry 4405.22 / volume 307700; sell 4398.92 / 307800
in native broker units. No positions or fills at that observation.

[Rollout evidence](evidence/market-stop-rollout.json). This verifies the deployed
transport and pending protection, not a completed natural cycle or profitability.
