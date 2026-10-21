# ISSUE-351 — Operator-authorized SMC / DOM demo release

Issue: https://github.com/AegisFintech/scalping-bot/issues/351.
Status: qualified, hosted checks passed, deployed and resumed in DEMO at
2026-10-21 05:14:17 UTC. Economic qualification remains unproven.

The operator explicitly requested activation after the candidate-preparation
handoff. This authorizes a separately versioned controlled DEMO experiment, not
live-account trading, a larger risk budget or an automatic promotion based on
fixtures. #349 prospective comparisons remain unqualified and separate. No claim
of better accuracy, positive expectancy or profitable seconds-to-exit is made.

## Current source and input

New strategy `0.4.1-smc-breakout.1-codex.2`, policy `0.4.1-smc-breakout.1`, provider
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

## Held rollout and clock correction

The first qualified artifact passed both hosted checks and was deployed under an
audited analysis hold. Fresh deployed-data verification exposed valid local quote
and depth receipt times later than the broker source clock. No new-release
provider request or order was dispatched. The first artifact and its exclusive
registration remain unchanged.

Revision `.codex.2` adds technical-context request 1.1 at `/v2/technical-context`
with the actual local snapshot capture time, and binds that time into worker 1.2
input. Source/receipt/capture ordering and the three-second freshness bound are
checked against the appropriate clocks. Completed-candle causality remains tied
to broker analysis time. Legacy technical-context 1.0 remains unchanged. A second
future registration is required before resuming; neither prior registration may
be overwritten. Clock regression tests cover legitimate receipt delay, future
receipt, stale source and local/broker disagreement. Full requalification passed: 974 Node / 94 PostgreSQL / 381 Python tests
(1,449 total), all required format/lint/types/build/schema/migration/fail-closed,
secret-scan and dependency-audit gates at
`/tmp/scalper-qualification-mzKhgT/checks/results.json`. Qualified source SHA-256:
`a0dc3210ef2c7c05f216c121648bfb5f6ab40df274d3f2ac51271737b194349c`. The exact fresh Node
input (23,374 bytes) passes the independent Python worker validator without
inference. Protected-file policy/startup and sample startup checks pass unchanged.
AST-only graph update completed; existing pyproject/community-label warnings only.

## Verified runtime activation

Both clock-corrected implementation-head hosted runs passed:
[push qualification](https://github.com/AegisFintech/scalping-bot/actions/runs/39547952064)
and [PR qualification](https://github.com/AegisFintech/scalping-bot/actions/runs/39547955747).
Immutable artifact `/opt/ctrader-ai-scalper/releases/smc351-clockfix-qualified`
uses commit `ed686d8f5df36102264c551ca108ad21ea846caa`; isolated worker
`/opt/scalper-codex-entry-351-r2` uses the same qualified source/Python. All five
PM2 working directories and the worker were verified. No database credential is
cached in PM2; protected deployment-file SHA and daily/capital financial values
match the pre-rollout evidence. Thirty migration checksums match; no SQL migration
or accounting reset was performed. Old artifact/worker rollback copies remain.

Fresh deployed market → analytics → exact Node provider-input smoke obtained all
720/576/480 bars and twelve compact rows per frame (23,643 bytes). The dedicated
worker user's Python validator independently accepted that input. Worker health
is 200, unauthenticated POST is 401, authenticated invalid input is 422; no test
inference or broker order was sent. Reconciliation is operationally ready.

The second exclusive mode-0400 registration was frozen at 05:13:05.887338 UTC,
with future collection from 05:14:05.887338 UTC through November 20 at the same
time, thirty UTC daily boundaries plus final partial cutoff. Registration SHA:
`335009492db4df47afff8601d47de1666a969509417a89205c556a05b9cf2c4f`.
Its source/protocol/prompt are pinned to the corrected artifact. Both earlier
registrations remain unchanged, including the first held attempt with no
new-version requests/orders. Independent 24-hour/15-second read-only observer
`scalper-smc-observer-351-r2.service` is active. The earlier observers retain their
original identities and can record version mismatch after cutover.

Original pause=false was restored via the authenticated audited control at
05:14:17.801425 UTC (13:14:17 Singapore), after the future window opened and
deployed validation passed. Automatic analysis is enabled, emergency stop false,
mode demo; real-money live remains disabled. At resume the account-wide historical
loss-streak wait still blocks new risk until 05:23:54.458 UTC. It was not reset.
No cycle, provider call or broker command was manually forced. Subsequent natural
requests/orders/outcomes belong to their actual journal clocks, not the rollout
smoke. No profitability or successful provider receipt is inferred from validation.

Final receipt-only diff receives formatting, staged review, secret scanning and
both hosted qualification checks before auto-merge; source qualification remains
`a0dc3210ef2c7c05f216c121648bfb5f6ab40df274d3f2ac51271737b194349c`.

At 05:19:52 UTC the existing observational watchdog also reported
`AUTOMATIC_ANALYSIS_STALLED`: its input has no loss-cooldown field, so the valid
one-hour gate can produce an inactivity warning after five minutes. Scheduler
admission does not consume that warning. [#353](https://github.com/AegisFintech/scalping-bot/issues/353)
tracks the separate reporting correction; this activation does not alter a
watchdog threshold, reset the loss wait or fabricate progress.
