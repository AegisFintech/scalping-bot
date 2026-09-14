# ISSUE-101 — LIMIT pending entry execution layer

Plumbing for LIMIT pending entries (used by the fade-limit strategy release
in ISSUE-102). Offline change for ISSUE-101: no broker policy change, no
strategy change. The `entryBrackets` option defaults to `"STOP"`, so the
existing STOP/STOP_LIMIT semantics are untouched.

## Why

ISSUE-100 demonstrated (4 trading days, 717 journaled setups) that fade
limits at the same provider levels are positive on both train and holdout
under pierce/commission stress. To accept this edge, the execution layer
needs a maker entry that does not pay the 0.64 average adverse slippage
measured for STOP market entries, and a relative SL/TP child path that keeps
ISSUE-089 / ISSUE-093 / ISSUE-095 protection machinery intact.

## Contracts and schemas

- `packages/contracts/src/index.ts` widens `PendingOrderCommand.executionOrderType`
  to `"STOP" | "STOP_LIMIT" | "LIMIT"`. No schema field rename; historical
  documents remain valid.
- `packages/contracts/src/order-type.ts` adds `LIMIT` to `pendingOrderType`
  and exposes `brokerOrderTypeNumber` (2/3/6 mapping used for ack
  validation). 1.0 schema stays immutable; `schemas/pending-order-execution-1.1.json`
  enumerates `"STOP", "STOP_LIMIT", "LIMIT"`.
- `packages/risk-engine/src/risk.ts` and `commission.ts` thread
  `executionOrderType` through `PositionRiskInput` and `stopCostReserve`.
  The price uplift in the per-unit commission model is skipped when the
  entry type is `LIMIT`; the stop-side reserves (including the points/side
  exposure) are preserved.
- `packages/risk-engine/src/model-validator.ts` adds an `entryBrackets`
  context field; `checkLeg` flips `BUY/SELL_ENTRY_TOO_CLOSE` and
  `*_ENTRY_DISTANCE_ATR_EXCEEDED` depending on `STOP` vs `LIMIT` semantics.

## Wire and execution

- `packages/ctrader-client/src/client.ts` extracts a shared
  `validatedRelativeProtection` helper, adds `limitProtectionFields`
  (orderType 2, `limitPrice`), and a `placeLimit` client entry point that
  dispatches a `NEW_ORDER_REQ` with relative SL/TP but no
  `stopTriggerMethod`. Acknowledgement orderType is matched via
  `brokerOrderTypeNumber`.
- `apps/execution-service/src/demo-gateway.ts` exposes `placeLimit` on the
  `CTraderTradingClient` interface, dispatches LIMIT pairs through the new
  client method, and treats recovered orders as owned when
  `orderType ∈ {2, 3, 6}`. Pair validation, the slippage monitor
  threshold, the OCO peer-cancel callback and the zero-fill terminal proof
  are all type-agnostic.
- `apps/execution-service/src/paper-gateway.ts` triggers LIMIT legs on the
  correct side of the spread (BUY on `ask ≤ limit`, SELL on `bid ≥ limit`),
  fills at `min(entry, market)` for BUY / `max(entry, market)` for SELL
  (maker style), and applies no modeled slippage.
- `apps/execution-service/src/postgres-trail.ts` writes the family column
  as `'LIMIT'` when the command's `executionOrderType` is `LIMIT` and as
  `'STOP'` otherwise, satisfying the widened constraint.

## Persistence

- `migrations/0025_limit_execution.sql` widens
  `orders_execution_order_type_check` to include `'LIMIT'` and
  `orders_order_type_check` to include `('STOP', 'LIMIT')`. Both constraints
  follow the precedent set by `0021_market_stop_execution.sql` (drop +
  add with no destructive statements). Historical rows and audit values
  remain immutable.

## Risk-engine semantics

| entry type | modeled per-side adverse movement | entry-side price uplift for commission |
|---|---|---|
| STOP / STOP_LIMIT | `points × tick` (30-point reserve) | yes (entry + reserve) |
| LIMIT | `points × tick` (stop-side overshoot) | no (fill at limit price) |

This matches the simulation calibration in `python/backtest/variants.py`
where LIMIT entries fill at the level with no entry slippage and exits pay the
measured `exit_overshoot` distribution.

## Validation

- Unit tests for the new wire and admission paths:
  `tests/ctrader/limit-transport.test.ts`,
  `tests/execution/demo-gateway.test.ts` (LIMIT pair block),
  `tests/execution/paper-gateway.test.ts`,
  `tests/risk/model-validator-limit.test.ts`,
  `tests/schema/pending-order-execution.test.ts`,
  `tests/migrations/migrations.test.ts` (file list + checksum).
- 728 Node tests pass; 185 Python tests pass (3 skipped, isolated
  `TEST_DATABASE_URL` required for storage tests).
- `tsc --noEmit` clean.
- Secret scan reports the long-standing pre-existing false positive on
  the `risk-budget-recovery-report.md` filename pattern; no new hits from
  this issue's files.

## Successor

ISSUE-102 (`entry-pair-v4-fade-limit`) flips the release constants
(`executionOrderType`, `entryBrackets`, `adverseSlippagePoints`, ATR
geometry, regime gate, losing-streak pause, bracket replacement) so the
trade flow selects the validated fade-limit branch. ISSUE-103 deploys the
release to demo with realized-slippage and net-EV telemetry, plus a
bounded observation. The ISSUE-101 plumbing remains the substrate and
stays off until the release runs.
