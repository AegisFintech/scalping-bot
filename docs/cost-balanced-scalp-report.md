# Cost-balanced scalping DEMO candidate — ISSUE-498

The operator approved implementing the proposed payoff redesign after the
[complete loss audit](loss496-review.md). This is controlled demo evaluation,
not an independently profitable strategy. It does not increase risk or promise
more trades/wins. The narrower entry range is a separate read-only study #499.

## Contract and scope

New source `0.9.0-cost-balanced.1-codex.1`, policy `0.9.0-cost-balanced.1`, prompt
`entry-scalp-v2`, requests1.14(subscription)/1.15(API), receipts1.6/1.7/1.8(fallback),
provider schema1.1 and risk-report schema2.1 are additive. Historical prompts,
schema files, migration checksums and registrations remain unchanged.
The `entry-scalp-1.0` wire plan is unchanged: its geometry limits are now explicitly
selected by immutable strategy version in provider binding, HTTP verification,
context reuse and database guards. Defaults in historical parser entry points keep
0.8's0.40 ceiling and0.0571428571 gross reward/risk. New geometry cannot authorize
an old release, and a legacy provider context cannot authorize the new release.

The flow stays completed M1/M5/M15, local SMC/DOM/account/cost evidence → model
BUY/SELL/WAIT → deterministic validation and dynamic sizing → one trend-direction
STOP_LIMIT/GTD → native broker protection → reconciliation → repeat. Model selects
prices, never order size or execution authority. No local green-P/L market close.

The forced0.40 target is removed for the new policy. Model-selected target and
stop each retain a finite7.00 price-unit ceiling; these are operational bounds,
not preferred distances or an intended holding time. Prompt requests the nearest
credible structural continuation target/stop for short-term scalping. Gross
reward/risk must be at least1 and modeled net reward must cover modeled net loss.
A distant target or arbitrary tighter stop must not be manufactured to pass.
WAIT remains valid. Targets may be farther and opportunities less frequent.

## Deterministic economics

Use Decimal throughout. Let `E` be requested entry, `T=abs(TP-E)`, `S=abs(SL-E)`,
`V` candidate broker volume, `P=tickValue*V/tickSize`, and `R=65*tickSize`.
The existing30-tick entry range remains. Both outcomes use the high price bound
`B=E+30*tickSize+T+S+R`, round-trip commission `2*oneWayCommission(metadata,B,V)`
including broker minima/FX, and `C=commission/P`. With conversion fraction `f`:

```text
modeled net target reward = T*(1-f) - C - R
modeled net stop loss     = S*(1+f) + C + R
admit only when both are positive and reward >= loss
```

The conservative65-tick adverse-exit reserve applies to both outcomes. It reuses
the existing stop-risk reserve; it is not a validated execution tail bound or a
realized-loss guarantee. Entry slippage changes commissions at the bound; native
protection remains fill-relative, so it is not added again as stop distance.
Executable bid/ask spread is not deducted twice. Unknown future swap/financing and
counterfactual closing proceeds remain unknown.

Minimum-volume admission and actual-sized-volume checks use the same broker cost
primitives. The final existing pre-placement metadata/volume recheck also applies
the new rule. Invalid/missing costs, conversion, precision, affordability or quantity
state reject; code does not widen/reprice geometry, round volume up or rescue an
unaffordable minimum by choosing larger lots. Model context receives the same
conservative commission plus65-tick reserve estimate at minimum volume, bounded
with maximum permitted geometry. Independent actual-volume validation is authority.

The latest audited0.8 loss was not a protection-distance bug: verified fill-relative
TP/SL were0.40/1.41, with no positive retained bid mark. This new contract is a
hypothesis about better payoff admission, not proof that it would save that trade.
No historical fill is retrospectively relabelled as a new candidate's result.

## Risk, lifetime and compatibility

Keep the existing5% shared demo setup ceiling and at-most2.5% former-leg allocation
for the single order. Current equity, costs, margin, volume steps and minimum
quantity still determine size; tighter stops can change affordable quantity, but
there is no lot multiplier or risk increase. Other modes retain their existing
policy and live execution remains disabled by default. Do not reset accounting,
capital high-water/daily history, dispatch claims, cooldowns or unresolved states.

Pending lifetime remains60–300seconds from capture, including inference latency.
A filled position does not expire with its entry order. No automatic holding-time
market close is added. Native protection, missing-SL recovery, manual/partial-close
handling, broker/session freshness, exact ownership and idempotency remain.

Migration0039 adds version-bound new guard branches before the unchanged0036
historical branches. The new group requires matching0.9 source analysis and a
retained provider artifact version `entry-scalp-v2`. The new order requires exact
side, prices, lifetime, ownership, finite geometry and gross reward/risk. Net-cost
checks remain independent in application admission. No history/backfill/reset or
accepted-order repricing occurs. Historical source/candidate/oracle files stay pinned.

## Evaluation and rollout

Software checks establish contract behavior, not economic improvement. Before
activation, retain the reviewed source, exact runtime/qualification, populated
configuration and scoped selection receipts. Deploy matching execution, AI,
provider and dashboard source on the ONE existing demo; preserve old orders and
requests, drain normal in-flight inference, and never replay an unknown request.
Broker-held orders/protection survive normal process maintenance. Flight must
observe the matching new release without rewriting original recordings.

Register fresh prospective collection after source freeze, before its start.
Review all new-release intents and fills: net after actual signed costs, positive/
negative/flat/open/partial/unfilled counts, payoff distribution, holding times,
actual price differences, original protection/ACK coverage, gaps and unavailable
counterfactuals. Initial operational review after24hours or20 new closed trades
is a diagnostic checkpoint, not qualification or automatic promotion. A future
collection batch, source change or economic claim needs its own explicit record.
Existing0.8 frozen studies may halt on source/release drift; never edit their pins.

Rollback retains migration0039 and all evidence. Restore older execution/worker
only after every newer group/command is terminal with exact independent broker
proof, through an audited scoped selection transition. Never downgrade/reset DB,
move old prices or erase unknowns. Actual qualification, reviewed delivery and
activation readbacks are recorded on https://github.com/AegisFintech/scalping-bot/issues/498.

## Final source qualification

Full `PYTHONDONTWRITEBYTECODE=1 node scripts/qualify.mjs` passes all required
format/lint/type/build/schema/migration/replay/fail-closed, database lifecycle,
secret and npm/Python dependency-audit gates:1,285 Node +157 PostgreSQL +1,215 Python
=2,657 tests. Both sample/deployed policy and startup checks pass; populated file
bytes remain unchanged. [Source validation](evidence/cost-balanced-scalp-validation.json).
Independent Standards and Spec reviews have no remaining P1/P2.

Review found a real non-USD minimum-commission boundary: a repeating Decimal cost
was too long for Python's10-decimal Price input. Model context now rounds UP to10
places; actual admission retains full precision. A realistic EUR-minimum fixture
passes the actual TypeScript-to-Python request boundary. Tests also distinguish
minimum-volume rejection from actual-volume affordability without increasing size
to rescue the minimum. Both release lifecycles run through the same database suite.

Earlier checks are retained, not qualification successes: the first migration
probe caught a wrong prompt-artifact join column; initial current factory fixtures
still used historical receipt versions/geometry; the first full run found two stale
migration/observer expectations, and the second stopped at dashboard Python indent
formatting. Those were corrected before the final unchanged-source full pass.
The temporary pyright invocation was inapplicable; the required111-file mypy check
passes. One existing upstream Starlette/httpx deprecation warning remains.
Actual reviewed merge, prospective registration, activation and readbacks are
recorded on the issue; software qualification alone does not establish returns.
