# ISSUE-318 — Directional slippage and OCO acknowledgement races

Issue: https://github.com/AegisFintech/scalping-bot/issues/318.

## Problem and behavior

An October 19 observed pair filled BUY at 08:02:34.098 UTC (received .264),
then SELL was accepted at .353 (received .518) and filled at .759 (received .931).
The first acceptance was at 08:02:33.854. This supports a callback/placement
race; it does not prove the precise command dispatch time or a broker fault.
Both trades ultimately won. This event does not explain the cohort loss.

Placement now rereads the mutable first-leg state after reconciliation and the
second session check, immediately before invoking second placement. Anything
other than an unfilled PENDING first leg, or existing uncertainty, withholds the
unsent peer. Its distinct local rejection has no broker ID/submission timestamp
and does not fabricate an execution event. An accepted or filled first leg is
preserved. A filled first leg remains active for protection and reconciliation.
Unknown outcomes remain blocked; this change grants no new recovery authority.

If a first fill occurs after dispatch while the peer acknowledgement is pending,
peer acceptance revisits OCO cancellation. Cancellation is scoped to the tracked
pair and deduplicated in flight. Failed cancellation retains uncertainty. Two
fills remain possible over network/broker latency; the shared race-exposed 1%
setup budget is unchanged. Serial broker pacing remains in the broker client.
A stale acceptance cannot reduce filled volume or overwrite a terminal state.

Adverse deviation is now max(fill-entry,0) for BUY and max(entry-fill,0) for SELL.
Price improvement is not adverse slippage. Existing point/basis-point thresholds,
missing/invalid-price failure and exact-group terminal recovery remain. Existing
stored slippage reasons are not rewritten or cleared, and previous fills are not
replayed. This is an execution correctness change, not an entry/TP/SL experiment.

## Validation and deployment

Focused gateway suite: 41 passed, including favorable/adverse fills on each side,
invalid price, fill/partial/terminal/unknown callbacks before second dispatch,
fill during session await, late acknowledgement, cancellation timeout, stale
acceptance and idempotent retry. PostgreSQL coverage checks locally withheld
submission provenance and rejects contradictory broker evidence.

Full qualification passed under Node 22: `npm run qualify`, evidence
`/tmp/scalper-qualification-rFxoDM/checks`. This includes formatting, lint, TypeScript
types/build, Node/schema/migration/fail-closed suites, isolated PostgreSQL lifecycle,
Python format/lint/types/tests, secret scan and both dependency audits. Initial
qualification found test-only lint/optional-property typing errors; corrected and
the complete qualification rerun passed. No service restart, production deployment, database
migration, accounting reset, prompt or risk-policy change has occurred.
Rollback is the previous immutable code artifact, preserving current database,
claims and journals; it does not authorize clearing uncertainty or replaying orders.
