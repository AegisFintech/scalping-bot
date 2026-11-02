# Token usage and bounded context

[#485](https://github.com/AegisFintech/scalping-bot/issues/485). Local24h audit,
not subscription billing. [Sanitized counters](evidence/token-usage-audit.json).
No message content, session IDs, credentials or account identities are published.

| Consumer                                       |   Input | Included cached input | Uncached input |
| ---------------------------------------------- | ------: | --------------------: | -------------: |
| Development and its fresh reviewers            | 287.29M |               282.79M |          4.50M |
| Trading entry worker                           |  81.63M |                68.27M |         13.36M |
| Observation, holding generation, source review |   1.46M |                 1.04M |          0.41M |

Development dominates raw input; trading dominates uncached input. In the most
recent six hours trading recorded zero usage increments (weekend closure), while
development plus reviewers recorded112.19M input. Investigation includes this
long development conversation; research timers are a small share of measured use.
Counters use cumulative positive deltas, deduplicate repeated events, and use only
the last increment at initial/reset boundaries. Fork/inherited prefixes and missing
records limit attribution. Cached input is part of input; reasoning is part of output.
Local usage events do not prove the subscription's quota formula or API cost.

There were437 durable trading claims/results, zero failed jobs and54 compaction
receipts in this window;438 usage increments include protocol/compaction accounting.
A fresh latest request averages41,532 characters:35,413 technical context,4,342
candles,1,320 execution context, plus quote/bounds/provenance. Nothing is removed.
The latest daily worker session's recorded input median was172,221 tokens, maximum
253,867. Its last retained compaction history was340,770 characters across11 items,
including multiple raw chart messages and a large summary. Repeating compaction
was retaining substantial historical chart data instead of keeping requests small.

## Change

Worker context policy `bounded-turns-v2` keeps day/model/prompt isolation and at
most four completed trading requests or one research request per thread. Before a planned rollover the
adapter resumes and verifies the exact old thread is idle and its durable state
explicitly reports a completed outcome. Pending/unknown or busy state never
justifies replacement; resume failure/corrupt state fails closed. A journaled
legacy-policy transition makes the first safe completed old context eligible for
rollover. Unknown-state handling retains its original provenance/cooldown behavior;
its safety exception can postpone rollover beyond the normal four-turn bound.

The new thread receives the same full fresh INPUT, including scoped recent
closed outcomes. Old threads, prompts, results, claims and raw journals stay intact
for learning/review. `context-rotation.json` records the predecessor/reason; no
explicit model compaction request is made. Model, reasoning, entry frequency,
market/session/reconciliation/risk gates and order protections remain unchanged.
This changes model context retention; decision outputs can differ. It is not an
economic strategy promotion, training or profitability evidence.

Matching current thread/turn server usage produces optional `token-usage.json`.
Malformed, missing or stale usage remains unknown and does not gate execution.
Cache counts are not added twice, nor are reasoning tokens. Money/subscription
charges remain null; existing public response usage remains unchanged.

Repository development config triggers auto-compaction64k and requests a compact
handoff. It does not change global credentials, model or permissions. This active
conversation may require a client compaction or fresh thread; the coding agent does
not alter an active controller's transcript. Batch reads and bounded polling,
short outputs and fresh review contexts reduce repeated history/tool overhead.
[Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `model_auto_compact_token_limit` and `compact_prompt`; installed CLI
0.166.0's generated protocol schema confirms the token-usage notification fields.
[Official caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
explains cached-input reporting; no API prices are applied to subscription counters.

## Validation and activation

Focused red/green tests, full qualification, four config checks, independent
reviews and reviewed isolated adapter activation are recorded here/on #485 before
completion. No paid inference is forced to benchmark savings. Fewer historical
messages and eliminated explicit compaction calls are deterministic; realized
usage/latency must be measured on subsequent naturally scheduled work. Economic
quality and the full unattended merge proof remain separate.

The expanded resource lanes and fresh research-thread/output reservations are documented in [learning control](learning-control-report.md).
