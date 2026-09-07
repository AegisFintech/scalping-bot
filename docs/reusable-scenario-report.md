# ISSUE-075 — Reusable chart maps and integrated execution

This is the historical ISSUE-075 checkpoint. ISSUE-076 removes its absolute-floor
blocker and changes risk policy; see [the current report](fixed-risk-report.md).

Date: 2026-09-07. Branch: `issue-075-efficient-scenario-execution`.
Issue: [#179](https://github.com/AegisFintech/scalping-bot/issues/179).
Delivery: [PR #181](https://github.com/AegisFintech/scalping-bot/pull/181),
implementation checkpoint `e5da2fd` committed and pushed.
Baseline source: `f5fe93f`; running baseline: `.43` / `gpt-5.6-sol/u40`.
New source: `0.2.1-reusable-scenarios.1`. Live execution remains disabled.

## Findings and implementation

The environment file already named `gpt-6-astra/u64`, but the running AI/execution
processes retained the older release/model. Between 11:10 and 15:38 SGT, the old
scheduler completed 183 cycles, all rejected. Overlapping rejection groups
included 86 spread failures, 56 provider timeouts, seven stale-quote and six stale-book failures, and
five invalid-decimal failures (these reasons can overlap). The 46 stored successful provider responses in
that window had median latency 38,555 ms and p95 46,172.75 ms. Old failures were
not consistently stored as model requests, so these counts do not reconcile all
of the provider's billed calls.

An 11:09 pair had approximately four seconds before expiry. A later 15:39 pair
expired/cancelled without a fill. A fifth demo trade closed at 15:44 with net
+0.42, before the maintenance pause. The earlier four-trade observation was
therefore no longer the current day total. These are demo observations, not
proof of strategy accuracy or profitability.

The integrated path removes inference from individual execution decisions:

- Cheap safety, current spread, account, affordable-stop and fee checks precede
  the paid refresh. A database transaction/advisory lock claims at most one
  refresh per account/symbol/mode in five minutes. Restarts and failed requests
  cannot repeatedly spend within that cooldown. Attempts include pre-provider
  and uncertain transport failures; exact billed usage may remain unknown.
- A separate bounded task calls the AI service's `/v1/scenario` endpoint.
  `scenario-v2` requests stable completed-M15/M5/M1 chart levels, without sizing,
  account policy or fabricated certainty. The strict scenario schema fixes a
  five-minute lifetime from capture, not from the end of a slow response.
- `scenarioOco` derives a protected buy/sell pair locally. Crossed thresholds are
  not chased. Entry-distance, fee/reward and remaining-validity failures wait.
  Both legs must remain within the existing risk envelope. This is a conditional
  stop-trigger strategy; it does not assert a completed-candle hold or failed reclaim.
- Fresh local decisions use durable five-second broker-time slots, reserving
  the final five seconds before M1 rollover. Every individual decision retains
  the existing completed-candle identity, quote/depth freshness, precision,
  account, margin, spread, fee and risk checks. A valid map can span ordinary
  candle advances; a stale execution snapshot cannot.
- Pending validity starts with the fresh local decision (60 seconds), within
  map validity. A unique database context link consumes the map at order intent,
  including failed/uncertain submission. It cannot repeatedly rearm after a loss.
- Existing OCO journal/recovery, broker-held relative SL/TP and independent
  two-second protective maintenance remain authoritative. Both race-exposed legs
  share the cost-inclusive budget. The available risk cap now also reserves the
  explicit equity floor before sizing; reaching that floor blocks entry. No
  leverage or risk increase was introduced.
- `DEFERRED` is a distinct terminal waiting state, with a separate durable reason.
  Actual validation failures remain `REJECTED`. Local derived artifacts have
  `decision_source=DETERMINISTIC_PLAN`; paid refresh evidence is stored separately.
  Dashboard provider counts exclude these local artifacts.

Migration `0016` adds the context journal, provenance link, local-decision claims,
unique consumption link and deferral fields/state. Historical contracts and audit
rows remain intact. The separate directional replay retains its completed-candle
confirmation/structural/time-exit rules; those research rules were not silently
promoted to broker commands.

## Endpoint and payload evidence

A real request through the revised local HTTP adapter on staging port 18082
requested **`gpt-6-astra/u64`**, returned **`gpt-6-astra`**, and passed strict
schema, identity, prompt hash, tick-grid and validity checks in **17,685 ms**.
It used 22,105 input and 359 output tokens. Request size was 135,040 bytes.
[Sanitized evidence](evidence/reusable-provider.json) records the observation.
A second bounded check through the recreated production AI service passed in
**18,825 ms**, with 22,102 input / 442 output tokens and the same exact requested
and normalized returned identities. [Runtime endpoint evidence](evidence/reusable-provider-runtime.json).
The suffix is transmitted literally; returned normalization is recorded, not
silently replaced. This cannot independently attest the reseller's underlying
weights or the meaning of `/u64`. No fallback model is configured.

Requests use Responses, strict JSON Schema, `store:false`, chart input and
30/18/12 completed candle tails, a 45-second deadline, 1,500 output-token bound,
zero automatic retries and a three-failure/300-second circuit breaker. Raw output
is revalidated across the HTTP boundary. Costs remain null because the reseller's
billing contract is unavailable. The earlier image-versus-structured experiment
saved bytes but did not establish a decision-quality winner; chart input is retained
for the requested workflow, not because it proved superior returns.
[Earlier benchmark](evidence/provider-benchmark.json).

cTrader documents STOP_LIMIT slippage bounds, relative protective prices, broker
execution events and cancellation requests. These support the existing broker
trigger/protection path; they do not supply atomic OCO or a fill guarantee.
[Official messages](https://help.ctrader.com/open-api/messages/),
[model definitions](https://help.ctrader.com/open-api/model-messages/).
Strict output formatting is an API contract, not a trading-quality guarantee.
[Official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

## Honest old-versus-new evidence

| Measure                                     | Running legacy baseline                                    | New implementation evidence                                                           |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Paid refresh cadence                        | Up to one per M1 cycle                                     | At most one per five minutes; durable concurrency/restart tests                       |
| Local decision opportunity                  | First 5–10 seconds of M1                                   | Every five seconds except the rollover reserve                                        |
| Inference in order path                     | Tens of seconds                                            | No provider call in local proposal/order path                                         |
| Response latency                            | Window p50 38,555 / p95 46,172.75 ms; 46 stored successes  | Two revised requests, 17,685 / 18,825 ms; not a matched latency distribution          |
| Pending lifetime                            | Several observed pairs had 4–21 seconds remaining          | Fresh 60-second decision validity; realized broker lifetime still needs demo evidence |
| Net expectancy/P&L, profit factor, drawdown | Prior demo/replay losses documented in the overhaul report | No matched prospective trade sample yet                                               |
| Frequency, exposure, fill/rejection rates   | 183/183 rejected cycles in the selected window             | No claim of increased filled-trade frequency; unit tests are not market evidence      |
| Slippage, gaps, partial fills, financing    | Existing sampled data and broker journals are incomplete   | Existing fail-closed protections retained; no new execution-quality claim             |
| Model value after cost                      | Not established                                            | Not established; provider pricing and sufficient prospective outcomes missing         |

The request ceiling is 80% lower than a once-per-minute ceiling, even if local
checks run more often. That is a mechanically tested spending bound, not measured
profit improvement. It must not be confused with an 80% observed bill reduction.
No candles were backfilled with future model maps. No synthetic fixture is presented
as out-of-sample performance. Current sampled quotes cannot prove complete tick
execution, and the available data do not support a new walk-forward profitability
claim. The recorder, existing evaluation tools and separate scenario replay remain
available for a prospective same-data/cost comparison, model ablation and stress tests.

## Configuration, rollout and rollback

Normal template keys remain **22**; the actual populated file remains **26**.
Relative to the original 176, reductions remain 87.5% and 85.2% respectively.
No tuning knobs were added. Existing credentials, endpoint, exact model pin and
operator capital/mode values are preserved. The only missing account choice is
the explicit USD equity floor. It has been requested, not invented.

At 15:46 SGT, an authenticated durable analysis pause stopped legacy spending.
Protective handling remained active. A subsequent broker-backed status was
healthy, paused, and showed a closed latest group with no exposure blocker.
Before migration, a mode-0600 environment/PM2 backup and a 234,459,132-byte custom
PostgreSQL public-schema archive were created. PostgreSQL client 18 matched the
server after client 17 correctly refused the version mismatch. Archive contents
were readable; this is not an isolated full restore or an off-host backup test.
An isolated rollback checkout of deployed commit `2ee59bb` built successfully;
its source/build artifact was archived privately, then the temporary checkout removed.

Migrations 0015 and 0016 were applied after the isolated migration tests and backup.
All five services were recreated under an explicit maintenance hold, removing
cached legacy overrides. Each uses a stable `/opt/scalper-node22/bin/node` binary
that matches the tested Node 22.23.2 binary byte-for-byte. The running execution
API reports the new release and exact model pin; startup/reconciliation passes.
PM2 state is saved with mode-0600 dumps. The populated environment remains
byte-for-byte identical to its backup. [Rollout evidence](evidence/reusable-rollout.json).

The deployment is deliberately **stopped**: automatic analysis and demo submission
are disabled in the supervisor, the durable pause is retained, and the emergency
stop is active. The dashboard explicitly identifies the missing equity floor.
This is an integrated stopped deployment, not a launched strategy or a completed
prospective demo campaign.
Enabled demo startup remains blocked until an explicit `ACCOUNT_EQUITY_FLOOR`
is supplied. No live execution may be enabled. A controlled stopped deployment
must retain the pause and disable broker submission until that limit is available.

Rollback: retain the new audit tables/columns and migration checksums. Pause,
reconcile and cancel only strategy-owned pending orders with acknowledged outcomes.
Restore the reviewed release artifact and protected supervisor environment; do
not overwrite the populated `.env` from the sample, reset capital/daily-loss state,
retry uncertain context requests or resurrect old proposals. Older dashboards may
not understand DEFERRED rows, so keep the current reader or deploy a compatible
reader rather than rewriting history. Re-enabling execution still requires all
capital, account, reconciliation and authorization checks.

To resume after the operator supplies the floor: update only that field in the
protected file, run `config:check -- .env --startup`, recreate the named services
from the reviewed ecosystem/environment without the temporary maintenance
overrides, and retain the durable pause until fresh broker/account/capital checks
pass. Only then clear the authenticated pause under the existing demo authorization.
Do not reset accounting, lower spread/risk thresholds or bypass reconciliation.

## Dashboard verification

[Light overview](images/dashboard-overview-light.png),
[dark overview](images/dashboard-overview-dark.png), and
[trade history](images/dashboard-history.png) show the actual stopped deployment.
Browser checks in both themes preserved title/navigation/control nodes, input
value, focus and cursor across two background observations. All four financial
metrics remained mounted; the trade-history chart survived an update. No browser
page errors occurred. No control was submitted during these browser checks.

## Validation record

The final release run passed all **22 commands** on Node **22.23.2**:
406 Node tests in 58 files; 117 Python tests; 22 JSON Schema tests; three static
migration tests; and all three configured database/analytics integration tests.
Prettier, ESLint, TypeScript typecheck/build, Ruff formatting/lint, mypy, configuration
checks, secret scanning, npm audit and pip-audit passed. Both dependency audits
reported no known vulnerabilities. Existing replay/backtest smoke fixtures and
scenario base/stress replays passed. [Exact commands and results](evidence/reusable-validation.json).

A final concurrency review canonicalized the database advisory-lock scope. The
configured integration tests passed with independent stores receiving differently
ordered scope properties. Node lint, typecheck, build and all 406 tests passed
again after that change; the exact final build was restarted under the same stop.
Final formatting, staged-diff review and repository secret scans passed; an
additional exact-value comparison found no populated credential in the 52 staged
implementation files. The GitHub repository currently has no main-branch protection
or matching rules and has automatic merge disabled. These facts do not replace
the local completion gates or authorize bypassing any later required check.

Early formatting/lint findings were corrected and rechecked. The deliberate
negative startup check against the unchanged populated file still rejects with
`CONFIG_DEMO_EQUITY_FLOOR_REQUIRED`; the deployed supervisor's maintenance hold
keeps demo submission disabled. The safe sample startup check passes. No new
strategy order was launched for validation, and no live authorization was enabled.

Remaining readiness: the explicit equity floor, controlled prospective demo
lifecycle observations, adequate bid/ask execution data, reseller billing information,
and matched cost-aware evaluation/model ablation. Partial/ambiguous broker outcomes
remain reconciliation blockers; the separate directional close-command research
is not represented as implemented production behavior. Encrypted off-host backup,
full isolated restore and least-privilege deployment remain operational limitations.
