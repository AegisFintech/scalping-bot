# ISSUE-076 — Fixed percentage money management

Date: 2026-09-07. Issue: [#182](https://github.com/AegisFintech/scalping-bot/issues/182).
Pull request: [#183](https://github.com/AegisFintech/scalping-bot/pull/183).
Implementation checkpoint: `302f23b` (committed and pushed).
Branch: `issue-076-fixed-percentage-risk`. Source: `0.2.2-fixed-risk.3`.
Policy: `fixed-risk-v2`. This policy change is explicitly authorized by the operator;
it does not establish a trading edge or increase measured strategy accuracy.

## Implemented policy

- Remove the absolute `ACCOUNT_EQUITY_FLOOR` admission requirement. Any positive,
  reconciled equity can be evaluated; broker minimum volume and costs can still
  make a trade unaffordable. Legacy floor values are ignored and stripped from
  the resolved environment; configuration checks identify the obsolete key.
- Hard-code a **1% current-equity ceiling per setup** and a **5% UTC daily loss
  budget**. Both pending OCO legs share the setup budget, at most half each, because
  cancellation is not atomic and both can fill. It is not 1% independently per leg.
- Use the existing Decimal cost-inclusive sizing, broker volume increments, currency
  conversion, margin estimates and notional cap. Preserve the existing 1% margin
  ceiling and local $5,500 per-position notional authorization. Those constraints
  can result in substantially less than 1% actual modeled risk; the engine does
  not increase leverage or force volume to meet a target percentage.
- Include unrealized losses in daily accounting, adjust for deposits/withdrawals,
  and cap the next combined setup by remaining daily capacity. At 4.9% loss, at
  most the remaining 0.1% of the daily baseline is available. Daily locks survive
  restart and policy changes. A concurrent reconciler's persisted lock now takes
  precedence over a prior unlocked read when returning an admission budget.
- Preserve the 5% flow-adjusted high-water drawdown lock. Risk halves at 2%
  drawdown or 2.5% daily loss; it quarters at 4% drawdown or 3.75% daily loss.
  A nonlocked reduction recovers only below both 1% drawdown and 1.25% daily loss.
  Daily thresholds represent 50%, 75% and 25% of the new daily budget. No model
  can change the limits or reset accounting. No averaging down or loss chasing.
- Dashboard budgets use the policy reported by the execution service, replacing
  the previous duplicated 0.001%/1% arithmetic. Missing/invalid policy or stale
  observations show unavailable; a persisted daily lock shows zero capacity.
  The obsolete minimum-equity message is removed. Background refresh is retained.

The former setup ceiling was 0.001%, so this is a 1,000-fold increase in the
permitted percentage, not evidence of 1,000-fold better performance. The daily
ceiling changes from 1% to 5%. Stops and modeled slippage reserves cannot guarantee
these as absolute realized-loss limits during gaps or adverse execution.

The separate historical directional replay explicitly retains its original
0.001% setup ceiling and fixture capital assumptions. Its original evidence is
not silently repriced by changing the production policy. It still reuses the same
sizing engine and has no broker authority; new production risk cases are tested
separately under 1%/5%.

cTrader exposes native minimum/maximum/step volume and expected margin, which
remain authoritative for this broker's XAUUSD sizing. Its execution events include
partial fills and rejection; neither fixed percentages nor AI remove those outcomes.
[Official model definitions](https://help.ctrader.com/open-api/model-messages/).
cTrader also describes risk-volume estimates as dependent on market movement.
[Official sizing reference](https://help.ctrader.com/ctrader-algo/references/MarketData/Symbols/Symbol/).

The first automatic map also exposed a local adapter bug: rich performance
context included sample-size/decay diagnostic fields, which were copied into the
strict order schema. The final `.3` projects only applied/confidence-delta/reason
codes, retains the original diagnostics in the source context, and still rejects
invalid adjustment values. Schema and semantic validation are unchanged. A
regression test covers the production context shape and malformed values.

## Configuration and migration

Normal template: **22 → 21** entries; actual populated environment: **26 → 25**.
Compared with the original 176 entries, the normal template is 88.1% smaller.
Only the `ACCOUNT_EQUITY_FLOOR` assignment was removed from the populated file.
All credentials, endpoints, exact model pin, trading authorization and remaining
values were verified unchanged. A mode-0600 backup and atomic replacement preserve
permissions. No risk-percentage environment knobs were added.

`config:check -- .env --startup` now passes without an account floor. Nonempty
legacy percentage overrides that conflict with the fixed policy still fail with
key-only actionable errors; remove reviewed overrides rather than tuning them.
The normal sample remains paper/stopped/automation-off. Live submission remains
structurally disabled. The current EPRToken model pin remains `gpt-6-astra/u64`;
this change does not alter the already verified provider request path.

No SQL migration or accounting reset is required. Apply the release through the
existing supervisor after a paused preflight; recreate processes to discard cached
policy overrides. Verify current equity/flows, daily baseline, locks, broker
reconciliation and runtime policy before restoring existing demo authorization.
An existing daily or drawdown lock remains a blocker even when its old threshold
was smaller; this release does not retroactively unlock it.

Rollback: pause and reconcile first, restore the reviewed previous code and
protected environment through the supervisor, and retain all daily/capital/context
journals. The previous release again requires its former absolute floor for enabled
demo startup; do not restore a blank floor and claim successful activation. Do not
reset high-water marks or resurrect consumed/expired plans. Existing uncommitted
screenshot deletions are unrelated user work and are not included in this change.

## Validation and rollout

The first activation attempt exposed a pre-existing identity bug: the mutable
scheduler-enabled flag was included in the immutable strategy configuration hash.
The database correctly rejected activation under the already registered stopped
release. Execution was returned to the stopped configuration while the bug was fixed.
Revision `.2` separated the hashes; the final `.3` keeps the scheduler flag in the full safety/control audit hash but
excludes it from the strategy-definition hash. Risk, notional, mode, account and
strategy parameters remain bound; changed economics under the same version still
fail immutability checks. No database row or historical hash was rewritten.
Unit and configured database tests exercise stopped-to-enabled registration and
rejection when the notional policy changes under the same strategy version.

All **22 required release commands passed after corrections** on Node 22.23.2: **421 Node tests** in
59 files, **118 Python tests**, 22 JSON Schema tests, three migration tests and all
three configured database/analytics integration tests. Prettier, ESLint, TypeScript
checks/build, Ruff, mypy, configuration checks, replay/fail-closed fixtures, secret
scan and both dependency audits passed. Both audits reported zero known
vulnerabilities. Initial findings and exact final commands/results are retained in
[validation evidence](evidence/fixed-risk-validation.json).

Both dashboard themes preserved navigation, controls, input text/focus/cursor and
chart nodes across background observations with no browser page errors. Updated
[light](images/fixed-risk-overview-light.png) and [dark](images/fixed-risk-overview-dark.png)
screenshots show the current policy without the removed equity-floor blocker.

All five services were recreated on stable Node 22.23.2. The final stopped preflight
reported the correct policy and healthy reconciliation. The authenticated maintenance
pause was cleared on final revision `.3` at **16:38 SGT**, restoring the operator's existing demo authorization. The intermediate `.2` activation at 16:33 was paused again while fixing the performance-context projection.
PM2 state was saved with protected dump permissions. No live execution was enabled,
no account baseline or drawdown lock was reset, and all other environment values
remain unchanged. [Runtime observation](evidence/fixed-risk-rollout.json).

The final `.3` automatic refresh requested `gpt-6-astra/u64`, returned `gpt-6-astra`,
and reached READY after **19,404 ms** in the context journal (two refresh attempts
recorded across the rollout). The next local decision deferred with
`SCENARIO_WAIT_PRICE_RETURN`: price must return inside the stored entry thresholds.
There were no active strategy orders or positions at this observation, and no
projection-schema rejection on that cycle. It did not request another model call
to retry the local decision. This is provider/runtime compatibility evidence,
not a fill or a profitable trade.
The tests use synthetic financial cases to check limits, not historical profit.
No new model-quality or matched trading-performance result is claimed. The
[previous evaluation limitations](reusable-scenario-report.md) still apply.
