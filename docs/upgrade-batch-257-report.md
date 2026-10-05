# ISSUE-257 — Connection-bound broker requests

Issue: <https://github.com/AegisFintech/scalping-bot/issues/257>.

Queued and dispatched requests now enter the same pending registry before pacing.
Their deadline includes admission waiting. Disconnect/shutdown rejects both, and
connection generations prevent stale work from sending on a new connection.
Broker rejections are never replayed; unknown dispatched outcomes still require
existing durable execution reconciliation.

Socket events, heartbeat and reconnect/authentication continuations are bound to
their connection generation. A delayed old close or response cannot invalidate a
replacement socket. Connection setup has a bounded handshake deadline (default
request deadline, ten seconds), settles early closure/error/shutdown, and
terminates failed attempts so late opens cannot recover obsolete work.

There is no economic policy, model, sizing, database or broker command change.
The shared dynamic 1% setup ceiling, GTC orders and protective maintenance remain.
Implementation uses an isolated checkout; active services and the frozen research
source/registrations are untouched. Rollback reverts this source commit; it does
not reset accounting or replay commands.

Validation under Node 22.23.2:

- Transport lifecycle/pacing suites: nine passed, including explicit/involuntary
  disconnect, admission timeout, delayed close/response, silent/early-close
  handshake, shutdown and rejected-command cooldown.
- TypeScript and changed-file ESLint/Prettier passed. Full Node suite passed: 792 tests in 99 files (108.01 seconds), including
  schema, migration and replay/fail-closed suites. Graphify AST refresh passed;
  its known empty pyproject.toml warning remains.
- Full qualification has known baseline formatting/security and missing isolated
  integration failures. Batch 259 owns their repair; this PR cannot bypass them.

Follow-up: an explicit connection now cancels the prior retry timer before
starting its new generation. Otherwise a second disconnect could be suppressed
by the stale timer, which would later return without scheduling recovery.
A deterministic two-disconnect test requires the third socket to open and recover.
This is source-only repair; no broker/session fault was injected into the demo.
