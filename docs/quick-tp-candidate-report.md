# ISSUE-330 — Cost-covered smaller broker TP candidate

Issue: https://github.com/AegisFintech/scalping-bot/issues/330.

## Candidate and economic limits

`packages/strategy-candidates/src/quick-tp.ts` composes the non-authoritative
breakout candidate with a smaller native broker target. It is not imported by
execution and cannot close or amend an existing position. There is no sampled
quote market-close command, trailing state, time exit or repeated uncertain close.
Native broker TP is the proposed first implementation of faster profit-taking;
it still may be reached in seconds or take longer, or never be reached.

Frozen proposal constants:

- SL: 2.5 M1 ATR, rounded inward to a tick and rejected above affordability.
- Initial fee floor: first whole-pip target meeting estimated net/fees >=1.5,
  using each supplied already-approved exact native quantity.
- Add 30 tick-size points for adverse entry, 65 for adverse exit, and 0.10 of
  original stop distance; round target distance outward to a whole pip.
- Cap target distance at 2 ATR. If costs/reserves cannot fit, reject; do not enlarge
  the target past that cap, widen SL or increase volume to force admission.
- Recheck fee coverage at the final target, including closing-price-dependent fees.

The 30/65-point reserves and 0.10 fraction are frozen proposed assumptions, not
measured guarantees or optimized parameters. The target can be rejected and is
not universally smaller than every historical target. Unknown swap, future FX,
actual slippage and final realized net remain unknown. The commission helper's
`expected_net_profit` is a modeled estimate. Smaller winners with full-size losses
can reduce expectancy even when many observed trades briefly turn green.

Exact quantities must satisfy broker minimum/maximum/step; this function never
selects or dynamically resizes a position. Conditional approved quantities are
not a dynamically rebalanced portfolio backtest. Runtime integration must perform
normal current-equity cost/margin sizing and validate the final exact command,
with both OCO legs sharing at most 1%. The candidate does not lower the current
minimum reward/risk admission threshold; a smaller-TP economic release needs its
own explicit reviewed constants and evidence. Broker entry/protection distance rules,
fill-relative protection, slippage and partial/OCO races remain release gates.

## Evidence and delivery

Tests cover both directions, exact quantities, estimated fee coverage, preserved
inputs/entries, inward stop rounding, unaffordability, volume/precision failures,
costs exceeding the cap, conversion failure and inherited breakout rejection.
Internal shared TypeScript types change; no persisted/wire contract or migration.

The exploratory #319 fade-exit results did not support promotion. Its candidate
code, original reports and future registration remain unchanged. This is a new
breakout/native-TP proposal; it needs its own causal comparison and frozen future
windows. No production activation, broker/provider command, risk/history reset or
profitability claim. Source rollback does not change existing orders/protection.

Validation: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed at
`/tmp/scalper-qualification-86mF1f/checks/results.json`: 927 Node tests, 92 isolated
PostgreSQL tests and 376 Python tests. Formatting/lint/types/build, schema/migration/
fail-closed suites, secret scan and npm/pip dependency audits passed. Twelve focused
TP tests and ten inherited breakout tests pass. Existing Starlette/httpx and
Graphify pyproject warnings remain. Final-head hosted checks are required before
merge; no activation or economic superiority is asserted.
