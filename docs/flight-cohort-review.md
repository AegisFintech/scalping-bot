# Complete daily cohort and Flight gap audit — ISSUE-545

The existing recordings support a payoff-imbalance diagnosis, not a repeatable
winning rule. Replaying the recorder reproduces the recorded quote gaps; no
recorder repair or trading-policy change is justified by this audit. Keep the
current registered trend experiment, its cost-aware admission and native protections.

## Scope and complete denominators

The fixed close/event cutoff is November5 11:58:42.968341UTC, beginning November4
16:00UTC (the Singapore calendar day). This is a partial day. Close deals/fills
were exported at that cutoff; group terminal state was read at12:31:29UTC and
context/profile/candle details at the supplemental snapshot recorded in the
[evidence](evidence/flight545-cohort.json). Later reads establish stored state,
not historical broker-flat proof. Contexts completed after the cutoff are labeled
NOT_KNOWN_AT_CUTOFF; no outcome is inferred from timing proximity.

All16 scoped close deals belong to0.10. Gross is-287.35USD, actual signed costs
-1,558.78USD and recorded net-1,846.13USD. Twelve wins total4,019.98USD; four losses
-5,866.11USD. Mean win334.9983USD versus mean loss magnitude1,466.5275USD gives
about4.38times payoff asymmetry. Dynamic volume/equity differ; these dollar means
are not fixed-risk returns or a stationary forecast. Model spend, open broker mark,
external cashflows and account return remain unknown.

There are72 day-created groups:15 closed,45 expired and12 failed. Existing database
terminal-proof functions establish15 closed and57 zero-fill groups; no group is
unproven at the later read. The16th daily close is a carry-in group created before
the day. Its exact context/trial link identifies TP_060; it is not assigned by
nearby timestamps. No day-created group is attributed to0.11 at the cutoff.

The requested-context cohort separately contains363 old-release contexts:
289WAIT,1FAILED and73other ready proposals. It is not the72-group denominator:
a ready proposal need not become a group. Current0.11 has239 requested contexts,
234WAIT and5FAILED. This aggregates the release across its source handover;
it is not239 observations from only the latest source. Contexts are neither
paid-call/billing counts nor all market opportunities.

## What the original Flight gaps mean

All16 original raw chains pass existing hash/sequence verification and end seals.
The32 recording/summary files have a retained SHA256 inventory. File integrity
and quote coverage are different properties.

| Recorded reason              | Events | During broker-recorded position interval |
| ---------------------------- | -----: | ---------------------------------------: |
| NO_FRESH_QUOTE               |     84 |                                       77 |
| QUOTE_TIME_DISCONTINUITY     |    100 |                                       92 |
| QUOTE_SIDE_FRESHNESS_UNKNOWN |      1 |                                        1 |

These are185 warning events, not185 distinct missing intervals: a quiet warning
and the resumed quote's discontinuity can describe the same interruption. Phase
uses each record's local observedAt against broker fill times; those clocks are
not assumed synchronized closely enough to resolve boundary instants.

The replay drives the unchanged Flight constructor, lifecycle update, quote and
publish methods with original recorded events and observation times. All16 chains
reproduce their non-quiet gap-reason sequences exactly. All84 quiet warnings
satisfy the existing no-quote/source-age-over3seconds predicate. The100 accepted
quote discontinuities are forward intervals: minimum3.228s, median4.697s,
maximum18.015s; no accepted source-clock reversal was found. A valid metadata
fixture enables the quote path; its modeled cost/excursion results are discarded.
This replay tests clock classification, not historical fee reconstruction.

No ring overflow, quote sequence gap or recorder read/source failure is recorded
in these chains. That does not prove the upstream broker/adapter delivered every
tick or identify why the source was quiet. Historical missing ticks cannot be
recovered from these files. The one side-freshness warning remains unknown rather
than being interpolated. Keep3-second freshness, causal side checks and gap markers.
Calling all these warnings recorder bugs, suppressing them or increasing freshness
limits would conceal missing evidence. No code defect was reproduced, so no new
runtime abstraction, dependency or speculative patch was added.

## Complete profile comparison

| Historical profile | Day-created groups | Proven closed | Proven zero-fill | Daily closes including carry-in | Wins | Recorded net USD |
| ------------------ | -----------------: | ------------: | ---------------: | ------------------------------: | ---: | ---------------: |
| ENTRY_CODEX        |                  2 |             0 |                2 |                               0 |    0 |                0 |
| ENTRY_RANGE_3      |                  4 |             0 |                4 |                               0 |    0 |                0 |
| ENTRY_RANGE_5      |                 28 |             9 |               19 |                               9 |    8 |         1,071.86 |
| RANGE_010          |                 14 |             0 |               14 |                               0 |    0 |                0 |
| SL_005             |                  4 |             3 |                1 |                               3 |    1 |        -2,418.50 |
| SL_010             |                  7 |             1 |                6 |                               1 |    1 |           341.82 |
| TP_060             |                  0 |             0 |                0 |                               1 |    1 |            92.12 |
| TTL_060            |                 13 |             2 |               11 |                               2 |    1 |          -933.43 |

Zero here means no recorded close-deal P/L, not zero operating cost or a successful
profile. ENTRY_RANGE_5 is the positive exploratory subgroup; nine closes across
sequential, different market periods do not establish a champion. SL_005's poor
three-close result does not establish that every stop buffer is harmful. The
narrower RANGE_010 has14zero-fills; its zero net is not14saved losses. Preserve
original definitions and all nonfills; do not roll back to a selected old profile.

## Conditions that distinguish outcomes, and those that do not

| Measurement                                  | Twelve winners | Four losers | Interpretation                                                        |
| -------------------------------------------- | -------------- | ----------- | --------------------------------------------------------------------- |
| BUY / SELL                                   | 6 / 6          | 2 / 2       | Direction alone does not separate outcomes.                           |
| Decision quote spread, median (price units)  | 0.085          | 0.100       | Distributions overlap:0.05–0.11 vs0.08–0.11.                          |
| Last fresh pre-fill quote spread, median     | 0.075          | 0.100       | Execution diagnostic, not an entry-time causal filter.                |
| Completed five-M1-candle range, median       | 3.725          | 3.615       | Overlap; no demonstrated volatility separator.                        |
| Sum of two absolute M5 close changes, median | 3.245          | 2.785       | Overlap; this is a stated magnitude proxy, not a fitted indicator.    |
| Planned gross reward/risk, median            | 0.269          | 0.276       | Both old-release groups had small reward relative to stop distance.   |
| Actual holding seconds, median               | 67.1345        | 311.6395    | Outcome-dependent duration; cannot authorize a profitable early exit. |

Decision features come from exact retained provider inputs and completed candles
known by their captured/available clocks. Fee and geometry diagnostics use Decimal;
all16 closes have the required context. The evidence keeps individual rows,
minima/maxima and missing counts. UTC close-time bands are descriptive only, are
chosen retrospectively and cannot be used as entry-session gates. Trend direction
matches trade direction for all16; that common condition does not explain which
trades won. Buy closes total-1,356.23USD and sell closes-489.90USD.

All12 positive closes compare at/beyond the last verified native TP; all four
negative closes compare at/beyond SL. These are order-type/price classifications,
not authenticated broker trigger causes. Original paths contain missing intervals;
no continuous profitable window, hypothetical earlier fill, better stop or saved
loss is established.

## Prospective action and rejection rules

1. Retain the already registered0.11 immediate/confirmed/retest comparison. It
   already requires at least1:1 modeled net reward/risk at actual sized volume,
   absolute structural protection and95/65-point sizing reserves. This addresses
   the old payoff geometry as a testable design, not as proof of realized improvement.
2. Keep the existing unprivileged trend observer and original source/method pins.
   Check fresh natural windows, gaps, every WAIT/failure/proposal/nonfill/close and
   actual signed costs. Failed or unknown provider work is never replayed.
3. Review the complete finite programme at its registered end, including zero-trade
   outcomes. The existing20-close/5-session floor is a minimum for an economic
   review, not qualification and not permission to extend/reset allocations until
   a desired result appears. Below that floor, report INSUFFICIENT_EVIDENCE.
4. Any new spread, volatility, holding or profile hypothesis needs a separate frozen
   method/source, future registration, complete chronological comparison and
   independently reviewed evidence before economic activation. Current exploratory
   medians provide no new threshold. New-source collection cannot silently replace
   existing frozen reports. Missing paths/counterfactual costs remain unavailable.
5. Reject a proposed improvement when gains require discarding losses/nonfills,
   arise only in a selected retrospective subgroup, or depend on unobserved fills.
   Report costs, loss concentration, coverage and partial/full-day status together;
   a higher win rate alone is not acceptance. Economic parent403 remains open.

This batch completes the bounded545audit. It does not complete prospective
profitability research or add an automatic promotion/strategy-rewriting service.
No executor/provider/Flight restart, broker command, risk change, live activation,
financial reset or original recording rewrite was performed.

## Persistent collection verified

At the recorded545check, five natural windows span10:00–12:30UTC. All five
input/report pairs reproduce exactly under the original frozen539method, match
its registration/source digests and retain no missing prior windows. The method
fingerprint isc67693bd1aa91d26d1c9ab3e7062fcccf79f749ec400a2db71268fccfa1af065.
Registration preceded10:00UTC; the existing30-day registration remains unchanged.
[Forward verification](evidence/flight545-forward.json). Flight and the trend timer
are active; no failed systemd unit was observed. These reports retain WAIT, failed,
unavailable and cutoff-unknown contexts, with zero recorded setups. A healthy
collector is verified; profitable or automatically promoted behavior is not.

## Reproduction and validation

Private original fills, close deals, recorder review, exact context projections,
replay/SQL assertion scripts and the32-file inventory are retained under
`/mnt/sdb/scalper-review-20261105/win-loss-1200`, with private permissions. The
public evidence binds those inputs/scripts by SHA256 and includes sanitized rows.
Use existing export_fill_evidence.export, fill_gap_review.review/chains and
setup_flight_recorder.Flight; the clock replay uses original lifecycle/quote records,
not reconstructed market candles. The audit scripts assert16deals, unique matching
entries/closes, exact net/cost totals, complete profile binding, terminal-proof
counts and all replay verdicts; temporary replay files were removed.

Recorder bytes match the deployed frozen Flight artifact. Executable-source
fingerprint remainsd63d4f14dba259da731d51cda8209aa8947fec283111d84280f971d47e46e4eb;
this is documentation/evidence only. [Fresh full qualification](evidence/flight545-validation.json) passes20checks and
2,961tests with no skips (1,345Node,175database,1,441Python). All four sample/protected
policy/startup configuration checks pass. Both fresh independent review axes are
CLEAR, including separate original-chain replays. The actual current audit reports
10moderate npm findings; the high-severity gate passes. The existing Starlette/httpx
deprecation warning remains. Final documentation formatting and secret scans pass;
protected exact-head hosted CI and independent approval precede merge. No runtime
deployment is needed for this report.
