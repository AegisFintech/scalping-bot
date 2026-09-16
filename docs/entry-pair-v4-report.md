# ISSUE-104: Entry-pair prompt v4

Status: implemented locally; prospective demo observation remains required.

Prompt `entry-pair-v4` keeps the existing two readable buy-stop/sell-stop prices,
completed-candle input, broker boundaries, nearby M1 structure and candle-based
order-block guidance. It adds comparative selection guidance for four recent
conditions: displacement, orderly consolidation, overlapping/choppy structure,
and failed-breakout reversal.

The prompt now tells the provider to avoid internal micro-swings in choppy
structure, prefer fresh and less-tested levels, avoid levels already breached and
reclaimed, avoid structure spanning a verified broker-session gap, and prefer the
side with cleaner nearby continuation space. These are provider-selection
instructions only. They do not add a local numerical gate, target-room filter,
model-selected risk, volume, stop, target, repricing, timer or fallback.

The deterministic application still owns tick precision, current quote checks,
entry validation, SL/TP, dynamic sizing, broker margin, shared setup risk,
ownership, reconciliation and idempotency. The previous prompt bytes and journal
history remain immutable; v4 is a new prompt identity.

This change is not evidence of improved expectancy. Compare v4 with the previous
release across multiple out-of-sample demo sessions, including win/loss payoff,
fees, slippage, stop overshoot, holding time, direction and market condition.
