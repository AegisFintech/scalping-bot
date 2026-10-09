# ISSUE-281 — Current contract and qualification evidence

Issue: https://github.com/AegisFintech/scalping-bot/issues/281.
Dependencies: #222 unattended operation, #255 frozen prospective research, #278
complete operational journal. This is a documentation and retained-evidence review;
no runtime, strategy, private configuration, financial state or study change.

## Current source contract

The primary architecture/configuration/risk guides previously called
`market-stop-v2` / `0.2.5-market-stop.11` current and described the equal-distance
ISSUE-099 trial as current behavior. Their headers now identify
`0.3.0-fade-limit.3` / `entry-pair-v4` and distinguish historical releases.
Archived implementation reports retain their original evidence.

Source authority is `packages/config/src/policy.ts`, with active policy wiring in
`apps/execution-service/src/index.ts` and deterministic transformation in
`apps/execution-service/src/coordinator.ts`. The current fade constants are LIMIT,
14 completed M1 ATR bars, stop 2.5×ATR, target 2.0×ATR, minimum proposal reward/risk
0.75 and adverse execution reserve 65 points. Intended reward/risk is about 0.8;
broker precision and actual fills affect realized geometry. The model levels are
replaced by quote-adjacent entries, so prompt-only improvement is not established.

Literal requested/returned Grok identity is `grok-4.5`, low reasoning, prompt v4,
with no silent fallback. Provider calls remain durably claimed, scoped and bounded;
unknown dispatches retain their cooldown. The model never sets size or mode.

Both race-exposed legs share at most 1% of current reconciled equity, after costs,
broker volume steps and exact margin checks. Demo uses multiplier 1 without daily
or high-water loss enforcement; measurements and locks still persist. Other modes
retain remaining daily capacity and reductions. The guide's sizing equation now
separates these modes and identifies the production 65-point reserve separately
from historical 30-point and generic 10-point defaults. No account-equity floor,
fixed lot or loss-chasing rule is introduced.

Fresh broker-calendar/session checks precede analysis, provider dispatch and each
new demo leg; cached metadata is valid for 30 seconds. Normal market-open waiting
is required when admission fails. Protection, ownership, reconciliation, emergency
controls and unknown-outcome handling remain independent. Live stays disabled.

## Deployed persistence discrepancy and source correction

The pre-fix fade source has a 30-bar trend check, a three-loss/60-minute admission
pause and `OrderMaintenance.recallStaleBrackets()`. The latter is invoked by the
independent maintenance loop and can cancel owned orders when their context expiry
is over 30 minutes old. It is not broker GTC expiry. Its SQL also includes partial
and unknown states; the downstream cancellation/reconciliation path remains relevant.
The authoritative AGENTS.md requires accepted GTC persistence and prohibits timed
cancellation. These descriptions cannot both be treated as one consistent contract.

ISSUE-283 removes context-age recall from the source operating path while
preserving OCO/emergency/protection cancellation and immutable historical evidence.
See [source fix and tests](persistent-gtc-maintenance-report.md). This does not
change the already deployed artifact: its recall behavior remains a deployment
limitation until separate verified activation. Runtime rollout must be explicit; the original #255 source
and registration must not change. Trend/loss-streak economic changes are outside
this evidence review and require their own evidence/release.

## ISSUE-222 acceptance matrix

Fixed event cohort: October 5 05:36:05 UTC through October 9 01:35 UTC. Existing
read-only repeatable database audit used a ten-second statement timeout and no
writes. Current collector/research summaries use cutoff October 9 02:32:15 UTC.

| Acceptance                                          | Verified evidence                                                                                                                                                        | Remaining proof / status                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| At least 24 market-open hours without manual unlock | New journal: 95 samples, 1,452,811 sampled-ready-open ms, five unavailable/not-ready samples, zero >45-second gaps                                                       | Adjacent samples are not independent broker-calendar coverage or proof of no manual unlocks. UNQUALIFIED.                                                                                        |
| Multiple protected fill/close/new-cycle transitions | 34 demo closes in 33 groups; all 34 have matched pre-intent equity/full entry volume and sampled protection, with 13,448 verified samples and zero sampled missing stops | Counts alone do not prove exact SL/TP acknowledgments, complete terminal orders, peer cancellation or next-cycle admission. Link each owned lifecycle before counting protected cycles.          |
| Normal restart                                      | Qualified pinned release activation and market-worker restart in the existing activation receipt; collector restart preserves journal registration/prefix                | Collector restart is separate from trading recovery. The initial overly strict snapshot drill failure remains retained; subsequent bounded snapshot verified recovery.                           |
| Reconnect/dependency failure                        | Qualified mock/database failure tests and bounded retry implementation                                                                                                   | Production prospective request-generation/subscription/quote/reconciliation recovery has not been independently traced. A normal restart does not substitute for this.                           |
| UTC rollover                                        | One reconciled daily row on each UTC date October 5–9                                                                                                                    | Verify ordered rollover and admission against original journal/accounting evidence; row existence alone is partial proof.                                                                        |
| Existing alert delivery                             | 96 HIGH_CPU events joined to DELIVERED outbox records                                                                                                                    | This is configured transport acceptance, not human receipt. Last acknowledgment 01:35:01.637 UTC follows the event cutoff; no claim that delivery was complete at cutoff. No new alert was sent. |
| Current paired backup restore                       | None claimed                                                                                                                                                             | Explicitly deferred by operator; qualification remains incomplete. Existing timers are preserved.                                                                                                |

The existing read-only diagnostics tool independently reviewed the same fixed
34-close cohort. Its matched fills and sampled SL/TP evidence improve attribution,
but do not prove uninterrupted protection, complete peer-terminal outcomes or the
next admission. Exact filled stop risk and exit reason remain null. Retained private
output: `/tmp/scalper-281-lifecycle-diagnostics.json`.

Collector integrity/registration verification passed; the reported retained tail is
`eac47cd420c3bac09a55e79b7e3442101e5f5900df93771daa7b54fbc7fc83a2`.
The five unavailable samples remain in the report. Session cache expiry on GET
status is not alone evidence of a broker outage; review contemporaneous errors.

Read-only repeatable summary, with a fresh explicit UTC cutoff and a new private
output path (never overwrite a previous report):

```sh
umask 077
/opt/scalper-node22/bin/node /opt/ctrader-ai-scalper/observers/issue-278-141c7a3/dist/scripts/observe-operational-evidence.js \
  --summary /var/lib/ctrader-ai-scalper/observations/issue-278-141c7a3/journal.jsonl \
  --as-of EXPLICIT_CURRENT_UTC_TIMESTAMP > NEW_PRIVATE_SUMMARY_PATH
```

The collector ends October 16 02:04:53.575 UTC. Reaching that deadline does not
satisfy the missing calendar/lifecycle/recovery/restore criteria automatically.
See [operational journal contract](operational-evidence-report.md) and
[retained trading restart evidence](release-activation-report.md).

## ISSUE-255 remaining collection and review

Trusted registration/checksums and all six retained windows verify at the stated
cutoff; zero due windows are missing. All entry/TP base/stress denominators and
censored paths remain retained. Actual prospective cohort: 39 closes, 21 wins,
gross -690.77, signed costs -991.53, net -1682.30, all 39 with matched close evidence.
This overlaps other reviews and must not be added to them or called account return.
Counterfactual net economics and provider costs remain null; decision HOLD.

The existing research timer continues collection against the original registration
through November 1 04:00 UTC. The last window is eligible after its ten-minute
reporting delay, then the timer's next invocation. No new window, candidate,
report overwrite or winner-only subset is authorized by this review.

```sh
umask 077
.venv/bin/python -m python.backtest.forward_summary \
  --directory /root/scalping-bot/.runtime/forward-study-255 \
  --study-sha256 728f121460868714b773b369ca31cc63551ca1023572c41c1d9a71f8953e9d8f \
  --as-of EXPLICIT_CURRENT_UTC_TIMESTAMP --output NEW_PRIVATE_SUMMARY_PATH
```

After all 30 windows exist, verify every envelope/source/input digest, actual-cost
reconciliation, excluded/censored/open denominators and missing windows. Preserve
negative paths. Retained conditional sampled replay is not a dynamically resized
counterfactual portfolio; unknown fees/swap/FX/margin cannot be invented. Completing
collection only supports a collection report, not strategy qualification/promotion.
See [frozen protocol](forward-observer-report.md), [paired replay](paired-replay-report.md)
and [actual cost/payoff audit](cost-payoff-audit-report.md).

## Delivery and validation

Only Markdown guides, this report and plan.md change in this batch. No behavior,
schema, migration or environment contract changes; no trading restart/drill or
backup operation. Retained journal/anchor and prospective summary verification
passed using existing qualified tools. Applicable formatting/secret checks and
full hosted qualification are required before merge; exact results follow below.

Changed-file Prettier and `bash scripts/secret-scan.sh` passed before source commit
`e20dae14949c8f913e3c03c392436997ac8cb79e`. Both full hosted qualifications on that
head passed: pull-request run 37875193371 and push run 37875189690. They execute
`npm run qualify` with Node 22/Python 3.13 and isolated TLS PostgreSQL: formatting,
lint, TypeScript/Python types, isolated build, Node/schema/migration/fail-closed
and database/Python tests, secret scan and both dependency audits. No production
DB writes. The documentation receipt receives its own full hosted checks before
merge. Remaining acceptance evidence stays partial as recorded above.
