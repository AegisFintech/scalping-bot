# OCO pair recovery — ISSUE-084

The September 9 operator request retains local entry/TP/SL calculation and asks
for idle → analysis → OCO → fill/cancel peer → SL/TP → fresh analysis. ISSUE-083
already implements that normal path. This repair handles an incomplete pair and
missed partial-fill cancellation retries.

Issue: [#198](https://github.com/AegisFintech/scalping-bot/issues/198).
Branch: `issue-084-oco-pair-recovery`. Release: `0.2.3-equity-risk.10`.
Pull request: [#199](https://github.com/AegisFintech/scalping-bot/pull/199).

## Observed gap

Read-only checks at **2026-09-09 10:22 SGT** found `.9` running in demo, automatic
analysis enabled, no pause/emergency, and operational readiness passing. New
analysis correctly blocked on `RELEVANT_PENDING_ORDER_EXISTS`.

The latest pair was submitted September 8 at 23:15:46 SGT. Its SELL was recorded
as broker-cancelled at 23:19:27 with zero executed volume, mapped evidence and no
reported error code. Its BUY remained pending more than eleven hours later.
Neither had a pending expiry. Six `.9` contexts produced six pairs: five pairs
ended cancelled without fills and the sixth retained this single pending order.
There were zero `.9` closed trades and zero post-close refreshes. The broker's
reason for its zero-fill cancellations is unavailable; no cause is inferred.

The last provider request preceded that pair at 23:12:05 SGT; active exposure did
not cause repeated inference. Actual local distances were **0.53 TP / 1.06 SL**
in XAUUSD price units. These are execution observations, not performance evidence.

## Repair and retained behavior

- An owned pending order whose owned peer has a confirmed zero-fill broker
  cancellation, expiry or rejection is cancelled through the existing gateway.
  This is pair failure recovery, with no elapsed-time trigger.
- Selection requires exactly two orders, matching account/symbol ownership,
  a mapped terminal broker event, no fills or positions, and no unresolved
  callback evidence in that account/symbol. Unknown, missing or conflicting
  evidence cannot authorize zero-fill completion.
- Cancellation failure keeps the group in reconciliation-required state. A
  recreated maintenance worker retries the same surviving order. Cancellation
  results and fresh broker reconciliation are checked before releasing the group.
  Durable fills/positions and unresolved events are checked again so a racing
  fill cannot be labelled an unfilled completion.
- Successful unfilled cleanup records `FAILED` / `OCO_PEER_UNFILLED_TERMINAL`.
  It creates no trade and grants no post-close cooldown exception. The old map
  stays consumed; a new request follows ordinary admission/cooldown rules.
- Durable peer cancellation also covers partial fills and positive executed
  volume. Pending remainders can be cancelled; filled positions retain their
  broker-held protection and reconciliation requirements.
- Cancellation writes are scoped to account, group and strategy ownership.
- A restarted gateway recovers cancellation authority from a fresh broker read
  when no in-memory order record remains. It requires exactly one matching
  client ID, the configured symbol and strategy label, a supported pending entry
  type, and matching cancellation response identity. Missing, duplicate, manual,
  other-symbol, closing-order and unknown evidence reject. It never resubmits
  an old order or reconstructs placement authority from an expired proposal.

Intact GTC pairs retain no timer expiry and survive normal shutdown. Local
scenario derivation, fee-buffered TP, twice-TP SL distance, precision, sizing,
1% combined setup risk, 5% daily budget, drawdown locks, provider identity and
all fresh-placement checks remain unchanged. The LLM does not choose TP/SL
distances or size. Live execution remains disabled.

## Validation and rollout

All required checks passed: **535 Node, 140 Python, 27 schema, 3 migration and
3 isolated TLS PostgreSQL/analytics integration tests**. Formatting, linting,
TypeScript/build, Ruff/mypy, replay/fail-closed fixtures, both policy and startup
configuration checks passed. npm and pip audits found no known vulnerabilities.
[Exact commands, corrections and configuration](evidence/oco-pair-recovery-validation.json).

The populated file has 24 keys. PM2 caches no overrides for model, mode, automatic
analysis, demo enablement or emergency stop; the services read those from the file.
Graphify's AST update succeeded (2,888 nodes / 6,075 edges); its existing parser
warning for `pyproject.toml` remains. User-deleted historical screenshots are
excluded from this change; their scanner limitation is covered by index scanning.

New analyses were paused at **10:27:31 SGT**; the existing GTC order and broker
protection were preserved. A rollback build was archived. After restarting only
execution, the new gateway recovered the existing broker order and its cancellation
was confirmed at **10:33:41 SGT**. The group became `FAILED` with
`OCO_PEER_UNFILLED_TERMINAL`, zero fills, no positions and no invented trade.
The order's former submission deadline was not extended or replayed.

Automatic demo analysis resumed at **10:34:08 SGT**. A fresh request was durably
claimed at **10:34:15 SGT**, using normal admission (`post_close=false`). It reached
the unchanged EPRToken route but returned **HTTP 500** after **1,578 ms**. No new
orders were placed. The five-minute failed-request backoff remains, with no forced
retry or fallback model. All four service readiness checks pass; provider request
failure is distinct from process health. [Timestamped evidence](evidence/oco-pair-recovery-rollout.json).

The populated environment is byte-for-byte unchanged. Capital reference/high
water/risk multiplier and daily baseline/locks match the pre-rollout snapshot.
Only execution was restarted; PM2 was saved with protected permissions. No schema
or populated environment migration was required. This verifies incomplete-pair
cleanup and subsequent inference admission, not a natural SL/TP close or a new fill.

## Rollback

Pause new analyses, reconcile outstanding exposure, and restore the previous
execution build. Keep broker-held protections, accepted GTC orders, all journal
rows and daily/capital locks. No reverse migration is needed. The prior release
can still leave an incomplete unfilled pair pending; confirm its status before
resuming. Never recreate a cancelled order from its consumed or expired map.

## Evidence limits

Software and demo lifecycle checks do not establish profitability, guaranteed
fills or maximum realized losses. A natural full fill → SL/TP → next-analysis
sequence remains separate from synthetic and database coverage. GTC may still
wait indefinitely while both orders remain intact.
