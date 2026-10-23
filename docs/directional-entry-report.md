# ISSUE-368 — Directional Codex trend-continuation entry

Issue: <https://github.com/AegisFintech/scalping-bot/issues/368>.
The operator approved the staged plan: review trades, replace opposing breakout
entries with one Codex-selected continuation side, preserve risk/protection, then
propose fast-exit parameters separately before changing exits. Delivery includes
qualified main deployed to the one existing demo account. No extra trading bot,
reversal/martingale, forced trade, history reset or real-money authority is added.

## Frozen baseline and what remains unknown

[Sanitized review](evidence/directional-baseline-review.json) covers all available
closed demo outcomes from v8 deployment, **22 October 09:11:34 UTC through
23 October 01:47:19.841168 UTC**, not an optimized winning subset or equity return.
There are **33 closed trades: 13 wins / 20 losses**, gross **−$2,422.77**, signed
fees **−$785.55**, net **−$3,208.32** (fees already included). LONG: 16 / −$3,079.74;
SHORT: 17 / −$128.58. Mean win $299.43 versus mean loss −$355.04. Median holding
405.967 seconds; range 60.699–1,245.542 seconds. Provider context availability:
246 calls / 2 failures, median 8.4074365 seconds, maximum 70.564750 seconds among
available results. Largest observed adverse entry displacement was $0.28 in price.
These counts do not establish that every long was countertrend or short was sound.

No retained broker quote tape or matching price-path table was located for this
cohort. Exact MFE/MAE, time spent net-positive and hypothetical rapid exits remain
unavailable; completed OHLC cannot prove executable second-long exits. Open and
pending paths are outside this closed-outcome statistic, not absent/flat. The
legacy cost-payoff CLI deliberately accepts only its historical fade releases;
this review used separately bounded repeatable read-only SQL rather than relaxing
that research contract. No closed outcomes, fees, account state or old reports
were rewritten. Losses before fees and asymmetric observed wins/losses justify
measurement and a controlled experiment, not a profitability/polarity conclusion.

## Directional contract and authority

Strategy `0.5.0-directional-scalp.1-codex.1`, policy `0.5.0-directional-scalp.1`,
provider `entry-direction-v1`, request 1.5 / response 1.2, stored
`entry-direction-1.0`. The requested Codex model remains `gpt-6.1-sol`; no model
or provider fallback, price feed change or new credential is introduced.

Codex evaluates established M15/M5 price structure and displacement, then a nearby
completed-M1 continuation range. It selects BUY, SELL or WAIT with a short reason.
Indicators/SMC/FVG/DOM/costs inform judgment without a deterministic pre-inference
ATR/scanner/trend threshold. A model can still misread trend or reject a valid
opportunity; the prompt is not independently proven accuracy. Both returned
breakout boundaries describe box geometry. Only selected `entry_side` has order
authority; no opposing executable leg is invented or placed. A crossed unselected
reference does not veto the selected entry. Fresh selected-side quote/distance,
precision, provenance and pre-placement checks still withhold a crossed or invalid
selected entry without shifting/chasing it. The existing once-only never-submitted
replacement, WAIT 60-second/new-M1 successor and failure/unknown cooldowns remain.

The internal historical model-response 2.1 projection contains two geometry
references for shared validation/exit calculations. New directional tags and
`entrySide` bind the actual selection; neither the unused projection nor its
historical method name grants a second command. Durable provider raw text, prompt,
context, decision market, selected risk and actual broker lifecycle stay separate.
The dashboard explicitly labels the chosen breakout and opposite range reference.

Strict schema/enum/null validation follows the existing isolated app-server path;
[official structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs)
informs the schema boundary, not economic validity. Historical v7/v8/schema/worker
contracts remain intact. The new prompt/model/day pin starts its own persistent
native thread without deleting old memory; compaction and bounded no-tool turns,
unknown-cost/null identities, dispatch claims and all transport deadlines remain.

## Deterministic risk and lifecycle

Only the demo gateway implements single-entry dispatch. Paper/shadow/live adapters
without that explicit method reject the new path. Live remains disabled. Dynamic
sizing uses the existing **half-setup allocation, at most 0.5% current equity**,
inside the unchanged **1% setup ceiling**. Removing the peer never doubles size.
Fee/slippage reserves, broker steps, exact-volume/tier margin confirmation, one
setup loss reserved in free margin, account-wide exposure and late cap rereads
remain. Approved budgets are not actual stop risk or guaranteed maximum losses.

The native stop remains beyond the opposite box reference plus one tick, rounded
inward to broker pips; gross TP equals stop distance. No smaller TP, break-even,
trailing, time exit or sampled-green market close is implemented. Existing native
repair/missing-SL recovery and manual-close reconciliation remain independent of
inference. Accepted GTC can outlive the original trend judgment; this release adds
no timer expiry or structural pending-order cancellation. That limitation requires
separate evidence and review, not an unannounced override of the GTC contract.

Migration 0032 adds nullable, immutable `order_groups.entry_side`. NULL retains the
historical two-entry contract; BUY/SELL requires the matching READY, scoped
`entry-direction-1.0` context and exactly one owned STOP_LIMIT/GTC order at its
selected original price. Deferred cardinality checks reject missing/extra orders;
side/level/group mutations reject. No synthetic rejected/cancelled peer is stored.
A true single group and a legacy pair missing a peer remain different states.

Callback-before-ack, partial/unknown placement, restart, GTC cancellation and
idempotency retain existing safety semantics. No rejected/unknown command is
resent. Terminal history checks explicitly use the durable expected cardinality,
exact fill/closing/cost/ownership evidence and all native protective-child proof.
Legacy groups still require two terminal entry proofs. Zero-fill cancellation
requires the exact recorded terminal order(s), no fill/position/trade and no
unresolved ambiguity; flatness or elapsed time alone never releases risk.

## Prospective price-path evidence and separate exits

`python.research.trade_paths` is a credential-free, read-only observer of loopback
status/quotes and bounded broker P/L observations. It never calls a provider,
places/cancels orders, changes controls, writes SQL or promotes strategy. Current
runtime release is distinct from unknown position-origin release; future analysis
must join exact scoped fill/position evidence before attributing an old surviving
position to a new cohort. Quote source/receipt/check clocks remain distinct from
broker P/L clocks. A changed position identity censors P/L. Broker net unrealized
excludes unknown future closing costs; those and counterfactual net remain null.

Freeze a new future registration, candidate/source/observer hashes and daily/final
cutoffs before activation. Initial collection is bounded to seven days of sampled
paths within a 30-calendar-day observation cohort, not qualification. One-second
quote sampling / every-fifth-sample P/L is not a complete tick tape. Keep unavailable,
stale/gap, flat, open, failed and source-change observations; do not retain only
winning or completed paths. Exclusive hourly JSONL segments have per-row checksum
chains and no overwrite; each run has its own chain. Bounds: 32 MiB per segment,
512 MiB total, 2 GiB / 15% disk reserve and no automatic deletion. Source drift or
storage failure stops research only. No redundant trading service is introduced.

[Exact exit candidates for operator review](directional-exit-proposal.md) specify
separate 0.10-SL net objective / 1.5-fee coverage and 0.10/0.05/0.02-SL
arm/giveback/floor hypotheses. Neither is implemented or promoted.
Issue #356 remains the separate exit research boundary: use prospective executable
path coverage, all-cohort censoring, fee/latency stress and null unknown economics
before proposing exact smaller native-TP and profit-protection parameters to the
operator. No automatic promotion, optimal target or expected profit is claimed.

## Validation and operational delivery

Targeted positive/failure tests cover strict BUY/SELL/WAIT and old/new worker
mismatch; selected-only price checks, one-side sizing, affordability, early-fill
callbacks, unknown-command no-replay, exact restart ownership, late risk reductions,
selected-only coordinator dispatch, and prospective observer gaps/source/identity.
The disposable PostgreSQL suite includes all legacy cases plus both directional
sides with closing/repair event permutations and single-cardinality/mutation
rejections. A legacy missing peer still fails terminal proof. Early fixture model
identity, migration-list and historical error-code expectations were corrected;
existing failure semantics were preserved. Frozen `npm run qualify` passed every
format/lint/type/build/schema/migration/replay/fail-closed, secret and dependency-audit
gate: 1,052 Node + 106 isolated PostgreSQL + 434 Python tests (1,592 total).
[Sanitized validation receipt](evidence/directional-entry-validation.json) records
the exact source/runtime fingerprints. Both sample policy/startup configuration
checks pass. Hosted exact-head checks are required before merge; activation
receipts follow in issue #368 before handoff.

No dependencies, credentials, normal environment keys or unused services are
changed. Historical prompts/schemas, legacy OCO recovery, research fixtures and
immutable rollback artifacts remain necessary references, not unused copies.
Graphify refresh is AST-only; document semantics are not freshly extracted.

Rollout uses matching artifacts from clean merged main, additive migration through
the existing local PostgreSQL administrator (no app-role privilege grant), a brief
analysis hold and complete certain broker reconciliation. Preserve accepted old
GTC/protection and all newer accounting/context/request records. Verify matching
worker, five supervisor paths, fresh-data contract smoke and native automation;
never force an inference/order to prove deployment. If an old active cycle is
present, retain its exact ownership/volume/entry/protection and verify continuity
or full natural terminal evidence, never cancel it just to cut over.

Rollback retains migration 0032/data/history and requires every new single group
fully terminal/proven before restoring older pair-only application/worker code.
Do not downgrade SQL, replay old requests or reset loss/baseline state. Native
protection stays active during any reviewed hold. This source checkpoint is not
an activation or economic-success claim; subsequent sanitized issue receipts
record actual timing, state and natural decisions.
