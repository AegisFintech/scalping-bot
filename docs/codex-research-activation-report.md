# ISSUE-306 — Codex research feed and activation

Issue: https://github.com/AegisFintech/scalping-bot/issues/306.
This is the operations slice of #304; candidate implementation, independent source
verification, chronological evaluation and economic promotion are not delivered here.

## Operating boundary

The operator completed device-code login for the dedicated `scalper-research` user.
An actual subscription-authenticated read-only structured-output smoke test succeeded
with Codex 0.163.0, returned model `gpt-6.1-sol`, and `{"ok":true}`. This establishes
one successful call, not remaining quota, guaranteed latency or unlimited access.
The matching `codex-code-mode-host` companion executable was installed after the
smoke exposed its absence. No root authentication cache was copied.

The root-owned research installation under `/opt/scalper-research` contains only
research modules and a separate Python environment. Research runs as the unprivileged
user with a private home, cleared environment and its own authentication. The
trading deployment, broker settings and frozen #255 checkout are unchanged.

## Aggregate feed

`python.research.feed` is a separate trusted process. It invokes the existing
read-only `review-demo-learning.ts` exporter from immutable deployment `9b35d877`,
whose script matches the reviewed source. Its environment contains only the Node
path, locale, TSX cache control and protected dotenv-file pointer. The exporter
uses existing repeatable-read/read-only SQL, row limits and statement timeouts.
The Codex worker never executes it or receives its environment.

Each feed invocation selects the last seven complete UTC days for release
`0.3.0-fade-limit.3`; daily reviews overlap and must not be summed. The exact start,
end and release are checked before publishing. Close-time aggregates exclude open
positions; source costs and unknown provider costs retain their original meaning.
The initial integration test rejected `+00:00` timestamps because the existing
exporter requires canonical `Z`; the feed and regression test now use that contract.

Only the validated `Evidence` allowlist crosses the boundary. The inbox moved to
`/var/lib/scalper-research-feed`, root-owned and not writable by the model user.
This avoids giving a privileged feeder a path below the model user's writable home.
Publication retains content-addressed aggregate snapshots (root-only, no overwrite),
then atomically replaces `latest.json` (root owner, research group, mode 0640).
A failed publication preserves the previous input; the worker rejects it when stale.
Corrupt archives and unsafe directory ownership/permissions reject publication.

The feeder has a 60-second child deadline, process-group termination, eight-megabyte
export limit and safe error-only output. Its systemd service additionally limits
CPU, RAM, tasks, file size and elapsed time. Raw exporter errors are suppressed.
The protected environment-path pointer is local mode 0600, never committed.

## Scheduling and rollback

The hourly feed timer runs at minute 10 UTC. Daily research remains at 02:30 UTC;
weekly research remains Monday 03:00 UTC. The two research jobs share the durable
one-daily/one-weekly and eight-per-seven-days attempt limits from #302. Unknown or
failed dispatched attempts are not replayed. This is a call/time limit, not a hard
token reservation or guaranteed subscription spending cap.

Activation follows successful qualified source delivery and a real daily report.
Research templates use the new read-only inbox path. No database migrations,
trading restarts, order commands, accounting resets or frozen-source edits apply.
Rollback disables the three research timers; retain claims and reports. No new
backup or automatic evidence deletion policy is added.

## Validation and activation receipt

Focused feed/worker tests: 27 pass. Python lint/types pass. Actual aggregate export
succeeded after the timestamp correction. Both complete hosted qualifications passed on aab8d3e (runs 39191037447 and
39191042049). The real daily worker returned PROPOSAL_ONLY/HOLD with no candidates.
Feed and duplicate daily service checks succeeded.

The first weekly service failed before producing output. A separate minimal
service diagnostic reproduced SIGXFSZ (signal 25): the original 1 MiB per-file cap
was below Codex's existing roughly 2 MiB SQLite WAL. This is an operational resource
limit, not evidence of a strategy failure or exhausted subscription. The service
cap is raised to 32 MiB; the worker's 128 KB input/output validation bounds stay
unchanged. The failed weekly claim remains immutable and is not replayed. A fresh
isolated diagnostic verifies the corrected service environment before schedules
are enabled. Updated qualification and final activation receipts are attached to
the issue/PR.

## Activation receipt — 2026-10-19T02:52:07.693380+00:00

Corrected unit commit `108e2e1` passed both complete hosted qualifications:
[push run](https://github.com/AegisFintech/scalping-bot/actions/runs/39191610707)
and [PR run](https://github.com/AegisFintech/scalping-bot/actions/runs/39191615656).
Installed research modules match committed `aab8d3e`; the later change affects
only the unit resource limit and documentation. Installed Python dependencies
match the repository lock for all five packages in the minimal research environment.

A separate service diagnostic with the corrected 32 MiB cap, unprivileged user,
read-only system/home protections, 512 MiB memory and 25% CPU completed successfully.
Its structured result was `{"ok":true}`; event metadata records two completed web
search actions against official Codex documentation. This is a functional web-tool
test, not a research candidate or trading-performance result.

The trusted feed service and daily duplicate check exited successfully. Starting
the corrected weekly unit returned the existing-claim wait without inference;
all failed weekly artifact digests remained unchanged. No failed claim was deleted,
rewritten or retried. The next timer tick this week may be a no-op; the next new
weekly research period begins October 26. Daily research next runs October 20.

All three timers are enabled and active: `scalper-codex-feed.timer`,
`scalper-codex-research-daily.timer`, `scalper-codex-research-weekly.timer`.
Nominal Singapore times are hourly at minute 10, daily 10:30, and Monday 11:00,
plus bounded random delay. Reports remain in the dedicated user's private jobs
directory; the real October 19 daily report is PROPOSAL_ONLY/HOLD with zero candidates.
The first weekly failure remains recorded and has no completed research report.

Permission checks: research can read `latest.json`, cannot write the feed inbox
or installed source, and cannot read root's private directory. The privileged
exporter never invokes Codex. No trading service was restarted or reconfigured.
Frozen source remains clean at `984f479`; no accounting or risk locks were cleared.

PR: https://github.com/AegisFintech/scalping-bot/pull/307. Generated-candidate testing,
independent source verification and promotion remain pending in #304; replacing
the trading AI and simplifying its operating loop remain pending in #303.
