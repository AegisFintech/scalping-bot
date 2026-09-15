# ISSUE-102b — Fade-limit deferred admission gates

Activates the three admission gates that ISSU-102 deliberately left
deferred. Each gate is a release-level release constant; turning them on
together gives the fade-limit release the full safety net the
simulation evidence relied on.

## Trend filter (`trendFilterBars:30`)

`packages/config/src/policy.ts` carries `trendFilterBars: "30"`. The
coordinator computes the M1 trend from the post-model snapshot:

```ts
m1TrendDirection(snapshot, lookbackBars, tickSize): -1 | 0 | 1
  closes[-1] - closes[-1 - lookback] >  tick  -> +1
  closes[-1] - closes[-1 - lookback] < -tick  -> -1
  otherwise                                 -> 0
```

The signal passes to the OCO risk evaluator. For the `LIMIT` execution
mode a `trend === 0` (no clear direction) rejects the placement with
`FADE_LIMIT_TREND_UNCLEAR`. For `trend = ±1` both fade legs stay
constructed — single-leg side isolation was evaluated and rejected in
this iteration because the underlying paired fade bracket already carries
the simulator's strongest evidence (`v1-fade-sl2.5-tp1.0-e30-noBe-tr30`
was positive on both splits under every stress). A future iteration may
revisit side isolation by relaxing `placeOco` to length-tolerant.

## Bracket recall (`bracketRecallBars:30`)

`OrderMaintenance.recallStaleBrackets()` selects owned
`PENDING`/`INTENT`/`SUBMITTING`/`CANCEL_PENDING` orders whose
`scenario_contexts.valid_until` is more than `bracketRecallBars` minutes in
the past and cancels them with reason `BRACKET_CONTEXT_EXPIRED_RECALL`.
The existing `zeroFillTerminalProof` exception (ISSUE-089/097) admits
one fresh request after proven cancel, so the cadence loop
regenerates a fresh bracket on the next cycle without persistent
staleness.

The bracket recall differs from `expireAndReconcile` (which expires
analysis_runs in `ACCEPTED` state when no live group exists). It is the
own-position companion: when a fade bracket rests too long it is
recalled; when the analysis has no live leg the run is expired.

## Loss-streak pause (`streakLosses:3 / streakPauseMinutes:60`)

`computeLossStreakPause()` inside the safety producer queries the last
`streakLosses` closed trades for the account; if all are losses and the
latest loss is within `streakPauseMinutes`, it sets
`lossStreakPauseActive: true` on the safety input. The
`evaluateAnalysisEligibility` check returns
`LOSS_STREAK_PAUSE_ACTIVE` in that case, blocking new analyses +
placements until the cooldown expires. Recovery is automatic once the
last-loss timestamp is older than the configured pause.

## Wire

| file | change |
|---|---|
| `packages/config/src/policy.ts` | `FADE_LIMIT_RELEASE` already includes `trendFilterBars`, `bracketRecallBars`, `streakLosses`, `streakPauseMinutes`. |
| `apps/execution-service/src/safety-gates.ts` | `SafetyGateInput.lossStreakPauseActive` + `LOSS_STREAK_PAUSE_ACTIVE` reason. |
| `apps/execution-service/src/index.ts` | safety producer computes `lossStreakPauseActive` from DB when the fade-limit release is active. |
| `apps/execution-service/src/coordinator.ts` | `m1TrendDirection` helper + `trendFilterBars` option + `trend` passed to `risk.evaluate`. |
| `apps/execution-service/src/oco-risk-evaluator.ts` | `trend?: -1 \| 0 \| 1` input field; `FADE_LIMIT_TREND_UNCLEAR` rejection when LIMIT-mode + trend = 0. |
| `apps/execution-service/src/order-maintenance.ts` | `bracketRecallBars` option + `recallStaleBrackets()` method. |
| `apps/execution-service/src/order-maintenance.ts` (test) | bracket recall exercised via a fake `pg.Pool` and `ExecutionGateway`. |

## Behaviour matrix

| regime | release | trend | admission |
|---|---|---|---|
| demo | market-stop-v2 | any | unchanged (gate disabled, `streakLosses=0`) |
| demo | 0.3.0-fade-limit.1 | clear ±1 | place both fade legs |
| demo | 0.3.0-fade-limit.1 | unclear (0) | reject (`FADE_LIMIT_TREND_UNCLEAR`) |
| demo | 0.3.0-fade-limit.1 | n/a | reject if last 3 closed trades are losses (`LOSS_STREAK_PAUSE_ACTIVE`) |
| demo | 0.3.0-fade-limit.1 | n/a | recall unfilled pendings older than 30 minutes |

The Trend filter and loss-streak pause are pure admission gates — they
neither rewrite the response nor change the broker wiring. Bracket
recall emits a normal `cancelStrategyOrder` and runs `reconcileRaw`;
the follow-on zero-fill refresh exception takes care of issuing a fresh
request.

## Validation

- 735 Node tests pass (was 728; +7 from new trend + recall + safety
  tests).
- 185 Python tests pass.
- `tsc --noEmit` clean; `eslint` clean.
- Repository secret scan unchanged on changed files.
