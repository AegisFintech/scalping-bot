# Archived agent directives (ISSUE-075 … ISSUE-387)

This is the complete `AGENTS.md` text as of commit 67c740d (2026-10-27). It is
preserved verbatim below the rule, except that its four report links are rewritten
relative to `docs/`. It is history, not current authority: the current contract is
[AGENTS.md](../AGENTS.md), which wins wherever the two differ. Read the matching
section and linked report before changing an area it covers.

---

# ISSUE-387 — Read-only entry evidence and native TP audit

Operator approved investigating TP execution and recording/comparing entry context
before reviewing any strategy change. Trading remains0.7.3, promptv4, TP0.40/SL7.00,
STOP_LIMIT/GTC/OCO and dynamic shared5% demo risk; no new filter or model input.
Only the SELECT-only Flight observer/research tools change. Keep original model
levels separate from computed M1 envelopes and round-number hypotheses; actual
broker acceptance/provider availability bind observations, never local placement
timestamps. Quote crossings are not fills; unknown counterfactual net stays null.
Preserve gaps/open/daily censoring, old frozen studies and all protection/history.
See [scope, unresolved broker TP crossing and research protocol](entry-evidence-review-report.md).

# ISSUE-384 — Broker-native profit exits

Operator approved fixing fee-to-fill execution after three recorded local profit
closes lost money net of fees. New source `0.7.3-quick-oco.1-codex.1`, policy
`0.7.3-quick-oco.1` removes optional local market-profit dispatch entirely.
Broker-held native TP stays0.40 price units (40 observed0.01 broker pips/ticks),
SL7.00, dynamic shared5% demo setup ceiling/at most2.5% each OCO leg, entry30-tick
range and65-tick stop-risk reserve are unchanged. Other modes1%. No fixed lots,
size increase, wider TP, reverse direction or forced trades. Native protection,
missing-SL emergency repair/close, manual/partial-close recovery, unresolved claims,
GTC/OCO/ownership/session/account/cooldown gates and financial history remain.
New promptv4/request1.10/local-executionv4/risk-schema1.9 are additive; old bytes
and registrations stay immutable. Keep the worker512MiB file cap/isolation.
See [evidence, limitations, validation and rollback](native-profit-exit-report.md).

# ISSUE-382 — Codex worker storage cap

The operator approved a finite512MiB per-file cap for the dedicated Codex analysis
worker after a32MiB inherited RLIMIT_FSIZE killed its SQLite thread-history writes
withSIGXFSZ/EFBIG. This operational correction changes no prompts, input sizes,
memory compaction, token budgets, request cooldowns, risk, lots, TP/SL or strategy.
Keep existing worker/application artifacts and all DB/session/claim history.
Preserve MemoryMax512MiB, TasksMax64, swap0 and isolation. Apply only the scoped
systemd LimitFSIZE override; verify live inherited limit and a normal gated retry.
Never delete history or replay an unknown request. Full evidence and rollback:
[worker file-cap report](codex-file-cap-report.md).

# ISSUE-380 — Smaller TP and independent cost-aware profit capture

Current explicitly approved DEMO trial source `0.7.2-quick-oco.1-codex.1`, policy
`0.7.2-quick-oco.1`: new native TP0.40 price units (upward whole-pip rounded),
SL remains7.00 price units independently, shared5% current-equity setup ceiling /
at most2.5% per OCO leg. Keep dynamic sizing, broker margin/volume and65-tick stop
risk reserve /30-tick entry range unchanged; no lot multiplier or risk increase.
Profit economics now explicitly use5-tick exit allowance, not the old65-tick TP
allowance. Native TP must cover costs at minimum AND actual quantity; reject
rather than widen. Early capture uses fresh executable bid/ask, actual entry fee
bounded conservatively by metadata, expected exit fee/conversion, known nonpositive
swap and5-tick execution allowance, net floor0.05 price units times actual volume
value. This is modeled, never guaranteed. Fresh exact owned position/native
protection, full entry/zero-fill cancelled peer, no partial-close ledger or
unresolved events, second quote/reconciliation and one committed close claim are
mandatory. Timeout/rejection/partial/restart cannot resend. Native protection and
maintenance remain independent of inference. Only new-source demo positions get
this authority; accepted old groups/protection/history remain unchanged. Existing
missing-SL authority stays separate. No forced provider/order, live activation,
accounting reset, polarity change or automatic promotion. Promptv3/request1.9/
local-executionv3/risk-schema1.8 are additive; older bytes stay immutable. Read
[implementation, review and rollback](small-tp-profit-exit-report.md).

# ISSUE-378 — Current external-close recovery and fixed1.00 TP

Read `docs/manual-intervention-report.md`. Source0.7.1-quick-oco.1-codex.1 / policy
0.7.1-quick-oco.1 supersedes older TP instructions below for NEW DEMO setups.
Fixed gross TP1.00 price unit, upward broker-pip rounded; native SL exactly7× TP.
Keep shared5% current-equity ceiling / at most2.5% each OCO leg, actual costs,
margin/volume and all gates. Remove only the second entry-slippage charge from
fill-relative TP; native entry range30 and risk/TP exit reserves65 stay. Reject
unaffordable targets instead of moving entries or widening TP. Other modes1%,
no real-money authority. Preserve all accepted old intent/protection and history.
New prompt entry-quick-oco-v2 / request1.8 / response1.2; local execution-v2,
risk schema1.7. Older prompts/schemas remain immutable; no fallback or memory reset.
Migration0035 appends immutable scoped close-deal evidence. External non-bot
client IDs are not authority: match exact owned position/order/deal, side, entry,
open/close times, original fills, cumulative closes and remaining volume/costs.
Full/partial manual closes observe completed broker actions, never authorize
commands. Final aggregate net includes closing-detail fees once. Retain original
journal payload/reasons; only exact proven resolutions release waiting/errors.
Partial exposure stays monitored/protected by existing independent maintenance;
no new setup until fully reconciled. Bounded complete history is mandatory;
missing/ambiguous/oversized evidence remains blocked. Do not reset accounting or
inject trade rows to fix the current incident. Close the existing+66.72 incident
through verified history with normal deployed code. Cancellation/OCO ownership
rules stay. Dashboard intervention feedback is read-only and cannot infer a human
identity or claim protection from a partial-close event alone. Keep old freezes,
recordings, retention approvals and credentials. Qualify, push reviewed main PR
with green checks, deploy one matching demo/worker/readonly recorder and verify.

# ISSUE-376 — Current demo quick-TP dual breakout OCO authority

Read `docs/quick-oco-flight-report.md` before changing this path. This explicit
operator authorization supersedes older single-profile/1% DEMO/TP instructions
below for NEW setups only. Source `0.7.0-quick-oco.1-codex.1`, policy
`0.7.0-quick-oco.1`: fixed OCO STOP_LIMIT/GTC, original BUY upper/SELL lower,
smallest whole broker pip gross TP meeting modeled 0.08 broker pip net after
verified costs and retained execution reserves, native SL distance exactly 7× TP.
Shared DEMO risk at most 5% current reconciled equity / 2.5% per race-exposed leg;
other modes retain 1%, new execution composition is demo-only. No fixed lot
multiplier, entry shifting, forced trades, profit guarantee or real-money authority.
Broker pip/tick is 0.01; actual metadata commissions (~$24/lot round trip near
$4,000 gold) override the unverified $7 estimate. Never understate costs or call
0.08 pip the gross broker TP. New risk schema 1.6; old contracts stay immutable.
Provider prompt/transport are entry-quick-oco-v1 / 1.7 / 1.2; preserve the old
entry-modes-v1 / 1.6 exact-1% contract unchanged. New request 1.7 requires exactly 5%
and fixed cost-aware OCO guidance; exercise actual Node-to-Python validation. Local deterministic
prompt is entry-quick-oco-execution-v1. Keep WAIT, all fail-closed operational,
account, session, margin, provider/revision/intent gates and native maintenance.
Existing accepted groups retain old settings/protection; use an audited scoped
selection CAS on deployment, never overwrite selection at startup or cancel an
old group to accelerate activation. Preserve financial/history/worker state and
the existing loss cooldown. No reset or automatic research promotion.
The flight recorder is a separately unprivileged SELECT-only observer, with no
provider/order/control credentials or execution authority. Preserve raw quote
source/receive times, stream/sequence gaps, late-close and partial-fill censoring,
immutable summaries and null counterfactual profit. Bounded/lossless learning
records are distinct from seven-day diagnostic logs. Storage failure halts only
recording; it cannot bypass or stop protection. Refresh AST Graphify, README and
these instructions for every outgoing commit; retain old registrations/reports.

# ISSUE-374 — Lean storage maintenance

Maintenance source `0.6.0-entry-modes.1-codex.3` preserves the fixed single
STOP_LIMIT policy/prompt/worker and native exits; older source labels below are
historical. Receipt cleanup needs the exact scoped operator approval marker.

Read `docs/lean-storage-report.md`. Preserve canonical trading, risk, provider,
decision/WAIT/rejection and research evidence. Only reviewed DELIVERED telemetry
receipts older than seven days may be pruned, scoped through canonical audit by
instance, no lease, max 1000 per pass; never pending/retry/in-flight or audit rows.
Migration 0034 adds index/autovacuum support, no row deletion. Cleanup activation
requires concrete operator retention review. Retain PGLZ: sampled LZ4 was larger.
Logs roll weekly with early size caps and seven-day closed-log retention; preserve
open files and the combined cap. Install current env/runtime/log paths explicitly;
never overwrite secrets or point maintenance at old recovery state. No economic,
order/protection, accounting/reset or research-promotion authority is added.

# ISSUE-372 — Fixed trend-direction STOP_LIMIT

The operator removed all four mode choices and approved single STOP_LIMIT only,
in Codex's original trend-continuation BUY/SELL direction. Read
`docs/fixed-stop-limit-report.md`. This supersedes ISSUE-370 selection authority
for NEW setups. Current source `0.6.0-entry-modes.1-codex.2`; policy, prompt and
worker contracts remain unchanged. WAIT has no order authority. New scopes start
SINGLE_STOP_LIMIT; persisted alternatives fail closed at initial/late admission.
The public selection endpoint, dashboard proxy/buttons/unlock/token UI are removed.
Historical mode schemas/store/mappings and migration 0033 remain necessary for
immutable audit, legacy recovery and lifecycle tests, not operator mode selection.
Preserve active groups/native protection, revision/intent interlocks, all cooldowns,
financial/history/registration state and half-leg dynamic sizing within shared 1%.
No smaller TP, larger lots, 1:10 payoff or profit-close change is included; these
remain separate evidence/review work. Model direction is not verified trend truth
or a profitability claim. Deploy qualified main to the ONE existing demo.

# ISSUE-370 — Explicit four-mode operator authority

The operator requested four dashboard choices, superseding single-direction-only
and no-reversal restrictions below for NEW setups on the existing DEMO. Read
`docs/entry-modes-report.md`. Current source: `0.6.0-entry-modes.1-codex.1`, policy
`0.6.0-entry-modes.1`, prompt `entry-modes-v1`, worker 1.6/1.2, mode-neutral local
`entry-modes-1.0`. STOP_LIMIT buys upper/sells lower; LIMIT buys lower/sells upper.
Singles follow Codex for STOP_LIMIT and reverse it at the SAME level for LIMIT.
WAIT has no entry authority. Initial selection is SINGLE_LIMIT; the operator can
select any approved profile with existing authenticated controls. No risk/exit
upgrade, forced trades, accounting reset or real-money authority is added.
Preserve scoped durable mode/revision CAS, one runner, late revision checks and
transactional mode/intent row lock. Every group retains immutable profile/revision,
cardinality, original prices and native type. NULL historical markers retain
legacy proof requirements. Mode changes never mutate accepted GTC/protection.
New mode-neutral contexts use effective/late selected-side/type quote checks;
STOP-only immediate replacement evidence cannot retire them. Ordinary expiry and
all failed/unknown cooldowns remain; historical replacement contracts stay intact.
Every leg keeps the prior half allocation, OCO shares at most 1% current equity,
and native equal-distance SL/TP is mirrored for LIMIT. Do not restore legacy fade
ATR/trend filters, quote clamping, automatic switching, martingale or loss chasing.
Dashboard controls need explicit existing operator token in browser memory only,
same-origin fixed-loopback proxy and backend auth. Never embed server credentials
or persist tokens in URLs/cookies/browser storage. Research remains read-only;
freeze new future cohorts, preserve old registrations/censoring/null costs and
attribute outcomes by immutable group mode, never a selected winning subset.
Qualify, push reviewed issue PR, green exact-head checks, merge main and deploy
matching worker plus the ONE existing bot. Rollback must prove new groups terminal
before older code; preserve additive migration 0033 and financial/request history.

# Historical single-direction authority — ISSUE-368

The operator approved one trend-continuation BUY/SELL entry or WAIT, not reversal,
martingale, forced frequency or doubling lots after removing the OCO peer. Read
`docs/directional-entry-report.md`. Current strategy is
`0.5.0-directional-scalp.1-codex.1`, policy `0.5.0-directional-scalp.1`, prompt
`entry-direction-v1`, worker request 1.5 / response 1.2. Only selected entry_side
has authority; two price references describe box geometry. Persist the side and
exactly one order with migration 0032. NULL side always means the historical
TWO-entry group: a missing peer never becomes single-entry authority.
Keep selected-side fresh quote/distance checks, immutable context/intent claims,
exact scoped ownership, partial/unknown commands, native protection and terminal
proofs. Single entry keeps the existing half-setup allocation, at most 0.5% current
equity inside the 1% setup ceiling, exact costs/margin/steps and late cap re-read.
Native opposite-box stop/equal gross TP and accepted GTC remain unchanged. No
smaller TP, trailing or profit-close rule is approved yet; propose exact exit
parameters separately for operator review. Old active OCO orders/protection and
all financial/context/provider history remain immutable through rollout.
Read-only sampled paths are prospective, bounded, credential-free observations:
freeze future registration and code before collection, preserve gaps and open/
daily cutoffs, null unknown future/counterfactual costs, and never promote from
selected complete winners. Source/storage failures halt research only. The sole
canonical trading system is qualified main on the existing demo; sampler and
rollback artifacts are not additional trading bots. Rollback to older pair-only
code requires every new single group fully terminal/proven first; never downgrade
the database, reset accounting, reinterpret old groups or force/cancel orders to
accelerate cutover. Historical schemas/prompts and migrations retain their bytes.

# ISSUE-366 — One main deployment, M1-first entry guidance

The operator approved immediate implementation and deployment on the existing
controlled demo after discussing v7's all-WAIT observation. Read
`docs/m1-range-release-report.md`. V8 / request 1.4 makes completed M1 primary,
permits visible brief consolidations, and treats M5/M15/FVG conflicts as context;
no invented levels, trade quota or risk bypass. TP economics are unchanged.
Keep v7/1.3 and all historical schemas/journals immutable. New prompt/hash/day
pins legitimately use a new daily thread; do not delete or resume an old prompt's
thread as current authority. Preserve WAIT successor/cooldown/storage interlocks.
The canonical system is tested `main` deployed to one existing demo account.
Repository delivery includes matching worker/orchestrator rollout and runtime
verification, respecting PR checks/protections. Rollback artifacts and read-only
registered observers are evidence, never additional trading bots. No reset,
forced orders, silent economic promotion or real-money activation is authorized.

# ISSUE-364 — Active evidence-first DEMO

The operator's no-trade report prompted activation of the already approved and
qualified #362/#363 source. Read `docs/evidence-demo-rollout-report.md`.
Runtime is `0.4.3-evidence-scalp.1-codex.1`, immutable `evidence364-qualified`,
worker `/opt/scalper-codex-entry-364`, matching v7 / transport 1.3. Preserve the
same database/runtime and every financial/request journal. Migration 0031 was
applied transactionally through the local PostgreSQL administrator; do not grant
the application CREATE/DDL privileges to make migration commands run. Keep the
WAIT order interlock, unique successor claims, 60-second/new-M1 retries and
failed/unknown cooldowns. Never force orders merely because frequency is low.
The new 30-day prospective registration and seven-day read-only observer are
separate from older frozen cohorts. Retain every old registration/observer and
all daily/open/gap/OCO censoring; source drift limits research only. A natural
WAIT proves proposal transport, not trading profitability or an actual fill.
The first natural WAIT successor used a new completed M1 after 66.593698 seconds
and the same daily thread. Native production compaction remains unobserved at
this checkpoint; retain the separate synthetic compaction qualification.

# ISSUE-362 — Evidence-first source and bounded daily Codex context

Read `docs/evidence-first-codex-report.md`. This source supersedes #358's scanner
admission only for the new `0.4.3-evidence-scalp.1-codex.1` demo policy. ATR/trend/
compression readings are context, not pre-inference strategy filters. Keep all
operational/data/session/risk/ownership/reconciliation gates. Codex v7 / transport
1.3 proposes OCO or WAIT; a WAIT has no entry authority, including at the database
boundary. Retry a completed WAIT only after 60 seconds from availability and a
new completed M1; unknown/failed dispatches retain the full durable cooldown.
Daily threads are isolated and pinned to model/prompt, with serialized durable
claims and bounded compaction. Memory never replaces fresh evidence or changes
risk, and compressed summaries never replace the immutable journal. Do not
silently create a replacement thread after corrupt state or resume failure.
Source delivery does not itself deploy, reset history or edit frozen research.
The qualified source has 1,547 passing tests; see the report for exact receipt and
source hash. Any runtime change requires a matching worker/orchestrator rollout
and new prospective cohort; preserve the additive WAIT interlock and all history.

# ISSUE-360 — Lean server and maintenance on every push

Use `/root/scalping-bot-terminal` for development; the original checkout and
immutable deployment/research artifacts are not disposable unused source.
Read `docs/server-cleanup-report.md` before further disk/service cleanup.
Claude and OpenCode were explicitly removed by the operator. Do not reinstall
them or delete Codex auth, active versions, current records or another project's
files. Keep the current Codex version, one fallback and every in-use version.
Reproducible caches may be removed after checking service/process references;
Python venv scripts can retain absolute interpreter paths into older worktrees.
No automatic package autoremove, database pruning, journal/report deletion,
research registration editing or removal of immutable deployments is authorized.

Before each repository update, review newly unused files, dependencies and
service references; remove only confirmed unused items and record retained
evidence/deployment dependencies in the issue report.
For every new non-merge commit pushed, update README.md with the user-facing
change/validation and AGENTS.md with the corresponding maintenance contract or
reviewed checkpoint. Keep these meaningful and concise. Run `npm run hooks:install`
once; the tracked pre-push gate checks every outgoing commit, clean tracked state
and `graphify update .` (local AST only). Keep Graphify outputs ignored. Do not
bypass a failed gate, overwrite existing hooks or auto-generate commits. Hooks
are local opt-in checks, not a substitute for full qualification, secret scanning,
reviewed issue branches and passing hosted checks before merge. Pure tag pushes
and branch deletions are exempt. New branches require fetched `origin/main`.
Cleanup itself never runs automatically on commit/push and must not restart the
bot, change risk/strategy, reset history or terminate registered observers.
Retired unregistered feed/research/intake schedules can be restored only after
reviewing source/epoch compatibility; their private outputs remain intact.

# ISSUE-358 — Explicit compression scalp DEMO trial

The operator requested deployment and fresh monitoring after #354. This authorizes
`0.4.2-compression-scalp.1-codex.1` / policy `0.4.2-compression-scalp.1` as an
unqualified controlled DEMO experiment, not real-money activation or a reset.
Keep Codex v6/two-price transport unchanged. Require the frozen scanner's
independently qualified compression pair before provider preparation and again
on the fresh post-model snapshot; preserve Codex entry prices and require outward
structural agreement. Deterministic structural protection and at least 1:1 gross
reward replace the previous quick-TP/2.5-ATR geometry only for the new release.
Directional LIMIT candidates remain research observations, never forced OCO legs.
Shared dynamic 1% risk, exact-volume costs/margin, STOP_LIMIT/GTC/OCO, protection,
session/reconciliation/ownership and all account-wide cooldowns remain. No
qualified pair means wait, not fallback or forced trading. Preserve original
journals and registrations; "afresh" means a new prospective cohort only. Read
`docs/compression-demo-release-report.md`. #355/#356 remain unqualified research.

# ISSUE-351 — Explicit SMC / DOM demo activation

The operator requested "live it" after #348. This authorizes a separately versioned
controlled DEMO trial, not real-money/live mode or an increase in risk. Current
source becomes entry-pair-v6 / Codex transport 1.2 / 0.4.1-smc-breakout.1-codex.3.
Use expanded completed history and causal-smc-1.0 context in the exact durable
provider input. Missing/stale/mismatched context blocks dispatch; no old prompt
reuse or fallback. Two-price replies, STOP_LIMIT/GTC/OCO, broker protection,
small TP economics and shared dynamic 1% ceiling remain. Preserve older worker
schemas/prompts, accepted groups and immutable #334/#338 registrations. Freeze
new future observation before activation. #349 comparisons remain unqualified;
operator activation is an explicit demo experiment, not automatic promotion or
profitability evidence. Read docs/smc-demo-release-report.md.

# ISSUE-346 — Landscape-only dashboard and lean configuration

The operator explicitly removed the sidebar, top navigation, Trade history and
Diagnostics pages. The landscape desk is the only dashboard view and is read-only;
authenticated backend emergency/pause controls remain available operationally.
This supersedes the older three-view/native control-form presentation requirement.
The desk now runs directly on the existing FastAPI/Uvicorn stack; Streamlit and its unused UI dependencies are removed. Keep bounded shared polling, verified scoped data, separate modes and explicit stale or unavailable values. The normal template has 16 identity/credential/authorization assignments;
model/risk/strategy policy is versioned code, optional monitoring is deployment
configuration. Read `docs/lean-dashboard-report.md`. Preserve active records,
research tools/registrations, migrations and deployment/rollback artifacts.

# ISSUE-303 — October 19 Codex production authorization

The operator explicitly requested “use codex instead”. Production entry proposals
use the isolated subscription-authenticated Codex worker, requested `gpt-6.1-sol`,
with no API-provider fallback. Returned identity, usage and cost remain null when
unattested. Migration 0029 preserves earlier model rows. Preserve the current
fade transform, entry-pair-v4 prompt, shared 1% dynamic risk, GTC/protection,
all session/account gates and the fresh epoch's claims/history. Read
`docs/codex-production-report.md`. This supersedes earlier Grok provider instructions;
it does not authorize strategy promotion or another accounting reset.

ISSUE-316: the operator subsequently required permanent removal of old local
trading records. That cleanup is complete; the pre-epoch database/archive is no
longer available for restore/research. Source/Git history remains. Do not restore
old state or treat deleted evidence as proven recovery. Preserve current records.

# ISSUE-314 — October 19 one-time fresh demo authorization

The operator explicitly authorized a fresh start after the legacy conflict audit.
Use a separate empty local database/runtime and the existing audited baseline
initializer after fresh flat broker and complete daily evidence. Old history is
excluded from the new operational epoch, retained separately with the frozen
research source. This supersedes the prohibition on this specific accounting
transition only; never infer recurring resets or harmless discarded callbacks.
Preserve current Grok/fade policy, shared dynamic 1% setup risk, live disabled,
all reconciliation/protection gates and every new epoch claim. Read
`docs/fresh-demo-epoch-314-report.md`; no old database rollback after new activity.

# Agent Instructions

ISSUE-255: prospective research is an isolated read-only observer, never an order
or strategy-promotion authority. Read `docs/forward-observer-report.md`. Register
future windows and freeze candidate code before collecting outcomes; do not edit
registrations, overwrite reports or select only complete winning paths. Source
drift halts research only. Preserve daily cutoff/open/gap censoring and null
counterfactual costs; 30 calendar days is a collection batch, not qualification.

ISSUE-253: use the causal conditional paired replay for entry/TP research; read
`docs/paired-replay-report.md`. It has no broker or promotion authority. Use actual
provider availability and broker acceptance events, not `orders.submitted_at`
(a locally persisted placement-result timestamp). Preserve GTC lifetime and
censor missing paths, open outcomes and OCO ambiguity. Unknown counterfactual
fees/swap/FX/margin remain null; frozen approved quantities are not a dynamically
resized portfolio backtest. Never promote from a selected complete subset.

ISSUE-245: session dependency failures must retry with bounded backoff inside
startup, never create a supervisor restart storm. Market-only reconnects require
fresh subscriptions and quotes; rejected commands are never replayed. Concurrent
broker requests must be paced serially. See `docs/session-recurrence-report.md`.
Do not attribute a new outage to an old broker error. Missing daily baselines
remain explicit accounting failures and require the existing audited evidence
procedure; reconnecting does not authorize an accounting reset.

Read `plan.md`, this file, and the relevant architecture/risk documents before changing code.

## Core bot purpose and operating contract (authoritative)

This repository implements an AI-assisted XAUUSD short-term trading system for
controlled demo evaluation. It continuously observes completed market candles,
quotes, order-book/account/risk state and broker session status; the AI proposes
two entry prices, while deterministic code owns validation, order type, SL/TP,
dynamic sizing, broker precision, margin, ownership, reconciliation and all
execution authority. The system records the complete decision and broker
lifecycle for later analysis. Live submission is disabled by default and must
never be inferred from credentials or configuration alone.

When the broker session is open, the scheduler must keep the demo system
continuously ready and evaluating new opportunities, and must resume
automatically after normal temporary failures or scheduled closures. “Trading
all the time” means continuous market-open operation, not forced order flow:
the bot must wait without a new provider call or order whenever an active group,
request cooldown, stale/invalid market data, unavailable broker session,
unreconciled account/order/position state, protection/recovery fault, affordability
failure, or other fail-closed gate applies. Accepted GTC orders and protective
maintenance remain active during waiting periods. No prompt, timer or operator
request may bypass these gates, manufacture a trade, or increase risk to maintain
frequency.

The current source is `entry-direction-v1` / worker 1.5→1.2, strategy
`0.5.0-directional-scalp.1-codex.1` / policy `0.5.0-directional-scalp.1`.
Codex chooses one continuation side with M15/M5 context and completed-M1 range.
Only its selected boundary is executable; the other is box geometry. Keep native
STOP_LIMIT/GTC protection and the unchanged opposite-box stop/equal gross TP.
WAIT has no order authority. Preserve prompt-hash isolation, scope cooldowns and
full account risk/reconciliation. See `docs/directional-entry-report.md`.
Historical prompt/release names in
older issue sections and archived evidence describe immutable past behavior and
must not be treated as current authority. The shared setup ceiling remains 1%
of reconciled current equity, both OCO/fade legs share that budget, and the
system makes no profitability claim.

## Communication preference

ISSUE-249 adds a read-only learning review and an unregistered research prompt.
Read `docs/demo-learning-review-report.md` before changing entry guidance based
on its results. The historical fade transform replaced model levels with
quote-adjacent prices; the new breakout release preserves model entry levels. Do not claim prompt-only entry improvement, mislabel an
approved leg budget as actual stop risk, infer exact SL/TP reason from P/L, or
promote a candidate automatically. Historical journals and the active cycle stay
unchanged; economic transform/prompt/TP changes require separate evidence.

Keep replies very short. Lead with the result or current blocker; put detailed evidence
in linked reports. Give longer explanations only when explicitly requested.

Money management must remain dynamic: size from current reconciled equity,
costs, broker margin and volume increments. Keep the shared 1% setup ceiling.
ISSUE-094 disables daily/high-water enforcement and reductions only in demo;
other modes retain remaining daily capacity and drawdown reductions.

## ISSUE-098 broker-session gate (current operator authorization)

- Read `docs/market-session-report.md`. Require a freshly verified broker schedule
  to be open before new analysis, actual EPR dispatch and each new demo order.
  Weekly intervals and holidays use their broker timezones; boundaries are
  reevaluated locally on every check. Session metadata is cached for 30 seconds.
- Closed or unavailable sessions wait automatically without provider calls;
  protective maintenance, reconciliation and accepted GTC orders remain active.
  A session denial must never set a global pause or erase request/account history.
- Startup uses the separate validated metadata/session endpoint, so scheduled
  closure does not require fabricated quotes. Every trading decision still needs
  fresh completed candles, quotes, book, account and risk evidence.
- A locally unsent order is journaled distinctly from broker rejection; do not
  overwrite broker acknowledgements or fabricate execution events. If the session
  closes between legs, withhold the unsent leg and cancel the owned pending peer;
  preserve uncertain cancellation and any fill for independent reconciliation.
- Session checks are not atomic with broker/provider receipt. Already dispatched
  calls and commands retain existing unknown-outcome handling and cooldowns.

## ISSUE-097 unsubmitted entry recovery (current operator authorization)

- Read `docs/entry-recovery-report.md`. Prompt `entry-pair-v3` preserves nearby
  completed-candle structure and adds deterministic executable bid/ask/tick bounds.
  The small spread/tick movement buffer is guidance only, never an extra gate.
- Retire only a proven completed, unusable, never-submitted entry context using
  fresh evidence. Never shift old prices, retire an accepted pair or erase history.
- Migration 0024 permits exactly one immediate replacement per original context;
  a replacement cannot parent another replacement. This supersedes waiting on
  crossed direct-entry maps below. Historical scenario-map behavior is unchanged.
- Preserve scope locks, unique parent claims, failed/unknown-request cooldowns,
  active-group exclusion and the database retirement/intent interlock across
  restarts. Shared 1% current-equity sizing, SL/TP and accepted GTC orders remain.

## ISSUE-094 demo development policy (current operator authorization)

- The operator explicitly requested unlocking demo trading for development while
  keeping 1% current-equity setup risk. Read `docs/demo-development-risk-report.md`.
- Release `0.2.5-market-stop.7` / `market-stop-v2` records the existing daily and
  high-water thresholds, locks and reductions but does not enforce them for demo
  admission. Both successful accounting reconciliations still precede admission;
  missing/stale/invalid/unavailable evidence remains blocked.
- Use effective multiplier 1 and at most 1% shared between both OCO legs. Costs,
  broker margin, volume steps and minimum affordability still bound actual size.
  Never change this to 1% independently per leg, fixed lots or loss chasing.
- Do not reset, delete or rewrite daily/capital baselines, locks or trade history.
  This mode-specific enforcement change supersedes older demo loss-lock rules
  below; paper, replay, backtest, shadow and live retain those rules. Live remains
  disabled. Report effective demo policy separately from stored loss measurements.
- Preserve SL/TP maintenance, emergency/ownership controls, fresh completed data,
  full reconciliation and idempotency. No new model fallback or timer cancellation.

## Current operator override — ISSUE-089 / ISSUE-087 / ISSUE-086

- ISSUE-092 uses provider prompt `entry-pair-v2`: tight support/resistance from
  the latest 10 completed M1 candles (prioritize 5), with explicitly candle-based
  order blocks as confluence. Older history provides context. Keep this guidance
  in the prompt, shared by dispatch/verification/journal; do not add order-block
  gates, price clamping, timed reviews or pending-order repricing. GTC/OCO,
  local exits and dynamic money management remain unchanged. Read
  `docs/nearby-order-block-report.md`.

- ISSUE-091: on September 10 the operator explicitly approved a fresh local demo
  start and resetting unrecovered loss/risk tracking. Use a separate database and
  a documented one-time accounting transition with fresh broker reconciliation.
  Preserve the hosted source, historical local archive and original evidence.
  This authorization does not permit recurring resets, replay of old dispatches,
  increased risk percentages or live execution. The existing dynamic sizing,
  shared 1% setup limit, 5% daily limit and drawdown reductions remain in force.

- ISSUE-090 authorizes local PostgreSQL, numeric-only production analytics 2.0,
  deduplicated candle values and on-demand display charts. Historical chart bytes
  and contracts remain immutable. Exact provider inputs/prompts and available
  response text are journaled; archived sampled evidence is pinned before cache
  eviction. Read `docs/local-storage-report.md` before storage changes. Managed
  recording requires the matching maintenance/backup timers. Never activate a
  historical recovery database or discard newer risk/dispatch state. On September
  10 the operator deferred the blocked history recovery to ISSUE-091 / #213 so
  verified ISSUE-090 implementation can be delivered independently. Merging it
  does not activate historical data or authorize a risk/accounting reset. Final
  operational activation requires current recovery or a separately authorized,
  documented accounting transition; keep the hosted source untouched meanwhile.

- ISSUE-089 removes local market-close fallbacks and their persistent analysis
  pause. Broker SL/TP handles exits; verified protection never depends on sampled
  quotes. Keep bounded SL/TP repair and historical close reconciliation. Do not
  add automatic pauses, exit fallbacks or entry filters without operator approval.
  Read `docs/broker-exit-loop-report.md`.

- September 9 policy `market-stop-v1` explicitly uses ordinary GTC STOP orders
  in the authorized demo. Keep local relative TP/SL, reserve 30 points of modeled
  adverse slippage when sizing, and monitor fills against 30 points / 2 bps.
  STOP has no broker fill-price ceiling; excess slippage still records fills and
  cancels peers, and blocks new risk until terminal recovery. Read
  `docs/market-stop-report.md`.
- One fresh context may follow fully proven zero-fill cancellation as well as a
  reconciled trade close. Exact ownership, two terminal broker events, no fills,
  positions, trades or unresolved events, and a unique durable claim are required.
  Provider failures/unknown dispatch retain cooldown. Never rearm the old map.
- Production uses readable buy/sell entry
  prices only. This supersedes the older scenario-shape/level-order requirements
  and spread, ATR entry/stop distance, preferred corridor, model target-room and
  daily order-count filters below. Read `docs/direct-entry-report.md`.
- Record the requested DeepSeek pin and returned identity; the returned identity
  is observational on this path. Provider metadata/extra fields are not required.
- Keep valid broker prices, local identity/time provenance, data integrity,
  cost-inclusive sizing/loss locks, ownership, reconciliation and idempotency.
  The historical/research contracts below remain unchanged.

## Non-negotiable safety rules

- Preserve fail-closed behavior. Missing, stale, ambiguous, unavailable, partially reconciled, or invalid state must block analysis or placement as documented.
- Never enable live execution by default or infer live authority from configured credentials.
- Preserve the current explicitly authorized contract: minimal entry parsing in production and unchanged historical schemas; retain broker precision, freshness, reconciliation and deterministic risk integrity.
- Never let model output bypass the risk engine or select position size, broker volume, precision, exposure, or mode.
- Never commit or log secrets, tokens, account IDs, authorization headers, database credentials, private URLs, cookies, or private certificates.
- Use completed candles unless a test explicitly targets forming candles and labels them as such.
- Preserve decimal strings at service boundaries and decimal arithmetic for price, money, volume, and risk calculations.
- Maintain idempotency across analysis runs, order groups, broker commands, callbacks, restarts, and reconciliation.
- Do not claim profitability. Label replay, backtest, paper, demo, shadow, and live results distinctly.

## Change discipline

- Add or update tests for every behavior change, including a rejection/failure path.
- Update documentation, JSON Schemas, shared types, and SQL migrations together when a contract changes.
- Do not make destructive database changes without a forward migration, data transition, rollback notes, and operator review.
- Document assumptions and unresolved broker-specific behavior.
- Keep every service compatible with headless Debian and systemd; avoid Docker-specific assumptions.
- Use the typed HTTP analytics contract for Node/Python communication, not shell pipelines.
- Keep broker adapters behind interfaces and test with mocks before demo integration.
- Use strategy ownership labels. Never cancel a manual order unless explicit configuration permits it.

## Current implementation contracts

- Read `docs/overhaul-report.md`, `docs/configuration.md`, `docs/architecture.md`
  and `docs/risk-model.md` before changing the current `fixed-risk-v4` system.
- Normal operator configuration is intentionally small. Change fixed policy only
  with a reviewed release and evidence; never migrate a populated `.env` by replacement.
- The normal template has 20 keys, including the exact model pin. A populated
  file may also retain private deployment credentials. Back up and preserve
  those values during an explicitly authorized migration; never copy the sample
  over them. Run both policy and `--startup` configuration checks, and report
  PM2-cached configuration separately from the file. The operator removed the
  absolute account-equity floor in ISSUE-076. Do not reintroduce a minimum starting
  balance. Fixed policy permits at most 1% current-equity risk per setup and a 5%
  UTC daily loss budget; both OCO legs share that 1%. Cost, broker margin, volume increments,
  remaining daily capacity and drawdown reductions can require smaller positions.
  These are limits, not guaranteed realized maximum losses or profit claims.
- Keep automation authorization in the full safety audit hash, separate from the
  immutable strategy-definition hash. Economic changes still require a new release.
- Preserve existing daily/drawdown locks when applying a policy update. Risk
  percentages are release constants, not environment tuning controls. Read
  `docs/fixed-risk-report.md` before changing the money-management policy.
- Request `grok-4.5` literally through the configured EPRToken chat-completions
  endpoint with `reasoning_effort: low`. Record requested/returned identities; never add a silent fallback.
  The returned identity must be `grok-4.5`; historical Astra, Sol and DeepSeek
  normalization remains documented.
  Unknown cost is null. Historical provider records remain immutable; a previous-model
  map cannot authorize new execution after a switch. Failure/unknown-dispatch cooldowns remain; one proven post-close refresh is the documented exception.
  Migration 0026 admits Grok alongside historical Astra, Sol and DeepSeek journal identities;
  never rewrite prior migration checksums or model history.
- Preserve model-independent protective maintenance and account/symbol ownership
  scope. Missing account P/L evidence or other-symbol exposure blocks new risk.
- Read `docs/pending-order-reconciliation-report.md` before changing account P/L
  matching. Every open position still requires one P/L row. A zero gross/net P/L
  row may instead match exactly one accepted, explicitly unfilled pending order's
  position identity. Unknown, duplicate, nonzero or partial evidence must reject.
  Preserve safe account failure codes without exposing raw broker errors.
- Cost-inclusive OCO sizing shares one budget across both race-exposed legs.
  Durable daily/high-water accounting and risk reductions must survive restarts.
- Production uses `entry-pair-v4` / locally bound `entry-pair-1.0`; local derived OCO
  proposals use `entry-pair-execution-v1` / schema `2.1`. Historical contracts remain
  immutable. Read `docs/reusable-scenario-report.md` before changing this path.
- The operator authorized integrated demo evaluation in ISSUE-075. Provider dispatch is durably claimed before inference. Five-minute failure/unknown-dispatch
  backoff remains; migration 0019 permits one fresh request after a fully reconciled
  consumed setup closes. No request may start with an active group.
  Only FAILED / `AI_CIRCUIT_OPEN`, emitted before provider dispatch, may use the
  one-minute local recheck. All unknown/timeout outcomes retain the full durable
  cooldown; prior requests across the entire scope still constrain admission.
  A unique context link consumes the map at order intent, including uncertain/failed submission.
  Do not count derived local proposals as paid provider requests.
- Sell target room is measured against `extension_targets[0]`, matching the buy
  leg’s first recovery target. `extension_below` is a continuation trigger, not a
  take-profit boundary. Never skip the first actual target or increase stop/size
  to make a proposal fit; all existing semantic/risk/fee checks remain required.
- Scenario provider requests have a 90-second deadline and five-second HTTP grace,
  within the unchanged five-minute map lifetime. Preserve original capture/expiry,
  output validation and independent maintenance. See `docs/provider-recovery-report.md`.
- Operator-approved ISSUE-083 uses explicit GTC for accepted pending orders: no timer
  expiry, including normal process restarts. The three-minute local deadline and
  five-minute map remain fresh-submission authorization only. Do not extend old
  proposals or model validity. Migration 0019 preserves historical GTD semantics;
  GTC stores null pending expiry and a separate submission deadline. Risk/emergency
  and OCO peer cancellations still apply. Read `docs/persistent-order-loop-report.md`.
  A normal shutdown preserves GTC; emergency stop explicitly cancels owned pending orders.
- ISSUE-084 also cancels a surviving owned order after its peer has a confirmed
  zero-fill terminal broker outcome. Preserve exact pair ownership, event evidence,
  no-fill/no-position checks and reconciliation before release. Unfilled cleanup
  never counts as a trade close or grants the post-close request exception. Durable
  peer-cancel retries include partial fills. Local TP/SL geometry is unchanged.
- Provider inference runs outside the execution promise. Reuse a validated map
  across ordinary candle advances, but never relax the fresh completed-candle
  context checks for each individual execution decision. Crossed thresholds wait;
  do not move them to manufacture entries. `DEFERRED` is terminal waiting, not
  acceptance, rejection, an order or a fill.
- Historical `scenario-v1`, structured `scenario-research-v2` and the completed-candle
  directional replay remain research-only.
  Observe/replay commands have no broker authority. They are distinct from the
  protected OCO integration, whose profitability remains unproven.
- Scenario confirmation consumes completed candles after plan availability;
  inference cannot backdate eligibility. Preserve strict event order, duplicate
  conflict handling, checkpoint failure latches and censored/unknown P&L. Structural
  and time exits cannot await the provider. Reuse the existing risk engine.
- Sampled quotes have their own source/receive/capture times, checksum, ordering,
  freshness and censoring rules. Do not describe them as a complete tick tape.
  Keep faster/directional candidates research-only until independent evidence
  supports promotion; fixture success is not economic validation.
- Keep the dashboard's Overview / Trade history / Diagnostics structure, distinct
  trading modes, authenticated controls and explicit unavailable/stale values.
- Keep navigation and control forms outside timed dashboard fragments. Background
  workers perform bounded reads only and never call Streamlit or broker mutations.
  Verify light/dark contrast and browser state across timed updates; fragment-owned
  elements must be emitted on every tick or Streamlit can remove them.

- ISSUE-079 revision `.3` removes the artificial dollar/equity notional and 1%
  margin-use caps at the operator's request. The unchanged 1% cost-inclusive loss
  budget is shared across both OCO legs. Reserve one setup loss in free margin;
  broker collateral and volume limits still constrain sizing. Never change broker
  leverage, round volume upward or target a guaranteed loss. The existing risk
  engine confirms exact-volume margin and bounds tier downsizing. A populated
  legacy `MAX_POSITION_NOTIONAL` must fail migration checks. Preserve daily locks.
- Revision `.4` refreshes market data after full account/capital checks. Preserve
  the required late authorization re-read, strict quote/book ages and the union
  of newer/placement exposure blockers. Never overwrite reconciliation uncertainty
  or newer open-order counts with an earlier empty account snapshot.
- Exact chart bytes now use protected local SHA-256 storage. Back up it and the
  database together. Never delete audit rows or silently discard PNGs. Migration
  0018 leaves old bytes intact; their relocation requires operator review after
  verified archive/restore preparation. Preserve operational fault latches across
  restarts; only a successful durable cycle clears an analysis/storage failure.

## Required completion checks

ISSUE-095 terminal recovery is documented in `docs/unattended-recovery-report.md`.
Use exact per-position full-fill or zero-fill cancellation evidence for native
protective children. Preserve original journal payloads/reasons, ownership,
volume/time equality and complete group proof. Gateway recovery consumes both
exact terminal entry orders; only the incident's own group may release slippage.
Keep idempotent responses after removing completed active callback state. Never
clear uncertainty based on elapsed time or a flat broker snapshot. Keep the
database lifecycle permutation/failure suite in unattended qualification.

Run formatting, linting, TypeScript type checks, Node tests, Python formatting/lint/type checks/tests, JSON Schema tests, migration tests, replay/fail-closed tests, secret scanning, and dependency audits. Record commands and results in `plan.md` or the implementation report.

## GitHub delivery discipline

- After every completed user-requested repository update that changes tracked
  files, inspect the diff and staged diff, run the secret scan and applicable
  quality gates, create a coherent commit on the issue branch, and push it
  before handoff. This applies to documentation-only updates too; a successful
  handoff must not leave the completed update only in the working tree or in an
  unpushed local commit.
- If authentication, authorization, network availability, branch protection,
  or another remote failure prevents the required commit or push, preserve the
  local work, do not claim successful delivery, and report the exact blocker
  and required operator action. Never bypass review or expose credentials to
  satisfy this rule.
- Represent planned development as bounded issues in `plan.md` with an identifier,
  acceptance criteria, dependencies, and current status. Add the GitHub issue or
  pull-request link after it exists remotely.
- Use a dedicated branch and pull request for each coherent issue unless the
  operator explicitly requests a direct hotfix. Respect branch protections and
  required reviews.
- Commit coherent, reviewable checkpoints that build or document an intentional
  state. Do not commit every shell command, broken intermediate state, generated
  runtime data, or trivial changes solely to inflate contribution activity.
- Push after meaningful checkpoints and before handoff. After each successful
  push, open or update the issue pull request and enable automatic merge. The
  operator has explicitly authorized automatic merge for qualifying updates in
  this repository. Merge only after the issue acceptance criteria, applicable
  quality gates, branch protection, and all required checks/reviews pass; never
  bypass a protection or failed check.
- Never place a PAT in a remote URL, command argument, issue, pull request, log,
  or tracked file. Keep a rotated least-privilege token only in the ignored,
  mode-`0600` local environment or an approved credential store.
- Before every commit, inspect the staged diff and run the secret scan. Before
  merge, run the full required completion checks and update `plan.md` plus the
  implementation report with exact results.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## ISSUE-093 missing-SL recovery (supersedes ISSUE-089 missing protection)

- Read `docs/missing-stop-recovery-report.md` before changing filled-position protection.
- Keep fresh broker SL/TP separate from intent, approved fill-relative distances,
  inward rounding and tighter existing protection.
- Two durable amendment attempts are separated by five seconds. Only a freshly
  confirmed exact owned demo position with no SL may enter the close path when
  repair is impossible or exhausted. An existing SL always prevents this path.
- Re-read ownership, exact volume and missing SL before claiming one close
  durably. Unknown/timeout dispatch, partial fills and restarts never resend it.
  Closing order/deal/P&L evidence remains necessary; no global pause or risk reset.
- Maintenance must not await inference or normal placement gates. Quote failures
  cannot prolong a confirmed missing SL, but stale/ambiguous broker or storage
  state cannot authorize a command. Never close protected/manual positions based
  only on sampled SL/TP crossings. Historical close claims remain immutable.
- A mapped unfilled SL/TP child acknowledgement may resolve after that exact child
  is explicitly cancelled and the owned position/trade and whole group have full
  terminal proof. Missing/partial/unknown cancellation or trade evidence still
  blocks; never clear price/recorder failures without existing certain recovery.
