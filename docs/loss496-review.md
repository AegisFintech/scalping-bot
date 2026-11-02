# Latest scalping loss and execution economics — ISSUE-496

The latest loss has no retained positive executable-side mark. Shortening its TP
alone is unsupported by the recorded path. The broader problem remains large
losses versus small after-fee wins, with material quote-to-fill differences.
This is retrospective DEMO evidence, not a strategy qualification or a code fix.

## Complete bounded cohort

The cutoff was fixed before this extraction: October29 00:00UTC through
November2 06:45UTC, release `0.8.0-model-scalp.1-codex.1`, one scoped XAUUSD demo.
The earlier [13-outcome review](completion489-report.md) keeps its original cutoff.
The [new evidence](evidence/loss496-review.json) includes all14 closes:10 positive,
four negative, gross−USD3,372.18, signed costs−USD1,876.64, net−USD5,248.82.
Fees are included once. All14 close costs and entry quantities reconcile.

Mean positive net isUSD93.579; mean negative net is−USD1,546.1525. The observed
positive share is71.43%. Arithmetic break-even at those observed dollar means is
94.29%, not an attainable or forecast win rate. Volumes/equity vary; these are
neither fixed-risk returns nor account-equity performance. Provider costs remain
unknown. Gross is already negative, so eliminating fees alone would not fix it.

The separately selected decision-created cohort contains4,058 local analyses,
36 groups/orders,14 with recorded fills/trades and22 without a recorded trade.
These are not paid-request counts. No recorded trade in that cohort is open at
the cutoff; current stored states do not reconstruct pending status as of cutoff
or prove a complete broker-flat account. The36 intent exports use separate
repeatable-read snapshots:14 CLOSED,14 EXPIRED,8 FAILED. No subset is promoted.

## Latest loss: November2 06:08–06:09UTC

BUY entry at06:08:36.917, exit at06:09:03.553; holding26.636seconds.
Exact recorded gross−USD1,299.23 plus signed fees−USD176.45 gives net−USD1,475.68;
swap and conversion are zero in this actual close. Two deal rows are entry and
exit, not two trades. Pre-intent reconciled equity isUSD69,002.02; this one net
loss is2.1386% of that recorded equity. The approved leg ceilingUSD1,725.0505 is
not actual filled stop risk or a guaranteed realized maximum.

| Observation                          | Price / distance  |
| ------------------------------------ | ----------------- |
| Requested entry                      | 3916.58           |
| Native STOP_LIMIT range              | 30 points         |
| Actual entry                         | 3916.86           |
| Verified broker SL / TP after fill   | 3915.45 / 3917.26 |
| Actual close                         | 3915.13           |
| Fill-relative target / stop distance | 0.40 / 1.41       |

The native acknowledgement is linked to the exact setup's immutable event hash;
its stop price, range and deadline are retained, with ordered clocks. A separate
validated metadata response at06:08:20.183090 reports pip/tick0.01, volumeScale0.01,
tickValue0.0001 and commissionUSD30 per million USD per side. It is an independent
metadata endpoint receipt, **not metadata captured with the original ACK**. Its
broker source time and hypothetical closing costs remain null. It does not satisfy
the future registered qualification under #407.

At that recorded scale, filled volume75,100 means751 units, and one broker pip
is0.01 price units. TP0.40 is40 broker pips; SL1.41 is141. Actual round-trip
fees176.45/751 equal0.2349534 price units, about23.4953 broker pips. Those actual
fees are58.74% of nominal target grossUSD300.40; hypothetical target-exit fees and
proceeds remain unknown. This is not a fixed USD7-per-lot cost calculation.

The fill is0.28 above the requested entry, within the acknowledged0.30 price-unit
range using the separate tick receipt. Native protection preserves the approved
distances from the actual fill: it did not accidentally retain the reference
TP3916.98. The last pre-close SL observation is3915.45 at06:09:02.526. Exit3915.13
is0.32 below it. The diagnostic class is NATIVE_AT_OR_BEYOND_SL, a price/type
comparison; the broker's exact exit cause remains unknown. No trigger is inferred
from P/L or that classification.

The last causal fresh ask before entry is3916.60,310ms before its fill; the fill
is0.26 worse. The last fresh bid before exit is3915.44,255ms before its fill;
the fill is0.31 worse. These sampled comparisons establish price differences,
not their cause, executable alternative fills or a broker malfunction.

## Flight: a shorter TP would not explain this loss

All14 matched chains were hash/sequence verified, end-sealed, uniquely matched
and have zero recorded GAP events. This does not establish complete tick coverage.
The latest chain has171 records. Its47 usable in-position quotes use the BUY's
closing bid, source/receive ordering and explicit side freshness; the best price
move is−0.25, with zero positive gross marks. The retained online summary has46
samples and best modeled net−49.50038 broker pips. These denominators differ:
offline reconstruction includes an early mark before the recorder had observed
the fill in its local lifecycle. Neither denominator proves a closing command
could have been sent then. Broker/fee latency and counterfactual net stay unknown.

All four losing paths remain visible:

| Close UTC          | Net USD  | Best sampled gross price move | Summary best modeled net pips |
| ------------------ | -------- | ----------------------------- | ----------------------------- |
| Oct29 16:37:46.384 | −1589.55 | +0.14                         | −10.07056                     |
| Oct30 02:56:45.854 | −1658.27 | −0.16                         | −39.98332                     |
| Oct30 18:18:01.232 | −1461.11 | +0.49                         | +25.72663                     |
| Nov2 06:09:03.553  | −1475.68 | −0.25                         | −49.50038                     |

Only one losing summary contains positive modeled net; it records4.790seconds
between positive samples. That is not guaranteed continuous profitable time or
an achievable exit. A gross-positive sample on the first loss did not cover the
recorded cost model. Earlier legacy-release positive excursions cannot be applied
to this current release or the latest loss.

Across all14 entries, adverse fill difference from the requested trigger is
0.12–0.30 (median0.235); difference from the latest usable ask/bid is0.12–0.30
(median0.20),223–313ms before fill. Four native-at/beyond-SL closes differ from
the last observed SL by0.28–0.46 (median0.33). These are descriptive price-level
comparisons, not attributable trigger slippage. Ten native-at/beyond-TP closes
retain their contrasting outcomes. No visible-depth inputs were supplied in this
review; missing ladder evidence is not proof of a liquidity shortfall.

## Hypotheses and next experiment

- **Protection-distance bug:** not supported in the latest trade; verified native
  distances match approved fill-relative0.40/1.41. No code or broker repair is justified.
- **Earlier positive exit:** absent from the latest sampled path; only one of four
  losing summaries has positive modeled net. Continuous/counterfactual exits are
  unavailable, so a blanket smaller TP is not an evidence-backed fix.
- **Fees and execution differences:** measured and material relative to targets;
  they do not explain all negative gross or identify a causal execution mechanism.
- **Late acceptance explains expiry:** falsified for the separate expired order;
  native acceptance06:06:14.028 preceded06:07:56.735 expiry by102.707seconds.
  Native expiry matched its deadline. The original model finding stays immutable.

Next compare entry-range and executable-side movement on complete chronological
cohorts using the existing causal replay, preserving nonfills, unknowns and actual
availability. A narrower range could avoid adverse fills but could also remove
winners or leave orders unfilled; it is a separately registered candidate, not a
runtime recommendation or a fill simulation from quotes. Keep exit research
separate. Native trigger attribution still needs broker evidence not retained by
this export; current metadata or later candles cannot reconstruct it. No external
news/DOM predictive claim is supported by this loss review.

After reviewed delivery, the existing research guidance can carry these bounded
facts into future scheduled reviews, with the audit's historical cutoff explicit.
It does not alter old findings, force a call or increase cadence/budgets; actual
guidance application and next-window verification are recorded on the issue.

Trading policy/prompt, TP/SL, lot/risk policy, services, database and all frozen
registrations/reports remain unchanged. No provider call or broker command was
issued by this audit. #289/#407/#466/#403 remain open for their separate acceptance.

## Reproduction and checks

Use the current SELECT-only `export_fill_evidence` and `export_entry_evidence`
CLIs with the fixed window above, then `fill_gap_review review` against existing
Flight recordings. `review-trading-diagnostics.ts` takes three positional arguments:
release, from, until. This run first rejected flag-style arguments before a database
read; the corrected unchanged CLI produced the retained complete cohort.

Exact input hashes, all14 path rows and unknown fields are retained in the linked
sanitized evidence. Private reconstruction/assertions and original-byte inventory
remain under root-owned loss496 evidence; no original recording was rewritten.
Assertions check28 deals,14 unique complete closes, all signed-cost equalities,
chain integrity/seals, exact ACK-event binding, metadata hash, native-range bound
and zero latest positive marks. Existing research code was reused unchanged;
no new runtime logic, dependency, wire schema or regression test is warranted.
Qualification and reviewed delivery status are recorded on
https://github.com/AegisFintech/scalping-bot/issues/496.
