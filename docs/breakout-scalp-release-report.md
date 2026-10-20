# ISSUE-334 — Immediate breakout and native quick-TP demo release

Issue: https://github.com/AegisFintech/scalping-bot/issues/334.
PR: https://github.com/AegisFintech/scalping-bot/pull/337.
Rollout receipt: https://github.com/AegisFintech/scalping-bot/pull/339.
Status: implemented, fully qualified, merged in PR #337 and deployed to demo.
First natural pair accepted; completed cycle observation remains in progress.

## Authorized behavior

The operator explicitly authorized completing tasks 1–4, then clarified immediate
first crossing, with no holding, candle-close or retest confirmation. This is a new
controlled demo experiment, not promotion from the old fade research. The supplied
manual screenshots illustrate major support/resistance but do not establish a
matched causal winning path or exact commission-covered exit rule. Private images,
financial/account details and archives remain outside Git. No profitability claim.

Prompt `entry-pair-v5` reads completed M15 major context, M5 current holding box,
then M1 executable edges. Numeric inputs retain up to 288 M15 / 144 M5 / 120 M1
completed candles with existing provenance, quality/session-gap and freshness
checks. Candle order blocks are confluence, not an extra execution gate. Output
remains two decimal entry strings; the model cannot size or authorize trades.
Historical v4 and transport schema 1.0 remain unchanged. Request 1.1 binds v5 and
its exact prompt SHA; the isolated worker checks configured version before claiming
work. Reusable entry contexts must also match the exact current provider-prompt
SHA from durable evidence, even when the model pin is unchanged. Missing/old proof
cannot authorize reuse, retirement or the one-time entry replacement exception;
scope-wide request cooldowns and terminal refresh rules remain. No historical rows
are rewritten. Legacy typed transport remains accepted only by a v4-configured worker.
No API fallback, web search or broker/database authority is added to Codex.

Production identity: `0.4.0-breakout-scalp.1-codex.1`; risk-policy identity:
`0.4.0-breakout-scalp.1`. The production transform is separate from research-only
candidate modules. Both provider prices survive unchanged: BUY above the upper
edge, SELL below the lower edge, broker STOP_LIMIT/GTC with 30-point entry range.
No quote clamping, direction inversion, local timer exit or sampled green-P/L close.
An accepted order triggers at its first executable broker crossing; it can remain
unfilled after a gap beyond its limit. Accepted GTC persists through waiting/restarts.

## Exit and risk constants

SL = 2.5 completed M1 ATR, rounded inward to tick, rejected when unaffordable.
Initial TP is a whole-pip commission floor using broker minimum quantity and
modeled expected net/fees >=1.5. Add 30 tick points of entry reserve, 65 exit reserve
and 0.10 SL; round outward to pip. Reject above 2 ATR rather than enlarging the
cap or size. Final risk-selected exact-volume commands independently recheck fee
coverage. Minimum R/R is 0.10 for this release; the modeled cost floor usually
requires more. These constants are explicit assumptions, not measured tail bounds.
Native TP/SL distances are bound relative to actual fill and maintained through
existing independent protection verification/repair. No guaranteed seconds-to-exit.

Dynamic sizing uses current reconciled equity, broker volume increments, exact
margin and costs. Both race-exposed OCO legs share the existing 1% setup ceiling.
Risk sizing conservatively reserves 65 adverse points using the existing entry/exit
cost helper; this does not relax the separate 30-point / 2-bps fill monitor.
The account-wide three-loss/60-minute pause remains across strategy versions.
Demo daily/high-water losses and locks remain measured and persisted under #094;
other modes retain enforcement. Live remains disabled. Economic trial is demo or
paper only. All active-group, cooldown, session, data, storage, reconciliation,
ownership, affordability and protection gates remain fail-closed.

A smaller target with unchanged stop may require a high win rate and still lose
money. Unknown swap, future FX, actual fills/slippage and counterfactual costs
remain unknown. Sampled quotes are not a complete tick tape. No selected winning
paths, manual screenshots or passing fixtures establish positive expectancy.

## Lifecycle and deployment

Includes #318 first-fill/late-ACK race handling, #331 fresh durable pair preflight,
and #323 full manual-close observation / immutable local-unsent proofs. Apply
additive migration 0030 before matching execution. Partial/ambiguous manual closes,
unknown submissions, missing protection/terminal events and contradictory proof
remain blocked. No manual order ownership or new close authority is granted.

Qualify stable source, commit/push through a checked PR, prepare an immutable
artifact, and update AI/worker/execution together while analyses are held and
protection continues. Preserve the current epoch DB/runtime, current token state,
controls, all history/claims and risk baselines. Verify policy/startup checks and
actual supervisor configuration separately. Never copy a sample over populated
credentials. No database/accounting reset or historical replay.

Register a new future observation window with frozen release fingerprint before
unpausing. Keep all intents, no-fill, missing, open, race and cutoff outcomes; actual
net only from complete broker-close evidence. Conditional replay must use actual
provider availability/broker acceptance and null unknown counterfactual costs.
The first cycle is operational observation, not economic qualification. #319/#255
frozen artifacts, registrations and reports stay untouched; drift halts research
only. A 30-calendar-day batch is not qualification or automatic promotion.

Rollback keeps analyses held, restores a compatible qualified trading artifact and
matching prompt worker against the SAME current DB/runtime, and reconciles new
release orders under their original identity. Keep migration/proofs/claims and
original protection; do not roll back to a historical DB or replay old requests.

## Validation and operational receipt

Initial focused failures exposed an invalid synthetic waiting-area enum, stale
prompt/version expectations and a schema-equality test that assumed one request
version. Corrected fixtures and a version-specific published typed 1.1 model retain
all legacy schema bytes. New tests reject mismatched versions, excess frame history,
worker prompt mismatch before claim, cost-defeating/unaffordable stops and preserve
entry prices, input immutability and schema-valid effective proposals. The v1.0 operational hash-journal keeps its historical release identity rather
than inheriting a changing default policy. The separate bounded unattended observer
accepts the exact new Codex strategy identity and rejects a mismatched deployment.
Full results and deployment receipt will be recorded after checks complete.

Full qualification passed: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`,
`/tmp/scalper-qualification-fAtkJa/checks/results.json`: 942 Node / 94 isolated
PostgreSQL / 381 Python tests; all format, lint, TypeScript/build, Python format/
lint/mypy, schema/migration/fail-closed, secret and npm/pip audit gates passed.
Both policy and `--startup` config checks passed against an unchanged protected
environment copy. [Sanitized validation](evidence/breakout-scalp-validation.json).
AST-only Graphify update completed (known pyproject warning). Earlier interrupted
runs and the corrected old-prompt test failure are not qualification.

## October 20 demo activation

Both final-head hosted qualification runs passed before PR #337 merged as
`4a26115bf070c5fb84d702d74c2187ce9c52d823`. Artifact source commit
`fdc19aa439b3403ac0cc41b10c22af5992ce2db6` has the exact qualified executable
fingerprint; the independent prepared tree and pinned binaries passed verification.
The initial worktree dependency links were rejected by artifact verification.
Physical dependency copies resolved packaging without a code or dependency change.
No rejected artifact was activated.

Migration 0030 ran transactionally under the existing migration owner after checking
all 29 previous checksums; current count is 30. The app can insert proof rows and
still cannot update the migration ledger. Accounting reference, high water, daily
baseline, losses and locks matched the private pre-deployment snapshot exactly
before resuming. The protected environment was copied unchanged. Existing epoch,
current token-state path, history, callbacks and controls were preserved.

PM2's restart operation retained the previous working directory despite new
absolute entry paths. AI/execution startup retries were stopped, then all five
process definitions were recreated from the verified ecosystem. Actual working
directories and protected environment paths were independently checked; all five
health endpoints returned 200. The isolated v5 worker returned health 200 and an
unauthenticated POST returned 401, without an inference probe. PM2 definitions
were saved for restart. Original trading/worker artifacts remain available for a
compatible same-DB rollback; history is never rolled back.

An exclusive mode-0400 private registration was frozen at
`2026-10-20T05:42:36.846Z`, before its future start
`2026-10-20T05:43:36.846Z` and audited resume
`2026-10-20T05:44:02.729Z`. Final cutoff is
`2026-11-19T05:43:36.846Z`, with 31 UTC-cutoff windows including the initial/final
partial days across a 30-day duration. The initial paused interval is retained.
The public receipt publishes its original canonical digest after activation; it
does not pretend the later Git publication was the registration event.
The [protocol](breakout-demo-observation-protocol.md) and executable/prompt
fingerprints were frozen before activation. Old #319/#255 registrations are unchanged.

A persistent read-only 24-hour status observer started before resume, samples every
15 seconds and resumes its original checkpoint/deadline after restart. It has no
credentials, broker/provider calls, controls or promotion authority. Operational
monitoring is separate from the registered economic batch. Future review is
[#338](https://github.com/AegisFintech/scalping-bot/issues/338); a new breakout
conditional replay adapter remains separately qualified/registered future work.

The first natural Codex v5 request completed and both new STOP_LIMIT/GTC orders
were broker accepted. Original model prices equal effective entry prices on both
legs. Pending orders block another paid request. A pending pair is not a completed
cycle, a win or proof of better entry precision. No order or fill was forced.
[Sanitized rollout receipt](evidence/breakout-scalp-rollout.json).

At `2026-10-20T05:47:52.498Z`, the first SELL breakout was filled, its BUY peer
was cancelled, and the open position had freshly broker-verified SL and TP with
zero repair attempts. This proves the observed entry/OCO/protection sequence, not
a completed profitable trade. Closure remains pending at this receipt snapshot.
