# ISSUE-102 — Fade-limit strategy release 0.3.0-fade-limit.1

Deterministic transform that turns the journaled entry-pair levels into
maker LIMIT brackets. Builds on the LIMIT execution plumbing from
ISSUE-101 and the validation evidence from ISSUE-100.

## Geometry and release constants

`packages/config/src/policy.ts` adds `FADE_LIMIT_RELEASE`:

| field | value | meaning |
|---|---|---|
| `orderType` | `"LIMIT"` | routed through `placeLimit` |
| `adverseSlippagePoints` | `"65"` | calibrated to measured 0.62 average stop-side overshoot |
| `atrBars` | `"14"` | M1 ATR window for the geometry |
| `slAtr` | `"2.5"` | SL distance = 2.5 × ATR(14) |
| `tpAtr` | `"1.0"` | TP distance = 1.0 × ATR(14) (reward ~ 0.4 × risk) |
| `trendFilterBars` | `"30"` | (deferred — future iteration) |
| `bracketRecallBars` | `"30"` | (deferred — bracket replacement) |
| `streakLosses` / `streakPauseMinutes` | `"3"` / `"60"` | (deferred — losing-streak pause) |
| `minRiskRewardRatio` | `"0.3"` | honours the fade 1:2.5/1:1 risk reward |

`POLICY_VERSION`, `STRATEGY_VERSION` and `CODE_VERSION` are bumped to
`"0.3.0-fade-limit.1"`. The risk-policy schema adds the new release as a
sibling of `"market-stop-v2"` for the demo unlock branch (ISSUE-094);
historical percentages remain pinned at 1% / 5%.

## Transform

`apps/execution-service/src/proposal-transform.ts` adds
`applyFadeLimitExitPolicy`:

- Long-fade leg: BUY at `response.sell_stop.entry_price` (support),
  SL = entry − slAtr × ATR, TP = entry + tpAtr × ATR.
- Short-fade leg: SELL at `response.buy_stop.entry_price` (resistance),
  SL = entry + slAtr × ATR, TP = entry − tpAtr × ATR.
- Tick-aligned, single-pip rounding, bounded by `maximumStopDistance`.
- Sets `setup_tags: [..., "DIRECT_FADE_LIMIT_PAIR_OCO"]`; preserves
  schema_version 2.1 and downstream audit fields.

The provider layer is intentionally untouched: the model still emits the
same levels as before, and the local transform interprets them in the
new order direction. No provider call schema or prompt change required.

## Wire

`apps/execution-service/src/coordinator.ts` selects the fade transform when
`this.#options.executionOrderType === "LIMIT"`; the existing
`applyCommissionAwareExitPolicy` path remains unchanged for the STOP
releases. Both paths feed the same `validateSemantics` + `risk.evaluate` +
budget re-checks; the `OCO` evaluator constructs two LIMIT commands
(`rounding loss_reward_ratio ≈ 0.4`, accepted against the release's 0.3
ratio). `apps/execution-service/src/index.ts` activates the policy
when `STRATEGY_VERSION` starts with `"0.3.0-"`.

## Risk-engine thread

The ISSUE-101 reservation logic already handles the LIMIT branch: maker
entries skip the entry-side price uplift in `stopCostReserve`; the
stop-side overshoot reserve (`65` points) carries through. `executionOrderType`
flows into `PositionRiskInput` so the cost math matches the simulation
calibration.

## Deferred gates (next iteration)

The simulation evidence supports keeping the simpler two-leg LIMIT pair
without filtering, but three gates remain valuable for live deployment:

1. **Trend filter** (`trendFilterBars:30`): keep only the trend-following
   leg; reduces whipsaw loss on trend days and matches the strongest
   simulator cells (`v1-fade-*-tr30`).
2. **Bracket replacement** (`bracketRecallBars:30`): cancel owned
   unfilled pendings whose context has expired and queue one fresh
   request under the existing `zeroFillTerminalProof` exception
   (ISSUE-089). Keeps brackets tethered to a recent level when a fade
   gets ignored.
3. **Loss-streak pause** (`streakLosses:3 / streakPauseMinutes:60`):
   block new analysis/placement until the third consecutive loss is more
   than 60 minutes old (matches the serial-stress simulation gain).

Each gate keeps the ISSU-101 LIMIT plumbing as the substrate and only
adds an admission predicate + a fade-tag setup decision. No new contract
fields.

## Demo rollout

ISSUE-103 deploys to the demo account with realized-slippage and net-EV
telemetry plus a bounded observation window. The release is profitable
in the journaled-4-days+backfilled-8-weeks replay only when these
admission gates are also enabled — the deferred gates will land in the
next iteration once the baseline telemetry is in place.

## Validation

- 728 Node tests pass (`tests/schema/risk-policy.test.ts` adapted).
- tsc / eslint clean.
- Repository secret scan clean on changed files (pre-existing false
  positive on the `risk-budget-recovery-report.md` filename remains).
