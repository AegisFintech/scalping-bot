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
