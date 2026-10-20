# ISSUE-334 — Frozen breakout demo observation protocol

This is prospective collection for the explicitly authorized demo experiment,
not economic qualification, strategy promotion or authority to send orders.
Executable source fingerprint:
`71ff74f999c9ad08f45393a66864c1e5443626e5ff0d5a20f9d67d21f6647d9b`.
Strategy: `0.4.0-breakout-scalp.1-codex.1`; prompt: `entry-pair-v5`.
Fixed parameters are [the reviewed release constants](breakout-scalp-release-report.md).
Freeze this protocol and a private exclusive registration before activation; the
registration records future UTC start/end, source/prompt fingerprints and artifact
commit. Do not edit that registration, overwrite reports or alter parameters after
seeing results. A delayed rollout requires a new registration, retaining the old.

## Collection and cutoffs

The first operational observation is 24 hours with 15-second bounded GET-status
samples, retaining unavailable observations, sampling gaps, counter regressions
and readiness failures. This is sampled availability, not continuous uptime proof.
The durable broker/decision journal remains the source of lifecycle evidence.
No observer is given provider, broker, control, account-reset or promotion authority.

The economic collection batch is 30 calendar days with fixed UTC midnight daily
cutoffs and an explicit final partial-day cutoff. Retain every new-release analysis,
provider failure/unknown dispatch, rejected/deferred proposal and intent, not just
filled or completed winners. Preserve actual provider availability, accepted broker
events, first/late fills, both OCO legs, uncertain cancellations, full/partial manual
closes and native protection. Locally persisted `orders.submitted_at` is not broker
acceptance. GTC survives daily cutoffs; carry open groups as censored rather than
forcing a close, extending map authority or dropping them from denominators.

Report intent-created and actual-close-time cohorts separately. Actual net requires
complete closing deals/P&L/fees and reconciliation; retain open/partial/unknown
outcomes as unavailable. Broker close reason is unknown without explicit evidence;
P/L sign cannot prove TP/SL. Keep input and outcome time gaps, missing sampled
quotes and OCO ambiguity explicit. Recorded quantities are historical approved
quantities, not a dynamically resized counterfactual portfolio.

## Comparisons and limitations

The existing fade-only paired replay/export deliberately rejects this new release
and must not be relabelled or have its sides silently reversed for breakout.
Until a separately qualified causal adapter exists, alternate-entry and alternate-TP
returns, unknown counterfactual fees/swap/FX/margin and full-path comparisons remain
null/unavailable. The new trial's observed actual outcomes may be reviewed without
claiming they isolate prompt, direction, TP or regime effects.

A later causal adapter must obey ISSUE-253 provider/broker event order, GTC lifetime,
daily cutoff/gap/open/race censoring and unknown cost rules. It needs a new frozen
registration before collecting comparative outcomes. Do not select only complete
winning paths. A 30-day collection batch is not qualification; no automatic
promotion, parameter search or profitability claim follows a green subset.
Existing #319/#255 source, registrations and reports remain separate and unchanged.
Source drift halts research only; it does not reset, pause or authorize trading.
