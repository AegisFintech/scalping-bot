# ISSUE-351 — Operator-authorized SMC / DOM demo release

Issue: https://github.com/AegisFintech/scalping-bot/issues/351.
Status: integration fully qualified; hosted checks and verified rollout pending.

The operator explicitly requested activation after the candidate-preparation
handoff. This authorizes a separately versioned controlled DEMO experiment, not
live-account trading, a larger risk budget or an automatic promotion based on
fixtures. #349 prospective comparisons remain unqualified and separate. No claim
of better accuracy, positive expectancy or profitable seconds-to-exit is made.

## Current source and input

New strategy `0.4.1-smc-breakout.1-codex.1`, policy `0.4.1-smc-breakout.1`, provider
prompt `entry-pair-v6`, additive Codex transport 1.2 and reported-risk schema 1.1.
Legacy prompt files, worker request schemas 1.0/1.1, risk schema 1.0, SQL migrations
and journals are unchanged. No SQL migration is necessary for new source/prompt
identities or existing immutable request-text storage.

Expanded history is 720 M1 / 576 M5 / 480 M15 completed bars. The market service
uses the qualified bounded serial history cache only for these exact XAUUSD
counts. It checks broker reconnect sequence before/after collection, invalidates
on failures/reconnect/scope change, revalidates the broker schedule across pages
and reacquires quotes/book after history. The seven-day page lookback bridges
normal weekend closures. Missing/short/stale/open-session-gap evidence fails
closed. Ordinary other-count snapshots retain the existing adapter contract and
now serialize their candle reads too; accepted orders/protection do not await AI.

A local typed HTTP callback runs `causal-smc-1.0` analysis on the final pre-model
snapshot. Freshness/count/quality/identity failures block provider admission.
It runs before the durable provider claim and has no inference/order authority.
The resulting evidence and normalized input SHA-256 are part of the shared
`entryProviderPayload` used byte-for-byte for durable request evidence and actual
Codex dispatch. That payload contains twelve completed rows per frame, broker
quote/tick/bounds and M15/M5/M1 structure, zones, POIs, indicators and DOM findings.
It does not forward the research candidate instructions or candidate output shape.
Full completed candles and final pre-model depth are retained by the existing
market/decision journal. The context hash is a normalized local input hash, not
proof of exchange authenticity or an original-byte signature.

The production prompt still requests exactly two decimal entry prices. The
current output schema does not introduce research candidate/NO_SETUP metadata.
Invalid replies retain the existing fail-closed/unknown-dispatch accounting and
cooldown; no forced entry, silent fallback or additional provider call is added.
Provider failures/unknown dispatch keep the durable five-minute cooldown. Old
unconsumed contexts cannot authorize new submissions with a different prompt SHA.

The worker accepts the new 1.2 contract only when configured with the v6 prompt.
It validates explicit context/history availability, latest completed-bar equality,
causal reference/zone chronology, numerical zone bounds and fresh depth before
its durable ID claim. The existing non-root, credential-isolated, no-retry Codex
process, native schema, 90-second deadline, prompt/ID binding and unknown
identity/usage/cost reporting are retained. Legacy transport validators and
configured-worker version gates remain available without rewriting old schemas.

## Unchanged money and execution contract

Two-price proposals retain original outward entries. STOP_LIMIT/GTC/OCO,
30-point entry range, 30-point / 2-bps fill monitoring and deterministic native
quick-TP/SL continue. SL = 2.5 M1 ATR; TP uses the same modeled commission floor,
30/65-point reserves and 0.10 SL component, capped at 2 ATR. No trailing/time exit,
local sampled-quote profit close, retest/holding confirmation or risk increase.
More historical bars can alter indicator warmup; observed old trades are never
recomputed or relabelled under the new release.

Dynamic shared setup ceiling remains 1% reconciled current equity across both
race-exposed legs, with exact costs, margin, increments and affordability.
Account-wide three-loss/60-minute cooling applies across strategy versions;
changing release never clears it. Daily/capital measurements, controls, ownership,
recovery/SL maintenance and broker-session gates survive the rollout. Demo #094
loss-limit policy stays measured/unenforced as already authorized; other modes
retain enforcement. LIVE_TRADING_ENABLED stays false and mode stays demo.
The dashboard recognizes the new reported policy without relaxing unknown/stale
values; its design/controls remain unchanged.

## Validation and rollout discipline

Initial real-input smoke (no inference/order command) obtained all target counts,
computed local context through HTTP and generated a 23,137-byte v6 provider body
with twelve rows per frame. The independent Python 1.2 worker validator accepted
that exact Node-produced body, with three frames and four depth levels. This is
operational contract evidence, not an economic comparison or provider receipt.
Private source snapshot/request remains outside Git in `/tmp/smc-351/`.

Tests cover exact context journal-before-dispatch and failed preparation without
a claim/provider call; cached history/reconnect failure; worker missing/history/
lookahead/stale-depth/bar-mismatch/legacy rejection before claim; durable worker
no-replay and old-schema parity; new risk identity and unchanged percentages;
dashboard known/unknown policy handling. `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed at
`/tmp/scalper-qualification-1QnXKI/checks/results.json`: 973 Node / 94 isolated
PostgreSQL / 375 Python tests (1,442 total), formatting/lint/types/build,
schema/migration/fail-closed suites, secret scan and npm/Python audits. No skipped
database qualification or failed audit was accepted. Existing Starlette/httpx
TestClient deprecation warning only. Source SHA-256: `7a844386754a17054bfcd2d3e07cb56e29828705e96b69f79caa9913aeb36961`.
Protected-file policy/startup and sample startup checks passed without modifying
credentials. AST-only `graphify update .` completed: 6,575 nodes / 12,344 edges,
known pyproject zero-node/community-label warnings; no API cost. Final docs
formatting, staged review and pre-commit secret scan are checked separately.
[Sanitized qualification](evidence/smc-demo-validation.json). Early corrected type/schema/pin-fixture mismatches
are not counted as passing qualification.

Before activation: commit/push checked PR, wait for both hosted checks, verify an
immutable artifact and isolated matching worker; hold new analyses using the
existing audited control, allow any dispatched old request to settle, preserve
accepted native GTC/protection and reconcile current state. Record original
control/accounting/supervisor/registration evidence privately. Do not cancel a
manual order, clear a fault/cooldown or reset a baseline to make the rollout pass.

Freeze a separate [future observation](smc-demo-observation-protocol.md) before
new-release outcomes. Recreate supervisor definitions against the same current
state/credential file and verify actual working directories; PM2 restart can
retain old cwd. Deploy matching analytics/market/AI/worker before execution,
then verify health, prompt/strategy/configuration and reconciliation before
restoring the originally authorized analysis state. Observe natural calls/orders
only when all existing gates allow; a loss-streak wait is not a server outage.

Rollback: hold new analyses, restore compatible previous immutable trading
artifacts and old worker prompt against the SAME current database/runtime, retain
new journals/claims/protection and reconcile any new-release group under its
original recorded ownership/geometry. Keep new identities and all observation
registrations. Never restore an old database or replay old dispatches. Existing
risk locks/unknown outcomes still govern rollback admission.
