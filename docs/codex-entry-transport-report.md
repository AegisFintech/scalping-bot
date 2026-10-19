# ISSUE-303 — Isolated Codex entry transport

Issue: https://github.com/AegisFintech/scalping-bot/issues/303.
Status: implementation and read-only trial; not activated for trading.

## Implemented boundary

The Python service accepts a bounded, authenticated typed HTTP request containing
completed numeric OHLC candles, a quote, deterministic entry bounds and the
versioned prompt digest. It rejects unknown fields, forming/flagged candles,
invalid ranges, gaps, future candles, stale captures/quotes and prompt mismatch.
No account, size, broker command or risk parameters are admitted. Published JSON
Schemas and Python models are checked together; semantic candle checks supplement
the structural schema. Node/Python communication is HTTP, never a shell pipeline.

Each analysis UUID claims one durable private job before invocation. Request,
complete effective prompt, hashes, available output text and success/failure
receipts are retained. Directory entries are flushed before dispatch. Duplicates,
unknown outcomes and restarts never replay an ID; a nonblocking OS lock excludes
concurrent CLI invocations. Timeout kills the subprocess group at 90 seconds.
The Node transport has a 95-second deadline, no retries/fallback, bounded response
reads, strict identity/prompt/input/time/output checks and the existing three-failure
five-minute circuit policy. The normal execution journal/cooldown is still required;
this worker is not an alternative trading scheduler.

Codex runs under a separate OS identity with an allowlisted environment, pinned
requested model `gpt-6.1-sol`, read-only sandbox, ignored user configuration/rules,
ephemeral execution and web search disabled. It proposes two positive decimal
prices only. The service has no broker/database/GitHub credentials or commands.
A fixed loopback endpoint requires an independent local transport token; that token
is not passed to the CLI. The service template bounds CPU, memory, tasks, file
size and restart rate and hides trading/PostgreSQL/research paths. It has no
installation target and has not been installed or started.

`EntryPairPlanner` now admits a trusted injected analysis client while retaining
its completed-market and output-validity checks. `CodexEntryClient` uses the shared
entry binding and requires a pre-dispatch session callback. The production factory
still constructs Grok; environment credentials alone cannot select Codex. No model
allowlist migration, provider switch, quote-adjacent fade change, economic release,
risk adjustment or order placement is included.

## Actual trial and limits

A single synthetic-candle request succeeded under the existing isolated research
login in **7.76 seconds** on October 19. It ran a root-owned temporary copy of the
worker, kept its new claim under that user's private `entry-transport-smoke`
directory and did not copy/read authentication contents or alter weekly claims.
The first launcher failed before dispatch because its explicit PATH omitted
`runuser`; using the absolute executable path fixed the launcher. One provider
request was made. This is transport/structured-output evidence, not economic or
market-latency validation.

The CLI request pins `gpt-6.1-sol`; its final-message transport does not attest the
returned backend model identity or usage. Those fields and cost remain **null**.
A subscription login succeeding once does not imply unlimited availability.
Timeout and usage-limit behavior are tested with mocks, not by consuming quota.
The CLI workflow follows [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

## Activation dependencies and rollback

Before trading activation, #301 must establish certain recovery. The provider
identity contract, exact request journal/context model allowlist and reviewed
release must explicitly admit this transport and its unknown returned identity.
The service reuses the existing isolated `scalper-research` subscription identity
without copying authentication files. Its independent local HTTP token must be
configured; no further sign-in is needed while that existing login remains valid. The reviewed current Grok policy
continues meanwhile. Changing model levels instead of the fade transform remains
a separate economic experiment under #253/#255, not a prompt-only improvement.

Rollback leaves the production factory as it is and retains private attempted-job
evidence. Never delete claims to retry unknown requests. No trading database
migration or production process restart was performed.

## Validation

The focused transport/planner suite passed 24 Node tests and the initial worker
suite passed 21 Python tests. Cases cover structured output, prompt/request/model
binding, session denial, invalid authority/size fields, stale/late outputs, failure
receipts, duplicate/restart exclusion, completed-candle rejection, bounded HTTP
authentication and environment isolation/process-group timeout. TypeScript,
Python types and focused lint passed. Schema-drift checks and full final
qualification are pending before delivery/merge.

The first full local wrapper passed formatting/lint/types/build but terminated
with signal status 143 during Node tests, without a completion receipt. A later
default-worker Node run also terminated after operational CLI test timeouts.
Neither is counted as full qualification. The suite is being rerun with two
workers; clean exact-head CI remains required for merge.

The bounded-worker rerun passes all **879 Node tests** (`npm test --
--maxWorkers=2`). All **23 Python worker/schema tests** pass, with a dependency
warning about Starlette's existing httpx test adapter; Python types/lint pass.
Two final circuit regressions distinguish pre-dispatch session denial from an
actual dispatched provider failure. Session denial cannot open the provider
circuit. Final focused tests and exact-head hosted qualification cover those cases.

Final focused verification passes **26 Node transport/planner tests** and **24
Python worker/schema tests**, including stale candle rejection and session/circuit
separation. HTTP redirects reject and the service bounds concurrent requests.
The existing authenticated research identity is reused; no new login was created.
Graphify was refreshed without provider calls (existing pyproject empty-node warning).
