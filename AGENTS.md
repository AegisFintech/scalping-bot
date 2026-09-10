# Agent Instructions

Read `plan.md`, this file, and the relevant architecture/risk documents before changing code.

## Communication preference

Keep replies very short. Lead with the result or current blocker; put detailed evidence
in linked reports. Give longer explanations only when explicitly requested.

Money management must remain dynamic: size from current reconciled equity and
remaining daily capacity, with drawdown reductions, costs, broker margin and
volume increments. Do not replace this with fixed lots or automatic risk increases.

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
- Request `deepseek-v4-pro/u5W` literally through the configured EPRToken Responses
  endpoint. Record requested/returned identities; never add a silent fallback.
  Observed `deepseek-v4-pro` return normalization and structured input are documented
  in `docs/deepseek-context-report.md`. Historical Astra normalization remains documented.
  Unknown cost is null. Historical provider records remain immutable; a previous-model
  map cannot authorize new execution after a switch. Failure/unknown-dispatch cooldowns remain; one proven post-close refresh is the documented exception.
  Migration 0020 admits DeepSeek alongside historical Astra and Sol journal identities;
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
- Production uses `entry-pair-v2` / locally bound `entry-pair-1.0`; local derived OCO
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

## ISSUE-089 protection maintenance (supersedes ISSUE-088 exits)

- Read `docs/position-protection-report.md` before changing filled-position protection.
- Keep broker-observed SL/TP separate from entry intent and require observation freshness.
- Preserve approved distances from actual fill, inward tick rounding, and existing tighter protection.
- Two durable amendment attempts bound repairs across restarts. Failed/exhausted repairs
  remain visible without market closing or setting a global analysis pause.
- Historical close claims still require broker deal evidence; never retry their dispatch.
- Protective maintenance must not await inference or ordinary placement gates. Only exact owned
  demo positions can be amended; closing fills still require existing deal/P&L evidence.
