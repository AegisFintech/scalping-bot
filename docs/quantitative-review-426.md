# Quantitative review: recent demo scalping

[Issue 426](https://github.com/AegisFintech/scalping-bot/issues/426) tracks the remaining analysis. This is an observational review, not a strategy promotion or a profitability claim.

## Closed outcomes

A read-only journal query selected demo trades closed from 2026-10-27 00:00 UTC inclusive to 2026-10-29 00:00 UTC exclusive, grouped by the recorded strategy version. For `0.7.3-quick-oco.1-codex.1`, all 67 closed outcomes comprised 62 positive and five negative results. Net was -4,825.61 USD, including signed fees of -3,716.57 USD. The mean winner was +65.28 USD, mean loser -1,774.57 USD, and worst loss -1,832.77 USD; median holding time was 94.591 seconds.

At those observed average payoffs, the arithmetic break-even win share is approximately 96.45% before any additional costs, compared with the observed 92.54%. This is a descriptive calculation, not a forecast. Volumes and equity vary, so the dollar means do not represent fixed-risk returns. Net outcomes alone do not identify exit cause.

## Flight coverage

Flight summaries matched the 67 trades by open/close times, direction and recorded net; one winning and one losing trade had duplicate summaries and were excluded from per-leg counts. Each of the remaining four losses had sampled quotes and recorded gaps; three had a positive modeled-net-pip sample. These sampled modeled observations do not establish an executable profitable exit, continuous tick coverage, actual closing costs or the outcome of an unexecuted exit. Reconcile timestamp and duplicate coverage before any counterfactual comparison.

## Current release

At the review time the journal contained no closed `0.8.0-model-scalp.1-codex.1` trades. Do not apply old-release outcomes as if they measured the current release. Its published contract permits, but does not require, a 0.40 price-unit TP and a 7.00 price-unit SL. At exactly those distances and equal per-unit payoffs, arithmetic break-even is about 94.6% wins before costs. Actual fees, volume, execution and broker protection determine realized outcomes.

The legacy diagnostic CLI admits only `0.3.0-fade-limit` releases. A version-aware, read-only review should preserve original trade and broker evidence, account for changing volume and equity, and measure actual fill-relative geometry, fees and sampled-path coverage. Design any exit or entry research around a frozen, chronological cohort with explicit missing data and unknown counterfactual costs. Economic-calendar and broker-depth data need recorded timestamps and provenance before they can support causal analysis; missing data is not evidence of a trading signal.
