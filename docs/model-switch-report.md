# ISSUE-078 — Operator-requested model switch

Issue: [#186](https://github.com/AegisFintech/scalping-bot/issues/186).
Date: September 8, 2026. Release: `0.2.2-fixed-risk.5`.
Branch: `issue-078-sol-model-switch`; prior release `.4` / PR #185.

The operator requested the exact EPRToken identifier `gpt-5.6-sol/u40`.
The populated environment now changes only `AI_MODEL`; credentials, endpoint,
mode, notional authorization and every other value are preserved. A protected
mode-0600 backup exists. Risk remains 1% combined setup / 5% daily, policy v2;
no live authority is introduced. Forward migration `0017_sol_context_model.sql`
adds the exact Sol route to the journal constraint while preserving historical Astra
rows. JSON contracts are unchanged.

## Implementation

Scenario generation, the local HTTP consumer, persisted request telemetry and
benchmark utilities now use the versioned policy pin. Runtime configuration
rejects stale or conflicting explicit pins. A fresh release identity keeps strategy
history auditable. Previous-model maps remain intact but cannot authorize new
orders; their existing five-minute request cooldown still prevents duplicate cost.
The generic adapter accepts only exact identities and the two explicitly observed
route aliases; active Sol consumers reject Astra responses.

The Responses interface, scenario-v2 prompt, strict schemas, chart inputs, request
bounds and 45-second deadline are unchanged. No temperature, reasoning effort,
retry, sizing, entry, expiry or risk-policy adjustment accompanies this switch.
Official [Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
describes image input, Responses and structured output support on OpenAI's service.
It does not establish EPRToken's `/u40` route semantics, tariff or actual upstream
identity. Only the observed endpoint response is reported here.

## Validation and rollout

A bounded identity probe returned HTTP 200 in 3,258 ms, requested
`gpt-5.6-sol/u40`, returned `gpt-5.6-sol`, valid strict boolean JSON; 31 input / 13
output tokens. This is compatibility evidence, not a strategy or latency benchmark.
The running scenario-v2 chart path also passed with explicitly synthetic,
completed-candle input: 35,185 ms, 16,568 input / 891 output tokens, requested
`gpt-5.6-sol/u40`, returned `gpt-5.6-sol`, strict scenario-1.0 schema. This
read-only compatibility probe never reached the execution coordinator or submitted
orders. [Sanitized evidence](evidence/sol-provider-runtime.json).

Two real-market probes stopped before paid inference because analytics reported
M1/M5/M15 gap-or-overlap failures. The hosted database integration attempt also
hit its 512 MB project storage limit (two DB tests failed; analytics passed).
Neither safeguard was relaxed. Integration validation uses an isolated temporary
PostgreSQL 17.11 server with verified TLS; its first valid connection exposed the
previous model-only SQL constraint, now addressed by forward migration 0017.
All software gates passed: 452 Node tests, 118 Python tests, 22 schema tests,
three static migration tests and all three integration tests on isolated PostgreSQL
with TLS verification enabled. Formatting, lint, TypeScript/build, Ruff, mypy,
replay/fail-closed fixtures, configuration checks and secret scanning passed;
both dependency audits found zero known vulnerabilities. Initial test lint/type
findings were corrected and affected checks rerun. The hosted 512 MB limit remains
an operational capacity blocker even though the isolated database suite passes.
[Exact commands, corrections and limits](evidence/sol-validation.json).

Migration 0017 applied to the hosted database at 09:04:49 SGT with unchanged
context row counts and zero data rewrites. The AI and execution services were
recreated using stable Node 22; paused preflight confirmed the Sol model and unchanged
risk policy. Existing demo automation was restored at 09:04:59 SGT. At 09:05:22,
all five services were online, the execution status reported `.5` and the exact
Sol request pin, pause/emergency were off, and startup checks passed. PM2 has no
cached model override. Only `AI_MODEL` changed in the 25-key populated file;
credentials, endpoint and mode-0600 permissions were preserved. The prior build,
environment and constraint definition have private backups.
[Rollout evidence](evidence/sol-rollout.json).

No change in trade frequency, fills, strategy accuracy or profitability is claimed.
Candle gaps and hosted database capacity were observed separately and are not
repaired by selecting another model. No live execution was enabled.

## Rollback

Pause new analyses using authenticated controls, reconcile strategy exposure,
restore the prior reviewed build and model assignment together, then restart the
AI and execution services through the existing supervisor. Keep migration 0017
applied: the older build can read its Astra rows, and Sol history must remain intact.
Do not narrow the database constraint while Sol rows exist. Preserve current
credentials, durable controls, loss locks, request cooldowns and audit rows.
Do not reset or rewrite historical contexts to obtain another request or trade.
