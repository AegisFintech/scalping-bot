# ISSUE-109 — Bounded automatic strategy improvement

The bot now has a research-only auto-improvement evaluator. It runs the
existing replay variant family through expanding-train, forward-test folds with
an embargo gap, serial one-position behavior, measured costs, and stressed
costs. ISSUE-251 supersedes its recommendation behavior: it now always emits
`HOLD` with explicit replay-fidelity blockers, even if the statistical screen
passes. See [the qualification report](research-evidence-gate-report.md).

The evaluator cannot place orders, change risk, change protection, modify the
active release, or authorize live execution. A candidate must be selected
repeatedly, remain profitable on unseen test folds after stressed costs, and
meet a minimum sample before it can be reviewed for a separately versioned
release. Those statistical conditions alone are insufficient: the current
OHLC simulator is not production-equivalent. Insufficient history also
produces `HOLD`.

Run it with:

```sh
.venv/bin/python -m python.backtest.auto_improve \
  --input artifacts/variant-inputs-full.json \
  --output artifacts/auto-improvement.json
```

This uses a 28-day expanding training window, a one-day embargo, and a
seven-day forward test by default. The report records the number of variants
tried so repeated experimentation is visible. This is intentional: selecting
the best result from many trials without accounting for selection bias can
make a losing strategy look successful.

The references below motivate further validation; this implementation does not
compute a Deflated Sharpe Ratio or establish control of multiple-testing bias.
Its purge and embargo do not cure missing model-availability timestamps,
non-causal cost calibration, unresolved outcomes or execution mismatch.

References:

- [Deflated Sharpe Ratio](https://doi.org/10.2139/ssrn.2460551), which addresses
  selection bias from trying many variants and non-normal returns.
- [Purged and embargoed financial time-series splitting](https://ppuertos.github.io/financial-ml-core/reference/model_selection/split/),
  which removes overlapping labels and an immediate post-test leakage window.
