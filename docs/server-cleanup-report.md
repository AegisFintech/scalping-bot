# ISSUE-360 — Server cleanup and per-push maintenance

Issue: https://github.com/AegisFintech/scalping-bot/issues/360.

## Result and boundary

The operator explicitly requested removal of unused project/server files and
services, Claude/OpenCode removal, Graphify maintenance and README/AGENTS updates
for each pushed commit. Cleanup completed on 21 October 2026 at 17:39 Singapore;
subsequent unit consolidation preserved the worker's effective configuration/PID.
This is maintenance, not another strategy release or deployment. The controlled
DEMO remains `0.4.2-compression-scalp.1-codex.1` on the existing immutable artifact.
No bot restart, manual broker/provider command, accounting reset, migration or new research
registration was performed.

Before: 44,690,649,088 bytes used; filesystem displayed 89% full.
After the removal pass: 37,436,051,456 bytes used, 12,912,590,848 bytes available;
filesystem displayed 75% full. Net reduction: **7,254,597,632 bytes (6.76 GiB)**.
These are point-in-time measurements; normal trading/logs/installation caches
continue writing. The private exclusive receipt is
`/var/lib/scalper-demo-epoch-314/.runtime/server-cleanup-360/completed.json`.

## Removed and retained

- Removed root's Claude binary link, installed versions, user state/config/history,
  and OpenCode binary/plugins/config/cache/state/history/database. No tool process
  or loaded file was in use. Removed the obsolete OpenCode PATH entries from the
  root shell and PM2 startup unit; reloaded systemd without restarting PM2.
- Removed 13 old standalone Codex versions and four daemon versions after checking
  live process executables, working directories, mappings and open descriptors.
  Kept current **0.163.0**, fallback **0.162.1**, active sessions, auth and all
  project workers. Held installation locks while pruning version directories.
- Removed reproducible node_modules/type/test caches from the unused upgrades
  and GTC-fix development worktrees, the GTC-fix venv, an unused temporary Node
  dependency staging directory and pip/npm download caches. Source, Git history,
  runtime data, research outputs and deployment artifacts remain. Retained the
  upgrades venv because copied entry scripts in other environments still reference
  its absolute interpreter path. Do not remove a venv based only on its name.
- Retired four unregistered stale schedules: Codex aggregate feed, daily research,
  weekly research and candidate intake. Their feed source points to a superseded
  deployment; recent feed/daily attempts failed. They do not participate in current
  entry proposals. Removed their four timer and three service definitions after
  disabling/stopping them. Preserved jobs, feed/candidate evidence and repository
  templates; private unit copies support reviewed manual restoration.
- Retired the completed, inactive 24-hour #334 operational observer unit after
  confirming its checkpoint says complete. Its checkpoint and 30-day registration
  remain unchanged. Removed three fully overridden Codex worker drop-ins; the
  final #353 drop-in remains. Effective ExecStart, Environment and PID are identical.
- Removed unused `pino-pretty` and 12 otherwise unneeded lockfile dependencies.
  Repository reference search found no runtime, script or test consumer; structured
  Pino logging remains. No application execution path was removed speculatively.

Retained all five running PM2 services, current isolated Codex entry worker,
current seven-day compression observer, three still-running registered SMC
observers, storage maintenance/backup timers and their dependencies. The #255
and #319 registered research definitions/outputs are retained even where a job is
failed/disabled: a failed research job is not permission to discard its registered
window. Their existing failures are not fixed by this cleanup or attributed to
trading. Any missing collection remains missing/censored, not a complete cohort.

Graphify and reference searches confirmed the dashboard's overview/command/position
helpers still have consumers. Historical prompts, schemas, migrations, research
CLIs and service templates support audit/replay or optional deployments; no
application module was deleted solely because it is absent from the current UI.

All immutable `/opt` release/worker artifacts, old study registrations, journals,
charts, broker/risk/dispatch records, PostgreSQL, private environments, Codex
credentials and unrelated projects remain. Old registered observers may report
identity mismatch after a release change; preserve that limitation rather than
retargeting their frozen cohort. No blanket apt autoremove, log vacuum, database
pruning, worktree removal or deletion of `/tmp` qualification evidence was used.

## Push maintenance

`npm run hooks:install` installs the tracked `.githooks/pre-push` through local
`core.hooksPath`; it refuses to replace a custom hooks path or an existing pre-push
hook. Installed successfully in the active development repository. In this linked
worktree setup the Git local configuration is shared; the relative hook directory
exists only in checkouts containing this change. Frozen worktrees are not updated.

Each outgoing non-merge branch commit must contain meaningful README.md and
AGENTS.md changes. A new branch compares against fetched origin/main; subsequent
pushes compare against the remote old SHA. Dirty tracked files, unavailable Git
baseline, missing documentation or failed/missing Graphify block the push. Branch
deletions/tags are exempt. Graphify runs once per branch push as local
`graphify update .`, bounded to 120 seconds, without provider inference/API cost.
Ignored Graphify outputs stay local. The hook never commits, pushes, cleans the
server or restarts services. Local hooks are opt-in and not remote enforcement;
full qualification, issue PRs, secret scans and required hosted checks remain.

README now describes the actual compression demo/v6/structural-1:1 contract rather
than the previous breakout/v5 release. AGENTS records cleanup constraints, the
absolute-venv-path pitfall and the required documentation/Graphify cadence.

## Validation

Eight isolated real-Git fixture tests initially passed: normal push, first branch,
missing documentation, checking every commit, graph failure/dirty tracked state,
branch deletion, missing baseline and installer existing-hook protection/idempotency.
Dependency install/audit reports zero vulnerabilities. Deployed artifact integrity
verification returns RELEASE_VERIFIED after cleanup. All five PM2 processes remain
online at their original release paths; Codex and the current/frozen observers
remain active. The removal-pass before/after snapshots report operationalReady=true,
automation enabled, pause=false and no operational fault. Twenty-two protected
credential/registration/manifest files matched before/after hashes; raw values and
broker/account IDs were never exported to this report.

Full qualification **passed: 1,001 Node + 94 isolated PostgreSQL + 405 Python =
1,500 tests**. Formatting, lint, TypeScript/Python types, isolated build,
schema/migration/replay/fail-closed suites, secret scan and npm/Python audits all
passed. The only Python warning is the existing Starlette/httpx deprecation.
Command: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`.
Exact commands/results: [validation receipt](evidence/server-cleanup-validation.json).
Private logs: `/tmp/scalper-qualification-3PMrkJ/checks`.
Qualified source SHA-256:
`26d3afda9dc4a8a7f909ab7c7f6f8c81c1de4259ff95b573f743f18e05c5951a`.
Documentation-only receipt edits are formatted and secret-scanned before commit.

`graphify update .` passed: **6,714 nodes / 12,664 edges / 534 communities**,
zero API calls. HTML uses the aggregated community view because the graph exceeds
5,000 nodes. Existing pyproject zero-node and community-label warnings remain;
no paid relabeling or semantic document extraction was performed. The per-push
hook refreshes code relationships, not prose semantics. This limitation is explicit;
README/AGENTS/report content itself is updated and reviewed in Git.

Deployed integrity verification:
`npm run release:verify -- /opt/ctrader-ai-scalper/releases/compression358-precision-qualified`
returned `RELEASE_VERIFIED`. `sh -n .githooks/pre-push` and Node syntax checks for
both maintenance scripts passed. The corrected health route is `/health/live`;
`/health` is not a route, and its initial 404 is not a worker failure.
Final pushed-head hosted checks must pass before the draft PR is marked ready and
auto-merged; the final remote receipt is posted on #360 rather than creating a
self-referential chain of documentation commits.

Rollback reinstalls removed development dependencies from
lockfiles and restores retired units from the private receipt only after reviewing
source/epoch compatibility; do not reactivate historical trading state. Removed
Claude/OpenCode histories are intentionally deleted, not backed up or restorable
from this change.
