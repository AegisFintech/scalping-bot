# Recorded WAIT and input-history distinction — ISSUE-547

## Problem and retained cohort

The historical review ending2026-11-06T02:17:56.411220Z contains595
contexts:501READY (all WAIT),93FAILED and1REQUESTING. These are repeated
observations, not595independent opportunities. The original v4 Codex prompt was
used. Full private review digest:
`552b71229ba6a0920cbc6f0a03896b7f7c142d9df8b11632630bf438e077a2b7`.
The [retained parent finding](https://github.com/AegisFintech/scalping-bot/issues/403#issuecomment-6675163635)
is separate from current readiness and broker exposure.

Required-tail history warnings affect94contexts, including83READY. Recorded M15
session gaps remained in the12-bar required tail from23:15:07Z through01:59:03Z;
12also had M5 gaps. A gap flag is recorded input evidence, not proof of why Codex
chose WAIT. The geometry screen's first failures were208unresolved direction,
112missing M1 confirmation,83history unavailable,43insufficient target/risk room,
17missing targets,13entry geometry,13stop bounds and12geometry-only successes.
The last12were not cost-qualified orders or hypothetical missed profits.

Of93failures,84had private durable jobs waiting on the learning budget before
dispatch,7had claims without an API response and2had no matched job. Local
FAILED alone does not establish dispatch, provider refusal or billing. Unknown
outcomes must never be retried from this reader.

## Change and boundaries

The read-only decision tape keeps the original Codex reason, alongside a separate
recorded-history warning for required-tail shortages or recorded quality flags.
Only the latest12account/symbol/mode-scoped contexts are selected. Their exact
persisted provider input is joined through the original analysis/version binding;
only0.11trend contexts get this diagnostic. Input is capped at128000bytes before
return from PostgreSQL. Malformed, missing or oversized evidence is unavailable;
raw inputs, identifiers, unknown flag contents and endpoints are never returned.
A clean flag/count check makes no current readiness or full-history-validity claim.

Explicit API-budget failures and expired inputs have distinct titles. Generic
failures remain provider-result unavailable; dispatch and billing stay unverified.
Legacy local failures retain their existing title. Tests cover the actual
PostgreSQL SELECT-only boundary, scope, row/byte limits, original reasons,
malformed evidence, flag tails and safe failure rendering.

This reader does not change executor/provider/Flight source, finite registrations,
orders, economics, claims or retry authority. It adds no provider calls. Deployment
must restart only the isolated dashboard after protected delivery. Qualification,
exact-head review and activation evidence are tracked on
[issue547](https://github.com/AegisFintech/scalping-bot/issues/547).

## Next economic work

[Prospective history admission](https://github.com/AegisFintech/scalping-bot/issues/548)
is tracked separately. Known-invalid-history admission belongs in a separately reviewed
executor handover and future registered source segment. Test completed contiguous
M1/M5/M15 history and retained quality flags at the real pre-provider boundary;
retain old evidence, original model reasons and unknown outcomes. No interpolation,
forced entry, looser risk or automatic promotion is authorized by this report.
Compare complete future denominators and daily net after actual costs. Better
visibility and zero-trade geometry do not establish profitability.

## Validation

Full qualification passes2,974tests (1,345Node,175PostgreSQL,1,454Python),
no skips and all20checks. The actual read-only SQL regression ran against the
isolated database. All four sample/protected normal/startup configuration checks
pass; fresh independent Standards and Spec reviews are CLEAR. Existing10moderate
npm advisories remain below the high-severity audit gate; Python audit reports no
vulnerabilities. One existing Starlette test-client deprecation warning remains.
See [sanitized validation](evidence/wait547-validation.json). Protected hosted
checks and isolated dashboard activation are separate delivery steps.
