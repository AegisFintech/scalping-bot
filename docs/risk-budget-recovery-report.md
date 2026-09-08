# Risk-budget sizing and analysis recovery

This is the continuation of ISSUE-079, [issue #188](https://github.com/AegisFintech/scalping-bot/issues/188)
and [PR #189](https://github.com/AegisFintech/scalping-bot/pull/189), requested on
2026-09-08. The earlier [paused checkpoint](equity-sizing-recovery-report.md)
records the intermediate policy and the prepared archive review. Current source
is `0.2.3-equity-risk.4`, policy `fixed-risk-v4`.

## What changed

The operator requested removal of the cap and recovery of rejected analysis.
The intermediate five-times-equity notional ceiling and the separate 1% collateral
ceiling are removed. One percent now governs cost-inclusive modeled loss, with
both race-exposed OCO legs sharing that budget. Margin is collateral, not the
loss at the stop. Broker leverage is unchanged.

Sizing stays in the existing Decimal risk engine. It uses current reconciled
account equity, remaining daily loss capacity, durable drawdown reductions,
stop distance, broker contract/conversion/commission metadata, volume increments
and exact-volume broker margin estimates. One complete setup loss is reserved in
free margin before allocating half the remainder to each leg. The broker exposes native volume and buy/sell expected margin in its
[official protocol definitions](https://help.ctrader.com/open-api/model-messages/);
this deployment confirms both sides at the proposed volume. Broker maximum
volume, collateral and cost constraints can still require less than 1% loss risk.
An unaffordable minimum rejects; it is never rounded upward. Account state is
rechecked before placement. No model can choose volume, risk or execution mode.
The 5% daily loss and 5% high-water drawdown locks are unchanged and were not reset.
Stops and the ten-tick reserve cannot guarantee maximum realized loss through gaps.

No operator setting was added. The normal template remains **20 entries**, the
populated deployment **24**, with credentials, endpoints, model and demo authority
unchanged. `MAX_POSITION_NOTIONAL` must be absent; cached legacy
`MAX_MARGIN_USAGE_PERCENT=1` must be removed because it conflicts with the new
policy. Do not replace a populated `.env`. Internal collateral validation still
rejects requirements above equity/free margin; it is not unlimited borrowing.

## Storage incident and recovery

A full hosted database prevented analysis journals and order admission. Changing
support/resistance levels could not fix this failure. At 10:18 SGT, verified
relocation and compaction reduced database size from **513,089,536** to
**249,610,240 bytes**, reclaiming **263,479,296 bytes**.
All **3,914 original PNGs / 252,895,795 image bytes** remain in protected hash-addressed
storage and in a separately reverified compressed local archive. IDs, hashes and
provenance remain in PostgreSQL. No financial/model/order/fill/trade records were
deleted. These two local copies do not establish off-host disaster recovery.

The already-applied additive migration 0018 supports database or local storage.
The operator's continuation completed the prepared transition review. The
idempotent relocation initially encountered storage error 53100 after small
batches; ordinary table vacuum between retries allowed progress. After every
original image had moved and all pointers were verified, bounded
`VACUUM (FULL, ANALYZE) analysis_chart_artifacts` compacted that relation only,
with five-second lock and thirty-second statement timeouts. Financial tables
were not rewritten. [Recovery evidence](evidence/chart-storage-recovery.json).

New charts use verified local storage, preventing the same image-blob accumulation.
Non-image journals still grow: monitor capacity and provision adequate durable
storage before it fills again. Storage failures retain the operational block and
minute backoff; protective maintenance remains independent. Only a successful
durable cycle clears the fault latch. No fault file or financial lock was reset.

## Same-input sizing evidence

Read-only comparison at 10:16 SGT used identical historical entry/stop prices and
current broker contract, commission and margin data. It submitted no orders.
Observed equity and free margin were USD 999,832.16; the combined 1% budget was
USD 9,998.3216.

| Measure                               | Old USD 5,500 cap | Intermediate caps | Current risk budget |
| ------------------------------------- | ----------------: | ----------------: | ------------------: |
| Lots per side                         |              0.01 |             11.28 |               35.08 |
| Combined modeled loss including costs |         2.8496872 |     3,214.4471616 |       9,996.7026976 |
| Combined confirmed broker margin      |              8.86 |          9,987.90 |           31,061.93 |
| Full sizing latency, one sample each  |         505.21 ms |         503.42 ms |           512.93 ms |

The current result uses approximately 0.99984% equity in modeled loss and 3.107%
in collateral. Broker volume flooring explains the small unused loss budget.
One thousand arithmetic repetitions had 0.951 ms median, 5.241 ms p95 and
8.942 ms p99 on this busy host. These are arithmetic timings, not order-fill
latencies; three broker checks cannot estimate tail latency.
[Exact comparison](evidence/risk-budget-sizing-comparison.json).

Larger volume is not evidence of better expectancy or execution quality. Old tiny
trade P&L cannot be scaled to predict these results. Suitable quote data and forward
demo observations remain necessary for net P&L, drawdown, profit factor, fill rate,
slippage, uncertainty and model ablation. Provider cost remains unknown.

## Rejections and safeguards

The prior 24-hour journal includes earlier releases and models. Its leading
rejections included spreads, stale quotes/market data, provider timeouts and the
storage incident. They are not all paid calls. `DEFERRED` means waiting for map
availability, immutable levels or refresh; a local derived proposal is not an
EPRToken request. No historical result is relabeled as accepted.

The broker-declared Labor Day closure fix passes fresh completed-candle analytics.
Unknown gaps, stale state, invalid JSON/precision, unaffordable orders and expensive
spreads still reject. Maps remain immutable and inference remains asynchronous,
with at most one durably claimed request every five minutes, bounded timeout,
strict validation and no silent model substitution. The configured requested model
remains **gpt-5.6-sol/u40**. A market scenario does not guarantee an economical fill.

## Validation, deployment and rollback

All 478 Node and 121 Python tests passed, alongside 22 schema, 3 migration and
3 integration tests using isolated PostgreSQL 17 with verified TLS. Formatting,
lint, types/build, Ruff/mypy, configuration validation, replay/fail-closed checks,
secret scanning and both dependency audits passed (zero known vulnerabilities).
Initial formatting and a test-only lint finding were corrected and rechecked.

The intermediate `.3` demo operation resumed at
10:20:01 SGT after certain, empty broker reconciliation and verified storage
recovery. The first durable cycle cleared the failure latch automatically;
readiness returned HTTP 200 with no safety blockers. The first new request used
literal `gpt-5.6-sol/u40`. Live submission remains disabled.

Rollback: pause new analysis, reconcile broker exposure, and restore validated
revision `.2` source/build through the supervisor. Its smaller caps can be restored
without changing account balances, consumed maps or daily/high-water locks. Keep
migration 0018 and the local chart directory; both revisions support them. An
older reader that requires database PNG bytes first needs the reviewed exact-byte
restore and sufficient database capacity described in the earlier report. Never
restore a whole historical database over current financial state.

## Final market refresh correction

The resumed `.3` observation reproduced one avoidable `MARKET_DATA_STALE` /
`ORDER_BOOK_STALE` rejection after the final capital/account checks consumed the
quote's remaining lifetime. Revision `.4` performs the full account/capital audit
before the final market snapshot, then re-reads authorization controls after the
market/semantic checks. The original three-second freshness limits, spread gates,
completed-candle fingerprint, prices and expiry remain unchanged.

The final gate now intersects current safety and the placement account. Newer
positions, pending orders, partial fills, cancellation or uncertain reconciliation
cannot be overwritten by the earlier empty account snapshot. Pause/emergency
changes during the final market request are checked again. Control-read failure
or data that ages even during that shorter read still rejects.

The regression simulates a four-second capital check: the old implementation
rejects the stale quote; the revised one obtains fresh data and admits the same
otherwise valid fixture. Separate tests prove newly observed exposure, uncertain
reconciliation, late pause/emergency and unavailable/slow controls still block.
This demonstrates removal of an implementation bottleneck, not improved market
forecast accuracy.

Before/after regression check: all eleven new final-gate cases fail against the
prior coordinator and pass against the revised coordinator. The complete
coordinator suite passes 43 tests. Two initial test assertions used incorrect
existing reason-code names and were corrected without changing production codes;
mock assertions were also made lint-safe. These are software failure-path checks.

Final revision `.4` resumed the existing demo authority at **10:26:39 SGT** after
fresh certain reconciliation found no positions or pending orders. All five
services use the new build, and the storage latch remains clear. No live authority,
credentials or capital accounting were changed.

Both final dashboard themes passed real-browser checks: navigation, focused input,
caret, four metrics and history plot nodes survived timed updates, with no browser
errors. [Light overview](images/equity-sizing-overview-light.png),
[dark overview](images/equity-sizing-overview-dark.png),
[exact validation commands/results](evidence/risk-budget-validation.json).

A transient fresh-quote HTTP 503 after service recreation caused the documented
minute backoff; the next durable cycle recovered automatically. The final build's
next EPRToken request completed in **32.471 seconds**, returned `gpt-5.6-sol`, and
used **17,735 input / 758 output tokens**. Both post-recovery provider maps passed
validation; local spread rejections did not trigger another provider request.

At the **10:30:46 SGT** observation, final revision `.4` had 16 spread rejections,
one refresh deferral and one crossed-level wait; **zero submitted orders and zero
new fills**. None of those local checks caused an extra paid call. There were no
new storage or final-snapshot-age rejections in this short window, but it did not
exercise a broker fill. The spread sample at 10:29:47 was USD 0.09 (allowed by the
absolute bound); the 500 prior sampled observations included frequent USD 0.11
quotes, above the unchanged USD 0.10 absolute ceiling. These are sampled
observations, not a complete tick tape or a same-market causal comparison.
[Forward demo observation](evidence/risk-budget-demo-observation.json) ·
[spread evidence](evidence/spread-recovery-observation.json) ·
[runtime/configuration verification](evidence/risk-budget-runtime.json).

Mechanical recovery and risk sizing are validated. Larger-order fills, slippage,
partial-fill recovery at this size, prospective net performance, model ablation,
provider pricing and off-host backup remain readiness work. There is no evidence
yet of improved net returns, and no promise that every cycle should trade.
