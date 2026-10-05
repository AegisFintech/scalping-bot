# ISSUE-258 — Independent market readiness

Issue: <https://github.com/AegisFintech/scalping-bot/issues/258>.
Depends on [batch 257](upgrade-batch-257-report.md).

The market service tracks session, quote and snapshot observations independently.
Startup session is UNKNOWN and returns 503. A successful session read restores
its component without requiring quotes during a scheduled closure. A quote or
snapshot success cannot clear session failure; session or quote success cannot
clear snapshot failure. Newer-started reads own their component status, so a late
obsolete concurrent success cannot mask a newer failure.

`GET /health/ready` preserves status ready/not_ready and adds version 1.0 with
explicit UNKNOWN/HEALTHY/FAILED components. Shared TypeScript and JSON Schema
contracts describe this additive diagnostic response. No SQL migration applies.
Ready means observed session availability and no observed component failure.
Unknown quote/snapshot components do not claim freshness or trading readiness;
all existing per-decision market/session/account/risk validation remains authority.
Health observations are not a new trading filter or automatic global pause.

Tests reproduce both original failure sequences, initial unknown state,
independent snapshot recovery and obsolete concurrent session completion.
Focused market server tests: 13 passed. Schema, TypeScript, lint and final global
qualification are recorded in the cross-batch report. No services were restarted;
rollback reverts this source batch without cancelling accepted orders or changing
financial history.

Final combined validation and remote delivery: [upgrade delivery report](upgrade-delivery-report.md).
