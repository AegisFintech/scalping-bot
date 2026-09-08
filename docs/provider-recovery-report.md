# ISSUE-080 — Missing orders and provider recovery

Date: 2026-09-08. Issue: [#190](https://github.com/AegisFintech/scalping-bot/issues/190).
Branch: `issue-080-provider-recovery`; source `0.2.3-equity-risk.6`.
Status: implemented, validated and deployed to the previously authorized demo. Policy remains `fixed-risk-v4`.

## Incident evidence

At 12:19 SGT the demo broker confirmed zero open positions and zero pending orders,
with equity/balance/free margin USD 999,832.16.
[Sanitized incident record](evidence/provider-recovery-incident.json). The preceding `.4` release had
submitted ten STOP_LIMIT orders in five pairs at 10:35, 10:46, 11:12, 11:30 and
11:35 SGT. Broker acceptance events exist for all ten. Eight expired; two sell
orders were cancelled before expiry, with no broker error/reason supplied. All
had zero executed volume and zero fills. Group-level later `ANALYSIS_EXPIRED`
is not evidence of why those two earlier cancellations happened.

Submitted sizes were 34.56–34.58 lots per leg. The risk cap removal worked; it did
not establish fill quality. Each order had 52.40–53.64 seconds until its declared
expiry when submission completed. One intent consumes a map even without a fill,
so this policy provides intermittent coverage, not continuously armed orders.
We retain expiry/one-intent behavior pending suitable quote/execution evidence.

Between 10:27 and 12:19 SGT there were 21 journaled refresh attempts: six validated
maps, eleven 45-second timeouts and four local circuit blocks. The last usable
map arrived at 11:35:19 and expired at 11:39:50. Successful requests took
28.199–43.616 seconds. Local spread filters also deferred execution; the
12:19 quote spread was USD 0.05 and passed the current spread gate. No valid map
was then available. These are separate provider, scheduling and market-quality
causes, not 21 rejected trading predictions.

## Repair

- Background scenario inference has a 90-second deadline, with five seconds of
  HTTP transport grace. The five-minute capture-based validity, 65-second minimum
  remaining execution lifetime, strict schema, tick grid and original model pin
  remain enforced. The additional inference time cannot extend an order/map.
- Previously, a local circuit block claimed another five-minute cooldown, even
  though it sent no request. This compounded the provider outage. Only an exact
  FAILED / `AI_CIRCUIT_OPEN` now permits a one-minute recheck. SQL still checks
  all earlier potentially dispatched requests under the account/symbol/mode lock,
  preserving one per five minutes across restarts and concurrency. Timeouts,
  unknown acceptance and every other failure retain the full dispatch cooldown.
- AI readiness checks the active scenario circuit. The dashboard identifies
  provider failure, overdue refresh, expired/consumed maps and current exposure.
  An ordinary in-progress analysis is labelled “Checking setup”; concurrent-check
  prevention alone is not displayed as a safety fault. Mixed safety reasons still block.
  “Latest execution check” separates deterministic checks from paid model calls.
  Refresh-attempt counts include local circuit blocks and are not billed-call counts.

Model, prompt, chart inputs, output-token limit, risk policy, stop/target distances,
60-second decision expiry and live disablement are unchanged. No settings were
added and the populated `.env` is unchanged (24 entries; template 20).

The production payload retains the chart-matched candle suffix, capped at 80 bars
per frame. Earlier documents incorrectly described these provider inputs as
30/18/12; those are analytics compact-tail settings, not the actual chart suffix.
No payload quality or latency improvement is claimed in this repair.

OpenAI describes multiple sources of latency and recommends measuring each;
reducing input bytes alone is not a reliable latency cure. This guidance does not
establish reseller capabilities or pricing. [Official latency guide](https://developers.openai.com/api/docs/guides/latency-optimization).
cTrader documents that stop-limit orders can remain unfilled outside the allowed
range, and that available margin is checked at trigger time. This supports
distinguishing acceptance from fills, but does not identify the reason for our
two early broker cancellations. [Official order documentation](https://help.ctrader.com/trading-with-ctrader/orders/).

## Sell target mismatch found after provider recovery

The first `.5` automatic request started at 12:29:45 and validated at 12:30:33 SGT
in 47,590 ms (17,737 input / 717 output tokens). It would also have exceeded the
old deadline. Local checks then returned `SCENARIO_WAIT_NET_REWARD`. The map had
a bearish trigger at 4431.00, extension trigger at 4430.50 and first actual downside
target at 4428.60. The cost-buffered TP from a 4430.99 sell entry is 4430.45.
Old code incorrectly compared that TP with 4430.50, although that field describes
a continuation trigger, not a target. The buy leg already used its actual first
target. [Intermediate observation](evidence/provider-recovery-intermediate.json).

Release `.6` compares sell TP with `extension_targets[0]`, matching the existing
buy-side rule. It keeps TP/SL distances, entry buffers, expiry and risk sizing
unchanged. It cannot skip the first target to use a more distant one; insufficient
actual target room still rejects. [Same-input old/new construction evidence](evidence/sell-target-mapping.json)
reproduces the old rejection. Regression tests cover both the reproduced case
through unchanged semantic validation and insufficient first-target room. This is
a contract correction, not evidence that the new entries are profitable.

## Validation and observed outcome

A bounded non-trading provider observation at 12:24:48 SGT completed in **62,824 ms**
with exact requested `gpt-5.6-sol/u40`, returned `gpt-5.6-sol`, strict validation,
17,740 input / 938 output tokens, and 235,512 ms remaining plan validity. The old
45-second deadline would have aborted this response. Costs remain unknown. Two
pre-dispatch observation attempts failed freshness/local snapshot checks and made
no provider request; the successful probe refreshed the capture only after checking
that completed candles and tick metadata matched the chart. This does not backdate
eligibility or authorize an order. One response is not a latency distribution.
[Sanitized provider result](evidence/provider-recovery-probe.json).

Validation passed: 487 Node tests, 125 Python tests, 22 schema tests, three
migration tests and all three isolated PostgreSQL/analytics integration tests.
Formatting, ESLint, TypeScript typecheck/build, Ruff, mypy, configuration checks,
replay/fail-closed fixtures, secret scanning, npm audit and pip-audit passed. Both
dependency audits reported no known vulnerabilities. Ruff initially flagged a
101-character caption; the corrected string passed lint/format and all 12 overview
tests. No rendered wording changed in that correction.
[Exact commands/results](evidence/provider-recovery-validation.json).

The AI/execution/dashboard services were recreated under an authenticated analysis
pause. The broker confirmed no exposure; startup/reconciliation passed, and prior
demo operation resumed at 12:27:33 SGT. All five services were online, with no risk
lock resets or live enablement. The populated environment remained byte-identical.
The model name is transmitted literally; returned normalization does not independently
attest reseller weights or the meaning of `/u40`.

Browser checks passed in light and dark themes with zero page errors. Background
updates preserved the title, navigation, control input value/focus/caret and history
chart; all four metrics remained present. The screenshots deliberately show the
real model outage while the last pre-deployment timeout completes its cooldown:
[light overview](images/provider-recovery-overview-light.png),
[dark overview](images/provider-recovery-overview-dark.png),
[light history](images/provider-recovery-history-light.png),
[dark history](images/provider-recovery-history-dark.png).

Final `.6` demo operation resumed at 12:35:28 SGT. Its first automatic request
started at 12:35:47 and validated in **40,772 ms**, with 17,735 input / 967 output
tokens and the same requested/returned identities. The broker still confirmed
**zero positions and zero pending orders at 12:37:18 SGT**. No `.6` order or fill
was recorded in that observation. Local outcomes included one spread rejection,
one stale-quote rejection at proposal validation, one sell-entry-distance rejection
at final placement validation, and a subsequent entry-distance wait.

The target-mapping rejection was removed; two-sided proposals passed the schema,
semantic, fee and risk stages. In the observed 12.5-second execution cycle, the
sell entry moved outside the existing 2.5-ATR distance limit before placement.
The bot retained that rejection instead of moving the immutable entry or loosening
freshness. A later dashboard read briefly showed an operational failure; status at 12:39:43
SGT had recovered automatically with a clear fault latch and no manual reset. The
underlying failure code is not captured in this report. Faster local snapshot/account
processing and suitable tick/quote evaluation remain work; this repair does not establish more fills.
[Final bounded demo observation](evidence/provider-recovery-runtime.json) ·
[Dashboard after recovery](images/provider-recovery-current.png).
No net-profit, trade-frequency
or fill-rate improvement has yet been established. Historical/demo observations
are not an out-of-sample strategy comparison. Full tick coverage, model billing
and a sufficient prospective filled-trade sample remain missing.

## Migration and rollback

No SQL migration, data transition, secret change or environment tuning is needed.
Under an authenticated analysis pause, deploy matching AI/execution builds and the
dashboard, verify model/policy, reconciliation, durable controls and provider output,
then restore the pre-existing demo authorization. Preserve accounting and journals.
To roll back, pause new analysis, deploy source `af7e098` with matching `.4` AI and
execution services, verify reconciliation, then restore the prior demo controls.
This restores the old timeout/cooldown behavior; it does not erase orders, maps,
capital state or chart storage. Protective management must continue during either
transition; never reset risk locks or enable live execution.
