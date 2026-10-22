# ISSUE-362 — Evidence-first Codex decisions and daily memory

Issue: <https://github.com/AegisFintech/scalping-bot/issues/362>.
Status: source implementation and qualification completed and merged in #363.
This report records source delivery before activation; the subsequent
[ISSUE-364 deployment receipt](evidence-demo-rollout-report.md) records the active demo.

The operator approved replacing the compression-first strategy admission with
fresh evidence supplied to Codex. New source uses `entry-pair-v7`, request 1.3,
response 1.1 and `0.4.3-evidence-scalp.1-codex.1` / policy
`0.4.3-evidence-scalp.1`. Historical prompts, transports, scanner, registrations,
journals and accepted GTC groups remain immutable.

The runtime composition no longer invokes the compression scanner before or
after inference. Completed M1/M5/M15 causal context, ATR/EMAs, structure, zones,
broker DOM and warnings remain available. Spread, conservative minimum-volume
commission/execution reserve and up to eight scoped reconciled closed net outcomes
from the preceding 24 hours are fresh bounded context. The reserve excludes
spread (provided separately), may overstate per-unit commission at larger volume,
and is not an estimate of guaranteed future closing proceeds. DOM is broker
liquidity, not consolidated gold order flow. News/harmonics remain unavailable.

Codex returns OCO with two unchanged entry prices and a short explanation, or
WAIT with null entries and an explanation. OCO invalidation is derived locally
from the opposite box boundary plus one tick, projected inward onto broker pip
distances. Gross TP equals the stop distance. This replaces compression structural
invalidation; it is a versioned economic change, not prompt-only improvement.
Exact-volume cost coverage, shared 1% current-equity sizing, affordability/margin,
precision, native fill-relative SL/TP and every late execution gate remain.
No ATR width/neutral trend/compression match is required. No trade is forced.

A successful WAIT is a READY `entry-wait-1.0` observation with no order authority.
Database migration 0031 adds a non-destructive order-group interlock and a unique WAIT successor link with mutually exclusive refresh parents. Contexts
still expire five minutes from capture; WAIT rechecks use the newer completed M1
and at least 60 seconds after provider availability. The same scope advisory lock, unique parent claim
and SQL cooldown checks protect concurrent/restarted workers. Prior successful
contexts do not extend a completed WAIT's retry, but every recent failed/unknown
request still constrains admission. Failed/unknown
requests retain the five-minute cooldown, including earlier failures in scope.
WAIT does not retire accepted GTC orders or grant the terminal-trade exception.

The isolated non-root worker uses Codex App Server over bounded stdio. It starts
one persistent thread per UTC date and model/prompt pin, resumes the exact ID,
serializes requests with the existing file lock, and explicitly compacts after
eight completed turns before the next decision. Each request still includes the
latest full bounded input; memory has no price/account/order authority. Durable
request claims, memory dispatch/turn/compaction receipts and original response
text stay outside the compressed conversation. Corrupt state, busy/mismatched
threads, tools, RPC failures, oversized messages and timeouts withhold output;
no request ID is retried and resume failure does not silently create a new thread.
A new request after an unknown outcome may resume an idle thread with the unknown
prior outcome marked; it never resends the old turn. An inherited incomplete
atomic state write fails closed for operator review rather than losing provenance.

Shell/execution, multi-agent, apps/plugins, browser and web tools are disabled;
configured MCP servers are disabled explicitly. Unexpected server requests or tool
events terminate the invocation. Existing service credential isolation/read-only
sandbox stays in force. Session continuity is not model training or economic
validation. Compaction can lose detail, and daily rollover bounds old context.
The 90-second total worker deadline includes compaction and proposal generation.
Subscription access/quotas and exact returned backend identity remain observational;
unknown usage/cost remains null. No API-key path or model fallback is introduced.

Official protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server),
including `thread/start`, `thread/resume`, `turn/start` and `thread/compact/start`.
The installed CLI-generated protocol schemas were inspected locally before
implementation. A non-root synthetic subscription transport smoke passed with three WAIT-only
calls, no market inputs or broker authority, one exact resumed thread, retained
test marker and explicit compaction before the third turn. The smoke harness
used a two-turn threshold; production is fixed at eight. The initial smoke exposed
replayed historical turn notifications, which now cannot satisfy a new turn or
compaction. Fresh exclusive reruns retained the original failed receipts and passed.
The final private receipt is
`/var/lib/scalper-research/.runtime/evidence362-smoke-r3/receipt.json`.
No strategy outcome or execution latency conclusion follows this transport test.

## Rollout and rollback

No deployment, provider smoke against market inputs, production migration, observer
registration edits, accounting reset or service restart is part of source delivery.
For rollout prepare immutable qualified Node/Python and isolated worker artifacts,
verify no in-flight provider request and certain broker reconciliation, preserve
accepted GTC/protection/history and existing environment credentials, apply the
additive migration through the normal audited path, freeze a new prospective
cohort, then activate both matching prompt/transport versions together. Never
activate a worker whose prompt differs from the orchestrator's pinned hash.
Rollback restores the previous immutable artifacts and worker prompt while retaining
0031 (additive and harmless to non-WAIT plans), all WAIT/context/cooldown records, financial state,
old and new thread journals. Do not downgrade a database or reuse old unconsumed
prompt contexts. Source drift censors the old observer; it never grants execution.

## Cleanup and qualification

No packages or services are added. The previous compression adopter is retained
for historical tests/research; the current composition no longer calls it. Its pure
cost reserve is shared without invoking the scanner. No immutable deployment,
frozen observer, authentication or database evidence is removed.

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed on the frozen source
`38faf0316c1e1f91a5a3fd79c229cc4d137247b322833c5f38328677274a3ba0`.
Private logs: `/tmp/scalper-qualification-v5qx88/checks`. All 20 checks passed,
including formatting, ESLint, TypeScript types/isolated build, Node/schema/migration/
replay/fail-closed tests, Ruff formatting/lint, mypy, secret scan, npm/pip audits,
isolated PostgreSQL lifecycle tests, Python tests and disposable database shutdown.

- Node: **1,023 tests / 127 files**.
- Isolated PostgreSQL: **103 tests / 7 files**, including WAIT successor concurrency,
  restart, 60-second/new-M1 admission, prior-success versus failed/unknown cooldowns,
  active-group exclusion and the WAIT order-intent interlock.
- Python: **421 tests**, including real bounded stdio pipes/write backpressure,
  exact resumed-turn matching, daily rollover, compaction, corrupt/busy state,
  no replay, strict schemas and dashboard WAIT labeling.
- Total: **1,547 passed**. One pre-existing Starlette/httpx deprecation warning.
- `npm run config:check -- .env.sample` and the same command with `--startup` passed;
  16 normal keys. Populated credentials and PM2-cached runtime configuration were
  not modified. The active runtime remains the earlier v6 compression release.
- `graphify update .` passed with **7,414 nodes / 13,517 edges / 588 communities**,
  local AST only and no extraction API calls. Documentation semantics/community
  labels were not refreshed. The known pyproject zero-node warning remains;
  HTML uses the aggregated community view above 5,000 nodes.

Early development failures (historical current-version assertions, fixture SQL
parameter types and unsafe test typing) were corrected before the complete frozen
qualification. A stopped earlier run and intermediate database-only runs are not
qualification receipts. Original failed synthetic transport receipts remain intact.

[Sanitized validation receipt](evidence/evidence-first-codex-validation.json).
Persistent native thread transcripts add storage; this change adds no automatic
pruning or cleanup. Tests and the synthetic subscription smoke establish software
behavior, not economic benefit, production-load latency or subscription capacity.
No market-data provider smoke, demo activation or production migration occurred.
