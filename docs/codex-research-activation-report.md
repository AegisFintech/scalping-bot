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
succeeded after the timestamp correction. Full hosted qualification and service
activation results will be attached to the issue/PR before handoff.
