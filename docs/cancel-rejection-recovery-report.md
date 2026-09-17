# ISSUE-106: Automatic OCO cancel-rejection terminal recovery

## Problem

An OCO peer-cancel can be rejected after both entry legs have filled. The
rejection is valid broker evidence, but the prior recovery query did not resolve
that reason after the resulting positions closed. The unresolved journal row
therefore kept demo admission fail-closed indefinitely.

## Implementation

`PostgresDemoExecutionStore.reconcileTerminalEvidence` now resolves a retained
`DEMO_CANCEL_REJECTED` row only when the existing terminal proof establishes all
of the following:

- the exact event is mapped to the strategy-owned order and order group;
- that exact broker order is filled with positive volume;
- the event's broker position identity belongs to a strategy-owned closed
  position in the same account, symbol and group; and
- the group has complete terminal entry, position, trade and close evidence.

The original payload, reason and event identity remain unchanged. Only
`resolved_at` and the proof reference are added. No timeout, flat snapshot,
manual reset, broker cancellation or risk-policy change is introduced. Missing,
partial, conflicting or zero-fill evidence remains blocking.

## Validation

The PostgreSQL lifecycle integration test proves that the rejection remains
blocking before terminal proof and resolves durably after the exact closed-group
proof. A second reconciliation remains idempotent.

## Rollout

Build and restart only the execution service after the normal pre-restart broker
reconciliation. The existing historical row may then resolve automatically on
the next recovery cycle if its exact terminal proof is still present; no direct
database rewrite is required.
