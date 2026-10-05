# ISSUE-222: current-release observation compatibility

The unattended CLI previously accepted only `0.x.y-market-stop.n` identifiers,
rejecting the current `0.3.0-fade-limit.3` release before any observation could
start. It now accepts the exact source `POLICY_VERSION` as well as the existing
historical market-stop syntax. Unknown fade revisions and malformed releases
still reject. Status must still match the explicitly requested release and demo
mode; duration remains bounded to 1–168 hours. No strategy authority is added.

Argument parsing is exported for direct failure tests. The checkpoint schema,
sampling cadence, counters, resume identity checks and private atomic writes are
unchanged. Both JSON Schema and runtime validation accept a current-release
checkpoint. Historical checkpoints are neither migrated nor overwritten.

## Retained operational evidence audit

Read-only inspection on October 5 found:

| Historical checkpoint      | Complete | Samples | Unavailable | Not ready |
| -------------------------- | -------- | ------- | ----------- | --------- |
| ISSUE-095 / market-stop.8  | no       | 224     | 4           | 8         |
| ISSUE-097 / market-stop.9  | no       | 4,556   | 4           | 42        |
| ISSUE-098 / market-stop.10 | yes      | 16,379  | 5,219       | 15,098    |

All three retained counters report zero sampling gaps. These are historical,
aggregate sampled-status observations, not current-release qualification.
Not-ready samples can reflect valid waiting/reconciliation, and aggregates alone
cannot establish market-open coverage, exact protected trade cycles or outages.
Elapsed time and trade-count maxima do not satisfy ISSUE-222.

Remaining acceptance: a fresh prospective window with at least 24 market-open
hours; exact protected fill/close/new-cycle journal proof; restart, reconnect,
dependency recovery and UTC rollover without manual unlocks; confirmed alert
receipt and restore of a current paired backup. No production-readiness or
profitability claim. This patch starts no service, changes no financial state,
and leaves the frozen prospective research observer and registration unchanged.

After qualified operational preparation, use a new evidence path with the
matching built release; never relabel a historical checkpoint:

```sh
node dist/scripts/observe-unattended.js --release 0.3.0-fade-limit.3 --hours 168 --output .runtime/issue-222/current-release-observation.json
```

168 hours is only a bounded collection window. Broker-calendar evidence must
independently prove the required market-open duration. Source delivery does not
assert the current running checkout has this patch or authorize a deployment.

## Validation

Focused command: `npx vitest run tests/operations/unattended-observer.test.ts
 tests/schema/unattended-observation.test.ts --maxWorkers=1`: 24 tests passed,
including current/historical acceptance, exact identity, malformed/unsupported
releases, bounded duration, counters, gaps and checkpoint-schema rejection.
Full isolated qualification results are recorded below before source handoff.

Full command: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed
all phases on Node 22.23.2 / Python 3.13.5. Results: 824 Node tests across
106 files, 70 disposable TLS database tests, 261 Python tests, no skips.
Formatting, ESLint, TypeScript/build, Ruff/mypy, JSON Schema/migrations,
replay/fail-closed coverage and secret scanning passed. Both dependency audits
reported zero vulnerabilities. Private logs:
`/tmp/scalper-qualification-TNRlFe/checks`. Graphify AST update:
5,148 nodes / 10,072 edges; no semantic-document refresh claimed.
