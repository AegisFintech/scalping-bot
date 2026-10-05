# ISSUE-273: integrate the qualified source into main

The current main branch (`af2ff1b`) predates the deployed Grok/fade release,
recovery fixes and isolated research stack. This integration retains that
operator-approved source plus the qualified October 5 upgrades and PR #272.
It does not select new strategy economics, deploy services or alter the frozen
research checkout. Source authority remains the current AGENTS contract.

## Conflict review

Four conflicts were resolved explicitly:

- Entry planner: retain literal Grok chat-completions, low reasoning, 1,024 output
  tokens and 120 M1 / 72 M5 / 48 M15 completed-bar bounds. Main's older generic
  request policy would undo the documented provider deadline repair.
- Architecture: retain Grok and its current completed-bar limits, preserving
  entry-pair-v4 and main's completed-candle structure guidance.
- Configuration: retain additive migration 0026 and Grok's bounded request
  contract; historical DeepSeek/Astra/Sol identities remain immutable.
- Plan: retain both histories and their common ISSUE-104 section, plus a bounded
  integration issue and current status.

The resolved executable files match the already qualified PR #272 source.
No tests or trading gates were relaxed. Main's prompt v4 guidance, contracts and
entry tests remain present. The larger main diff includes previously authorized
and documented changes, not a fresh economic experiment: current fade-limit.3,
Grok identity and migration, durable recovery, transport/readiness upgrades,
read-only research/diagnostics, isolated qualification and release preparation.

## Current pending milestones

- #222: a new read-only current-release observer began October 5 05:36 UTC, capped
  at 168 hours. Fixed copied code/dependency manifest, Node 22.23.2, independent
  resource-limited transient systemd unit and a new private checkpoint. Original
  trading processes and historical checkpoints remain unchanged. Calendar time
  does not prove market-open coverage or protected cycles; recovery/rollover and
  alert evidence remain necessary. The unit needs explicit resume after host
  reboot; it is not a persistent service installation.
- #255/#262: frozen October 2–November 1 prospective research continues; all
  recommendations remain HOLD. No registration, candidate, historical report or
  counterfactual costs are rewritten by source integration.
- #260: immutable release preparation is implemented; matching supervisor
  activation and restart/failure drills remain outstanding.
- Backup work was explicitly deferred by the operator. No backup/restore success
  or unattended-readiness qualification is claimed.

Completed source issues #257/#258/#259/#261 are closed. Old PR #228 is closed as
superseded; its equal-distance market-stop trial must not overwrite fade-limit.3.
Original `/root/scalping-bot` remains clean at `984f479`; separate source worktrees
and the read-only #222 observer do not switch or restart it.

## Validation

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all phases on
Node 22.23.2 / Python 3.13.5: 824 Node tests / 106 files, 70 disposable TLS
database tests and 261 Python tests, no skips. Formatting, lint, types/build,
JSON Schema/migration/replay/fail-closed coverage, secret scan and both dependency
audits passed; audits report zero vulnerabilities. Private logs:
`/tmp/scalper-qualification-jOUCti/checks`. No production fault injection or
broker command is used for integration checks.
