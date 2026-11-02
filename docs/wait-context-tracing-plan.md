# Prospective WAIT/context lineage — ISSUE-504

This records a newly measured observability gap, not a trading incident or an
implemented tracing feature. [Issue504](https://github.com/AegisFintech/scalping-bot/issues/504),
parents402/289. Trading and frozen studies remain unchanged.

The corrected normal review in #502 asked whether each local WAIT corresponded to
one refresh for the same context. The exact10:00–10:30Z packet contains25
SCENARIO_CODEX_WAIT and25 SCENARIO_WAIT_REFRESH_STARTED analyses, but all25 WAIT
rows export empty contextIds. Equal counts cannot establish the proposed pairing.
The source returns WAIT from the consulted context without a durable exact
context/analysis association on that path. The conclusion is unavailable linkage,
not25 proven pairs, a broken trading loop or a provider rejection.

## Bounded implementation acceptance

1. Inspect existing authoritative relations first. Reuse only exact persisted
   associations; never infer them from nearby timestamps, the latest context or
   matching aggregate counts.
2. If absent, design an additive immutable journal for the exact context actually
   consulted, analysis identity, reason, source/receive/persist clocks and owned
   account/symbol scope. Include unique/idempotent claims and conflicting retry
   rejection. Missing links remain explicit; old packets are never backfilled.
3. Project direct typed links through the existing read-only evidence boundary.
   Preserve historical schemas/oracles or add a separate versioned envelope.
   Separate source-context and consulted-context roles where they differ.
4. Keep entry/TP/SL, dynamic risk, sizing, provider claims/cooldowns, lifetime,
   reconciliation and all execution gates unchanged. Do not force calls/orders
   or introduce a research recommendation as execution authority.
5. Test identity, missing/ambiguous/partial/restart/storage failures. Qualify source,
   obtain independent reviews and exact-head CI before reviewed delivery.
6. Coordinate code-version integrity and #499's frozen0.9.1 collection explicitly
   before activation. Preserve old source/registrations/reports; source drift
   halts research only. Never silently substitute a new source, rewrite accounting
   or use an incomplete selected subset as qualification. A new collection requires
   its own source freeze and future registration.
7. Verify exact links from a NORMAL newly registered check after rollout. Neither
   fixtures, this plan nor a manually advanced stage satisfies natural publication
   cycle466 or economic acceptance403.

Status: planned instrumentation; no production journal/migration or rollout is
claimed. Current observation repair502 is deployed and its scheduled review is
verified. The known missing-link question remains inconclusive.

## Independent operational recovery evidence

A separate current-demo context at10:39:14Z failed SCENARIO_INPUT_STALE: recorded
capture10:39:10.672Z was already3.390seconds old at request persistence, exceeding
the existing3-second input admission ceiling. The journal then contained97 READY
WAIT contexts plus1 failed context; these are context counts, not paid-call or
billing proof. Its durable cooldown remained intact. A new normal context became
READY at10:44:27Z, with no restart, replay, accounting reset or freshness relaxation.
This is one observed bounded recovery, not whole-harness or profitability
qualification. Session status remains independently freshness-gated.

Documentation verification uses Prettier, the actual protected publisher-footer
formatter regression, secret scanning and unchanged qualified executable fingerprint
48e17478d2437d6fb8c507b8046b10d646dc426143b9faa083e7d7d15dc88269. Exact delivery
and hosted checks are recorded on issue504; implementation acceptance stays open.
