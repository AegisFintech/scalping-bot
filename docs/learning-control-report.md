# Two resource lanes and learning visibility

[#486](https://github.com/AegisFintech/scalping-bot/issues/486), dependent on
[#485](https://github.com/AegisFintech/scalping-bot/issues/485).

Trading proposals use explicit request1.13/response1.4 with OpenAI API
`gpt-6.1-sol`, low reasoning, fresh complete input and structured output.
The existing deterministic scalp decision, protection, expiry, sizing, reconciliation
and unknown-dispatch contracts remain authoritative. No economic promotion is added. A separately authorized subscription fallback is
described below. Old subscription contracts remain readable and immutable.
`AI_PROVIDER=codex-subscription` remains the legacy orchestrator routing label;
the new explicit request/receipt records the actual API provider. Deploy the new
producer only with the matching isolated adapter, with the approved US$20/day dollar cap.

## Budgets and context

The API worker reserves estimated micro-USD before claiming a provider request.
It uses the Responses API with standard service tier, no tools, no stored response
and no previous response ID. Output is capped4096 tokens. Private systemd
credentials provide the API key; neither the browser nor research UIDs receive it.
Returned model identity, response ID and input/output usage are validated.
Public monetary cost stays null; private charging is a conservative estimate,
not an invoice or credit-balance query. Standard model rates currently used:
input2.50/M (includes potential cache-write allowance), cached input0.10/M,
output10/M. [Official model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
Authentication/billing denial pauses new API admission; ordinary rate limiting
retains the existing durable cooldown and automatic re-evaluation. unknown dispatches retain reservations
without retry. Protective trading maintenance remains independent of the provider.

The operator additionally authorized API-first subscription fallback. Root policy
`subscriptionFallback:true` permits response1.5 with actual subscription memory
and an explicit API_DAILY_LIMIT or API_CREDIT_EXHAUSTED reason. A local daily-cap
denial selects subscription before any API dispatch. Only a bounded provider HTTP
402/429 financial code (`insufficient_quota` or `billing_hard_limit_reached`)
records credit exhaustion; that original request still fails with its normal
cooldown, and a **future normally gated request** uses subscription. There is no
second inference for that failed request. Rate limiting, authentication errors,
timeouts, unknown outcomes and malformed responses never switch providers.
Financial rejection/unknown reservations stay recorded. An authenticated API
resource update archives the current credit marker; unpause retries API on future
requests, while a manual pause without that marker waits. The API cap never changes
trading size/risk. Subscription fallback does not share learning's local token
budget, but the quota meter observes the shared subscription quota.

Learning stays subscription-funded, Sol low for observation, medium for bounded
source generation and independent source review. Every completed research request
gets a fresh thread after first verifying its predecessor idle and resolved.
Research pending/unknown context cannot authorize a replacement. Historical threads,
claims and evidence remain intact. Trading's legacy subscription adapter allows at
most four resolved turns before safe rollover. Persistent memory is not training.

Learning defaults to1,000,000 locally counted tokens per UTC day. Conservative
admission reserves four times current UTF-8 prompt bytes,24,576 protocol/schema
allowance and the model's full128,000 output-token allowance (including reasoning).
Actual matching turn usage replaces a reservation; missing usage and unknown
outcomes retain it across days. This local admission budget is separate from
subscription quota/billing; no exact conversion is claimed. The meter reads
`account/rateLimits/read` without inference every five minutes. New admissions wait
below20% reported quota or if the observation is older than15min/unavailable.
Pause blocks **new admissions**. Already admitted work may finish, including the
Root reviewer preflight reservation; this prevents a later resource pause turning
an authorized review into an ambiguous Root claim. Binding changes and redispatch
of dispatched/complete/unknown reservations reject. Conservative reservations may
make a small remaining budget unusable; the dashboard reports the specific wait.

The existing hourly evidence relevance/pacing, immutable registrations and separate
review/publishing authority remain. Empty observation windows do not call a model.
The half-hour observation slot is checked before reserving resources. Operator
focus/guidance is frozen into **new observation reviews**, never injected into old
registered experiments or privileged fixed generation tasks. New findings inform
the next evidence question; no model can arbitrarily change safety rules or trading.

## Separate console

`/learning` has its own HTML/CSS/module and lazy bounded read worker. `/` assets and
layout are unchanged. It shows API budget, reported subscription quota, measured
input/cache/output/reasoning, work and admission status, findings/window clocks,
publication links, next observation time and operator direction. Missing evidence
is explicit. GET requests never trigger inference, research jobs or broker commands.

The operator's Cloudflare Access protects `/learning` and `/api/learning` at
its private tunnel ingress. There is no second application login or session token.
The dashboard listener remains127.0.0.1:8501; the checked nginx configuration has
no route to that port. Access policy ownership stays at Cloudflare; deploy this
console only behind the protected private ingress. This does not prove that an
arbitrary future public proxy is protected: verify origin exposure on every rollout.
Writes require same-origin and an explicit control header. Private provider-control credentials stay out of responses. The console uses a dedicated forced SSH key to tc01's nonprivileged
`learning_control receive` command, with fixed HOME/PYTHONPATH; no arbitrary remote
command or paths. API resource controls use a separate credential, not the proposal
token; they can lower the root cap/pause analysis, never increase it or change risk.
Guidance is bounded1000 characters and is data, not authority.

## Deployment, data transition and rollback

New private SQLite ledgers live outside trading PostgreSQL and frozen journals:
tc01 HOME/learning-control/usage.sqlite3 and entry UID HOME/api-budget/usage.sqlite3.
This is initial schema1, created transactionally with FULL synchronization and
0600 permissions. No trading migrations or deletions. Unknown reservations are
never reset on restart, policy change, midnight or rollback. Future ledger changes
require a versioned forward migration; preserve these directories in rollback.

1. Ship reviewed exact-source research runtime, leaving frozen experiment runtime,
   oracle input domain and existing claims/reviews unchanged. Enable root-owned
   `/etc/scalper-learning/policy.json` containing the dedicated UID-home ledger path.
   Grant generation service write access only to that new control directory.
2. Install `scalper-learning-meter.service/timer`; verify an actual read-only quota
   refresh, then ordinary learning timers. No forced provider benchmark.
3. Provision the private provider-control credential/forced-key receiver and verify
   the Access-protected private origin. No local admin key is required. Start only
   the new dashboard release and verify actual process cwd and served assets;
   retain the four core trading services.
4. Ship isolated entry adapter with provider-control credential. With API policy
   absent it continues serving the old subscription contract. Root API policy
   `/etc/scalper-codex-entry/provider.json` requires explicit model/provider and
   approved dailyLimitMicroUsd. Install API key via LoadCredential using the approved US$20/day ceiling and subscriptionFallback:true. The model-access GET already passed;
   no paid inference or remaining-credit guarantee is implied.
5. Before changing producer transport, allow its current inference to finish and
   old unsubmitted proposal validity to expire; preserve accepted orders/protection.
   Activate matching producer/adapter, verify natural receipt identity/usage and
   preserved execution PIDs. Do not rewrite history or reuse prior-provider prices.

Rollback research/dashboard aliases to retained source and restore service drop-ins;
preserve all budget/evidence/credential files. API rollback requires stopping new
analysis, draining unknown/in-flight work and expired unsubmitted contexts, then
restoring the matching subscription producer/adapter. Never replay an unknown
request or reset accounting to make rollback pass.

## Evidence and limits

The token audit identifies repeated development/history input as the dominant
consumer, followed by the trading thread, not the small bounded research calls.
See [usage report](token-usage-report.md). Hypergrok's public repository supplies
useful process ideas—single-writer execution, timestamped evidence, fee-aware
review and falsifiable hypotheses. It supplies no independently verified return
or transferable XAUUSD edge: [upstream source](https://github.com/galleonlabs/hypergrok-trading-desk).
Neither a larger model nor this resource/UI work establishes profitability.

Validation and actual activation are tracked on issues485/486. The operator approved US$20/day and subscription fallback. Activation remains
pending qualification/review and runtime readback; do not infer completion.

## Reviewed qualification

Both fresh Standards and Spec reviews have no remaining findings, including the
operator-authorized hybrid delta. Regressions cover reserved-work continuation
without replay, stale quota, unknown/day rollover, concurrent admission, research
thread bounds, observation cooldown before reservation, Root reviewer admission
before claim, API financial errors and actual provider receipt identity. The
production factory exercises both API and subscription-fallback receipts.

`npm run qualify` passes formatting, lint, TypeScript/build, Node tests, Python
format/lint/mypy, secrets, npm/pip audits, isolated PostgreSQL lifecycle and all
Python tests. [Exact source receipt](evidence/learning486-qualification.json).
Four `npm run config:check -- <file> [--startup]` combinations pass for the sample
and existing deployment environment; no populated environment was replaced.
Browser fixture passes login, text safety, guidance, decimal micro-USD controls,
mobile layout and no page errors. `graphify update .` is AST-only (no API charge).
An earlier run exposed the missing browser timer global; fixed before this
successful qualification. Scope updates interrupted earlier disposable runs;
those are not claimed as successful qualification.

Reviewed merge, isolated deployment, quota refresh and actual natural provider
receipt verification are required next. No paid benchmark or order is forced.

Hosted CI caught root-owned HTTP fixture assumptions. The corrected fixtures pass as root and as the restricted entry UID; separate ownership/permissions/symlink rejection tests retain production checks. A second review also confirms transient429 errors retain normal cooldown without a permanent pause or financial fallback. Updated full local qualification passes2,586 tests (1,276 Node,147 database,1,163 Python).
