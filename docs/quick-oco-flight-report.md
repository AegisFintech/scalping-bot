# ISSUE-376 — Cost-aware quick TP, dual breakout OCO and flight recorder

Status: implemented; qualification and matching existing-demo activation are
recorded below and on [issue #376](https://github.com/AegisFintech/scalping-bot/issues/376).
This is an operator-authorized, unqualified demo experiment, not a profitability
claim. Earlier release reports, prompts, schema versions and registrations remain
immutable.

## Authorized execution contract

Source `0.7.0-quick-oco.1-codex.1`, policy `0.7.0-quick-oco.1` fixes new setups to
OCO STOP_LIMIT/GTC: BUY at Codex's original upper boundary, SELL at its original
lower boundary. Neither entry is inverted, clamped or moved to manufacture a
trade. Codex can still WAIT; fresh completed M1/M5/M15 technical/SMC/DOM context,
market session, provider cooldowns, ownership, account reconciliation and all
protection/recovery gates remain authoritative. No new trading bot or public
mode selector is introduced.

The provider prompt is `entry-quick-oco-v1`, worker request **1.7** / response 1.2.
The local deterministic proposal artifact is separately versioned
`entry-quick-oco-execution-v1`. Request 1.7 adds an exact 5% execution-context
contract and fixed dual STOP_LIMIT / cost-aware TP / 7× SL guidance. Historical
request 1.6, its 1% contract and `entry-modes-v1` prompt remain immutable and
cannot accept this new payload. Node dispatch, Python validation, prompt hashes
and durable evidence share the new identity. Daily memory gets the new prompt pin;
old thread/job history remains, with no reset or fallback. Persistent provider
memory is context, not model training.

For each new leg, choose the smallest whole broker pip gross TP that meets a
modeled **0.08 broker pip net objective** after broker metadata commissions,
conversion charges and the retained 30 entry + 65 exit tick reserves. SL distance
is exactly **seven times this gross TP price distance**, before costs. The ratio
is not a net payoff guarantee. Native relative protection encodes the same 7:1
geometry and follows the actual fill. Quote spread is already present in the
executable bid/ask and is not subtracted again. Unknown future swap remains null;
actual slippage, conversion, swap and fees can differ. Actual-volume costs are
rechecked against fresh metadata immediately before placement. Invalid geometry,
unsupported costs or insufficient affordability rejects, without shifting entries
or increasing risk.

## Verified fee and pip evidence

Read-only broker metadata on 26 October 2026 reports pip position 2 and both pip
and tick size **0.01 price units**. Therefore 0.08 broker pip is **0.0008 price
units**, below one native price tick; gross TP must round upward. Commission is
**USD_PER_MILLION_USD at rate 30**, not a verified fixed $7 per lot. Three recent
canonical closed demo trades showed approximately $23.88, $23.92 and $24.01
round-trip fees per lot after matching actual entry-fill volumes. No identifiers
or private broker payloads are published here.

The implementation uses verified broker costs, never the unverified $7 estimate.
At roughly $4,000 gold and this metadata, commissions cost about 24 broker pips,
and existing execution reserves add 95 ticks; a typical minimum gross TP is about
120 broker pips ($1.20 price), with SL about $8.40. Exact levels depend on the
fresh metadata, entry and minimum commission. **0.08 is the modeled net objective,
not the displayed gross TP or guaranteed closing proceeds.** Native whole-pip
rounding normally leaves additional modeled room. This differs materially from
an infeasible sub-tick gross target.

## Dynamic setup sizing and continuity

Only explicit DEMO admission changes to **5% reconciled current equity shared
between both race-exposed legs**, at most 2.5% each. Volumes round down to broker
steps; current equity, commissions, stop reserve, exact broker margin and free
margin still constrain actual size. There is no fixed 3–5× lot multiplier,
martingale, reassignment of unused peer budget or guaranteed maximum realized
loss. Other modes retain the 1% setup ceiling; the new execution composition
rejects non-demo use. Live submission remains disabled by default.

Demo daily/high-water loss measurements remain durable and explicit; the existing
demo-only non-enforcement policy is unchanged. Other modes retain enforcement
and reductions. The existing consecutive-loss cooldown is retained. No accounting,
trade history, provider memory, dispatch claim or risk baseline is reset.

Risk schema 1.6 adds this policy and permits 5% only for this exact version in
demo; previous schemas are unchanged. Existing migration 0033 already records
immutable profile/revision/cardinality, so no new migration is required. Deployment
uses a scoped compare-and-swap transition of the current selection to OCO, never a
startup overwrite. An existing accepted single/older OCO group retains its
original type, volume, protection and terminal proof. The new profile waits for
that group to finish; there is no cancellation to accelerate activation. Rollback
requires all new groups to be proven terminal before older execution code resumes;
never relabel, resize or rewrite them.

## Setup flight recorder

The market-data process observes actual broker spot update callbacks into an
8,192-event bounded ring. Read-only HTTP returns at most 2,048 events per batch,
with stream identity, sequence and explicit overflow/reconnect gaps. Source and
receive times remain distinct, missing broker timestamps remain null, and partial
bid/ask update flags remain present. Subscription polling never synthesizes a
quote event. This is bounded observed evidence, **not a complete tick tape or
consolidated order book**.

A separate unprivileged operational recorder polls the ring at 250 ms and a
repeatable-read, SELECT-only account/symbol/demo database snapshot at one second.
Its credentials cannot mutate trading tables; it has no provider, order or admin
credentials. A cheap static source endpoint avoids account-status reconciliation
polls. The recorder does not call any trading control or broker command.

Each setup has append-only hash-chained lifecycle, quote and gap records from
observed intent/placement through pending, fill/cancel, protection and canonical
close. Broker source/receive times and payload hashes are preserved without raw
payloads or account/order identifiers. Local placement-result time is explicitly
not broker acceptance or wire latency. Entry-journal commissions are separate from
canonical closed net/fees; signed fees are not subtracted twice.

For actual fills, BUY excursions use bid and SELL excursions use ask. Summaries
show observed MFE/MAE, closest TP/SL, entry slippage, modeled net and sampled time
profitable. Metrics begin when durable fill evidence is visible; earlier sub-second
movement remains in raw records for later causal review. These are observed
bounds, not reconstructed broker extrema. Protection uses a prior verified broker observation when available,
otherwise explicitly fill-relative intent. Partial-fill basis changes censor prior
metrics; raw observations remain. Late close evidence removes post-close metrics
using a bounded ten-second checkpoint window; older unavailable windows are
explicitly censored. Another 30 seconds of raw quotes after terminal observation
supports later review, without extending open-trade excursions. Both boundaries
record proximity/crossing, **never a hypothetical fill or counterfactual profit**.

Recorder restarts/carry-in, invalid/stale quotes, partial updates, source drift,
ring overflow, interrupted storage and missing intervals remain visible. It never
reconstructs missing extrema or claims a missed winner from later price movement.
Existing independent prospective research remains read-only, with frozen future
windows, daily cutoffs, censoring and null counterfactual costs unchanged.

Raw segments compress losslessly at 8 MiB, verifying gzip bytes before removing
the identical uncompressed segment. Completed summaries become read-only.
Learning evidence is not a diagnostic log: it is not deleted by seven-day log
rotation. A 512 MiB total budget reserves 16 MiB for compression/status; less than
2 GiB free disk or a full recorder budget stops/censors recording and reports a
gap without pausing the trading/protection engine. No automatic evidence eviction
is authorized. Separate storage monitoring can support later reviewed archival.

The dashboard defaults to a **Flight** tab with moving bid/ask path, observed
entries/protection and metrics; M1/M5/M15 completed charts remain available.
Client and server freshness checks withdraw stale evidence. Shared setup budget
shows the verified active policy percentage. All display remains read-only and
unavailable account state never implies a flat account.

## Validation and activation

Required gates include positive/failure tests for exact native 7× distances,
whole-pip minimum net/cost rounding, actual-volume late fee changes, dynamic
shared demo sizing, unchanged other modes, fixed profile admission, quote events,
HTTP/schema bounds, recorder gaps/compression/quota/partial/late-close behavior,
stale/path-safe dashboard reads, and historical database lifecycle/recovery.
Full qualification, both configuration checks, AST-only Graphify and matching
source-head hosted checks precede main deployment. Operational receipts are
appended to the issue without editing frozen prior evidence.

## First checkpoint qualification and pre-deployment boundary review

The first checkpoint `node scripts/qualify.mjs` under Node 22 passed every required gate and
**1,668 tests**: **1,102 Node, 115 isolated PostgreSQL, 451 Python**. All 34 migration
checksums/lifecycle cases passed; no new migration was added. Formatting, lint,
TypeScript/Python types, build, schemas, replay/fail-closed, secret scan and npm /
Python dependency audits passed. One upstream FastAPI test-client deprecation
warning remains; tests pass. Both `.env.sample` policy and `--startup` checks pass,
and the current populated deployment env passes the new startup check without
replacement or printing credentials. AST Graphify is refreshed; document semantic
labels remain their existing historical extraction.

Read-only current database smoke passed both latest and exact opaque-key lookup
with one accepted unfilled historical single group; this does not establish a new
policy fill. Playwright passed desktop 1920/1440/1280 and mobile 390 layouts,
read-only controls, new Flight path freshness/dynamic budget, polling persistence,
transport withdrawal/recovery, HTML injection, stale/partial data, bounded events,
reduced motion/fullscreen and zero browser errors/external harness requests.
Earlier preliminary lint failures were fixed; a development run whose source
changed was discarded. Only the final frozen qualified fingerprint is authoritative.

[Exact commands, gate results and fingerprints](evidence/quick-oco-flight-validation.json).
A subsequent pre-deployment transport review found that historical request 1.6
correctly rejects a 5% context and its old prompt describes equal-distance exits.
The merge was stopped while still draft; no runtime changed. New request 1.7 /
provider prompt and an actual TypeScript-to-Python contract test correct this
boundary. The checkpoint evidence remains immutable; renewed final source
qualification is recorded separately below.

Reviewed PR, exact-head hosted checks, merge and same-demo activation follow on
[issue #376](https://github.com/AegisFintech/scalping-bot/issues/376); source tests
alone do not claim deployment, fills, expected returns or qualification.

## Final source qualification — request 1.7

The corrected full `node scripts/qualify.mjs` passed every required gate and
**1,672 tests**: **1,103 Node, 115 isolated PostgreSQL, 454 Python**. The actual
TypeScript request body validates against Python RequestV17 before a simulated
receipt; new risk5 and historical risk1 reject each other's versioned contracts.
BUY/SELL/WAIT native receipt cases and historical schema equality pass. Old
request1.6 schema and provider prompt bytes match main exactly. No runtime was
changed by the first checkpoint or this qualification.

Both configuration checks, refreshed AST Graphify and the earlier desktop/mobile
browser checks pass. Full formatting/lint/types/build/schema/migration/lifecycle/
replay/fail-closed, secret and both dependency audits pass. All 34 migrations stay
unchanged. [Authoritative final commands/results/fingerprint](evidence/quick-oco-flight-validation-v2.json)
supersede the first checkpoint for delivery. Matching main deployment must verify
actual completed-market input through RequestV17 with a simulated provider receipt
and zero forced provider/order calls before resuming admission.
