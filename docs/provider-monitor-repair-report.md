# Provider and monitoring repairs — ISSUE-528

## Verified failures

On November4, the frozen0.10 executor was operationally ready, but both completed
Codex allocations had no fills:22 `AI_ANALYSIS_FAILED` and1 `SCENARIO_INPUT_STALE`.
An offline reconstruction from immutable request/prompt evidence reproduced three
`extra_forbidden` errors before provider dispatch: `modeled_stress_round_trip_cost_price`,
`base_exit_reserve_ticks`, and `stress_exit_reserve_ticks`. No worker job was created.
The earlier description of all23 as provider failures was too broad: these are
failed proposal contexts, not evidence of23 paid inference calls.

The worker's trial-only1.16/1.17 payload now requires those executor-emitted fields,
validates the5/65 constants and ordered base/stress costs. Earlier request versions
remain unchanged. Matching JSON Schemas and actual HTTP-boundary fixtures are updated.
The archived failed request now parses and its prompt hash matches exactly; this
is an offline compatibility check, not a new provider request or trade. A simulated
WAIT receipt also completed the worker cycle using the archived input at a causal
post-quote clock; no provider or broker was called.

The daily scorecard's read-only1,500ms query timed out in `demo_trial_closed_group`.
It evaluated expensive proof functions even for contexts without groups and groups
in irrelevant states. CASE guards now avoid those calls while retaining the exact
proof functions for eligible groups, including EXPIRED zero-fill groups. The same
actual scoped read completes in approximately0.73seconds, with23 allocations and
net1,184.45USD. A heavy-disk load probe still exceeded the bounded lifecycle timeout. The optional
trial census now runs behind a savepoint after daily accounting is computed. On
query/validation failure, rollback preserves the same read-only snapshot's daily
results and returns `trialOutcomesReadState: unavailable`; the UI explicitly says
counts are not zero. A successful census is `ready`. The real database test forces
a statement timeout and verifies daily results survive without invented proof.
Limits/timeouts and unknown/unproven accounting are unchanged.
A database regression makes the irrelevant proof call fail and exercises the actual
Python loader against a migrated isolated database.

The witness failed its2GiB disk reserve. Removing only disposable npm/pip/compiler
caches and the unused headed-browser download recovered approximately550MB; headless
browser and all trading evidence remain. Free space initially recovered to2.55GB. Separately, identical dependency files
in five protected historical releases were checked against manifest hashes and
actual bytes, ownership and permissions, then atomically hardlinked to the existing
verified reader release. This preserved every pathname/content and recovered a
further1.73GB, leaving4.19GB free; no runtime/history/rollback file was removed. The normal
read-only witness then retained22 completed allocations, six distinct filled
profiles with successors, and bound actual restart proof. Its safe storage/capacity/
staleness reasons are now visible on `/learning`, without exposing raw exceptions.
Daily display adds average positive/negative close-deal payoff; no-loss/no-win is
unknown, not zero. Averages are rounded to10 decimal places; underlying sums remain exact. Partial deals are not represented as position win rates.

## Loss evidence and limits

Snapshot November4 at06:10UTC, scoped to the new0.10 trials:

| Singapore day      | Closed outcomes | Wins / losses | Net after signed fees |
| ------------------ | --------------: | ------------: | --------------------: |
| November3          |              23 |         22 /1 |           4,068.58USD |
| November4, partial |              11 |          8 /3 |          -2,884.13USD |

Combined1,184.45USD excludes earlier strategies and open P/L, not account return.
Today's average winning outcome271.99625USD versus losing1,686.70USD means one
average loss offsets about6.2 wins. This does not identify an exit cause.

| Profile | Open / close UTC   | Direction |       Net | Signed fees included |
| ------- | ------------------ | --------- | --------: | -------------------: |
| SL_005  | 03:51:16 /03:56:22 | LONG      | -1,677.22 |               -69.94 |
| SL_010  | 04:14:28 /04:22:42 | LONG      | -1,729.46 |               -54.71 |
| SL_010  | 04:34:18 /04:40:39 | SHORT     | -1,653.42 |               -81.34 |

The corresponding planned stop distances were5.34,6.90 and4.22 price units against
1.00-unit planned targets. Actual entries were adversely displaced by0.26,0.25 and
0.27 respectively from requested triggers. These are order-intent geometry and
actual entry observations, not proof of final protection geometry or exact exit cause.
They reinforce investigating entry execution and loss asymmetry, rather than
assuming another smaller target would have saved the trades.

No usable Flight excursion samples exist for these three outcomes. First two have
no retained matching summary; third has an empty leg list and2,050 gap records.
Storage recovery cannot reconstruct missing quotes. No claim that any became
profitable or that a shorter TP/timed exit would have won is supported. Preserve
these negative outcomes and missing-path censoring in every comparison.

## Next controlled experiments and decisions

Keep the active catalogue/source frozen. Follow-up [issue529](https://github.com/AegisFintech/scalping-bot/issues/529) tracks implementation. New candidates require separate future
registration, reviewed implementation and exact terminal handover, never edits to
an active profile. Capture decision-time quotes, spread/commission, model/placement
latency, native protection, fill and exit evidence, sampled MFE/MAE and explicit gaps.

1. Structural loss cap: compare the unchanged baseline to a candidate rejecting
   entries whose structural stop exceeds the frozen target multiple. Do not move a
   stop into invalid structure, enlarge lots or retrospectively select winners.
2. Holding-time candidate: retain native protection and study a180-second exit after
   actual fill. Unknown close latency/slippage/fees remain null; historical prices
   alone cannot assert execution or authorize an automated market-close path.
3. Failed-breakout candidate: study exit after the first completedM1 candle closes
   back inside the entry range, causally after fill and data availability. No reversal.

Use all registered opportunities, WAIT, failures, zero fills, open/gapped paths and
negative outcomes. Predefine a minimum20 closed positions over at least5 market
sessions per candidate as a review floor, not statistical qualification. Compare
net after actual costs, average payoff, loss tail, time exposed and uncertainty.
Provider/recorder failures trigger engineering repair; insufficient paths trigger
more collection, not a winner declaration. Reject a candidate if it breaches its
execution/risk contract. Economic continuation/retirement needs independent review;
no hourly ranking, automatic winner promotion or guarantee of positive days.

## Delivery and activation

Issue528 covers operational repairs and the loss audit. Economic implementation and
future registration are separate follow-up work; no active TP/SL, size, source,
profile, provider claim, accounting baseline or broker order is changed by this PR.
Worker deployment uses its newly verified code but the unchanged protected original
prompt/manifest path to bind the frozen executor's source. Reader/witness deployment
is separately attested. Preserve the failed contexts; verify the next naturally
admitted Codex request rather than replaying them or forcing a paid test.

Full qualification passes: 1321 Node, 165 PostgreSQL lifecycle,
1376 Python tests (2862 total), no skips. All formatting/lint/types/build,
secret scanning and dependency audits pass. All four sample/deployment policy/startup
configuration checks pass. Independent Standards and Spec reviews are clear. Real
read-only probes and desktop1440/mobile390 preview pass with zero JS errors/overflow.
Command: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`.
[Validation receipt](evidence/provider-monitor-repair-validation.json).

Earlier runs remain failures/interrupted: review exposed decimal/schema and malformed
clock issues; Python type checks required Decimal sum seeds and typed safe returns;
the README note initially violated the publisher's final-marker template; savepoint
indentation needed two SQL line wraps. No failed run is counted as qualification.
Exact-head hosted CI and isolated deployment/readback remain pending; their actual
receipts will be recorded on issue528. Next natural Codex receipt is separate from
offline compatibility and software qualification.
