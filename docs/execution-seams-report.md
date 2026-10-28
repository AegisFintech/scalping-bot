# ISSUE-393 — Narrow execution seams

Child of [#391](https://github.com/AegisFintech/scalping-bot/issues/391), following
the qualified [evidence repair](fill-evidence-integrity-report.md).
This reduces maintenance coupling before the directional scalping release.
Current policy, prompt/schema bytes, broker commands, sizing, financial records,
recovery and running services are unchanged.

## Architecture assessment

The existing authority split stays intact:

```text
completed candles / quotes / broker DOM
  -> numeric analytics and causal level map
  -> isolated Codex proposal worker
  -> deterministic validation / risk / margin
  -> durable owned order intent -> broker
independent protection / reconciliation <- broker events
SELECT-only research <- recorded evidence
```

The largest maintenance risks are concentrated coordinator/composition files,
scattered version knowledge and research dictionaries with insufficient evidence
provenance. #392 repairs the last category. This batch separates existing pure
calculations without adding another state machine or broker abstraction.

## Changes and verification

- `model-execution-bounds.ts` owns entry/stop/expiry bounds and model deadline
  calculation. Both extracted blocks byte-match their previous implementation.
  The coordinator re-exports the existing interface, preserving all callers and
  74 coordinator tests.
- Provider routing derives from the existing Pydantic Literal fields. Startup
  prompt validation uses the same metadata instead of another handwritten list.
  Unknown/non-string versions reject before dispatch. Existing validators still
  own shape/provenance; published schemas are unchanged.
- Routing characterization covers all twelve versions and rejection cases.
  Targeted worker suites pass 105 tests, including existing memory, validation
  and schema compatibility. TypeScript and Python strict type checks pass.

Caller searches covered coordinator tests, worker HTTP entrypoint, request parser,
published schemas and memory. No package or setting is added. Historical contracts,
recovery implementations and frozen observers retain compatibility/evidence callers
and are kept. No production artifact, service or authentication state is removed.

## Remaining design work

#394 changes proposal economics/cardinality/lifetime and requires additive
contracts and independent lifecycle qualification. The
[cTrader model contract](https://help.ctrader.com/open-api/model-messages/) defines
GTD expiration timestamps and a distinct ORDER_EXPIRED event. Protocol support
alone does not prove a particular broker acknowledgement or race outcome.
Existing groups keep GTC/OCO semantics; a filled position's protection does not
expire with its pending entry. This refactor grants no changed order authority.

Rollback restores previous source; no migration or data transition is needed.
Full qualification/delivery results follow before handoff.

## Qualification

`PYTHONDONTWRITEBYTECODE=1 /opt/scalper-node22/bin/node scripts/qualify.mjs`
passed all required gates and dependency audits: 1,132 Node +124 PostgreSQL +544
Python tests (1,800 total). Private results:
`/tmp/scalper-qualification-CS1hPa/checks/results.json`; source SHA-256
`51b862f7e33273f8bf8a71be4feed846b07e128fb604775a0d09c0f6018b3bb4`.
The new test initially tripped Ruff's comparison-order rule; it was corrected
before qualification. One upstream Starlette/httpx warning remains. Independent
Standards and Spec reviews found no blocking finding; no deployed behavior change
or economic improvement is claimed. Staged inspection/secret scan and the AST
Graphify push gate precede remote delivery.
