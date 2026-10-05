# Recovery preflight and liveness audit — September 29

Issue: [#247](https://github.com/AegisFintech/scalping-bot/issues/247).
Inspected source: `c01e771`. All times below are UTC.

## Current outcome

At approximately 01:24–01:26, execution reported demo mode, session OPEN,
automation RUNNING, trading enabled, and no admission reason codes. All five
PM2 services were online. Market/execution restart counters were unchanged
from the September 24 handoff (13 and 9,588 respectively). Process uptime
alone is not evidence that trades can be placed.

The audited baseline recovery preflight found a current, recently reconciled
September 29 UTC baseline, with daily rows for September 25–29. September 24
is still absent; no historical accounting was fabricated. The first subsequent
context request was September 25 at 00:00:06.139, consistent with the existing
five-minute UTC rollover capture window. The latest explicit operator-baseline
audit remains September 10: manual recovery was not performed in this audit.

The recovery mutation is unnecessary now and would be inappropriate: an existing
baseline must not be replaced, and today's broker trading activity disqualifies
the zero-activity initialization procedure. No emergency-stop transition,
environment change, restart, baseline write or broker command was issued.
Read-only database queries used a read-only transaction.

Closed demo trades recorded September 25/27/28/29: 17/3/22/1 respectively at
observation. The latest close was September 29 at 00:17:39.634. Unresolved
broker events with nonempty reason codes: zero. Historical reason codes must
not be counted as unresolved without checking `resolved_at`.

## Confirmed additional defects

These are **mock reproductions against current source**, not proof they caused
the original outage or occurred at the broker. No fault was injected into the
running services. The following code defects remain unfixed in this audit.

### 1. High priority: requests can cross a connection boundary

`packages/ctrader-client/src/transport.ts`, `request`, `#rateLimit`, `close`:
the admission promise queue is outside `#pending`. Closing rejects only requests
already sent; callers waiting for admission are neither invalidated nor bound
to the socket on which their invocation began.

Reproduction: use EventEmitter fake sockets with asynchronous successful replies;
send a regular metadata request to occupy the pacing slot; queue payload 2106
(NEW_ORDER_REQ, mock payload only); close and reconnect before its slot opens.
Observed old-socket sends `[2114]`, new-socket sends `[2106]`, queued result
`sent`. This is delayed unsent work, not replay of an acknowledged command.
It can nevertheless dispatch after the original session/authorization context.

Required repair/test: invalidate queued work on disconnect using a connection
generation; reject before send if generation or deadline changed. Include admission
waiting in a bounded request deadline. Test explicit close, involuntary disconnect,
cooldown, slow admission and reconnect/authentication; never blindly resend an
unknown command. Preserve durable reconciliation of already-dispatched requests.

### 2. High priority: connection establishment can hang recovery

`transport.ts`, `#open`: the connection promise settles on `open` or `error`,
but has no handshake deadline and does not reject on a close-before-open event.
`requestTimeoutMs` only starts after admission to an individual request.
The default WebSocket constructor is not supplied a `handshakeTimeout`.

Reproduction: a fake socket that emits neither `open` nor `error`, with
`requestTimeoutMs: 20`, leaves connect pending after a 100ms observation.
The source has no timeout to settle it later. The market recovery runner awaits
reconnect in its single shared pending promise, so this case can prevent further
probes and can stall shutdown's `drain()`.

Required repair/test: bound connection establishment, settle on early close and
cancellation, clean listeners/timers and terminate the failed socket. Test a
silent handshake, close-before-open, explicit shutdown while connecting and
later successful recovery. A timeout wrapper must also cancel the underlying
attempt; otherwise late opens can still interfere with new connections.

### 3. High priority: an old socket can invalidate a new one

`transport.ts`, `#open`, `#closed`: close listeners call an unqualified
`#closed()` which clears the current socket and rejects its pending requests.
Explicit close waits only two seconds; the old socket may close later.

Reproduction: a fake old socket delays its close beyond that wait; reconnect
opens a new socket; then emit the old close event. Observed
`connectedBefore: true`, `connectedAfter: false`, `newSocketStillOpen: true`.
The callback discarded the new connection even though it remained open.

Required repair/test: bind socket events and reconnect continuations to a socket
generation; ignore stale close/error/message callbacks. Test late close and late
responses after replacement, preserving exactly one current heartbeat/reconnect
timer. Group this fix with queued-request invalidation.

### 4. Medium priority: readiness conflates independent failure paths

`apps/market-data-service/src/index.ts`, `createMarketDataServer`:
one shared `ready` boolean is set false by session failures and true by successful
quotes/snapshots. Successful session reads do not restore it.

In-process Fastify injection with a fake adapter reproduced both directions:

| Sequence                             | Endpoint result | Readiness result            |
| ------------------------------------ | --------------- | --------------------------- |
| Session fails                        | 503             | 503                         |
| Session recovers, no quote requested | 200             | 503                         |
| Session fails again, quote succeeds  | quote 200       | 200 despite session failure |

Required repair/test: track component health separately; a quote must not clear
a session failure, and a successful session must clear its own failure. Define
closed-session readiness without requiring fabricated fresh quotes. Test both
sequences plus market closure and simultaneous snapshot failure. This is misleading
health reporting; downstream session validation still blocks new orders.

## Recurrence exposure and other observations

- Missing the daily capture window can still block that entire UTC day. This is
  an explicit accounting rule, not a transient-error retry bug. Reconnecting alone
  cannot repair it. A reviewed automatic recovery design would need the same
  durable no-activity, stable-account/flow and ownership evidence as the existing
  initializer; never bootstrap arbitrary late equity or reset earlier losses.
- The guarded initializer's two-read broker evidence is not an atomic broker
  snapshot. Any future refactor should reject a day-boundary change during
  capture and require evidence covering the same day. This audit did not inject
  a midnight fault or assert a reproduced production accounting corruption.
- Last-24h context outcomes at observation: 279 READY; 8 `AI_HTTP_ERROR:503`;
  4 `SCENARIO_INPUT_STALE`; 4 `SCENARIO_CHART_CONTEXT_MISMATCH`;
  2 `AI_PROVIDER_TIMEOUT`; 1 `AI_ENTRY_PAIR_UNREADABLE`. Counts are journal
  outcomes, not all paid provider calls. Mean READY duration was 33,708ms,
  maximum 88,805ms. These warrant separate input/latency analysis, not attribution
  to the transport defects without evidence.
- Node is 24.21.0 while package engines require Node 22. This is environment drift,
  not a demonstrated cause. Shared in-place build artifacts and incomplete
  isolated integration qualification also remain follow-ups.

## Scope and verification

The user authorized recovery and checking for other bugs. This milestone records
recovery preflight, read-only runtime evidence, mock reproductions and bounded
repair acceptance criteria. It does not deploy additional runtime repairs or
claim permanent prevention. Shared 1% sizing, model, strategy and protection
remain unchanged. Graphify identified the session startup, daily store and client
paths; direct source inspection and mock runs established the findings.

Checks executed on September 29:

- Both populated-file policy and startup configuration checks passed. Runtime
  separately reported the same Grok model and demo strategy; the private cached
  PM2 environment was not dumped or rewritten.
- `npm test`: 756 passed in 92 files, including existing replay/fail-closed tests.
  Passing tests do not cover the four mock-reproduced sequences above.
- `npm run typecheck` and `npm run lint`: passed.
- Schema tests: 56 passed. Migration tests: 3 passed.
- Integration tests: 1 passed, 69 skipped; isolated dependencies unavailable.
- Python tests: 187 passed, 3 skipped for missing isolated database configuration.
  Ruff lint and mypy (35 files) passed.
- Full Prettier check failed on five pre-existing files; Ruff format failed on
  the existing dashboard grouping layout. This audit leaves those unrelated
  files untouched. Changed Markdown was formatted separately.
- Repository secret scan flags the existing document-filename false positives;
  changed content and staged diff are separately reviewed before commit.
- `npm audit --omit=dev --audit-level=high` reports one high-severity `fast-uri`
  dependency finding (GHSA-qw65-cvwx-89v3 and GHSA-58mr-gqgx-xq4g). This differs
  from the September 24 audit. Dependency remediation is a separate required
  follow-up; no exploit or relationship to trading stalls was demonstrated.
  Python dependency audit reports no known vulnerabilities.
- No deployment build was run: this is a documentation-only audit and rebuilding
  the shared `dist` directory would change what later service restarts load.
- Graphify query/reflection and AST update were run; its existing zero-node
  `pyproject.toml` warning remains. No paid semantic extraction was requested.

Final runtime recheck at 01:28:49: demo trading enabled, session OPEN, automation
RUNNING, no admission reasons, latest completed analysis 01:28:39.943, and the
last cycle recorded `SCENARIO_REFRESH_STARTED`. This is evidence of continued
analysis, not a claim of an additional trade during the audit.

Delivery is documentation-only on `audit/recovery-preflight-liveness`.
Full gates are not green; automatic merge must not bypass the formatting,
security or integration-qualification gaps. Runtime fixes remain open under #247.
