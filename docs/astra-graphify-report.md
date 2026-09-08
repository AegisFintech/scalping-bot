# ISSUE-081 — Astra, Graphify and missing fills

Date: 2026-09-08. [Issue #192](https://github.com/AegisFintech/scalping-bot/issues/192).
Release: `0.2.3-equity-risk.7`; branch: `issue-081-astra-graphify`.

## Implemented

The active policy, template, populated environment, scenario consumers and tests
now use literal `gpt-6-astra/u64`. Only `AI_MODEL` changed in the populated
environment; credentials, endpoint, demo authority and mode 0600 were preserved.
The normal template still has 20 assignments; the populated file has 24.
Policy `fixed-risk-v4` remains 1% combined setup risk and 5% daily loss, with the
existing broker/margin/cost/precision constraints. Live execution stays disabled.

Old Sol contexts remain immutable and cannot authorize Astra execution. Their
five-minute request cooldown still applies. Existing migration 0017 already admits
both identities; no schema change or database migration is required. The prompt,
chart inputs, strict output contract, 90-second background deadline, independent
protective maintenance and execution policy remain unchanged.

A bounded non-trading request at 17:31:36 SGT returned HTTP 200 in 5,842 ms:
requested `gpt-6-astra/u64`, returned `gpt-6-astra`, strict boolean JSON valid.
The provider reported 4,414 input / 13 output tokens; cost remains unknown.
This small probe does not measure chart latency or strategy quality.
[Sanitized identity evidence](evidence/astra-identity.json).
Official [Astra documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
describes Responses, image input and structured output on OpenAI's service; it
does not attest EPRToken's upstream weights, `/u64` semantics or pricing.

The matching demo deployment resumed at **17:33:20 SGT**. Its first ordinary
chart request validated in **20,437 ms**, requesting Astra/u64 and returning Astra,
with 22,125 input / 502 output tokens. At **17:34:40 SGT**, an independent read-only
broker reconciliation confirmed **two pending stop-limit orders and zero positions**.
Both were 35.11 lots: BUY 4396.45 and SELL 4393.72, submitted at 17:34:11, expiring
at 17:35:04. This verifies the requested model-to-broker path, not better fills.
[Rollout evidence](evidence/astra-rollout.json) · [Dashboard](images/astra-orders.png).
Both orders subsequently expired unfilled at 17:35:04. The broker confirmed zero
orders/positions at 17:36:29, and the local check was `SCENARIO_MAP_CONSUMED`.
An intervening check reported `MARKET_DATA_HTTP_ERROR:503`; it was not a paid
model rejection. No filled-trade improvement was observed.

## Why there were no visible orders or fills

At 17:28:08 SGT, the broker confirmed zero orders and positions, certain account
state and equity USD 999,832.16. The latest local check was
`SCENARIO_MAP_CONSUMED`. Between release `.6` at 12:35 and this observation,
the journal recorded **56 submitted stop-limit orders: 43 expired, 13 cancelled,
zero fills**. Broker acceptance events exist; these are orders, not trades.
The latest pair was submitted at 17:24:32, with expiry 17:25:24. The sell was
cancelled at 17:25:04, before expiry. A later group `ANALYSIS_EXPIRED` does not
explain that earlier broker cancellation.

The execution policy consumes a map at order intent, even without a fill. Orders
have about 53 seconds remaining when broker submission completes, while model
refreshes have a five-minute minimum interval. This produces gaps with no pending
orders. Existing entry-distance/spread/cost gates can further delay placement.
Provider recovery is working better than the earlier incident: the bounded
12:27–17:28 observation had 51 validated maps, three timeouts and one pending
request. This does not establish a long-run reliability estimate.

A read-only check of **59,963 recorded quote samples** found trigger crossings
within the submission-to-expiry window for 13 orders; all 13 were subsequently
recorded cancelled with zero fill. The 43 expired orders had no recorded crossing.
Five first observed crossings were beyond the configured USD 0.05 adverse fill
range. These are 250 ms samples, with gaps and quote ages, not a full tick tape,
broker trigger log or proof of the cancellation cause. The other eight cannot be
attributed to slippage from this evidence. No reliable broker cancellation reason
was supplied. [Sampled quote evidence](evidence/order-trigger-diagnosis.json).

cTrader documents that a stop-limit can remain unfilled outside its allowed price
range. This supports investigating execution tolerance, but does not identify
our broker's cancellation reason. [Official order documentation](https://help.ctrader.com/trading-with-ctrader/orders/).

The next execution investigation is bounded: capture trigger/cancel evidence and
compare the existing expiry/one-intent policy with a longer still-valid order
lifetime on identical quotes, costs and risk. Any rearming must follow certain
terminal reconciliation and avoid duplicate or overlapping OCO exposure. A wider
fill range must be included in sizing and net-cost tests; it must not be used to
force fills. No expiry, rearming, slippage or risk-limit change is part of this
model/tooling release. The previously measured 12.5-second local decision path
also remains an execution limitation. Improved filled-trade performance is unproven.

## Graphify and concise communication

[Graphify](https://github.com/Graphify-Labs/graphify) `0.9.56` with SQL support is
installed in `/root/.local/share/graphify/venv`, separate from trading dependencies.
The CLI is available as `graphify`; its Codex skill and references are installed
under `/root/.codex/skills/graphify/`. Skill discovery is available on the next turn.
The generic skill installer rejected the upstream lowercase `skill.md`; the
official Graphify installer supplied the correctly named Codex `SKILL.md`.

The initial verified graph contained 2,786 nodes and 5,843 edges across 292 source paths,
including all 18 SQL migrations. Focused `query` and `explain` commands passed.
`.graphifyignore` and `.gitignore` exclude credentials, runtime records, generated
builds and graph output. The graph source-path audit found no excluded paths.
The final index check recorded 2,793 nodes and 5,853 edges. Updates use local
AST/SQL and structural document extraction, with no model calls.
This is a navigation aid; source and tests remain authoritative. The parser does
not produce nodes for `pyproject.toml`; no claim of complete semantic indexing is made.

```sh
graphify query "stop limit cancellation" --budget 1000
graphify explain "stopLimitProtectionFields"
graphify update .
```

The user's preference for very short replies is persisted in repository AGENTS.md
and the local global `/root/.codex/AGENTS.md`. Detailed evidence belongs in linked
reports. No conflicting `agent.md` was created.

## Validation, migration and rollback

487 Node tests, 125 Python tests, 22 schema tests, three migration tests and all
three isolated PostgreSQL/TLS integration tests passed. TypeScript/build, ESLint,
Ruff, mypy, configuration/startup checks, replay/fail-closed fixtures, secret
scanning and dependency audits passed. npm and Python audits reported no known
vulnerabilities; the isolated Graphify environment also passed pip-audit. Initial stale test aliases and generated AGENTS.md formatting
were corrected and rechecked. [Exact validation](evidence/astra-graphify-validation.json).

For installation on another host, use an isolated Python environment and install
`graphifyy[sql]==0.9.56`, then `graphify install --platform codex` and
`graphify codex install`; retain this repository's safety instructions and ignores.
Regenerate the local graph after checkout or code changes. No graph daemon,
hosted Graphify service or external semantic backend is configured.

For model rollback, pause new analyses, deploy source `f40ea81` and restore only
`AI_MODEL=gpt-5.6-sol/u40`, recreate matching AI/execution services, reconcile and
restore only the prior demo authorization. Preserve current credentials, request
cooldowns, capital state and journals; keep migration 0017. Removing the isolated
Graphify installation has no trading-runtime effect. Never reset loss locks or
enable live execution as part of rollback.
