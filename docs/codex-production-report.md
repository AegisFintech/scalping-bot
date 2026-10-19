# ISSUE-303 — Codex production proposals

Issue: https://github.com/AegisFintech/scalping-bot/issues/303.
PR: https://github.com/AegisFintech/scalping-bot/pull/317.
Status: Codex production proposals activated; final delivery qualification pending.

The operator explicitly requested “use codex instead” on October 19 after the fresh
demo restart. The production AI factory now constructs only `CodexEntryClient`:
completed numeric candles/quotes -> authenticated loopback worker -> subscription
Codex -> two prices -> deterministic fade/risk/execution. The old API analysis and
scenario endpoints return unavailable in production. Historical API clients remain
available for tests/replay; they cannot be selected by credentials or used as a
fallback. `gpt-6.1-sol` is the existing tested subscription pin, with low reasoning.
Code identity is `0.3.0-codex.1`, with a new immutable strategy registry identity
`0.3.0-fade-limit.3-codex.1`. The v3 economic constants, net-to-fee threshold and
risk-policy version remain unchanged. Older strategy registry rows are not edited.

The existing worker uses official non-interactive Codex execution with the existing
isolated subscription login, a read-only sandbox, disabled web search and bounded
90-second execution. [Official documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
describes scriptable CLI execution; [authentication](https://learn.chatgpt.com/docs/auth)
describes ChatGPT sign-in. Availability remains subscription/quota dependent; no
unlimited usage or profitability claim is made.

## Contracts and retained authority

Migration 0029 only extends the context model allowlist; it neither rewrites old
rows nor clears claims/locks. New contexts request the Codex pin. Prior-provider
maps cannot authorize new execution, while scope-wide failed/unknown cooldowns
continue across the switch. The worker's claim, exact effective prompt, input and
available response remain durable across errors/restarts. Requested identity is
known; returned backend identity, usage and money cost stay null. Existing HTTP
schemas and prompt v4 are unchanged. No extra broker authority is given to Python.

The 1% current-equity setup budget remains shared between both race-exposed legs.
Sizing, costs, margin, precision, account/order reconciliation, market-session gates,
GTC peer cancellation and SL/TP maintenance are unchanged. The quote-adjacent fade
transform still replaces model levels: this provider change does not implement
model-selected SMC entries or establish better returns. Research cannot promote itself.

## Deployment and rollback

The normal environment template has 19 keys: `CODEX_ENTRY_LOCAL_TOKEN` replaces the
two API endpoint/key settings, and `AI_MODEL=gpt-6.1-sol` remains explicit. Preserve
old populated private API credentials; they are unused by production and are not
copied into the worker. A separate root-owned worker environment contains only the
independent local token; the worker reuses its existing OS user's subscription login.
Missing token or wrong provider/model fails startup. Credentials never enable trading.

Qualify the final executable source, prepare and verify an immutable release, then
install the matching isolated service and additive migration. Disable new analysis
while letting any active setup complete and keeping protection running. Wait for no
in-flight request before replacing AI/execution services. Preserve the current epoch
database, token file, runtime, all new orders/claims/baselines and existing controls.
Verify policy/startup checks and actual supervisor environment separately, then
restore authorized automatic demo evaluation. Do not force a provider call or order.

For rollout failure, keep new analysis held and protection available. Roll back
compatible code against the same current database only. Keep migration 0029 and
all Codex claims; never replay an unknown request or automatically fall back to Grok.
Research/source pins stay independent; the old frozen observer remains disabled.

## Validation and operational receipt

Focused production HTTP tests exercise the real factory and transport with mocked
Codex receipts, exact prompt/input/identity, session denial, malformed receipts,
usage limits/circuit behavior, missing local token, disabled legacy routes and no
fallback. PostgreSQL tests cover new pin admission, historical identity preservation,
unknown-model rejection and cooldown across a provider switch. Full qualification,
release identity and operational observations will be recorded before completion.

## Local qualification

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed completely at
`/tmp/scalper-qualification-JOYsWJ/checks`: format, lint, TypeScript, build, 886 Node
tests (including schema/migration/replay/fail-closed cases), Python format/lint/types,
secret scan, npm/Python dependency audits, 90 isolated PostgreSQL cases and the full
Python suite. Earlier attempts exposed corrected lint and migration-list fixtures;
no failed check was bypassed. The registry immutability review led to an explicit
provider version with tested unchanged v3 selection. Both policy and `--startup`
checks pass for the prepared private environment. Graphify AST update completed
without provider calls; its pyproject.toml empty-node warning is unchanged.

## First deployed input and session-gap compatibility

The first natural request on the deployed transport was rejected before any CLI
claim/dispatch: its completed M15 tail contained one trusted
`BROKER_SESSION_GAP_BEFORE` marker from the existing broker schedule classifier.
The worker had accepted only contiguous unflagged synthetic histories. The worker
now mirrors the existing Node/analytics contract: exactly one known marker on a
positive integral timeframe gap, at most 14 days; unmarked gaps, duplicate/unknown
flags, overlaps, fractional gaps and spurious/first-row markers still reject.
Original candles and markers are retained unchanged, never interpolated. The
authenticated caller still performs the independent current broker-session checks.
The failed database claim and normal cooldown remain; analysis is temporarily held
while the compatibility fix is qualified. No provider fallback or order was made.

The compatibility source passed a second complete qualification at
`/tmp/scalper-qualification-2QVY8D/checks`: 886 Node, 90 PostgreSQL and 339 Python
cases, all formatting/lint/types/build, schema/migration/replay/fail-closed checks,
secret scan and both dependency audits. The 32 focused worker tests include eight
session-marker cases. Source `1b73f23` also passed both full hosted checks
39215086173 / 39215113793. Its immutable trading release is deployed with migration
0029, all five services on the new protected environment, no cached database URL,
and unchanged daily baseline/reference/high-water values across restart. The feed
and maintenance now use that verified source and the same current epoch.

## Activation result

Trading services run the verified immutable `1b73f23-codex303` release; the isolated
worker runs seven Git-verified source files from `955cb5aac431adcee90877e29d63a8636833abec`
with its own copied dependency environment. The same existing ChatGPT login is
used without copying authentication contents. Worker health returned 200 and an
unauthenticated proposal returned 401. All five trading/dashboard health endpoints
returned 200, and post-start release verification passed. Actual PM2 cwd/environment
paths select the new release/protected environment; no database URL is cached.
The only intentional environment changes are the model pin and a new local token;
existing credentials, demo authorization and current database/runtime remain.

Migration 0029 applied once under the migration role after verifying all 28 prior
checksums and zero in-flight requests/open positions/pending orders. Baseline and
reference/high-water values matched before migration, after migration and after
service restart. A new immutable strategy version records the provider change;
older rows/claims and the first failed Codex request remain unchanged.

After the normal cooldown and worker update, analysis was unpaused through the
audited control endpoint. A natural `gpt-6.1-sol` context reached READY in **19,284 ms**;
the worker's durable claim/result agree, with no failure/replay and null returned
model, usage and cost. No provider request or order was manually triggered. The
first resulting OCO filled one leg and cancelled its peer; the open position has
fresh VERIFIED broker SL and TP. The existing fill-slippage/reconciliation gate
currently holds new risk while that position is maintained. It was not cleared
or attributed to the provider; this is transport/operation evidence, not improved
profitability or a guarantee of uninterrupted order flow.

Storage maintenance and the epoch-aware feed succeeded on the new source. The feed
still waits for a completed new UTC reporting interval without calling a model.
Only the existing backup-overdue storage warning remains; no backup success is
claimed. The frozen observer remains disabled, and research has no promotion or
order authority. Final exact-head hosted checks gate merging PR #317.
