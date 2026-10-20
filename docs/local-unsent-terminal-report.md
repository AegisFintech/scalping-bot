# ISSUE-323 — Local-unsent peer and manual full-close recovery

Issue: https://github.com/AegisFintech/scalping-bot/issues/323.

Migration 0030 adds append-only `local_unsent_entry_proofs`. Placement stores a
scoped exact-order proof in the same transaction as its local rejection, only
with null broker/submission identity, zero fills and no execution event. Duplicate
placement requires the same source reason/time/scope. No historical rows are
backfilled and no broker acknowledgement is manufactured. UPDATE/DELETE reject.
The internal shared type and JSON Schema 1.0 describe this new evidence.

Terminal history verification accepts a missing peer broker identity only with
this proof and no contradictory current submission, fill, event, variant or broker
order-history evidence. All original filled-leg volume, closing deal/P&L, ownership,
protection and fresh account proof remain. Snapshot hashes remain unchanged for
orders without a new proof. The database terminal-recovery path independently
checks the new proof; a null broker identity alone cannot release a group.

An exact already-executed external full market close of an owned demo position may
now be observed without inventing an internal close-command claim. Exact original
entry price/time, full summed entry quantity, closing fill/position/order identity
and no conflicting internal close claim are required. It grants no close command
or authority over manual positions. Missing/partial/ambiguous outcomes and unknown
protective children remain blocked. Callback and history paths use the same
observation predicate. Existing internally claimed closes retain their claim checks.

Tests include full broker history with an unsent peer, missing/contradictory proof,
restart/replay, immutable proof rows, submitted-peer contradiction and manual full
versus incomplete close. Existing permutation, timeout, rollback and conflict suites
remain mandatory. Legacy synthetic fixtures now carry the known cancelled peer's
broker identity instead of a null identity masquerading as a broker cancellation.

Deployment requires forward migration 0030 before the new service. No destructive
transition or accounting reset. Rollback selects the previous qualified artifact
and leaves all new evidence/tables intact; never drop proofs or replay old groups.
No current orders or runtime are changed by this implementation checkpoint.

Full qualification: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed at
`/tmp/scalper-qualification-FVTtuE/checks/results.json`: 932 Node, 94 isolated
PostgreSQL and 376 Python tests. All format/lint/type/build/schema/migration/
fail-closed/secret/dependency gates passed. Focused recovery/schema/migration: 14
tests. Earlier tests exposed an inconsistent null-identity cancellation fixture and
the missing manual-close observation path; both were corrected without relaxing
partial/unknown evidence. A database-only run changed source while running and was
not treated as qualification. Existing Starlette/httpx warning remains. Final-head
hosted qualification is required before merge; deployment is in #334.
