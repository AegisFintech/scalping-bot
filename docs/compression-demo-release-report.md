# ISSUE-358 — Explicit compression scalp demo trial

Issue: <https://github.com/AegisFintech/scalping-bot/issues/358>.
The operator explicitly requested deployment and fresh monitoring after the
research-only #354/#357 delivery. This is separate DEMO experiment authority,
not automatic research promotion, profitability qualification or real-money live
activation. Source is `0.4.2-compression-scalp.1-codex.1`, policy
`0.4.2-compression-scalp.1`. Activation receipts follow below once verified.

## Actual change

The frozen scanner remains `scalp-candidates-1.0`; its historical source,
thresholds and research HOLD/no-authority report are preserved. A new explicit
Node demo adopter calls `/v1/scalp-scan` on loopback analytics over typed JSON.
It validates request/report schemas, two-second HTTP deadline, 128 KB response
bound, exact raw-request SHA-256 response binding and snapshot time. Python
recomputes causal context from the full saved snapshot; arbitrary externally
supplied derived evidence cannot authorize this path. Schemas 1.0/1.1 remain
unchanged; risk-policy 1.2 adds the new release identity and retains demo-only
loss-enforcement reporting. No SQL migration or environment setting is added.

A fresh pre-provider pair check withholds preparation/dispatch when no eligible
compression pair exists. It does not clear request cooldowns, consume a map,
force inference, retire accepted orders or set a global pause. Every such check
is journaled with explicit scanner status/reasons. Directional pullback/reclaim
signals remain observations; neither a single order nor a fabricated opposing
leg is submitted. No fallback to the previous breakout economics is permitted.

After Codex returns, another fresh execution snapshot is scanned. Only a BUY
and SELL COMPRESSION_BREAKOUT / STOP_LIMIT pair may proceed. Original model
entries remain unchanged. BUY must be at or above its structural boundary,
SELL at or below, and neither may be more than 0.25 M1 ATR farther outward.
Otherwise SCALP_CODEX_STRUCTURE_MISMATCH withholds placement. This is a new
explicit strategy filter, not a prompt-only improvement or a hidden transform.
Prompt v6, exact provider journal and worker transport 1.2 remain unchanged.
The existing qualified isolated worker and original subscription sign-in are
reused only after prompt/code/dependency contract equality checks.

Structural opposite-box invalidation replaces 2.5-ATR stops. Each leg's intended
reward equals its stop distance, rounded upward to whole broker pips for the TP;
therefore intended gross reward/risk is at least 1. Broker fill-relative native
protection, actual costs and slippage can change realized geometry. The model's
non-authoritative two-price scaffolding retains 0.1 minimum proposal validation;
adopted effective SL/TP must pass the new minimum 1 ratio independently at both
decision and late placement. No model-selected risk or volume is introduced.

The scanner's fixed admission/cost/ATR/geometry thresholds remain as documented
in [#354](fast-scalping-candidate-report.md). Modeled per-unit cost reserves both
minimum-volume commissions at ask plus three ATR, 95 ticks of execution reserve,
and conversion cost at 1.5 ATR; the scanner independently adds spread. Commission
floor, tick value and conversion metadata must be supported. Minimum-volume
floors over-reserve per-unit cost at greater quantities; final exact-volume
commission/margin/dynamic risk checks still govern. Unsupported/missing evidence
or RPC failure withholds trading, never substitutes zero costs. Exact realized
costs are recorded separately; counterfactual net remains unknown.

## Preserved controls and economic limits

Shared setup risk stays at most 1% reconciled current equity across both race-
exposed legs, dynamically constrained by costs, margin and volume increments.
STOP_LIMIT/GTC/OCO, 30-point entry range and 65-point modeled adverse reserve,
fill monitoring, native SL/TP, maintenance, ownership, fresh/session/account
checks, uncertainty recovery and durable idempotency remain. Existing three-loss
60-minute cooldown and all daily/capital history span release changes unchanged.
The demo-only daily/high-water enforcement policy is unchanged; real-money live
remains disabled. No local quote trailing/profit close/time exit is activated.

Admission expiry is for new intent only; it never cancels accepted GTC orders.
Pre-provider and post-model checks are not atomic with provider/broker receipt;
existing late authorization, freshness and unknown-outcome rules still apply.
Research reports retain no authority; only this reviewed mode/version-bound
adopter can supply proposals to the existing deterministic risk/coordinator.

This may REDUCE frequency: strict opposite-side OCO currently supports only
compression, and fixed spread/cost thresholds can reject most snapshots. No
threshold will be relaxed or trade forced to claim high frequency. No win-rate,
second-long holding-time or profitability claim follows unit tests or activation.
#355/#356 are still unqualified separate research. Scanner input digests and
candidate reports are journaled; no new full-tick feed, exact counterfactual cost
reconstruction or independent economic qualification is asserted.

## Rollout and fresh monitoring contract

The existing demo has an audited new-analysis hold while qualification proceeds.
Accepted GTC orders and independent protection/reconciliation keep operating.
Before cutover, require no requesting context and certain broker/account/order
reconciliation. A known accepted GTC group can survive the existing normal
restart path: preserve its original version, entries, protection intent, quantity
and broker identity; the new release must remain blocked by that group. An
uncertain/partially reconciled cycle blocks rollout; never cancel a peer merely
to force a switch. Account/symbol recovery spans strategy versions and retains
original trade attribution. Freeze financial state while held, verify existing
migration checksums and protected environment hash, and keep the same database
and runtime. No baseline/cooldown/history reset or old database activation.

Build an immutable artifact from clean committed source and matching complete
qualification. Verify hosted checks before deploying. Preserve the existing
worker/auth if its unchanged contracts match. Roll out dependencies first while
old protection runs; execution switches only after certain existing-order evidence. Reconcile the
new identity while held, verify all process paths, health and unchanged financial
values/credentials, then restore the original authorized pause state.

Freeze an exclusive new prospective 30-calendar-day observation registration
before resuming. Preserve #334/#338/#351 and every prior registration/report.
Store code/prompt/protocol digests, actual UTC bounds and daily/final cutoffs.
Retain rejection/no-pair/nonfill/failed/open/partial/OCO/gap cases, unknown costs
and cutoff censoring. Thirty days is collection, not qualification. Source drift
halts observer interpretation only, never trading authority. A separate bounded
read-only seven-day operational observer follows the exact new release; trading
and broker journals remain the complete source for subsequent all-cohort review.
A short no-pair observation or mere process health is not a verified order/fill.

Rollback preserves current database/accounting and accepted GTC/protection.
Restore the prior immutable code only after exact active-cycle recovery and
reconciliation; never replay old requests or silently clear a loss wait. If a
safe terminal cutover cannot be established, preserve the current protected
cycle and report the blocker instead of forcing a deployment.

## Validation

Focused tests cover unchanged model entries, structural exits through risk and
placement, pre-provider no-pair/no inference, post-model mismatch/no placement,
missing/expired/future/wrong-side/wrong-family/unaligned/unaffordable evidence,
loopback enforcement and HTTP request/clock binding, and strict HTTP body
validation. Full qualification and rollout results are appended after execution.

## Completed source qualification

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed on source
`d30ebcba778e172b8bbf8d56bb05cd1623c7a35006813762abefc011cb3c16d8`:
992 Node / 94 isolated PostgreSQL / 405 Python tests, all 1,491 passed. Prettier,
ESLint, TypeScript/noEmit and isolated build, Ruff format/lint, mypy,
JSON Schema/migration/fail-closed suites, secret scan and npm/pip dependency audits
all passed. Private receipt: `/tmp/scalper-qualification-AKRPGL/checks/results.json`.
The earlier qualification caught asynchronous test-mock lint/type issues; those
were corrected before this complete passing run. Only existing Starlette/httpx
deprecation remains; no skipped database qualification or failed audit accepted.

Protected policy and `--startup` checks and `.env.sample --startup` all pass,
with 16 normal keys / 19 protected assignments unchanged. The saved actual broker
snapshot passed the complete typed Node HTTP -> Python scanner -> request-bound
response path and returned NO_PAIR, with no provider/broker calls. Synthetic
positive placement and all negative gates are tested; no actual fill is inferred.
`graphify update .` completed AST-only with 6,689 nodes / 12,641 edges and known
pyproject/community-label warnings, no API cost. Historical risk schemas remain
unchanged; new risk-policy 1.2 is separate. No SQL migration was required.

Final tracked/staged review, secret scan, clean coherent commit/push and hosted
head qualification precede rollout. Operational activation/monitoring receipts
are appended separately; this source qualification does not assert deployment.
