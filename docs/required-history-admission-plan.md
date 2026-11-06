# Required-history admission: prospective design

Issue [548](https://github.com/AegisFintech/scalping-bot/issues/548), following
[the retained WAIT audit](wait-distinction-report.md). This batch characterizes
existing behavior and specifies a future change. It changes no runtime admission,
provider protocol, registered method, economic policy or deployed service.

## Reproduced boundaries

The real FastAPI route, request parser and worker run function are exercised with
an injected deterministic provider. No paid provider is called. Fixtures use the
frozen request1.18 protocol, preserve source/receipt clocks and retain exact input.

| Required M15 history                           | HTTP result | Injected provider calls | Trend geometry                |
| ---------------------------------------------- | ----------- | ----------------------- | ----------------------------- |
| Twelve contiguous completed bars               | 200         | 1                       | Existing rules apply          |
| Five completed bars                            | 200         | 1                       | Completed history unavailable |
| Internal, explicitly marked broker session gap | 200         | 1                       | Completed history unavailable |
| Unknown quality flag                           | 422         | 0                       | Not dispatched                |
| Capture older than worker allowance            | 503         | 0                       | Not dispatched                |
| Technical history target explicitly unmet      | 422         | 0                       | Not dispatched                |

Repeating an admitted request returns503 without a second provider call. Successful
responses retain executionAuthority=false. Rejected fixtures create no worker job.
The stale fixture advances worker time31seconds without rewriting market clocks.
These are synthetic boundary observations, not evidence that all cases occur in
production or that any unavailable history caused a particular model WAIT.

Actual PostgreSQL claim tests retain exact compact request bytes and SHA256 for
contiguous, short and marked-gap tails. They check REQUESTING state, unchanged
input and no orders. A database context claim is evidence retention, not proof of
provider receipt, a paid call or order authority. No minimum-history rule belongs
implicitly inside that opaque retention boundary.

The existing TypeScript geometry requires six clean M1 bars and twelve clean M5
and M15 bars. Internal session gaps can therefore be valid worker input while
unusable for that geometry. Separate tests confirm both cases retain the original
Codex WAIT reason. A recorded WAIT returns before geometry evaluation: a history
warning must never replace its reason or be represented as its proven cause.

## Smallest prospective change

Extract only the existing required-history predicate from trend geometry into one
shared TypeScript helper. Preserve its counts, completed flags, exact durations,
OHLC/tick checks, adjacency, latest-end age and quality-flag rules. Use it in both
geometry and the pre-provider coordinator; do not duplicate geometry in Python.
Tests must prove valid geometry is byte-for-byte unchanged.

Run this check after existing session, ownership, reconciliation, active-group,
cooldown and unknown-outcome checks, but before the new context/provider claim.
An unresolved old claim continues to block regardless of current history. Known
unusable required tails produce an explicit local history-warmup observation,
without fabricating a model WAIT, failed request, provider claim or trade outcome.
Missing or malformed evidence remains unavailable; it never becomes valid history.

Retain a bounded, durable observation with source/method, analysis linkage,
required timeframe/count, available count, original flags and separate broker and
local capture clocks. Observe at most once per new completed M1 snapshot; this is
proposed pacing, not a new runtime timer. Re-evaluate naturally with new completed
history and existing cooldowns. No interpolation, clock rewriting, provider forcing
or trend/ATR/target-room/cost prefilter is authorized by this proposal.

The compact serializer currently removes a session-gap marker only on the first
transmitted row, because that gap precedes the transmitted window. Geometry sees
its original input. Preserve both representations and test this edge explicitly;
normalizing original flags or changing which bars qualify needs separate review.

## Delivery and economic boundary

Do not rewrite frozen request1.18/1.19 contracts, trial definitions, registrations,
old observations or existing claims. Before implementation activation, specify and
freeze a separately versioned future source/method segment and its observation
window, including known-invalid, admitted, rejected, failed and unknown counts.
A registration made after outcomes cannot qualify those outcomes prospectively.

Implementation needs real coordinator tests proving no dispatch on known-invalid
history, recovery on a new valid snapshot, preservation of unknown claims and
unchanged session/quote/cost/risk/order gates. Exercise actual HTTP and DB paths,
including failure and restart behavior. Full qualification, four configuration
checks, fresh independent Standards/Spec review and exact-head hosted checks precede
protected delivery. Exact terminal proof, fresh reconciliation and an explicitly
reviewed forward handover precede replacing the frozen executor/provider source.
A newer reader checkout must never restart that executor.

After separately verified activation, retain natural warmup/recovery and authentic
provider dispatch receipts. Count avoided known-invalid calls against all eligible
checks; context rows alone are not paid-call accounting. Compare complete daily
realized net across releases after actual broker costs, retain zero-trade periods,
missing model spend and open P/L, and preserve complete cohort denominators.
Fewer calls and cleaner history establish neither profitability nor economic
qualification. Memory is not training. Issue548 stays open until its remaining
implementation, registration, handover and natural-evidence acceptance is met.

## Validation record

The first new WAIT fixture omitted required nullable proposal fields; it was
corrected before accepting its result. Type checking then identified readonly
fixture mutations; these were replaced with explicit fixture construction updates.
Neither failure concerned deployed behavior. Focused HTTP cases pass6/6; focused
trend geometry cases pass10/10.

The first three full runs exposed new integration-fixture defects: a claim before
trial activation, a mismatched strategy binding, then a no-order assertion naming
a nonexistent table. The fixture now waits for activation, uses the registered
strategy, shifts synthetic capture/quote/candle clocks together and queries actual
account-scoped order groups. All178 PostgreSQL tests then passed. That DB-focused
qualification reached Python and caught AGENTS prose below the protected publication
footer; moving the prose above the unchanged footer repaired the document contract.
No production guard or frozen template was relaxed.

Final full qualification passes2,985tests (1,347Node,178PostgreSQL,1,460Python), no
skips, and20checks. All four sample/protected configuration and startup checks pass.
Fresh independent Standards and Spec reviews are CLEAR for this foundation-only
batch. The [sanitized receipt](evidence/history548-validation.json) retains source
fingerprints and check results. Existing10moderate npm advisories remain below the
high-severity gate; Python reports one existing test-client deprecation warning.
Protected delivery is still subject to exact-head CI and authentic approval. This
batch changes tests and documentation only; issue548 and its runtime acceptance
remain open.
