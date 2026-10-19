# ISSUE-303 — Codex production proposals

Issue: https://github.com/AegisFintech/scalping-bot/issues/303.
Status: implementation and qualification; activation pending.

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
