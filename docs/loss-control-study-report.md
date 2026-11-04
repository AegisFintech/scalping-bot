# Prospective loss-control diagnostics — ISSUE-529

The existing current-contract reconstruction now has a separate read-only loss
study. It preserves every supplied context/setup, WAIT, failed/requesting context,
zero-fill, pending, partial, unknown and negative outcome. Counts describe journal
observations, not every market opportunity or distinct trades across windows.

Frozen hypotheses are structural stop distance at most twice planned target,
180 seconds after actual entry fill (never before its receipt), and a completed
M1 close inside the original five-completed-M1 range after an actual breakout fill.
The 2x threshold is a prospective hypothesis, not a fitted optimum. Structural
stops are never moved. Actual closed net remains separate from hypothetical exits.
Partial paths remain unsupported. Native protection and trading are unchanged.

Failed-breakout signals use snapshot availability, not candle end time. Conflicting
candles censor the signal. Intermittent snapshots cannot establish the first market
crossing or absence of a signal. Timers indicate elapsed eligibility only. Neither
method invents close execution, prices, fees or saved profit. Flight summaries are
coverage warnings, not verified tick paths. Recommendations remain REPAIR or
COLLECT_MORE; this diagnostic stage cannot justify economic continuation/retirement.

A source-pinned future registration uses half-hour boundaries and 30 calendar days
as a collection batch. The existing observation feed supplies packets; the new
systemd reader has no database credentials, broker access or network permission.
Each first-observed input/report is retained immutably, with missing prior windows
explicit. Stale feeds, source drift, invalid scope, storage reserve and conflicting
prior reports reject. A repeated window is not a new sample. Historical archives
and registrations are untouched. Twenty closes over five sessions remains a review
floor, not qualification. Actual close authority requires a separately reviewed
implementation and terminal handover; it is not delivered by these observations.

Investigation also found all16 contexts in the07:00–07:30UTC November4 feed lacked
market data: the old exporter rejected trial cost fields. The exporter now strictly
validates the exact0.10 trial payload, then emits the unchanged1.0 market projection.
The three extra stress-policy fields remain in immutable hashed provider evidence;
TRIAL_STRESS_COSTS_NOT_PROJECTED explicitly labels their absence. Invalid/unknown
fields, incorrect reserves and legacy release mixing still reject. Existing public
schemas and old exported packets remain unchanged. Exact one-to-one null-order closing
fills are represented by their already exported close-deal records, matched on broker
deal identity, position, volume and occurrence. Duplicate/unmatched fills remain
explicit. This prevents closing fills being mistaken for unmatched entry fills.
The real reconstructed window still retains two UNKNOWN setups: stale position
observation chronology and post-cutoff lifecycle events cannot be repaired by
filtering or assumed terminal state. No old economics are inferred from them.

Delivery requires full qualification, independent Standards/Spec review, exact-head
CI and reviewed merge. Activation then updates only the isolated observation-feed
artifact and installs the loss-study reader with a future registration. The executor,
provider worker, live dashboard, risk, TP/SL and active catalogue stay frozen.
Receipts and natural provider verification are recorded on issues529/528 respectively.

Validation: full `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passes2,877
tests with no skips (1,321 Node,165 PostgreSQL lifecycle,1,391 Python). All
format/lint/types/build/schema/migrations/replay/secrets/dependency audits pass.
All four sample/deployment policy/startup configuration checks pass. Both independent
review axes are clear after fill-minute, duplicate/partial-fill, projected-storage
and replay corrections.15 focused tests cover those boundaries and interrupted
writes. Earlier runs interrupted for corrections remain unqualified/source-changed.
The unchanged historical07:00–07:30 window exports16/16 market contexts after the
repair versus0/16 before; this is a compatibility probe, not prospective evidence.
[Validation receipt](evidence/loss-control-study-validation.json).

Future registration, timer/readback and exact-head hosted delivery receipts follow
on issue529; no future result or provider receipt is claimed by this source report.
