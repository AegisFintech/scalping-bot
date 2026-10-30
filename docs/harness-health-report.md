# Continuous harness visibility

Part of [#431](https://github.com/AegisFintech/scalping-bot/issues/431) and the
dashboard portion of [#403](https://github.com/AegisFintech/scalping-bot/issues/403).
The existing demo remains the only broker authority. This batch adds a one-minute
read-only monitor and a dashboard research-status disclosure; it grants no recovery,
order, provider, cancellation, reset, deployment or strategy authority.

The monitor reuses the execution watchdog's current status and the dashboard's
bounded Flight projection. It needs no recorder/database credentials. Market closure,
accepted exposure, normal admission waits, explicit pauses, stalled progress and
unavailable observations remain distinct. Five existing PM2 processes already have
automatic crash recovery with a five-second delay and zero recorded restarts at
inspection. The enabled boot unit and mode0600 saved PM2 dump contain those same five
release paths; no second supervisor or duplicate demo is started.

A restricted SSH reader on tc01 exposes only current observation/experiment health,
one proposed research question and recorded closure counts. Negative, rejected and
inconclusive trials stay visible; these counts are experiments, not trade results.
The exporter validates closure/finding digests and keeps unknown remote outcomes
explicit. A bounded full-ledger claim scan retains unresolved jobs outside the
coordinator’s rotating four-job sample; unavailable counts remain null, not zero. It never reads model credentials or dispatches a model/job. Review health
expires after40 minutes, coordinator health after5 minutes; the collector's public
snapshot expires after3 minutes. Each stage also retains its own expiry, checked on API reads and browser ticks.
Future timestamps and invalid data fail unavailable.

The current loop is distinct from frozen historical studies. Historical source-drift
halts and old unknown jobs are not reset or retried. A current coordinator failure
cannot be blamed on an old research halt. Existing bounded session recovery, broker
reconciliation and PM2 restarts remain responsible for recovery; elapsed time or a
green process never clears uncertainty.

The landscape layout keeps its existing controls and panels. A keyboard-accessible
Research pipeline disclosure shows each stage, latest proposed question, plan/job
identities, recorded trial counts and an independently reported publication PR when
available. Dynamic content uses text nodes and fixed GitHub link prefixes. Losing
the monitor or SSH reader shows unavailable/stale observations, never a healthy or
flat account. No email/chat destination is added: findings appear in the dashboard,
this conversation and the existing local service journal.

## Publication and deployment boundary

The monitor reads a separate bounded `/var/lib/scalper-publisher/status.json` receipt
when an actual publisher exists. Missing/stale receipts do not imply activation.
The operator selected `aloycwl`; that account was subsequently verified on tc01 and
submitted an automated, authorized source-bound approval of PR456 after independent
reviews and both hosted checks passed. This supersedes the earlier local-only
credential search. The result-derived candidate remains separately subject to
publication/review gates; the infrastructure PR is not its research PR.

No economic candidate or release is promoted here. #403's matched rollout/rollback
and future-outcome acceptance and #431's complete unattended publication-cycle proof
remain open until the publisher chain supplies actual evidence. A read-only status
page is not whole-loop completion.

Independent Standards and Spec reviews found and corrected Flight projection/state,
effective-admission/watchdog precedence, rotating unknown-job visibility, missing
timestamps, and per-stage expiry. All38 focused monitor tests pass, including
actual Flight projection, false admission, malformed/stale evidence and five jobs
outside a four-job sample. Fixture-only Chromium checks pass for keyboard disclosure,
1920/1440/1280/390px panel bounds, text safety, independent component expiry and
collector expiry. No browser controls or broker/provider requests were submitted.

Full qualification, deployment and natural timer receipts follow below. The saved
PM2 boot configuration was inspected; no real reboot/crash of the demo is claimed.

## Qualification and reader probe

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed every gate:
1,271 Node,147 PostgreSQL and910 Python tests (2,328 total), formatting, lint,
types, build, secret scan and both dependency audits. Four configuration checks
(sample/populated, policy/startup) passed without changing configuration.
The [qualification receipt](evidence/harness-health-validation.json) binds source
`c274fe44d9c100fe195972483b323142f6fdbca17678b8e5df03ab117d3017c7`.
Graphify updated14,680 nodes/24,124 edges/878 communities; existing `pyproject.toml`
zero-node warning remains. The existing Starlette/httpx deprecation warning remains.

A dedicated local monitor user has a new SSH key that tc01 restricts to one
root-owned forced command: bounded export as the existing unprivileged research
user. Arbitrary requested commands cannot run. Existing SSH keys are preserved.
No reader access to recorder credentials or the broker database was granted.
The first failure-probe write found a root-owned temporary test directory; ownership
was corrected before repeating it. This was probe provisioning, not a trading fault.
Runtime activation and natural timer evidence are recorded after reviewed delivery.

## Reviewed activation

PR457 merged as `4af946bf3af36878624d006fb7ac21b1ef391ab4` after both hosted
runs passed the exact head and `aloycwl` submitted the authorized automated review.
The first artifact preparation rejected worktree dependency symlinks; preparing
from the clean primary checkout passed. PM2 restart updated arguments but retained
its old cwd; replacing only the dashboard process corrected the deployment.
The four trading/dependency PIDs stayed unchanged. The verified dashboard artifact
is `health431-main`; broker execution remains `predispatch434-r2-main`.

The systemd health timer is enabled and its natural10:10:32 and10:11:32 UTC runs
completed successfully. A live Chromium check confirmed five stages and keyboard
panel opening without browser errors. Its first probe incorrectly waited for
visibility inside the initially collapsed disclosure; waiting for attachment then
opening the disclosure passed. Missing/stale Flight projections remain explicit;
a publisher receipt is correctly unavailable until #452 activation.
[Rollout receipt](evidence/harness-health-rollout.json).

Rollback restores only the previous dashboard artifact (replace its PM2 process,
verify cwd, save the dump) and disables this monitor timer. The old dashboard
artifact remains intact and no broker/risk/accounting migration occurred. Boot
configuration is saved; no actual machine reboot was performed. Full unattended
publication and economically qualified rollout remain open.
