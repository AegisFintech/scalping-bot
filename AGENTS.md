# Agent Instructions

Read `plan.md`, this file, and the relevant architecture/risk documents before changing code.

## Non-negotiable safety rules

- Preserve fail-closed behavior. Missing, stale, ambiguous, unavailable, partially reconciled, or invalid state must block analysis or placement as documented.
- Never enable live execution by default or infer live authority from configured credentials.
- Never weaken JSON Schema, semantic, precision, freshness, reconciliation, or deterministic risk validation.
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
  and `docs/risk-model.md` before changing the current `fixed-risk-v2` system.
- Normal operator configuration is intentionally small. Change fixed policy only
  with a reviewed release and evidence; never migrate a populated `.env` by replacement.
- The normal template has 21 keys, including the exact model pin. A populated
  file may also retain private deployment credentials. Back up and preserve
  those values during an explicitly authorized migration; never copy the sample
  over them. Run both policy and `--startup` configuration checks, and report
  PM2-cached configuration separately from the file. The operator removed the
  absolute account-equity floor in ISSUE-076. Do not reintroduce a minimum starting
  balance. Fixed policy permits at most 1% current-equity risk per setup and a 5%
  UTC daily loss budget; both OCO legs share that 1%. Cost, margin, notional,
  remaining daily capacity and drawdown reductions can require smaller positions.
  These are limits, not guaranteed realized maximum losses or profit claims.
- Keep automation authorization in the full safety audit hash, separate from the
  immutable strategy-definition hash. Economic changes still require a new release.
- Preserve existing daily/drawdown locks when applying a policy update. Risk
  percentages are release constants, not environment tuning controls. Read
  `docs/fixed-risk-report.md` before changing the money-management policy.
- Request `gpt-5.6-sol/u40` literally through the configured EPRToken Responses
  endpoint. Record requested/returned identities; never add a silent fallback.
  Observed `gpt-5.6-sol` return normalization is documented in `docs/model-switch-report.md`.
  Unknown cost is null. Historical Astra records remain immutable; a previous-model
  map cannot authorize new execution after a switch. Its five-minute cooldown still applies.
  Migration 0017 admits both historical Astra and current Sol journal identities;
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
- Production context uses `scenario-v2` / `scenario-1.0`; local derived OCO
  proposals use `scenario-execution-v1` / schema `2.1`. Historical contracts remain
  immutable. Read `docs/reusable-scenario-report.md` before changing this path.
- The operator authorized integrated demo evaluation in ISSUE-075. One context
  request per five minutes is durably claimed before inference. A unique context
  link consumes the map at order intent, including uncertain/failed submission.
  Do not count derived local proposals as paid provider requests.
- Provider inference runs outside the execution promise. Reuse a validated map
  across ordinary candle advances, but never relax the fresh completed-candle
  context checks for each individual execution decision. Crossed thresholds wait;
  do not move them to manufacture entries. `DEFERRED` is terminal waiting, not
  acceptance, rejection, an order or a fill.
- `scenario-v1` and the completed-candle directional replay remain research-only.
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
