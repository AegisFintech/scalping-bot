# Persistent stop-limit loop — ISSUE-083

The operator explicitly requested and approved persistent orders on September 8, 2026. Release `0.2.3-equity-risk.9` implements analyze → GTC buy/sell stop-limit
pair → fill/cancel peer → protected position → confirmed close → fresh analysis.
This is an operator-selected lifecycle, not a profitability improvement established
by the earlier censored expiry research.

## What changes

Accepted orders have no application or broker timer expiry. cTrader receives
`GOOD_TILL_CANCEL` (`timeInForce=2`) and no `expirationTimestamp`. The adapter
requires matching GTC acknowledgment for accepted pending orders. Broker rejections,
cancellations, liquidity and stop-limit execution ranges still apply. The API
supports these fields; broker-specific acceptance is validated separately below.
Sources: [cTrader new-order request](https://help.ctrader.com/open-api/messages/#protooaneworderreq)
and [time-in-force enum](https://help.ctrader.com/open-api/model-messages/#protooatimeinforce).

The five-minute map and three-minute local proposal deadlines remain fresh
**submission authorization**. They do not cancel an already accepted GTC order.
A stale proposal cannot create a new order. The EPRToken model, chart prompt,
entry thresholds/buffers, costs, risk policy, and SL/TP geometry are unchanged.
The local deterministic audit artifact advances to `scenario-execution-v2`.

Active exposure suppresses model requests through existing account gates and an
additional durable active-group guard. Complete recorded closure permits one
post-close request immediately, even inside the old five-minute interval. The
advisory lock plus unique `refresh_after_context_id` prevents duplicate dispatch
across processes/restarts. Unknown/failed requests retain five-minute backoff;
known local circuit failures retain their one-minute local recheck. Unfilled broker
cancellations do not count as a trade close or authorize repeated paid calls.

OCO peer cancellation, partial/ambiguous-state blocking, broker-held SL/TP,
independent reconciliation, daily/drawdown controls and authenticated emergency
cancellation remain. Ordinary shutdown preserves GTC orders at the broker. Pause
only prevents new analysis. No filled position is closed merely because time passes.

## Persistence, configuration and rollback

Migration 0019 adds explicit lifetime and fresh-submission columns; old orders
remain GTD with their exact expiry. GTC requires null pending expiry and a separate
submission deadline. The strict `pending-order-lifetime-1.0` schema describes this
projection. Dashboard/API distinguish GTC from dated or unavailable expiry.

No operator settings are added: 20 sample keys, 24 populated keys. Preserve the
populated environment and credentials; no rewrite is required. Apply the additive
migration under pause before starting the matching release. Risk accounting and
existing broker orders are not retroactively changed.

Before rollback, pause and confirm all strategy GTC orders cancelled and all
positions closed. Older readers assume dated orders; retain the current dashboard
for historical GTC rows. Keep migration/audit history and all loss locks.

## Validation and demo rollout

All required quality gates passed after the documented corrections: **522 Node,
140 Python, 27 schema, 3 migration and 3 configured PostgreSQL/analytics integration
tests**. Formatting, ESLint, TypeScript/build, Ruff/mypy, startup configuration,
replay/fail-closed fixtures, npm/pip audits passed. Both audits reported no known
vulnerabilities. [Exact commands and corrections](evidence/persistent-order-validation.json).
The repository secret scanner has a pre-existing missing-file limitation; the
commit also receives an exact-value and token-pattern scan of every index blob.

Migration 0019 applied at **20:04:47 SGT** under authenticated pause. AI, execution
and dashboard were recreated; all five services were online with zero restarts.
Existing demo automation resumed at **20:05:13 SGT**. The environment was byte-for-byte
unchanged, and durable capital reference/high water/risk multiplier and daily
baseline/locks were verified preserved. Live execution remains disabled.

The first request took **20,529 ms**, requesting `gpt-6-astra/u64` and recording
returned `gpt-6-astra`. BUY **4404.39** (35.09 lots) and SELL **4402.38** (35.10 lots)
were submitted at **20:05:56–57 SGT**. A separate read-only broker reconciliation
at **20:06:16** confirmed both as STOP_LIMIT (6), GTC (2), zero executed volume,
and no expiry timestamp. Their historical fresh-submission deadline is
20:08:49; original map deadline is 20:10:19. Those are not pending-order expiry.
[Rendered dashboard](images/persistent-order-loop.png).

At **20:10:38 SGT**, after both the submission and original map deadlines, a
second independent broker reconciliation still showed both GTC orders pending,
zero fills/positions and no expiration timestamp. The durable journal still
contained **one** `.9` model request; automation was unpaused and operationally
ready. Thus the old timer/periodic-refresh behavior is absent in this observed
waiting interval. A real fill → SL/TP → next-analysis cycle remains unobserved;
that transition has synthetic and PostgreSQL failure/concurrency coverage.
[Timestamped rollout evidence](evidence/persistent-order-rollout.json).

## Evidence limits

Previous release observation at 19:47 SGT: 36 submitted orders, 20 expired,
16 cancelled, zero fills; median entry distance from the local decision quote
USD 1.63 (range 0.35–3.65). Twenty-two exceeded the preferred entry corridor.
These are demo observations, not a matched causal test of expiry or distance.

GTC removes timer expiry; it does not guarantee fills, enduring technical relevance,
or positive net expectancy. Later triggers can face changed margin, spreads,
slippage/gaps and overnight conditions. The 1% combined setup limit is modeled
risk at submission, not a guarantee of maximum realized loss. Current sampled
quotes do not support a reliable long-horizon old/new net-performance comparison.
The existing dated-expiry exporter explicitly rejects GTC with
`EVALUATION_GTC_NOT_SUPPORTED`; it cannot silently discard persistent orders and
report an empty cohort. A GTC-aware evaluation horizon/execution model is still needed.
No live execution is enabled, no loss locks reset, and no trades are forced for
validation. A natural SL/TP close is needed to verify the complete new broker loop.
