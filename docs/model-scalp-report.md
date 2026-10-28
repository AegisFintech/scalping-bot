# ISSUE-394 — Model-defined directional scalping

Parent [#391](https://github.com/AegisFintech/scalping-bot/issues/391); follows
qualified evidence repair #392/PR #395 and refactor #393/PR #396.
This is a controlled DEMO strategy release, not economic qualification or a
profitability claim. Scalping remains the core.

## New authority

Source `0.8.0-model-scalp.1-codex.1`, policy `0.8.0-model-scalp.1` uses one selected
trend-direction STOP_LIMIT/GTD entry. Prompt `entry-scalp-v1`, request1.12,
response1.3, local execution `entry-scalp-execution-v1`, context
`entry-scalp-1.0` and risk schema2.0 are additive. Prior contracts stay immutable.

Codex returns BUY/SELL/WAIT, one entry, TP, SL and integer pending lifetime60–300s.
Completed M15/M5/M1, causal SMC level map, broker-only DOM, supplied broker pip/tick,
cost context, actual affordable stop bound, broker protection minimum and execution
boundaries inform it. Model reasoning describes
anchors; code never assumes an indicator or a round number predicts a fill.
The subscription thread is prompt/day pinned; memory is not training.

Deterministic code validates positive tick-grid prices, direction, whole broker
pips for native protection, broker minimum distances, fees/conversion, margin and
current reconciled equity. It never moves an entry, replaces model exits, widens
protection or increases size to make a proposal fit. Gross TP distance is at most
0.40 price units, SL at most7.00 and reward/risk at least0.0571428571. The model
chooses smaller valid distances when suitable. Both minimum and actual volume must
cover modeled costs plus the existing five-tick exit allowance and modeled0.08
broker-pip net objective. That allowance is not a validated execution tail bound.

The unchanged demo setup ceiling is5%; the single order retains the former leg's
at-most2.5% ceiling. Deleting the peer never doubles size. Quantity remains dynamic
with costs, margin/volume steps and the65-tick stop-risk reserve. The entry limit
range remains30ticks. Actual losses can exceed modeled reserves. Native protection
uses approved distances from actual fill, so final absolute TP/SL can differ from
the model's reference prices. No local sampled-profit market close is introduced.

## Lifetime and races

Expiry starts at captured_at, so inference consumes it. The READY context's durable
validity narrows to that exact time. New plans need at least five seconds remaining
for admission; all later deadline/session/quote/account checks still apply.
Historical plans keep their65-second admission reserve and five-minute context.

The broker must acknowledge the exact GTD deadline. Missing or changed pending
lifetime is uncertain, never silently converted to GTC. An already-filled receipt
is still recorded and protected. Native expiry/cancellation releases a fresh
analysis only after the exact owned terminal event, zero fills, no positions/trades
and no unresolved evidence, with one durable parent claim across concurrent
processes/restarts. Native expiry with no local cancellation reason uses its
explicit mapped ORDER_EXPIRED evidence. Time passing or broker flatness alone is
insufficient. Partial fills remain protected and prevent replacement.

Expiry applies to unfilled entry only. Filled positions never close because that
timer elapsed; independent native protection, missing-SL recovery, manual closes,
reconciliation, session gates and failed/unknown provider cooldowns remain.

## Compact integration and compatibility

The existing internal response envelope is retained. Its second reference is the
model's invalidation, not another entry or a holding box; selected-side validation,
risk, immutable database cardinality and dispatch admit exactly one order. Flight
context1.1 and dashboard label entry/SL/TP distinctly instead of displaying the
invalidation as an opposite breakout. Budget display recognizes the new policy
and remains a ceiling, not measured stop loss. The unused API-constructor fallback
was removed after confirming the sole caller explicitly supplies Codex; no API
fallback, new dependency, configuration knob, broker or scheduler is added.

Migration0036 preserves historical group/order guards and only adds the new scoped
single/GTD branch. It narrows the new context lifetime while retaining old checks;
no row is backfilled or rewritten. A READY context and matching current scoped
selection revision are required. Old accepted GTC/OCO groups keep original mode,
revision, orders, prices, native protection and lifetime, even after selector CAS.

## Delivery, activation and rollback

Full qualification and independent Standards/Spec review precede delivery. Activation
requires a matching application, worker/prompt and migration on the ONE existing
demo deployment, plus audited scoped selection CAS. Never overwrite selection on
startup, cancel/reprice an old group to accelerate the switch, or reuse an old
prompt's map. Preserve worker512MiB file cap, isolation, state and authentication.

Keep the Flight recorder as a separate SELECT-only observer with matching source.
Existing frozen registrations/reports are never edited; source/release drift halts
research only. A two-entry study is not silently repurposed to rank single-entry
outcomes. Continuous recording does not grant strategy promotion authority.

Rollback retains migration0036 and all new evidence. Wait for every newer group
and command to be terminal with exact proof before restoring older source/worker
and its audited scoped selection. Never downgrade the database or reset accounting.
Broker-side explanation of the historical missed TP remains #388, independent of
this release. No broker/support message has been sent.

## Verification

Targeted tests cover geometry/WAIT/injected authority, both directions, exact
expiry/protection derivation, actual-volume costs, dynamic former-leg sizing,
native GTD acknowledgement, worker schema/receipt/no replay, short-lived admission,
dashboard budget/levels, Flight labels, native expiry callback→one refresh,
partial-fill→expiry withholding and old GTC/OCO preservation after selector CAS.
Full qualification commands/results and activation receipt follow before handoff.

## Final source qualification

`PYTHONDONTWRITEBYTECODE=1 /opt/scalper-node22/bin/node scripts/qualify.mjs`
passed all required checks:1,152 Node +132 PostgreSQL +557 Python tests (1,841),
format/lint/types/build, schema/migration/lifecycle/replay/fail-closed coverage,
secret scan and npm/Python dependency audits. Exact sanitized results:
[validation](evidence/model-scalp-validation.json). Private logs:
`/tmp/scalper-qualification-VA5IiI/checks/results.json`.
Sample and populated-file policy/`--startup` checks also passed; credentials and
populated environment bytes are unchanged. PM2 still used its previous artifact
at source qualification. Independent Standards and Spec reviewers found no
remaining blocker. Graphify and staged secret scanning precede delivery.

Earlier exploratory runs are not full qualification: database tests first found
fixture parameter casts and the new migration-list expectation; subsequent tests
caught typing/lint issues, a frozen-reference formatting expectation, the factory
receipt fixture and the HTTP bridge's old parser. Independent review additionally
caught the native-first expiry reason, the65-second admission reserve and dashboard
allowlists; all have regressions. A run was interrupted to add the real affordability
bound to model input. Final qualification used the corrected source. One upstream
Starlette/httpx deprecation warning remains. No live trial-and-error or order/provider
forcing was used for these checks.

The prior470-line README is archived in `docs/readme-history.md` with relative links
adjusted; its original SHA-256 was
`422a8c4665141ed475ef619c273248869453974d5d9995984e2842dd27bf384f`.
The front README and current agent contract now describe this single scalping flow.
